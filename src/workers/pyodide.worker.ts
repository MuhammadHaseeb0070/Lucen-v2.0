const ctx: Worker = self as any;

let pyodide: any = null;

// Only Excel-relevant output extensions are tracked
const OUTPUT_EXTENSIONS = ['xlsx', 'xls', 'csv', 'png', 'jpg', 'jpeg', 'pdf', 'json', 'txt', 'zip'];

// WHITELISTED libraries for Excel work — all are Pyodide-native, no micropip needed
// openpyxl: read/write xlsx, full formatting, charts, images
// xlsxwriter: write xlsx with advanced chart API (write-only)
// pandas: data manipulation, CSV to Excel, transformations
// numpy: numerical calculations
// matplotlib: chart images to embed in Excel
// Pillow: image processing before Excel embedding
const EXCEL_NATIVE_PACKAGES = ['openpyxl', 'xlsxwriter', 'pandas', 'numpy', 'matplotlib', 'Pillow'];

function arrayBufferToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

interface FileMeta { mtime: number; size: number; }

function listFilesRecursively(dir: string): string[] {
  const result: string[] = [];
  try {
    const files = pyodide.FS.readdir(dir);
    for (const file of files) {
      if (file === '.' || file === '..') continue;
      const fullPath = `${dir}/${file}`;
      const stat = pyodide.FS.stat(fullPath);
      if (pyodide.FS.isDir(stat.mode)) {
        result.push(...listFilesRecursively(fullPath));
      } else {
        result.push(fullPath);
      }
    }
  } catch { /* ignore */ }
  return result;
}

function getFilesMeta(dir: string): Map<string, FileMeta> {
  const meta = new Map<string, FileMeta>();
  for (const p of listFilesRecursively(dir)) {
    try {
      const stat = pyodide.FS.stat(p);
      meta.set(p, { mtime: stat.mtime, size: stat.size });
    } catch { /* ignore */ }
  }
  return meta;
}

function clearWorkspace(py: any) {
  const dir = '/home/pyodide';
  try {
    for (const name of py.FS.readdir(dir)) {
      if (name === '.' || name === '..') continue;
      const p = `${dir}/${name}`;
      try {
        const stat = py.FS.stat(p);
        if (py.FS.isDir(stat.mode)) {
          // recursively remove dirs
          const rmRecursive = (path: string) => {
            for (const n of py.FS.readdir(path)) {
              if (n === '.' || n === '..') continue;
              const fp = `${path}/${n}`;
              const s = py.FS.stat(fp);
              if (py.FS.isDir(s.mode)) rmRecursive(fp);
              else py.FS.unlink(fp);
            }
            py.FS.rmdir(path);
          };
          rmRecursive(p);
        } else {
          py.FS.unlink(p);
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

async function initPyodide(artifactId: string) {
  if (pyodide) return pyodide;

  ctx.postMessage({ type: 'status', artifactId, stage: 'init',
    message: 'Setting up Python environment...' });

  const pyodideModule = await (Function('u', 'return import(u)')(
    'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.mjs'
  ));
  pyodide = await pyodideModule.loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/',
  });

  ctx.postMessage({ type: 'status', artifactId, stage: 'packages',
    message: 'Loading Excel libraries...' });

  // Load all whitelisted packages upfront — these are Pyodide-native,
  // no network download needed after first load
  await pyodide.loadPackage(EXCEL_NATIVE_PACKAGES);

  await pyodide.runPythonAsync(`
import os
os.makedirs('/home/pyodide', exist_ok=True)
os.chdir('/home/pyodide')
`);

  ctx.postMessage({ type: 'status', artifactId, stage: 'ready',
    message: 'Ready.' });

  return pyodide;
}

function getMimeType(ext: string): string {
  const types: Record<string, string> = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    csv: 'text/csv',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    pdf: 'application/pdf',
    json: 'application/json',
    txt: 'text/plain',
    zip: 'application/zip',
  };
  return types[ext] || 'application/octet-stream';
}

ctx.addEventListener('message', async (e: MessageEvent) => {
  const d = e.data;
  if (!d || d.type !== 'run') return;

  const { code, artifactId, inputFiles } = d;

  try {
    const py = await initPyodide(artifactId);
    clearWorkspace(py);

    // Mount input files
    if (inputFiles && Array.isArray(inputFiles)) {
      for (const file of inputFiles) {
        try {
          py.FS.writeFile(`/home/pyodide/${file.name}`, base64ToUint8Array(file.data));
          ctx.postMessage({ type: 'status', artifactId, stage: 'input',
            message: `Loaded: ${file.name}` });
        } catch (err: any) {
          throw new Error(`Could not load input file "${file.name}": ${err.message}`);
        }
      }
    }

    ctx.postMessage({ type: 'status', artifactId, stage: 'running',
      message: 'Running script...' });

    const beforeMeta = getFilesMeta('/home/pyodide');

    // Redirect stdout/stderr
    await py.runPythonAsync(`
import sys, io
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
`);

    // Set matplotlib to headless mode
    await py.runPythonAsync(`
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams['figure.dpi'] = 150
except Exception:
    pass
`);

    // Execute with timeout
    let runError: string | null = null;
    const TIMEOUT_MS = 60000;
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(
          'Script timed out after 60 seconds. It may contain an infinite loop or process too much data.'
        )), TIMEOUT_MS)
      );
      await Promise.race([py.runPythonAsync(code), timeoutPromise]);
    } catch (err: any) {
      runError = err.message || String(err);
    }

    // Capture stdout/stderr
    let stdout = '';
    let stderr = '';
    try {
      stdout = py.runPython('sys.stdout.getvalue()') ?? '';
      stderr = py.runPython('sys.stderr.getvalue()') ?? '';
    } catch { stdout = ''; }

    // Restore streams
    try {
      await py.runPythonAsync(`
import sys, io
sys.stdout = sys.__stdout__ or io.StringIO()
sys.stderr = sys.__stderr__ or io.StringIO()
`);
    } catch { /* ignore */ }

    // Scan for output files
    const outputFiles: Array<{ name: string; data: string; mimeType: string }> = [];
    try {
      const afterMeta = getFilesMeta('/home/pyodide');
      for (const [p, meta] of afterMeta.entries()) {
        const before = beforeMeta.get(p);
        const isNew = !before || before.size !== meta.size || before.mtime !== meta.mtime;
        if (!isNew) continue;
        const ext = p.split('.').pop()?.toLowerCase() || '';
        if (!OUTPUT_EXTENSIONS.includes(ext)) continue;
        try {
          const bytes = py.FS.readFile(p);
          outputFiles.push({
            name: p.replace('/home/pyodide/', ''),
            data: arrayBufferToBase64(bytes),
            mimeType: getMimeType(ext),
          });
        } catch { /* ignore single file read error */ }
      }
    } catch { /* ignore fs scan error */ }

    ctx.postMessage({
      type: 'result',
      artifactId,
      stdout,
      stderr,
      files: outputFiles,
      error: runError,
    });

  } catch (err: any) {
    ctx.postMessage({
      type: 'result',
      artifactId,
      stdout: '',
      stderr: '',
      files: [],
      error: err.message || String(err),
    });
  }
});
