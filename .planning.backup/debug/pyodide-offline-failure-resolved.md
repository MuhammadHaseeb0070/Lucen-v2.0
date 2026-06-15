# DEBUG: Pyodide Offline/CDN-Blocked Failure — RESOLVED
Created: 2026-06-12T09:58:00Z
Status: RESOLVED
Resolved: 2026-06-12T10:16:00Z

## Root Cause (Confirmed)

Pyodide's internal wheel fetches (for `packaging`, `micropip`, etc.) go directly
to the Supabase proxy URL (`*.supabase.co/functions/v1/pyodide-proxy/...`).

The `globalThis.fetch` interceptor only checked for `jsdelivr.net`, `pypi.org`, and
`pythonhosted.org` when deciding to add auth headers. Since the proxy URL is on
`supabase.co`, it did NOT match — so requests went through WITHOUT the `apikey` header.

Supabase's API gateway returned 401 Unauthorized. The 401 response may lack CORS
headers → browser shows `"Fetch API cannot load"`.

This caused `packaging` to never load → `micropip` crashed with `ModuleNotFoundError`.

## Fixes Applied

### Fix 1 — Load `packaging` explicitly (belt-and-suspenders)
File: `src/workers/pyodide.worker.ts` L246
```ts
// Before:
await pyodide.loadPackage('micropip');

// After:
await pyodide.loadPackage(['packaging', 'micropip']);
```

### Fix 2 — Inject auth headers for all Supabase proxy fetches (THE real fix)
File: `src/workers/pyodide.worker.ts` L68-83

Added detection: if the URL being fetched is already pointing to OUR Supabase proxy
(`urlStr.startsWith(supabaseProxyOrigin) && urlStr.includes('/pyodide-proxy/')`),
inject the `apikey` header immediately before calling `originalFetch`.

This covers ALL internal Pyodide wheel fetches transparently.
