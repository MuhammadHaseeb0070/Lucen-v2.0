const ctx: Worker = self as any;

let pyodide: any = null;

const STANDARD_LIBS = new Set([
  'sys', 'os', 'math', 'json', 're', 'csv', 'datetime', 'time', 'collections',
  'itertools', 'functools', 'random', 'hashlib', 'io', 'base64', 'ast',
  'pathlib', 'tempfile', 'shutil', 'subprocess', 'threading', 'xml', 'uuid',
  'copy', 'pickle', 'logging', 'urllib', 'http', 'socket', 'struct', 'select'
]);

function findImports(code: string): string[] {
  const imports = new Set<string>();
  const lines = code.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('import ')) {
      const parts = trimmed.substring(7).split(',');
      for (const part of parts) {
        const mod = part.trim().split(/\s+/)[0];
        if (mod) {
          imports.add(mod.split('.')[0]);
        }
      }
    } else if (trimmed.startsWith('from ')) {
      const match = trimmed.match(/^from\s+([a-zA-Z0-9_]+)/);
      if (match && match[1]) {
        imports.add(match[1]);
      }
    }
  }
  return Array.from(imports);
}

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
    message: 'Loading Pyodide environment (~10MB)...'
  });

  const pyodideModule = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.mjs');
  pyodide = await pyodideModule.loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/',
  });

  // Pre-load micropip for package installs
  await pyodide.loadPackage('micropip');

  ctx.postMessage({
    type: 'status',
    artifactId,
    status: 'ready',
    message: 'Pyodide initialized.'
  });

  return pyodide;
}

ctx.addEventListener('message', async (e: MessageEvent) => {
  const d = e.data;
  if (!d || d.type !== 'run') return;

  const { code, packages = [], artifactId } = d;

  try {
    // 1. Lazy load Pyodide
    const py = await initPyodide(artifactId);

    // 2. Install explicitly requested packages
    if (packages.length > 0) {
      ctx.postMessage({
        type: 'status',
        artifactId,
        status: 'installing_packages',
        message: `Installing explicit packages: ${packages.join(', ')}...`
      });
      const micropip = py.pyimport('micropip');
      await Promise.all(packages.map((pkg: string) => micropip.install(pkg)));
    }

    // 3. Scan imports and auto-install fallback packages
    const imports = findImports(code).filter(pkg => !STANDARD_LIBS.has(pkg));
    if (imports.length > 0) {
      ctx.postMessage({
        type: 'status',
        artifactId,
        status: 'installing_packages',
        message: 'Resolving and loading imports...'
      });
      
      // Load any pre-compiled Pyodide packages from imports
      await py.loadPackagesFromImports(code);

      // Install pure python packages from PyPI using micropip if not already loaded
      const micropip = py.pyimport('micropip');
      const loadedPackages = new Set(Object.keys(py.loadedPackages));
      const toInstall = imports.filter(pkg => !loadedPackages.has(pkg));

      if (toInstall.length > 0) {
        ctx.postMessage({
          type: 'status',
          artifactId,
          status: 'installing_packages',
          message: `Installing auto-detected packages: ${toInstall.join(', ')}...`
        });
        await Promise.all(
          toInstall.map((pkg: string) =>
            micropip.install(pkg).catch((err: any) => {
              console.warn(`Failed to auto-install package: ${pkg}`, err);
            })
          )
        );
      }
    }

    ctx.postMessage({
      type: 'status',
      artifactId,
      status: 'running',
      message: 'Running code...'
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
        if (ext && ['png', 'jpg', 'jpeg', 'svg', 'csv', 'xlsx', 'json', 'txt'].includes(ext)) {
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
