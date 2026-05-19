const ctx: Worker = self as any;

let pyodide: any = null;

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

function rmRecursive(py: any, path: string) {
  const stat = py.FS.stat(path);
  if (py.FS.isDir(stat.mode)) {
    for (const name of py.FS.readdir(path)) {
      if (name === '.' || name === '..') continue;
      rmRecursive(py, path.endsWith('/') ? `${path}${name}` : `${path}/${name}`);
    }
    py.FS.rmdir(path);
  } else {
    py.FS.unlink(path);
  }
}

/** Wipe output files from prior artifact runs in this shared worker. */
function clearWorkspace(py: any) {
  const dir = '/home/pyodide';
  try {
    for (const name of py.FS.readdir(dir)) {
      if (name === '.' || name === '..') continue;
      rmRecursive(py, `${dir}/${name}`);
    }
  } catch {
    // Directory may not exist yet on first run
  }
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

async function installPackagesDynamic(
  py: any,
  packages: string[],
  code: string,
  artifactId: string
): Promise<void> {
  // Step 1: Let Pyodide auto-detect and load its own native packages
  // from import statements in the code
  try {
    ctx.postMessage({
      type: 'status',
      artifactId,
      status: 'installing_packages',
      message: 'Scanning imports...',
    });
    await py.loadPackagesFromImports(code);
  } catch (err) {
    console.warn('loadPackagesFromImports error:', err);
  }

  // Step 2: For explicitly requested packages, check Pyodide's runtime registry
  if (packages.length === 0) return;

  const repoPackages: Record<string, unknown> = py._api?.repodata_packages ?? {};
  const alreadyLoaded = new Set(Object.keys(py.loadedPackages ?? {}));

  const nativeToLoad: string[] = [];
  const pipToInstall: string[] = [];

  for (const pkg of packages) {
    const normalized = pkg.trim().toLowerCase();
    if (!normalized) continue;
    if (alreadyLoaded.has(pkg) || alreadyLoaded.has(normalized)) continue;

    const isNative =
      normalized in repoPackages ||
      pkg in repoPackages ||
      Object.keys(repoPackages).some((k) => k.toLowerCase() === normalized);

    if (isNative) {
      nativeToLoad.push(pkg);
    } else {
      pipToInstall.push(pkg);
    }
  }

  if (nativeToLoad.length > 0) {
    ctx.postMessage({
      type: 'status',
      artifactId,
      status: 'installing_packages',
      message: `Loading ${nativeToLoad.join(', ')}...`,
    });
    await py.loadPackage(nativeToLoad);
  }

  if (pipToInstall.length > 0) {
    ctx.postMessage({
      type: 'status',
      artifactId,
      status: 'installing_packages',
      message: `Downloading ${pipToInstall.join(', ')} from PyPI...`,
    });
    await py.loadPackage('micropip');
    const micropip = py.pyimport('micropip');
    await Promise.all(
      pipToInstall.map((pkg) =>
        micropip.install(pkg).catch((err: unknown) => {
          console.warn(`micropip could not install ${pkg}:`, err);
        })
      )
    );
  }
}

ctx.addEventListener('message', async (e: MessageEvent) => {
  const d = e.data;
  if (!d || d.type !== 'run') return;

  const { code, packages = [], mode: _mode, artifactId } = d;

  try {
    // 1. Lazy load Pyodide
    const py = await initPyodide(artifactId);

    const packageList = [...new Set(
      (packages as string[])
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 0)
    )];

    // 2. Dynamic package installation (imports + packages attribute)
    await installPackagesDynamic(py, packageList, code, artifactId);

    clearWorkspace(py);

    ctx.postMessage({
      type: 'status',
      artifactId,
      status: 'running',
      message: 'Executing script...'
    });

    // 3. Snapshot FS before execution (empty workspace for this artifact only)
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
