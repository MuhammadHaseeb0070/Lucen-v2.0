# Stack Research

**Domain:** React 19 SPA + Deno Edge Functions (stabilization)
**Researched:** 2026-06-08
**Confidence:** HIGH (all versions verified against npm registry)

## Purpose

This is NOT a stack-selection document. Lucen is a mature app with an established stack (React 19 + Vite + Supabase + Deno Edge Functions). This document prescribes:

1. **Current/locked versions** for the existing stack that should be pinned during stabilization
2. **New supporting libraries** needed for specific stabilization targets
3. **What NOT to add** and why

All seven areas (a-g) from the milestone scope are addressed below.

---

## Recommended Stack

### Existing Technologies — Locked Versions for Stabilization

| Technology | Locked Version | Purpose | Why This Version |
|------------|----------------|---------|------------------|
| React | **19.2.7** | UI framework | Latest React 19 stable. Do NOT upgrade to React 20 during stabilization — unnecessary risk. Pin to patch. |
| React DOM | **19.2.3** | DOM rendering | Match React version. |
| TypeScript | **~5.9.3** | Language | Pin to 5.9.x series. TS 6.0.3 is shipping but introduces breaking changes (e.g., `.ts` extension mandatory in some paths). Do NOT upgrade during stabilization. |
| Vite | **8.0.16** | Bundler | Current npm latest. Existing code uses Vite 7.3 — verify the 7 -> 8 migration path is trivial (no plugin API changes affecting this project). If Vite 8 breaks anything, pin to **7.3.x**. |
| `@vitejs/plugin-react` | **6.0.2** | React transform | Compatible with Vite 8. Uses `automatic` JSX runtime (matching existing tsconfig `react-jsx`). |
| Supabase JS Client | **^2.107.0** | DB, Auth, Storage, Functions | Latest stable. Existing `^2.98.0` semver range allows this — no lock change needed. Verify no breaking changes in 2.98 -> 2.107. |
| Zustand | **5.0.14** | State management | Latest 5.x stable. |
| React Router | **7.17.0** | Client-side routing | Latest 7.x stable. |
| Sentry React | **10.56.0** | Error monitoring | Pin to existing. No upgrade needed for stabilization. |
| Mermaid | **^11.15.0** | Diagram rendering | Update from `^11.13.0` — `securityLevel: 'sandbox'` is the correct config for BUG-08. |
| Pyodide | **0.29.4** | Python WASM runtime | Latest. Used for Python artifact execution in Web Worker. |

### New Supporting Libraries — Stabilization Targets

#### (a) Test Infrastructure: Vitest + Playwright

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| **Vitest** | **4.1.x** (`^4.1.0`) | Unit/integration test runner | Vite-native. Shares `vite.config.ts` transform pipeline. Strict mode, Chai assertions, snapshot support. Vitest 4.x is the current major. Do NOT use Jest — it requires a separate transform config and does not integrate with Vite. |
| **`@vitest/coverage-v8`** | **4.1.x** (`^4.1.0`) | Code coverage | V8 native coverage. Faster than Istanbul. Use `--coverage.provider=v8`. |
| **`@testing-library/react`** | **^16.3.2** | React component testing | Works with React 19. Tests from user perspective, not implementation. Use for store-connected components. |
| **`@testing-library/jest-dom`** | **^6.9.1** | DOM matchers | `toBeInTheDocument()`, `toHaveTextContent()`, etc. Needed by vitest expect. |
| **`@testing-library/user-event`** | **^14.6.1** | Simulated user interactions | `userEvent.click()`, `userEvent.type()` simulate real browser events. Use over `fireEvent` for integration tests. |
| **`jsdom`** | **^29.1.1** | DOM environment for Vitest | Required by `@testing-library/react`. Configure in `vitest.config.ts` as `environment: 'jsdom'`. |
| **`@playwright/test`** | **^1.60.0** | E2E test runner | Industry standard for browser automation. Chromium + Firefox + WebKit. Auto-wait, web-first assertions, trace viewer. |

**Why Vitest over Jest:** Vitest shares Vite's config, transform pipeline, and module resolution. No separate Jest config. Jest requires `babel-jest` or `ts-jest` and cannot use Vite plugins. For a Vite project, Vitest is strictly better.

**Why jsdom over happy-dom:** happy-dom 20.x has incomplete implementations of `fetch`, `requestAnimationFrame`, and `IntersectionObserver` — all used heavily in Lucen (streaming, stores, artifact rendering). jsdom 29.x is slower but more correct. For Lucen's integration tests, correctness wins.

**Configuration pattern:**

```typescript
// vitest.config.ts (standalone, extends vite.config.ts)
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.*', 'src/test/**'],
    },
  },
});
```

#### (b) DOMParser-based SVG Sanitization

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| **DOMPurify** | **^3.4.8** | SVG/HTML sanitization via DOMParser | Industry standard XSS sanitizer from Cure53. Uses browser-native DOMParser internally. Provides `ADD_TAGS` and `ADD_ATTR` for precise SVG allowlisting. Not regex-based — cannot be bypassed by encoding tricks. |
| **`isomorphic-dompurify`** | (**DO NOT USE**) | N/A | Server-side wrapper for Deno/Node. NOT needed — SVG sanitization runs in browser only. Adds unnecessary dependency. |

**Why DOMPurify over sanitize-html:**
- DOMPurify uses the browser's DOMParser (correct parse model for SVG/HTML)
- `sanitize-html` 2.17.4 uses htmlparser2 (not DOM-based) — can misparse SVG namespaces
- DOMPurify is maintained by Cure53 (the security audit firm), receiving active security research
- DOMPurify 3.x is 9KB gzipped vs 40KB+ for sanitize-html

**Why DOMPurify over the existing regex-based `sanitizeSvg()`:**
The existing regex in `ArtifactRenderer.tsx:28-43` strips known dangerous patterns but:
- Mixed-case event handlers (`oNloAd=`) bypass regex
- Encoded entities bypass regex
- SVG namespace quirks (e.g., `xlink:href` with `javascript:` URI) are not fully covered
- SVG `use` element with external references bypass regex

DOMPurify addresses all of these because it uses the same parser as the browser.

**Configuration for SVG:**

```typescript
import DOMPurify from 'dompurify';

// SVG-safe configuration
const svgPurify = DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  // Block <script>, <foreignObject>, <use> with external href
  if (data.tagName === 'foreignobject' ||
      data.tagName === 'script' ||
      (data.tagName === 'use' && node.getAttribute('href')?.startsWith('http'))) {
    return node.parentNode?.removeChild(node);
  }
});

// Configure allowed SVG tags and attributes
const SVG_ALLOW_LIST = {
  ADD_TAGS: ['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon',
    'text', 'g', 'defs', 'use', 'linearGradient', 'radialGradient', 'stop',
    'filter', 'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode',
    'animate', 'animateTransform', 'set', 'clipPath', 'mask', 'pattern',
    'marker', 'symbol', 'title', 'desc', 'tspan', 'textPath', 'a'],
  ADD_ATTR: ['viewBox', 'd', 'cx', 'cy', 'r', 'x', 'y', 'width', 'height',
    'fill', 'stroke', 'stroke-width', 'opacity', 'transform', 'points',
    'rx', 'ry', 'dx', 'dy', 'text-anchor', 'dominant-baseline', 'font-size',
    'font-family', 'font-weight', 'font-style', 'fill-opacity', 'stroke-opacity',
    'stroke-linecap', 'stroke-linejoin', 'clip-rule', 'fill-rule',
    'stop-color', 'stop-opacity', 'offset', 'stdDeviation', 'in', 'result',
    'values', 'keyTimes', 'dur', 'repeatCount', 'calcMode', 'attributeName',
    'from', 'to', 'begin', 'end', 'href', 'target', 'rel'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  FORBID_TAGS: ['script', 'foreignobject', 'object', 'embed', 'iframe'],
  FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover', 'style'],
};
```

#### (c) Pyodide Execution Timeouts in Web Workers

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| **No external library needed** | -- | Worker timeout | Implement via native `Worker.terminate()` + `AbortController`. No npm package needed. |

**Pattern:**

```typescript
// Worker host pattern
const PYTHON_TIMEOUT_MS = 30_000; // 30 seconds

export function runPythonWithTimeout(code: string, worker: Worker): Promise<PythonResult> {
  const abortController = new AbortController();
  const { signal } = abortController;

  return new Promise<PythonResult>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      worker.terminate();     // Hard kill the worker
      abortController.abort();
      reject(new Error('Python execution timed out after 30s'));
    }, PYTHON_TIMEOUT_MS);

    worker.onmessage = (event) => {
      clearTimeout(timeoutId);
      resolve(event.data);
    };

    worker.onerror = (error) => {
      clearTimeout(timeoutId);
      reject(error);
    };

    worker.postMessage({ code, signal: signal.aborted }); // Pass signal state
  });
}
```

**Why no library:** Pyodide is single-threaded WASM inside a Web Worker. The only reliable timeout mechanism is `Worker.terminate()` — no library wrapper improves on that. Libraries like `p-timeout` or `async-timeout` wrap promises but cannot force-terminate a Web Worker.

**Worker-side cooperation (best-effort):** Inside the worker, periodically check `AbortSignal.aborted` and break out of loops. This is cooperative and not a substitute for `Worker.terminate()` but prevents leaving the WASM heap in a broken state.

#### (d) Shared TypeScript Types Between Vite SPA and Deno Edge Functions

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| **Zod** | **^4.4.3** | Runtime type validation + type inference | Single source of truth for API contracts. Define schemas once, infer TypeScript types with `z.infer<>`. Both frontend and edge functions can import the same schema. |
| **No monorepo tool** | -- | N/A | Do NOT introduce Turborepo, Nx, or pnpm workspaces for this. A simpler approach works. |

**Recommended pattern: Type package with path aliases**

Create a directory `shared-types/` at project root with TypeScript source files. Reference via relative import or a tsconfig path alias.

```
lucen/
  shared-types/
    tsconfig.json         # Single tsconfig, no complications
    api-contracts.ts      # ChatRequest, ChatResponse, SSE events
    tool-definitions.ts   # ToolCall, ToolResult
    billing.ts            # CreditDeduction, UsageRecord
    index.ts              # Re-exports
  src/
    types/                # Frontend-specific types (React props, store shapes)
  supabase/
    functions/
      _shared/            # Edge function shared utilities
  tsconfig.json           # Root config references shared-types/ and src/
```

**In `shared-types/api-contracts.ts`:**

```typescript
import { z } from 'zod';

// Define schema once
export const ChatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })),
  webSearchEnabled: z.boolean().default(false),
  stream: z.boolean().default(true),
});

// Infer types
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
```

**Why Zod over alternatives:**

| Approach | Verdict | Reason |
|----------|---------|--------|
| Zod (recommended) | USE | Runtime + compile-time. Both frontend (npm) and Deno (esm.sh) can import. |
| OpenAPI / Swagger | DO NOT | Heavy tooling for a single SPA. Codegen adds generated files to git. |
| GraphQL | DO NOT | Entirely different paradigm. Not worth the migration for a stabilization pass. |
| Manual `.d.ts` files | DO NOT | Drift problem — exactly the issue this targets. No enforcement. |
| `@types/shared` workspace package | MAYBE | If user wants a published package. Over-engineered for stabilization. |

**Deno import path for shared types:**

Edge functions import from the shared directory using relative path or a `deno.json` import map:

```json
// supabase/functions/deno.json
{
  "imports": {
    "shared/": "../../shared-types/"
  }
}
```

Note: Zod on Deno imports from `https://esm.sh/zod@4.4.3` or `npm:zod`. Validate Deno compatibility before committing to Zod 4.x — if Zod 4 breaks on Deno, use Zod 3.23.x instead.

#### (e) Structured Logging with Correlation IDs

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| **No external library** | -- | Structured logging | Modifying the existing `src/lib/logger.ts` is sufficient. A full logging library (pino, winston) is overkill for a client-side SPA and adds bundle weight. |
| **`uuid`** | **^14.0.0** (already in deps) | Correlation ID generation | Existing dependency. Use `v4()` or `v7()` for request correlation IDs. Already in `package.json`. |

**Why NOT to add pino/winston:**

- These are Node.js logging libraries. In the browser, they add 10-40KB for features (transports, rotating files, streams) that don't apply.
- The browser has no file system — all logs go to `console.*` regardless.
- Sentry breadcrumbs are the correct mechanism for production log aggregation in a browser app.

**Recommended upgrade to `src/lib/logger.ts`:**

```typescript
// src/lib/logger.ts - Upgraded pattern
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  correlationId: string;
  module: string;
  message: string;
  data?: Record<string, unknown>;
  error?: { name: string; message: string; stack?: string };
}

// Module-level correlation ID — set at request start
let _correlationId: string = crypto.randomUUID();

export function setCorrelationId(id: string): void {
  _correlationId = id;
}

export function getCorrelationId(): string {
  return _correlationId;
}

function log(level: LogLevel, module: string, message: string, data?: unknown, error?: unknown): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    correlationId: _correlationId,
    module,
    message,
    data: data as Record<string, unknown> | undefined,
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : undefined,
  };

  const formatted = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.correlationId.slice(0, 8)}] [${entry.module}] ${entry.message}`;

  switch (level) {
    case 'debug': console.debug(formatted, entry.data ?? ''); break;
    case 'info':  console.info(formatted, entry.data ?? ''); break;
    case 'warn':  console.warn(formatted, entry.data ?? '', entry.error ?? ''); break;
    case 'error': console.error(formatted, entry.data ?? '', entry.error ?? ''); break;
  }

  // Send errors to Sentry
  if (level === 'error') {
    Sentry.captureException(entry.error, {
      tags: { module: entry.module, correlationId: entry.correlationId },
      extra: entry.data,
    });
  }
}

export const logger = {
  debug: (module: string, message: string, data?: unknown) => log('debug', module, message, data),
  info:  (module: string, message: string, data?: unknown) => log('info', module, message, data),
  warn:  (module: string, message: string, data?: unknown) => log('warn', module, message, data),
  error: (module: string, message: string, error?: unknown, data?: unknown) => log('error', module, message, data, error),
};
```

**Correlation ID flow for streams:**

1. `streamChat()` generates `correlationId = crypto.randomUUID()` before fetching
2. Sets `logger.setCorrelationId(correlationId)` 
3. Passes `X-Correlation-Id: <id>` header to the chat-proxy edge function
4. Edge function reads the header and uses it for its own logging
5. On error, Sentry event includes the correlation ID tag
6. User support can search logs by correlation ID

**Edge function logging (Deno):**

Deno's `console.*` already outputs structured JSON to Supabase logs. No library needed there either. Just prefix all log lines with the correlation ID:

```typescript
function log(level: string, correlationId: string, message: string, data?: unknown) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    correlationId,
    message,
    data,
  }));
}
```

#### (f) Cross-Isolate State Sharing for Rate Limiting and Circuit Breakers

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| **Deno KV** (built-in) | -- | Shared state (Supabase Pro+) | Zero-dependency. Built into Supabase Edge Functions on Pro plans. Key-value store with atomic operations and TTL. Ideal for rate limit counters and circuit breaker state. |
| **`@upstash/redis`** | **^1.38.0** | Shared state (fallback via REST) | REST-based Redis client. No persistent TCP connection needed — works in Deno Edge Functions' stateless model. Fallback if Deno KV is not available (Free/Hobby plans). |
| **In-memory `Map`** (existing) | -- | Local dev only | Keep as dev fallback. Switch to Deno KV when available, Upstash Redis as second fallback. |

**Why Deno KV is the primary choice:**

- Zero cold start latency (no connection setup)
- Atomic operations for rate limit increments (`Deno.Kv.prototype.atomic().sum()`)
- Built-in TTL support for rate limit windows
- Shared across all Edge Function instances in the same region
- No additional infrastructure or API key management
- Available on Supabase Pro plan ($25/mo)

**Why Upstash Redis is the fallback:**

- REST API (no WebSocket or TCP) — compatible with Edge Functions' short-lived execution model
- Pay-as-you-go pricing with free tier
- Supports TTL, atomic increment, and Lua scripting
- Can be used across regions

**Rate limiter implementation (Deno KV):**

```typescript
// supabase/functions/_shared/rateLimitKv.ts
const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 30;

export async function checkRateLimitKv(kv: Deno.Kv, userId: string, maxReq = MAX_REQUESTS): Promise<boolean> {
  const key = ['rate_limit', userId, Math.floor(Date.now() / WINDOW_MS)];
  const result = await kv.get<number>(key);
  const count = (result.value ?? 0) + 1;

  if (count > maxReq) return false; // Rate limited

  await kv.set(key, count, { expireIn: WINDOW_MS });
  return true;
}
```

**Circuit breaker implementation (Deno KV):**

```typescript
// supabase/functions/_shared/circuitBreakerKv.ts
const FAILURE_THRESHOLD = 5;
const HALF_OPEN_TTL_MS = 30_000; // 30 seconds
const OPEN_TTL_MS = 60_000;      // 1 minute

type CircuitState = { status: 'closed' | 'open' | 'half-open'; failures: number; lastFailure: number };

export async function getCircuitState(kv: Deno.Kv, key: string): Promise<CircuitState> {
  return (await kv.get<CircuitState>(['circuit', key])).value ?? { status: 'closed', failures: 0, lastFailure: 0 };
}

export async function recordFailure(kv: Deno.Kv, key: string): Promise<void> {
  const state = await getCircuitState(kv, key);
  state.failures++;
  state.lastFailure = Date.now();
  if (state.failures >= FAILURE_THRESHOLD) {
    state.status = 'open';
    await kv.set(['circuit', key], state, { expireIn: OPEN_TTL_MS / 1000 });
  } else {
    await kv.set(['circuit', key], state);
  }
}
```

**Fallback strategy (Upstash Redis):**

```typescript
import { Redis } from '@upstash/redis/cloudflare'; // REST-compatible import

const redis = new Redis({
  url: Deno.env.get('UPSTASH_REDIS_REST_URL')!,
  token: Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!,
});
```

**What NOT to use:**

| Technology | Reason to Avoid |
|------------|-----------------|
| In-memory `Map` for production | Per-isolate. Lost on cold start. Not shared across instances. Only acceptable for local dev. |
| Bull/BullMQ | Job queue, not a KV store. Requires Redis directly. Over-engineered for rate limiting. |
| Memcached | No built-in atomic increment. Deprecated pattern for rate limiting. |
| Traditional `redis` npm package | Requires TCP connection. Not compatible with Deno Edge Functions. |

#### (g) CSP Header Setup for Vite + Vercel

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| **No library needed** | -- | CSP headers in `vercel.json` | Vercel supports custom headers natively via `vercel.json` `headers` array. No middleware, no plugin. |
| **`vercel.json`** | project config | Header delivery | Already used for build config. Add a `headers` block. |

**CSP header configuration in `vercel.json`:**

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' https://js.sentry-cdn.com https://cdn.vercel-insights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.openrouter.ai https://api.tavily.com https://api.lemonsqueezy.com https://o*.ingest.us.sentry.io; frame-src 'self'; worker-src 'self' blob:; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "SAMEORIGIN"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        }
      ]
    }
  ]
}
```

**Directive breakdown for Lucen:**

| Directive | Rationale |
|-----------|-----------|
| `default-src 'self'` | Baseline — all resources default to same origin |
| `script-src 'self' https://js.sentry-cdn.com https://cdn.vercel-insights.com` | Sentry error monitoring + Vercel Analytics |
| `style-src 'self' 'unsafe-inline'` | Required for Vite's CSS injection in dev; React Emotion/MUI may inject inline styles |
| `img-src 'self' data: blob: https:` | User uploads (blob:), inline images (data:), external images (https:) |
| `connect-src 'self' https://*.supabase.co wss://*.supabase.co ...` | Supabase REST + realtime, OpenRouter, Tavily, Lemon Squeezy, Sentry |
| `frame-src 'self'` | Artifact iframes (same-origin) |
| `worker-src 'self' blob:` | Web Workers (Pyodide, tokenizer, highlighter, artifact parser) |
| `base-uri 'self'` | Prevent base tag injection |
| `form-action 'self'` | Prevent form action hijacking |
| `object-src 'none'` | Block Flash/plugin content |
| `upgrade-insecure-requests` | Force HTTPS |

**Deployment note:** CSP headers work on Vercel for both `*.vercel.app` and custom domains. Use `Content-Security-Policy-Report-Only` initially to catch violations without breaking functionality, then switch to enforcing `Content-Security-Policy` after observing violations for one week.

**Vite dev server note:** During local development (`vite`), CSP headers set via `vercel.json` are NOT sent (Vite's dev server does not read `vercel.json`). To test CSP locally, add a Vite plugin or use browser devtools to inject headers. For the user's workflow (no local Vite server), this is not blocking — CSP is enforced on deploy.

---

## Installation

```bash
# (a) Test infrastructure
npm install -D vitest@^4.1.0 @vitest/coverage-v8@^4.1.0 @testing-library/react@^16.3.2 @testing-library/jest-dom@^6.9.1 @testing-library/user-event@^14.6.1 jsdom@^29.1.1 @playwright/test@^1.60.0

# (b) SVG sanitization
npm install dompurify@^3.4.8

# (d) Shared types
npm install zod@^4.4.3

# (f) Upstash Redis (Deno KV is built-in, this is the fallback)
# Installed via Deno import in edge functions, not via npm:
# import { Redis } from 'npm:@upstash/redis'
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Test runner | Vitest 4.1.x | Jest | Jest doesn't share Vite config. Requires babel-jest/ts-jest. No ESM support without config. |
| DOM environment | jsdom 29.x | happy-dom 20.x | Incomplete `fetch`, `rAF`, `IntersectionObserver` in happy-dom. Lucen uses all three. |
| SVG sanitizer | DOMPurify 3.x | sanitize-html 2.x | htmlparser2-based, not DOM-based. SVG namespace misparsing risk. Larger bundle. |
| Structured logging (browser) | Custom `logger.ts` upgrade | pino/winston | Node.js-focused. Bundle size cost for features that don't apply in browser. |
| Cross-isolate state (production) | Deno KV | Upstash Redis | Deno KV is zero-infrastructure on Supabase Pro. Upstash is a fallback for Free/Hobby. |
| Shared types runtime validation | Zod 4.x | OpenAPI / GraphQL | OpenAPI adds codegen step and generated files. GraphQL is a paradigm shift for a stabilization pass. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Jest** | Separate config, no Vite integration, slower cold start | Vitest 4.1.x |
| **happy-dom** | Incomplete implementations of Lucen-critical browser APIs | jsdom 29.x |
| **Mocha + Chai** | Manual config, no Vite integration, no native TypeScript | Vitest 4.x (uses Chai assertions natively) |
| **Cypress** | Heavier than Playwright, slower CI, no web-first assertions | Playwright 1.60.x |
| **sanitize-html** | htmlparser2 misparses SVG namespaces; no SVG-specific allowlist tuning | DOMPurify 3.x |
| **pino/winston in browser** | 10-40KB bundle for Node.js transport features that don't work in browser | Custom `logger.ts` upgrade |
| **Bull/BullMQ** | Job queues, not KV stores. Require direct Redis TCP connection. | Deno KV / Upstash Redis |
| **Redis TCP client** | Doesn't work in Deno Edge Functions (no TCP sockets in Supabase runtime) | Upstash Redis REST client |
| **Express/Koa for edge** | Not compatible with Deno Edge Functions; adds overhead | `serve.ts` (built-in) |
| **Turborepo/Nx/pnpm workspaces** | Over-engineered for a single shared types directory. Adds CI complexity. | Relative imports + path aliases |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Vitest 4.1.x | Vite 7.x, Vite 8.x | Shares config. Use `vitest/config` import. |
| `@testing-library/react` 16.x | React 19.x | Works with React 19's `act()`. Verify render hook compatibility. |
| Playwright 1.60.x | TypeScript 5.x | Native TypeScript support. `@playwright/test` includes `test`, `expect`. |
| DOMPurify 3.x | All browsers | No peer dependencies. Browser-only (not SSR). |
| Zod 4.x | TypeScript 5.x | Verify Deno compatibility before committing to v4. Fallback to Zod 3.23.x if v4 breaks on Deno. |
| `@upstash/redis` 1.x | Deno via `npm:` specifier | REST-based. No TCP required. |
| Zustand 5.x | React 19.x | `useSyncExternalStore` already built in to React 19. |
| Mermaid 11.15.x | All browsers | `securityLevel: 'sandbox'` available since Mermaid 9.x. |
| TypeScript 5.9.x | React 19.x, Vite 8.x | `verbatimModuleSyntax` compatible. `react-jsx` transform works. |

---

## Stack Patterns by Variant

**If Supabase plan is Free/Hobby (no Deno KV):**
- Rate limiting: In-memory `Map` for local dev; Upstash Redis REST for production
- Circuit breaker: In-memory `Map` for local dev; Upstash Redis for production
- Skip Deno KV entirely — it won't be available
- Cost: Upstash Redis free tier is sufficient

**If Supabase plan is Pro+ (Deno KV available):**
- Rate limiting: Use `Deno.Kv` for all production state
- Circuit breaker: Use `Deno.Kv` for all production state
- Upstash Redis: Not needed (but harmless as a fallback)
- Benefit: Zero cold start, no network hop, no API keys

**If Vite 8 compatibility issues arise:**
- Pin Vite to `7.3.x` and `@vitejs/plugin-react` to `5.1.x`
- Vite 7 is stable and maintained
- Do NOT let a Vite upgrade block stabilization work

**If Zod 4 breaks on Deno:**
- Fall back to Zod `3.23.x`
- Use `npm:zod@3` import specifier in Deno
- API is 99% the same; migration from 3 to 4 is straightforward later

**If user does not want to set up the full test infrastructure:**
- Minimum viable: Vitest only (no Playwright)
- Unit tests for: sanitizeSvg, artifactParser, logger
- Defer E2E to a future milestone
- Rationale: Unit tests have the highest ROI for the current stabilization bugs

---

## Sources

- **npm registry** (2026-06-08) — All version numbers verified via `npm view <package> version`
- **Vercel docs** — `vercel.json` header configuration format (`/docs/project-configuration/vercel-json#headers`)
- **Vercel docs** — CSP best practices (`/docs/cdn-security/security-headers`)
- **Vitest site** (v4.1.7) — Vite integration, React component testing, browser mode
- **DOMPurify** (Cure53 maintainer) — SVG sanitization, DOM parser-based approach
- **Supabase docs** — Deno KV for Edge Functions, Upstash Redis fallback
- **Pyodide docs** — JS API for worker-based execution, termination patterns
- **Zod docs** — Schema definition, type inference, Deno compatibility notes

**Training data note:** Where specific configuration details are documented above (e.g., DOMPurify SVG allowlist, CSP directive values), these are synthesis from official documentation sources verified at the URLs listed. HIGH confidence for all npm-verified versions; MEDIUM confidence for CSP config exact values (should be validated against production).

---

*Stack research for: Lucen v2.3 stabilization milestone*
*Researched: 2026-06-08*