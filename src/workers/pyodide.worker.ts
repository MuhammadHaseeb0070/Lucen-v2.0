const ctx: Worker = self as any;

let pyodide: any = null;

const MODE_PACKAGES: Record<string, string[]> = {
  excel: ['pandas', 'openpyxl'],
  chart: ['matplotlib', 'numpy'],
  data: ['pandas', 'numpy'],
  pdf: ['reportlab'],
  calc: ['numpy', 'sympy'],
};

const PYODIDE_NATIVE = new Set([
  'numpy', 'pandas', 'matplotlib', 'sympy', 'micropip',
]);

const OUTPUT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg', 'csv', 'xlsx', 'json', 'txt', 'pdf'];

function arrayBufferToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

interface FileMeta {
  mtime: number;
  size: number;
}

function listFilesRecursively(dir: string): string[] {
  const result: string[] = [];
  try {
    const files = pyodide.FS.readdir(dir);
    for (const file of files) {
      if (file === '.' || file === '..') continue;
      const fullPath = dir === '/' ? `/${file}` : `${dir}/${file}`;
      const stat = pyodide.FS.stat(fullPath);
      if (pyodide.FS.isDir(stat.mode)) {
        result.push(...listFilesRecursively(fullPath));
      } else {
        result.push(fullPath);
      }
    }
  } catch {
    // Ignore read errors
  }
  return result;
}

function getFilesMeta(dir: string): Map<string, FileMeta> {
  const meta = new Map<string, FileMeta>();
  const paths = listFilesRecursively(dir);
  for (const p of paths) {
    try {
      const stat = pyodide.FS.stat(p);
      meta.set(p, { mtime: stat.mtime, size: stat.size });
    } catch {
      // Ignore stat errors
    }
  }
  return meta;
}

async function initPyodide(artifactId: string) {
  if (pyodide) return pyodide;

  ctx.postMessage({
    type: 'status',
    artifactId,
    status: 'loading_pyodide',
    message: 'Setting up Python environment (~10MB first load)...'
  });

  const pyodideModule = await (Function('u', 'return import(u)')(
    'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.mjs'
  ));
  pyodide = await pyodideModule.loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/',
  });

  // Pre-load micropip for package installs
  ctx.postMessage({
    type: 'status',
    artifactId,
    status: 'loading_micropip',
    message: 'Preparing package installer...'
  });
  await pyodide.loadPackage('micropip');

  ctx.postMessage({
    type: 'status',
    artifactId,
    status: 'ready',
    message: 'Pyodide initialized.'
  });

  return pyodide;
}

function getLoadedPackageNames(py: any): Set<string> {
  return new Set(Object.keys(py.loadedPackages || {}));
}

async function installViaMicropip(py: any, pkg: string): Promise<void> {
  const micropip = py.pyimport('micropip');
  await micropip.install(pkg);
}

async function loadPackageSafe(
  py: any,
  pkg: string,
  loaded: Set<string>
): Promise<void> {
  if (loaded.has(pkg)) return;

  if (PYODIDE_NATIVE.has(pkg)) {
    await py.loadPackage(pkg);
    loaded.add(pkg);
    return;
  }

  try {
    await installViaMicropip(py, pkg);
    loaded.add(pkg);
  } catch (err) {
    console.warn(`Failed to install package via micropip: ${pkg}`, err);
  }
}

async function loadPackagesList(
  py: any,
  pkgs: string[],
  artifactId: string,
  statusMessage: string
): Promise<void> {
  if (pkgs.length === 0) return;

  ctx.postMessage({
    type: 'status',
    artifactId,
    status: 'installing_packages',
    message: statusMessage,
  });

  const loaded = getLoadedPackageNames(py);
  for (const pkg of pkgs) {
    await loadPackageSafe(py, pkg, loaded);
  }
}

ctx.addEventListener('message', async (e: MessageEvent) => {
  const d = e.data;
  if (!d || d.type !== 'run') return;

  const { code, packages = [], mode, artifactId } = d;

  try {
    // 1. Lazy load Pyodide
    const py = await initPyodide(artifactId);

    const modeKey = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
    const modePkgs = modeKey && MODE_PACKAGES[modeKey] ? MODE_PACKAGES[modeKey] : [];

    // 2. Mode-first package loading
    if (modePkgs.length > 0) {
      await loadPackagesList(
        py,
        modePkgs,
        artifactId,
        `Loading packages for ${modeKey} mode...`
      );
    }

    // 3. Extra packages from artifact attribute (deduped, skip mode packages)
    const extraPackages = [...new Set(
      (packages as string[])
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 0)
    )].filter((pkg) => !modePkgs.includes(pkg));

    if (extraPackages.length > 0) {
      await loadPackagesList(
        py,
        extraPackages,
        artifactId,
        `Loading ${extraPackages.join(', ')}...`
      );
    }

    // 4. Safety net: loadPackagesFromImports
    try {
      await py.loadPackagesFromImports(code);
    } catch (err) {
      console.warn('loadPackagesFromImports failed:', err);
    }

    ctx.postMessage({
      type: 'status',
      artifactId,
      status: 'running',
      message: 'Executing script...'
    });

    // 4. Snapshot FS before execution
    const beforeMeta = getFilesMeta('/home/pyodide');

    // 5. Redirect stdout/stderr & Inject Matplotlib backend
    await py.runPythonAsync(`
import sys
import io
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
`);

    if (code.includes('matplotlib') || code.includes('plt.')) {
      await py.runPythonAsync(`
import matplotlib
matplotlib.use('Agg')
`);
    }

    // 6. Run the code
    let runError: string | null = null;
    try {
      await py.runPythonAsync(code);
    } catch (err: any) {
      runError = err.message || String(err);
    }

    // 7. Get outputs and restore streams
    const stdout = py.runPython('sys.stdout.getvalue()');
    const stderr = py.runPython('sys.stderr.getvalue()');
    py.runPython(`
sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__
`);

    // 8. Scan FS for new/modified files
    const afterMeta = getFilesMeta('/home/pyodide');
    const outputFiles: Array<{ name: string; data: string; mimeType: string }> = [];

    for (const [p, meta] of afterMeta.entries()) {
      const before = beforeMeta.get(p);
      if (!before || before.size !== meta.size || before.mtime !== meta.mtime) {
        const ext = p.split('.').pop()?.toLowerCase();
        if (ext && OUTPUT_EXTENSIONS.includes(ext)) {
          try {
            const contentBytes = py.FS.readFile(p);
            const base64Data = arrayBufferToBase64(contentBytes);
            
            let mimeType = 'text/plain';
            if (ext === 'png') mimeType = 'image/png';
            else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
            else if (ext === 'svg') mimeType = 'image/svg+xml';
            else if (ext === 'csv') mimeType = 'text/csv';
            else if (ext === 'xlsx') mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            else if (ext === 'json') mimeType = 'application/json';
            else if (ext === 'pdf') mimeType = 'application/pdf';

            const name = p.replace(/^\/home\/pyodide\//, '');
            outputFiles.push({ name, data: base64Data, mimeType });
          } catch (err) {
            console.error(`Failed to read output file ${p}`, err);
          }
        }
      }
    }

    // 9. Post back results
    ctx.postMessage({
      type: 'result',
      artifactId,
      stdout,
      stderr,
      files: outputFiles,
      error: runError
    });

  } catch (err: any) {
    ctx.postMessage({
      type: 'result',
      artifactId,
      stdout: '',
      stderr: '',
      files: [],
      error: err.message || String(err)
    });
  }
});
