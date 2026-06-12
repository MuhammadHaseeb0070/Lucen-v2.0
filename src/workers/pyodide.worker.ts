const ctx: Worker = self as any;

let pyodide: any = null;
let currentArtifactId = '';
let proxyBaseUrl = import.meta.env.VITE_SUPABASE_URL ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pyodide-proxy?url=` : '';

const originalFetch = globalThis.fetch;
globalThis.fetch = async function(input, init) {
  let urlStr = '';
  if (typeof input === 'string') {
    urlStr = input;
  } else if (input instanceof Request) {
    urlStr = input.url;
  } else if (input instanceof URL) {
    urlStr = input.toString();
  }

  const isExternal = urlStr.includes('pypi.org') || 
                     urlStr.includes('pythonhosted.org') || 
                     urlStr.includes('jsdelivr.net');

  try {
    return await originalFetch(input, init);
  } catch (err: any) {
    // Network errors typically throw TypeError in fetch
    if (err.name === 'TypeError' && proxyBaseUrl && isExternal) {
      if (currentArtifactId) {
        ctx.postMessage({ type: 'status', artifactId: currentArtifactId, stage: 'packages', message: 'Network blocked. Routing request via backend proxy...' });
      }
      const proxiedUrl = `${proxyBaseUrl}${encodeURIComponent(urlStr)}`;
      return originalFetch(proxiedUrl, init);
    }
    throw err;
  }
};

// Output extensions tracked by the worker
const OUTPUT_EXTENSIONS = ['xlsx', 'xls', 'csv', 'png', 'jpg', 'jpeg', 'pdf', 'json', 'txt', 'zip', 'docx'];

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
  if (!pyodide) {
    ctx.postMessage({ type: 'status', artifactId, stage: 'init', 
      message: 'Setting up Python environment...' });

    const CDN_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/';
    const CDN_MJS = `${CDN_URL}pyodide.mjs`;

    let pyodideModule;
    try {
      pyodideModule = await (Function('u', 'return import(u)')(CDN_MJS));
      pyodide = await pyodideModule.loadPyodide({
        indexURL: CDN_URL,
      });
    } catch (err: any) {
      if (proxyBaseUrl) {
        ctx.postMessage({ type: 'status', artifactId, stage: 'init',
          message: 'Network block detected. Initiating secure backend proxy fallback...' });
        
        const fallbackMjs = `${proxyBaseUrl}${encodeURIComponent(CDN_MJS)}`;
        const fallbackIndex = `${proxyBaseUrl}${encodeURIComponent(CDN_URL)}`;
        pyodideModule = await (Function('u', 'return import(u)')(fallbackMjs));
        pyodide = await pyodideModule.loadPyodide({
          indexURL: fallbackIndex,
        });
      } else {
        throw err;
      }
    }

    await pyodide.runPythonAsync(`
import os
os.makedirs('/home/pyodide', exist_ok=True)
os.chdir('/home/pyodide')
`);
    
    // Always load micropip natively
    await pyodide.loadPackage('micropip');
  }

  return pyodide;
}

function getMimeType(ext: string): string {
  const types: Record<string, string> = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
  currentArtifactId = artifactId;

  try {
    const py = await initPyodide(artifactId);
    clearWorkspace(py);

    // Setup streaming callback on the worker global scope
    (self as any).emit_stream = (stream: string, text: string) => {
      ctx.postMessage({ type: 'stream', artifactId, stream: stream as 'stdout' | 'stderr', text });
    };

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

    // 1. Resolve Native packages automatically
    ctx.postMessage({ type: 'status', artifactId, stage: 'packages', 
      message: 'Resolving native dependencies...' });
    await py.loadPackagesFromImports(code);

    // 2. Resolve Pip packages from # pip: header
    const pipRegex = /#\s*pip:\s*(.+)/gi;
    const pipPackages = new Set<string>();
    let match;
    while ((match = pipRegex.exec(code)) !== null) {
      match[1].split(',').forEach(p => pipPackages.add(p.trim()));
    }

    if (pipPackages.size > 0) {
      ctx.postMessage({ type: 'status', artifactId, stage: 'packages', 
        message: 'Installing pip dependencies...' });
      const micropip = py.pyimport('micropip');
      for (const pkg of pipPackages) {
        if (pkg) await micropip.install(pkg);
      }
      micropip.destroy();
    }

    ctx.postMessage({ type: 'status', artifactId, stage: 'running', 
      message: 'Running script...' });

    const beforeMeta = getFilesMeta('/home/pyodide');

    // Redirect stdout/stderr with a custom streaming wrapper
    await py.runPythonAsync(`
import sys, io
import js

class StreamWrapper:
    def __init__(self, stream_name):
        self.stream_name = stream_name
        self.buffer = io.StringIO()

    def write(self, text):
        self.buffer.write(text)
        try:
            js.emit_stream(self.stream_name, text)
        except Exception:
            pass

    def flush(self):
        pass

    def getvalue(self):
        return self.buffer.getvalue()

sys.stdout = StreamWrapper('stdout')
sys.stderr = StreamWrapper('stderr')
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

    // Execute with timeout and self-healing loop
    let runError: string | null = null;
    const TIMEOUT_MS = 60000;
    let retryCount = 0;
    const MAX_RETRIES = 2;

    while (retryCount <= MAX_RETRIES) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(
            'Script timed out after 60 seconds. It may contain an infinite loop or process too much data.'
          )), TIMEOUT_MS)
        );
        await Promise.race([py.runPythonAsync(code), timeoutPromise]);
        runError = null; // Success!
        break;
      } catch (err: any) {
        runError = err.message || String(err);
        
        // Auto-healing for missed pip packages
        const moduleMatch = runError?.match(/ModuleNotFoundError: No module named '([^']+)'/);
        if (moduleMatch && retryCount < MAX_RETRIES) {
          const missingModule = moduleMatch[1];
          ctx.postMessage({ type: 'status', artifactId, stage: 'packages', 
            message: `Auto-installing missing module: ${missingModule}...` });
          
          try {
            const micropip = py.pyimport('micropip');
            // Map common module names to pip package names
            let pkgToInstall = missingModule;
            if (missingModule === 'docx') pkgToInstall = 'python-docx';
            else if (missingModule === 'PIL') pkgToInstall = 'Pillow';
            else if (missingModule === 'bs4') pkgToInstall = 'beautifulsoup4';
            else if (missingModule === 'sklearn') pkgToInstall = 'scikit-learn';
            
            await micropip.install(pkgToInstall);
            micropip.destroy();
            
            retryCount++;
            ctx.postMessage({ type: 'status', artifactId, stage: 'running', 
              message: 'Retrying script execution...' });
            continue; // Retry execution
          } catch (installErr) {
            runError = `Failed to auto-install missing module '${missingModule}': ${installErr}`;
            break; // Break if we can't install it
          }
        }
        break; // Break if not ModuleNotFoundError or out of retries
      }
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
