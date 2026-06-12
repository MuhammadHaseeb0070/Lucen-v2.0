import { getCorsHeaders } from '../_shared/cors.ts';
import { createLogger } from '../_shared/logging.ts';

/**
 * pyodide-proxy — Secure CORS proxy for Pyodide assets and PyPI packages.
 *
 * Two modes:
 * 1. Query-param mode: GET /pyodide-proxy?url=https://cdn.jsdelivr.net/...
 * 2. Path-forwarding mode: GET /pyodide-proxy/cdn/pyodide/... (maps to cdn.jsdelivr.net/pyodide/...)
 *    This is needed because Pyodide internally appends filenames to the `indexURL`,
 *    so indexURL must be a simple base path, not a URL with query params.
 *
 * The path-forwarding base paths:
 *   /pyodide-proxy/cdn/  → https://cdn.jsdelivr.net/
 *   /pyodide-proxy/pypi/ → https://files.pythonhosted.org/
 */

const ALLOWED_DOMAINS = [
  'cdn.jsdelivr.net',
  'pypi.org',
  'files.pythonhosted.org',
];

function buildTargetUrl(req: Request): { url: string; error?: string } {
  const reqUrl = new URL(req.url);

  // Mode 1: ?url= query param (highest priority)
  const queryUrl = reqUrl.searchParams.get('url');
  if (queryUrl) {
    return { url: queryUrl };
  }

  // Mode 2: path forwarding
  // Supabase may deliver the request with different path formats:
  //   /functions/v1/pyodide-proxy/cdn/...  (full path)
  //   /cdn/...                             (stripped prefix)
  //   /pyodide-proxy/cdn/...               (partial prefix)
  //
  // Regex matches any path that contains /cdn/ or /pypi/ segment
  const path = reqUrl.pathname;
  
  // Look for /cdn/ or /pypi/ anywhere in the path
  const cdnMatch = path.match(/\/cdn\/(.+)/);
  if (cdnMatch) {
    const rest = cdnMatch[1];
    return { url: `https://cdn.jsdelivr.net/${rest}${reqUrl.search || ''}` };
  }
  
  const pypiMatch = path.match(/\/pypi\/(.+)/);
  if (pypiMatch) {
    const rest = pypiMatch[1];
    return { url: `https://files.pythonhosted.org/${rest}${reqUrl.search || ''}` };
  }

  return { url: '', error: 'No target URL provided. Use ?url= or path forwarding (/cdn/... or /pypi/...).' };
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);
  cors['Access-Control-Allow-Methods'] = 'GET, POST, HEAD, OPTIONS';
  cors['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type, x-correlation-id, range';
  cors['Access-Control-Expose-Headers'] = 'content-length, content-type, content-range';

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const correlationId = req.headers.get('X-Correlation-ID') || req.headers.get('x-correlation-id') || crypto.randomUUID();
  const log = createLogger('pyodide-proxy', { correlationId });

  const { url: targetUrlStr, error: routeError } = buildTargetUrl(req);

  if (routeError || !targetUrlStr) {
    return new Response(JSON.stringify({ error: routeError || 'Missing target URL' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(targetUrlStr);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid target URL format' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  if (!ALLOWED_DOMAINS.includes(targetUrl.hostname)) {
    log.warn(`Blocked proxy request to unauthorized domain: ${targetUrl.hostname}`);
    return new Response(JSON.stringify({ error: `Domain not allowed: ${targetUrl.hostname}` }), {
      status: 403,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    log.info(`Proxying: ${req.method} ${targetUrl.toString()}`);

    // Forward relevant request headers (e.g., Range for large WASM files)
    const forwardHeaders: Record<string, string> = {
      'User-Agent': 'Lucen/1.0 PyodideProxy',
    };
    const rangeHeader = req.headers.get('Range');
    if (rangeHeader) forwardHeaders['Range'] = rangeHeader;

    const fetchResponse = await fetch(targetUrl.toString(), {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: forwardHeaders,
    });

    const responseHeaders = new Headers(cors);
    // Forward important content headers
    for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'ETag', 'Last-Modified', 'Accept-Ranges']) {
      const val = fetchResponse.headers.get(h);
      if (val) responseHeaders.set(h, val);
    }
    // WASM files must have this content-type or browser rejects them
    if (targetUrl.pathname.endsWith('.wasm')) {
      responseHeaders.set('Content-Type', 'application/wasm');
    }

    return new Response(req.method === 'HEAD' ? null : fetchResponse.body, {
      status: fetchResponse.status,
      statusText: fetchResponse.statusText,
      headers: responseHeaders,
    });
  } catch (err: any) {
    log.error(`Proxy fetch error: ${err.message}`);
    return new Response(JSON.stringify({ error: 'Failed to fetch resource', detail: err.message }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
