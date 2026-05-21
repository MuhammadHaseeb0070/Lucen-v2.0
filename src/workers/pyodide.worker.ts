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

function base64ToUint8Array(base64: string): Uint8Array {
  if (!base64) return new Uint8Array(0);
  try {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    console.error('base64ToUint8Array conversion failed:', err);
    return new Uint8Array(0);
  }
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

  await pyodide.runPythonAsync(`
import os
os.makedirs('/home/pyodide', exist_ok=True)
os.chdir('/home/pyodide')
  `);

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

    // Write input files
    if (d.inputFiles && Array.isArray(d.inputFiles)) {
      for (const file of d.inputFiles) {
        try {
          const bytes = base64ToUint8Array(file.data || (file as any).base64);
          py.FS.writeFile(`/home/pyodide/${file.name}`, bytes);
          ctx.postMessage({
            type: 'status',
            artifactId,
            status: 'loading_file',
            message: `Loaded: ${file.name}`
          });
        } catch (err: any) {
          throw new Error(
            `Failed to load "${file.name}": ${err.message}`
          );
        }
      }
    }

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
import sys, io
sys._lucen_orig_stdout = sys.stdout
sys._lucen_orig_stderr = sys.stderr
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
    `);

    if (code.includes('matplotlib') || code.includes('plt.')) {
      try {
        await py.runPythonAsync(`
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as _plt
    _plt.show = lambda *args, **kwargs: None
except Exception:
    pass
        `);
      } catch { /* ignore */ }
    }

    // 6. Run the code
    let runError: string | null = null;
    try {
      await py.runPythonAsync(code);
    } catch (err: any) {
      runError = err.message || String(err);
    }

    // 7. Get outputs and restore streams
    let stdout = '';
    let stderr = '';
    try {
      stdout = py.runPython('sys.stdout.getvalue()') ?? '';
      stderr = py.runPython('sys.stderr.getvalue()') ?? '';
    } catch {
      stdout = '[output capture failed]';
    }

    try {
      await py.runPythonAsync(`
try:
    import sys, io
    sys.stdout = getattr(sys, '_lucen_orig_stdout', 
                         sys.__stdout__ or io.StringIO())
    sys.stderr = getattr(sys, '_lucen_orig_stderr', 
                         sys.__stderr__ or io.StringIO())
except Exception:
    pass
      `);
    } catch { /* ignore */ }

    // 8. Scan FS for new/modified files
    let outputFiles: Array<{ name: string; data: string; mimeType: string }> = [];
    try {
      const afterMeta = getFilesMeta('/home/pyodide');

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
    } catch (err) {
      console.warn('FS scan failed:', err);
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
