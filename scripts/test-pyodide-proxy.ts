/**
 * pyodide-proxy integration tests
 * Run with: npx tsx scripts/test-pyodide-proxy.ts
 * 
 * Tests the proxy edge function at the URL level — verifies both routing modes,
 * CORS headers, content-type passthrough, and allowlist enforcement.
 * 
 * Set SUPABASE_ANON_KEY env var before running:
 *   $env:SUPABASE_ANON_KEY="eyJ..."; npx tsx scripts/test-pyodide-proxy.ts
 */

const PROXY_BASE = process.env.SUPABASE_URL
  ? `${process.env.SUPABASE_URL}/functions/v1/pyodide-proxy`
  : 'https://jephupjgsvcgfzsozmas.supabase.co/functions/v1/pyodide-proxy';

const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!ANON_KEY) {
  console.warn('\x1b[33m⚠  SUPABASE_ANON_KEY not set — some tests may 401.\x1b[0m');
  console.warn('   Run: $env:SUPABASE_ANON_KEY="eyJ..."; npx tsx scripts/test-pyodide-proxy.ts\n');
}

/** Fetch with anon key header (mimics what the browser worker does) */
async function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) };
  if (ANON_KEY) headers['apikey'] = ANON_KEY;
  return fetch(url, { ...opts, headers });
}

// ANSI colors
const g = (s: string) => `\x1b[32m✓ ${s}\x1b[0m`;
const r = (s: string) => `\x1b[31m✗ ${s}\x1b[0m`;
const y = (s: string) => `\x1b[33m~ ${s}\x1b[0m`;
const b = (s: string) => `\x1b[34m\n  ${s}\x1b[0m`;

let passed = 0;
let failed = 0;
let skipped = 0;

async function assert(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(g(name));
    passed++;
  } catch (e: any) {
    console.log(r(name));
    console.log(`    ${e.message}`);
    failed++;
  }
}

function skip(name: string, reason: string) {
  console.log(y(`${name} — ${reason}`));
  skipped++;
}

function check(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ═══════════════════════════════════════════════════════════════
// GROUP 1: CORS Preflight (OPTIONS — no auth needed)
// ═══════════════════════════════════════════════════════════════
console.log(b('GROUP 1: CORS Preflight'));

await assert('OPTIONS preflight returns 200', async () => {
  const res = await fetch(`${PROXY_BASE}?url=https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.mjs`, {
    method: 'OPTIONS',
    headers: { 'Origin': 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
  });
  check(res.ok, `Expected 200, got ${res.status}`);
  const acao = res.headers.get('access-control-allow-origin');
  check(!!acao, `Missing Access-Control-Allow-Origin, got: ${acao}`);
});

await assert('OPTIONS allows GET method', async () => {
  const res = await fetch(`${PROXY_BASE}?url=https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.mjs`, {
    method: 'OPTIONS',
    headers: { 'Origin': 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
  });
  const allowedMethods = res.headers.get('access-control-allow-methods') || '';
  check(allowedMethods.includes('GET'), `GET not in Access-Control-Allow-Methods: "${allowedMethods}"`);
});

// ═══════════════════════════════════════════════════════════════
// GROUP 2: Security - Allowlist Enforcement (with apikey)
// ═══════════════════════════════════════════════════════════════
console.log(b('GROUP 2: Security — Allowlist Enforcement'));

await assert('Blocks request to unauthorized domain', async () => {
  const res = await apiFetch(`${PROXY_BASE}?url=https://evil.com/steal-data`);
  check(res.status === 403, `Expected 403, got ${res.status}`);
  const body = await res.json();
  check(body.error?.includes('not allowed') || body.error?.includes('Domain'), `Unexpected error body: ${JSON.stringify(body)}`);
});

await assert('Blocks request with no url param in query-param mode', async () => {
  const res = await apiFetch(PROXY_BASE);
  // Without path, both /cdn/ and ?url= missing → 400 (no target) or 403 (bad domain from path)
  check(res.status === 400 || res.status === 403, `Expected 400 or 403, got ${res.status}`);
});

await assert('Blocks malformed url param', async () => {
  const res = await apiFetch(`${PROXY_BASE}?url=not-a-url`);
  check(res.status === 400 || res.status === 403, `Expected 400 or 403, got ${res.status}`);
});

// ═══════════════════════════════════════════════════════════════
// GROUP 3: Query-Param Mode (?url=)
// ═══════════════════════════════════════════════════════════════
console.log(b('GROUP 3: Query-Param Mode (?url=)'));

await assert('Proxies jsdelivr pyodide.mjs (Content-Type: JS)', async () => {
  const url = `${PROXY_BASE}?url=${encodeURIComponent('https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.mjs')}`;
  const res = await apiFetch(url);
  check(res.ok, `Expected 200, got ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  check(ct.includes('javascript') || ct.includes('text/'), `Expected JS content-type, got "${ct}"`);
});

await assert('Proxies pypi.org package metadata JSON', async () => {
  const url = `${PROXY_BASE}?url=${encodeURIComponent('https://pypi.org/pypi/openpyxl/json')}`;
  const res = await apiFetch(url);
  check(res.ok, `Expected 200, got ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  check(ct.includes('json'), `Expected JSON content-type, got "${ct}"`);
  const body = await res.json();
  check(body?.info?.name === 'openpyxl', `Expected openpyxl info, got ${JSON.stringify(body?.info?.name)}`);
});

await assert('Proxies files.pythonhosted.org (wheel file)', async () => {
  // Get a real wheel URL from PyPI metadata so it doesn't go stale
  const metaUrl = `${PROXY_BASE}?url=${encodeURIComponent('https://pypi.org/pypi/six/json')}`;
  const meta = await apiFetch(metaUrl);
  check(meta.ok, `PyPI metadata returned ${meta.status}`);
  const pkgData = await meta.json();
  // Find any wheel file URL from the latest version
  const latestVersion = pkgData?.info?.version;
  const files = pkgData?.releases?.[latestVersion] || [];
  const wheelFile = files.find((f: any) => f.filename?.endsWith('.whl'));
  check(!!wheelFile, `No wheel found in latest six version ${latestVersion}`);
  
  const wheelUrl = `${PROXY_BASE}?url=${encodeURIComponent(wheelFile.url)}`;
  const res = await apiFetch(wheelUrl);
  check(res.ok, `Expected 200, got ${res.status} for ${wheelFile.filename}`);
  const acao = res.headers.get('access-control-allow-origin');
  check(!!acao, `Missing ACAO header on wheel response`);
  console.log(`    Fetched wheel: ${wheelFile.filename}`);
});

await assert('ACAO header present on ?url= response', async () => {
  const url = `${PROXY_BASE}?url=${encodeURIComponent('https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.mjs')}`;
  const res = await apiFetch(url);
  const acao = res.headers.get('access-control-allow-origin');
  check(!!acao, `Missing Access-Control-Allow-Origin on ?url= response`);
});

// ═══════════════════════════════════════════════════════════════
// GROUP 4: Path-Forwarding Mode (/cdn/) — KEY FOR PYODIDE indexURL
// ═══════════════════════════════════════════════════════════════
console.log(b('GROUP 4: Path-Forwarding Mode (/cdn/) — Critical for Pyodide indexURL'));

await assert('Path-forward: /cdn/ serves jsdelivr JS file (pyodide.mjs)', async () => {
  const url = `${PROXY_BASE}/cdn/pyodide/v0.26.2/full/pyodide.mjs`;
  const res = await apiFetch(url);
  check(res.ok, `Expected 200, got ${res.status} for ${url}`);
  const ct = res.headers.get('content-type') || '';
  check(ct.includes('javascript') || ct.includes('text/'), `Expected JS content-type, got "${ct}"`);
  console.log(`    Content-Type: ${ct}`);
});

await assert('Path-forward: /cdn/ serves WASM with correct Content-Type', async () => {
  const url = `${PROXY_BASE}/cdn/pyodide/v0.26.2/full/pyodide.asm.wasm`;
  // Use Range to avoid downloading the full 10MB WASM file  
  const res = await apiFetch(url, { headers: { 'Range': 'bytes=0-3' } });
  check(res.ok || res.status === 206, `Expected 200/206, got ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  check(ct.includes('wasm') || ct.includes('octet') || ct.includes('binary'),
    `Expected wasm-like content-type, got "${ct}"`);
  console.log(`    WASM Content-Type: ${ct}`);
});

await assert('Path-forward ACAO header present', async () => {
  const url = `${PROXY_BASE}/cdn/pyodide/v0.26.2/full/pyodide.mjs`;
  const res = await apiFetch(url);
  const acao = res.headers.get('access-control-allow-origin');
  check(!!acao, `Missing Access-Control-Allow-Origin on path-forward response`);
});

await assert('Path-forward: /cdn/ serves pyodide-lock.json', async () => {
  // pyodide-lock.json is a tiny file Pyodide loads to resolve packages
  const url = `${PROXY_BASE}/cdn/pyodide/v0.26.2/full/pyodide-lock.json`;
  const res = await apiFetch(url);
  check(res.ok, `Expected 200, got ${res.status}`);
  const body = await res.json();
  check(body?.info?.version === '0.26.2', `Expected pyodide 0.26.2 lock, got ${JSON.stringify(body?.info?.version)}`);
  console.log(`    Lock file version: ${body?.info?.version}`);
});

// ═══════════════════════════════════════════════════════════════
// GROUP 5: CDN Direct Probe Simulation
// ═══════════════════════════════════════════════════════════════
console.log(b('GROUP 5: CDN Direct Probe Simulation'));

await assert('Direct CDN HEAD request behaviour', async () => {
  try {
    const res = await fetch('https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.mjs', { method: 'HEAD' });
    check(res.ok || res.status === 405, `CDN HEAD returned ${res.status}`);
    console.log('    → CDN directly reachable (proxy fallback NOT needed in this env)');
  } catch {
    console.log('    → CDN not reachable (proxy fallback WOULD activate in this env)');
  }
});

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(55)}`);
const total = passed + failed + skipped;
console.log(`Results: ${passed}/${total} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) {
  console.log('\x1b[31mSome tests FAILED — see details above\x1b[0m');
  process.exit(1);
} else {
  console.log('\x1b[32mAll tests PASSED ✓\x1b[0m');
}
