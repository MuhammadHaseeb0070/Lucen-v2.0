import { getCorsHeaders } from '../_shared/cors.ts';
import { createLogger } from '../_shared/logging.ts';

const ALLOWED_DOMAINS = [
  'cdn.jsdelivr.net',
  'pypi.org',
  'files.pythonhosted.org'
];

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);
  cors['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const correlationId = req.headers.get('X-Correlation-ID') || req.headers.get('x-correlation-id') || crypto.randomUUID();
  const log = createLogger('pyodide-proxy', { correlationId });
  const url = new URL(req.url);
  const targetUrlStr = url.searchParams.get('url');

  if (!targetUrlStr) {
    return new Response(JSON.stringify({ error: 'Missing target URL parameter (?url=...)' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(targetUrlStr);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid target URL format' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  if (!ALLOWED_DOMAINS.includes(targetUrl.hostname)) {
    log.warn(`Blocked proxy request to unauthorized domain: ${targetUrl.hostname}`);
    return new Response(JSON.stringify({ error: 'Domain not allowed by proxy policy' }), {
      status: 403,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    log.info(`Proxying request to ${targetUrl.toString()}`);
    const fetchResponse = await fetch(targetUrl.toString(), {
      method: req.method,
      headers: {
        'User-Agent': 'Lucen/1.0 PyodideProxy',
      }
    });

    const responseHeaders = new Headers(cors);
    const contentType = fetchResponse.headers.get('Content-Type');
    if (contentType) {
      responseHeaders.set('Content-Type', contentType);
    }
    
    return new Response(fetchResponse.body, {
      status: fetchResponse.status,
      statusText: fetchResponse.statusText,
      headers: responseHeaders,
    });
  } catch (err: any) {
    log.error(`Proxy fetch error: ${err.message}`);
    return new Response(JSON.stringify({ error: 'Failed to fetch resource' }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
