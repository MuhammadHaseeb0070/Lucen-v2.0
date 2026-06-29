const ctx: Worker = self as any;

let pyodide: any = null;
let currentArtifactId = '';

// The Supabase project URL is injected at build time via Vite's import.meta.env
const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
// Path-forwarding proxy base for Pyodide CDN assets.
// Pyodide appends filenames to indexURL directly, so we need a clean base path,
// not a ?url= query param. The proxy maps /cdn/ → cdn.jsdelivr.net/
const PROXY_INDEX_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1/pyodide-proxy/cdn/`
  : '';
// Query-param proxy for micropip/PyPI (these go to known full URLs)
const PROXY_QUERY_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1/pyodide-proxy?url=`
  : '';

const CDN_BASE = 'https://cdn.jsdelivr.net/';
const CDN_URL = `${CDN_BASE}pyodide/v0.26.2/full/`;
const CDN_MJS = `${CDN_URL}pyodide.mjs`;

/** 
 * Probe whether the CDN is reachable from this browser environment.
 * Returns true if directly accessible, false if blocked (CORS/firewall).
 */
async function probeCdnReachable(): Promise<boolean> {
  try {
    // Probe with a tiny known file to avoid loading the whole 10MB wasm
    const res = await originalFetch(`${CDN_URL}pyodide.mjs`, { method: 'HEAD' });
    return res.ok || res.status === 405; // 405 = HEAD not allowed but server reached
  } catch {
    return false;
  }
}

/** Returns headers needed to call the Supabase Edge Function proxy */
function proxyHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (SUPABASE_ANON_KEY) h['apikey'] = SUPABASE_ANON_KEY;
  return h;
}

/**
 * Global fetch interceptor — intercepts PyPI/CDN requests and retries
 * through proxy if the direct request fails (TypeError = network block).
 * This covers micropip.install() calls automatically.
 */
const originalFetch = globalThis.fetch;
globalThis.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let urlStr = '';
  if (typeof input === 'string') {
    urlStr = input;
  } else if (input instanceof Request) {
    urlStr = input.url;
  } else if (input instanceof URL) {
    urlStr = input.toString();
  }

  // Detect URLs that need to be re-routed through our proxy (CDN/PyPI direct calls)
  const isProxiable = PROXY_QUERY_BASE && (
    urlStr.includes('pypi.org') ||
    urlStr.includes('pythonhosted.org') ||
    urlStr.includes('jsdelivr.net')
  );

  // Detect URLs that ARE already our Supabase proxy — these need auth headers injected.
  // This covers Pyodide's internal wheel fetches: Pyodide constructs URLs using
  // indexURL as the base, so internal fetches go directly to our Supabase proxy URL.
  // Without the apikey header, Supabase's gateway rejects them with 401, which the
  // browser shows as "Fetch API cannot load" (the 401 may lack CORS headers).
  const supabaseProxyOrigin = SUPABASE_URL ? new URL(SUPABASE_URL).origin : '';
  const isOwnProxyUrl = supabaseProxyOrigin && urlStr.startsWith(supabaseProxyOrigin) && urlStr.includes('/pyodide-proxy/');

  if (isOwnProxyUrl && SUPABASE_ANON_KEY) {
    let originalHeaders: any = {};
    if (input instanceof Request) {
       originalHeaders = Object.fromEntries((input.headers as any).entries());
    }
    const initHeaders = (init as any)?.headers || {};
    
    init = {
      ...(init || {}),
      headers: { ...originalHeaders, ...initHeaders, ...proxyHeaders() },
    };
  }

  try {
    return await originalFetch(input, init);
  } catch (err: any) {
    // If it's a TypeError (Network/CORS failure)
    if (err.name === 'TypeError') {
      if (isOwnProxyUrl) {
        // Transient proxy error (e.g. 502 Gateway timeout lacking CORS headers under load)
        // Retry it after a short delay
        if (currentArtifactId) {
          ctx.postMessage({
            type: 'status',
            artifactId: currentArtifactId,
            stage: 'packages',
            message: 'Proxy network hiccup. Retrying...',
          });
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        return originalFetch(input, init);
      } else if (isProxiable) {
      if (currentArtifactId) {
        ctx.postMessage({
          type: 'status',
          artifactId: currentArtifactId,
          stage: 'packages',
          message: 'Network blocked. Routing via backend proxy...',
        });
      }
      const proxied = `${PROXY_QUERY_BASE}${encodeURIComponent(urlStr)}`;
      const proxiedInit = { ...(init || {}), headers: { ...((init as any)?.headers || {}), ...proxyHeaders() } };
      return originalFetch(proxied, proxiedInit);
      }
    }
    throw err;
  }
};

/** Make a fetch request through the proxy with auth headers */
async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  return originalFetch(url, { ...init, headers: { ...((init as any)?.headers || {}), ...proxyHeaders() } });
}

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

    // Step 1: Probe whether CDN is directly reachable from this browser
    const cdnReachable = await probeCdnReachable();

    let indexURL: string;

    if (!cdnReachable && PROXY_INDEX_BASE) {
      // CDN is blocked — use path-forwarding proxy.
      // We CANNOT just dynamic import() from the proxy URL because the ES Module
      // loader bypasses our fetch interceptor. Instead, we:
      // 1. Fetch the .mjs content as text through our auth-aware proxyFetch
      // 2. Create a Blob URL from the text
      // 3. import() the blob URL (same-origin, no CORS issues)
      // 4. Set indexURL to the proxy path so Pyodide fetches subsequent
      //    files (.wasm, .json, etc.) through the fetch interceptor automatically
      ctx.postMessage({ type: 'status', artifactId, stage: 'init',
        message: 'Network block detected. Initiating secure backend proxy fallback...' });

      const pyodidePath = 'pyodide/v0.26.2/full/';
      indexURL = `${PROXY_INDEX_BASE}${pyodidePath}`;
      const proxyMjsUrl = `${indexURL}pyodide.mjs`;
      
      // Fetch the module text through our proxy (passes apikey header)
      const mjsText = await proxyFetch(proxyMjsUrl).then(r => r.text());
      const blob = new Blob([mjsText], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      try {
        const pyodideModule = await (Function('u', 'return import(u)')(blobUrl));
        pyodide = await pyodideModule.loadPyodide({ indexURL });
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    } else {
      // CDN is reachable — use it directly (fast path, normal case)
      const pyodideModule = await (Function('u', 'return import(u)')(CDN_MJS));
      pyodide = await pyodideModule.loadPyodide({ indexURL: CDN_URL });
    }

    await pyodide.runPythonAsync(`
import os
os.makedirs('/home/pyodide', exist_ok=True)
os.chdir('/home/pyodide')
`);
    
    // Always load micropip + packaging together.
    // 'packaging' is a runtime dependency of micropip that Pyodide does NOT
    // auto-install. In CDN-blocked environments the lazy .whl fetch for
    // 'packaging' silently fails, causing "No module named 'packaging'" when
    // micropip tries to import it. Loading them as a batch ensures both wheels
    // are downloaded and registered before any Python import runs.
    await pyodide.loadPackage(['packaging', 'micropip']);
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

const taskQueue: MessageEvent[] = [];
let isRunningTask = false;

async function processTaskQueue() {
  if (isRunningTask) return;
  isRunningTask = true;
  while (taskQueue.length > 0) {
    const e = taskQueue.shift();
    if (e) {
      await handleRunTask(e);
    }
  }
  isRunningTask = false;
}

ctx.addEventListener('message', (e: MessageEvent) => {
  const d = e.data;
  if (!d || d.type !== 'run') return;
  taskQueue.push(e);
  processTaskQueue();
});

async function handleRunTask(e: MessageEvent) {
  const d = e.data;
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
      
      const pkgList = Array.from(pipPackages).filter(Boolean);
      if (pkgList.length > 0) {
        const pyList = pkgList.map(p => `"${p}"`).join(', ');
        await py.runPythonAsync(`
import micropip
await micropip.install([${pyList}])
`);
      }
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
      // Inject Sandbox Polyfills to prevent common AI hallucinations from crashing execution
      // Placed inside the retry loop so they apply AFTER any auto-installed packages are available
      await py.runPythonAsync(`
# Polyfill for fpdf2
try:
    import fpdf
    if hasattr(fpdf.FPDF, 'add_font'):
        _orig_add_font = fpdf.FPDF.add_font
        def safe_add_font(self, family, style="", fname="", uni=False, **kwargs):
            try:
                _orig_add_font(self, family, style, fname, uni, **kwargs)
            except Exception:
                pass # Silently fallback to default fonts
        fpdf.FPDF.add_font = safe_add_font
    
    if hasattr(fpdf.FPDF, 'image'):
        _orig_image = fpdf.FPDF.image
        def safe_image(self, name, x=None, y=None, w=0, h=0, type='', link='', **kwargs):
            import os
            if isinstance(name, str) and not name.startswith('http') and not os.path.exists(name):
                return # Ignore silently
            try:
                _orig_image(self, name, x, y, w, h, type, link, **kwargs)
            except Exception:
                pass
        fpdf.FPDF.image = safe_image
except Exception:
    pass

# Polyfill for python-docx
try:
    import docx
    if hasattr(docx.Document, 'add_picture'):
        _orig_add_picture = docx.Document.add_picture
        def safe_add_picture(self, image_path_or_stream, width=None, height=None):
            import os
            if isinstance(image_path_or_stream, str) and not os.path.exists(image_path_or_stream):
                return # Ignore silently
            try:
                return _orig_add_picture(self, image_path_or_stream, width, height)
            except Exception:
                pass
        docx.Document.add_picture = safe_add_picture
except Exception:
    pass
`);

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
        
        // Auto-healing for missed pip packages and optional dependencies (e.g. pandas missing openpyxl)
        const moduleMatch = runError?.match(/(?:ModuleNotFoundError: No module named |ImportError: Missing optional dependency )'([^']+)'/);
        if (moduleMatch && retryCount < MAX_RETRIES) {
          const missingModule = moduleMatch[1];
          ctx.postMessage({ type: 'status', artifactId, stage: 'packages', 
            message: `Auto-installing missing module: ${missingModule}...` });
          
          try {
            // Map common module names to pip package names
            let pkgToInstall = missingModule;
            if (missingModule === 'docx') pkgToInstall = 'python-docx';
            else if (missingModule === 'PIL') pkgToInstall = 'Pillow';
            else if (missingModule === 'bs4') pkgToInstall = 'beautifulsoup4';
            else if (missingModule === 'sklearn') pkgToInstall = 'scikit-learn';
            else if (missingModule === 'fpdf') pkgToInstall = 'fpdf2';
            
            await py.runPythonAsync(`
import micropip
await micropip.install('${pkgToInstall}')
`);
            
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

    // Enhance error reporting if Pyodide only gives us a generic "PythonError"
    if (runError) {
      if ((runError === 'PythonError' || !runError.includes('Traceback')) && stderr) {
        if (!runError.startsWith('Failed to auto-install')) {
          runError = stderr.trim();
        }
      }
    }

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
}
