# Feature Research -- Stabilization Infrastructure

**Domain:** AI Chat SPA (React 19 + Vite + Supabase + Deno Edge Functions)
**Researched:** 2026-06-08
**Confidence:** HIGH (sourced from codebase analysis + official docs)

## Context

This is a **stabilization milestone**, not a feature release. The items below are infrastructure and hardening work that must reach a minimum quality bar for the project to be production-grade. Each item is categorized by "table stakes" (minimum acceptable for a credible stabilization) vs "differentiators" (above-and-beyond).

---

## 1. Test Infrastructure: Vitest + Playwright

**State today:** Zero test files. No Vitest, Jest, or Playwright in `package.json`. The project has no CI test runner. CONCERNS.md TD-09.

### Table Stakes

| Element | Standard | Why |
|---------|----------|-----|
| **Vitest config** | `vitest.config.ts` (separate from `vite.config.ts`) with `environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`, `include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)']` | Vitest inherits Vite config by default but a dedicated config avoids test bloat in build config. jsdom is the standard DOM environment for React unit tests. |
| **Setup file** | `src/test/setup.ts` importing `@testing-library/jest-dom` matchers | Provides `toBeInTheDocument()`, `toHaveTextContent()`, etc. -- standard React testing idiom. |
| **Coverage provider** | `provider: 'istanbul'` with per-file thresholds in `vitest.config.ts` | Vitest's default v8 provider is faster but istanbul is more accurate and better-documented for thresholds. |
| **File pattern** | Colocated `.test.ts`/`.test.tsx` next to source files (`src/store/chatStore.test.ts`, `src/services/openrouter.test.ts`) | Colocation signals "this test belongs to this module" and prevents stale test files when modules move. |
| **Core test targets** | Stores (Zustand), services (OpenRouter), lib (artifactParser, logger, sanitizeSvg), hooks | State logic is the highest-risk surface. Pure functions in `src/lib/` are the easiest to test. |
| **Playwright setup** | `playwright.config.ts` with `webServer` pointing at `vite preview` (port 4173), `reuseExistingServer: !process.env.CI`, Chromium-only project for CI | Vite preview is production-like; `reuseExistingServer` lets devs run their own dev server locally. Chromium-only keeps CI fast. |
| **Playwright test dir** | `e2e/` at project root, file pattern `*.spec.ts` | Separate from unit tests. Standard Playwright convention. |
| **Flow tests** | Sign-in, send message, attach file, run artifact (HTML), buy credits | Covers the five core user flows from PROJECT.md. These are the highest-regression-risk paths. |
| **Coverage thresholds** | Lines: 50%, Branches: 40%, Functions: 45%, Statements: 50% initially | Pragmatic for a greenfield test start. Raise to 70%/60%/65%/70% in the next milestone. Do NOT set 80%+ thresholds on day one -- they will block CI and be disabled. |

### Differentiators

| Element | Standard | Why |
|---------|----------|-----|
| **Browser-mode Vitest** | `@vitest/browser` + Playwright for component-level rendering tests | Lets you test React components with real browser rendering (not jsdom). Valuable for artifact renderer tests. Not table stakes because component tests can wait. |
| **Per-function coverage thresholds** | Individual thresholds per module: `src/lib/artifactParser.ts` 80%, `src/lib/logger.ts` 90%, `src/services/openrouter.ts` 40% (it's huge) | Allows strict enforcement on critical modules while not blocking on the monolith. |
| **GitHub Actions CI** | `.github/workflows/test.yml` running `vitest run --coverage` and `playwright test` on PR to main | Enables pre-merge gating. Not table stakes because the user deploys manually today and may not want CI integration yet. |
| **Failing test regression suite** | A small set of tests that reproduce BUG-01 through BUG-10, run as a smoke suite before each deploy | Prevents re-introducing known bugs. High value but not required for phase 1 of testing. |
| **Test data factories** | `src/test/factories/` with `buildMessage()`, `buildArtifact()`, `buildChatState()` helpers | Makes tests readable and maintainable. Without factories, tests inline large fixture objects and become brittle. |

### Anti-Patterns

| Practice | Why Avoid | Instead |
|----------|-----------|---------|
| Snapshot testing large components | Brittle, meaningless diffs on every styling change | Test behavior (state transitions, callbacks) not markup |
| Mocking `fetch` globally with `vi.fn()` | Tests couple to implementation details | Mock at the service boundary (e.g., mock `supabase-js` client methods) |
| 100% coverage target immediately | Will be ignored or disabled within 2 weeks | Start at 50% line coverage, raise each milestone |
| E2E tests that require real credentials | Flaky, slow, can never run in CI | Use test users (Supabase auth test helpers) or mock the auth layer in E2E |

---

## 2. Rate Limiting at Edge Function Scale

**State today:** `supabase/functions/_shared/rateLimit.ts` exists with in-memory sliding window (per-Deno-isolate). Only `chat-proxy` calls `checkRateLimit()` (30 req/min per user). 10 other edge functions have NO rate limiting. CONCERNS.md SEC-04.

### Table Stakes

| Element | Standard | Why |
|---------|----------|-----|
| **Per-function rate limits** | `checkRateLimit()` call at entry of: `describe-image`, `classify-intent`, `embed`, `retrieve-chunks`, `generate-title`, `web-search`, `get-file-content`, `deduct-credits` | Every public endpoint needs protection. The function exists -- it just needs to be called. |
| **Rate limit key scheme** | `"funcName:userId"` for authenticated routes, `"funcName:ip"` for unauthenticated | User-based limits prevent one bad actor from exhausting per-user quotas. IP fallback for routes without auth (webhooks). |
| **Configurable per-route limits** | Environment variable per function: `RATE_LIMIT_CHAT_PROXY=30`, `RATE_LIMIT_CLASSIFY_INTENT=60`, `RATE_LIMIT_WEB_SEARCH=20` | Each function has different load characteristics. Chat is expensive (LLM calls), classify-intent is cheap. |
| **Consistent error shape** | Return HTTP 429 with `{ error: 'rate_limit_exceeded', retryAfterMs: number }` | Frontend needs a consistent shape to retry. The `checkRateLimit` already returns `retryAfterMs`. |
| **Response header** | `Retry-After` header in seconds on 429 responses | Standard HTTP convention. Lets proxies and CDNs respect the limit. |

### Differentiators

| Element | Standard | Why |
|---------|----------|-----|
| **Redis/Upstash-backed rate limiting for production** | Replace in-memory `Map` with Upstash Redis (via `https://esm.sh/@upstash/redis`) using `INCR` + `EXPIRE` or sliding window Lua script | In-memory state is per-isolate -- on cold start or during scale-out, limits reset independently. Redis gives global consistency. |
| **Sliding window with sorted sets** | Redis sorted set per key, scoring by timestamp, `ZREMRANGEBYSCORE` + `ZCARD` | More accurate than fixed-window counters. Prevents burst at window boundary. Medium complexity. |
| **Graduated tiers per user role** | Free users: 10 req/min, Pro users: 60 req/min, Admin: 300 req/min | Differentiates by subscription tier. Not table stakes because upfront rate limits protect all users equally. |
| **Rate limit analytics** | Log rate limit hits to Sentry as breadcrumbs, track rate_limit_exceeded events as a metric | Helps tune limits. Not table stakes because limits can be tuned reactively. |

### Anti-Patterns

| Practice | Why Avoid | Instead |
|----------|-----------|---------|
| Sliding window via `Array.push` + `filter` (current implementation) | Memory leak risk per key, O(N) on every check | Use timestamp-based fixed window or Redis sorted set |
| Rate limiting per-IP on authenticated routes | Bypasses per-user quotas when users share an IP | Always prefer `userId` key for authenticated routes |
| Hardcoded limits in source code | Requires deploy to change | Use environment variables or Supabase function secrets |

---

## 3. Circuit Breaker for OpenRouter

**State today:** `supabase/functions/_shared/circuitBreaker.ts` exists with in-memory state. Threshold: 5 failures, 30s recovery window, half-open allows 1 request. Only used by `chat-proxy`. CONCERNS.md PERF-05.

### Table Stakes

| Element | Standard | Why |
|---------|----------|-----|
| **Constants tuned for LLM API** | Threshold: 3 failures (not 5), Recovery window: 60s (not 30s), Half-open probes: 1 every 30s | LLM APIs have longer recovery than typical REST APIs. 3 failures triggers faster than 5. |
| **Graceful degradation on frontend** | When circuit is OPEN, show banner: "AI temporarily unavailable -- retrying..." instead of a hang or cryptic error | The worst UX is an infinite spinner. The user needs to know the system detected the problem and is handling it. |
| **Timestamps in error responses** | Circuit OPEN returns 503 with `{ error: 'service_unavailable', retryAfter: 60 }` | Frontend uses `retryAfter` for exponential backoff. Same pattern as rate limiting. |
| **Success/failure counting in all streaming paths** | Both the happy path (line 636) and error path (line 905) in `chat-proxy` currently call `circuitSuccess` / `circuitFailure` -- verify all paths | CONCERNS.md BUG-05 (missing `finishReason` assignment) suggests some streaming paths don't complete correctly, which would also miss the circuit breaker call. |

### Differentiators

| Element | Standard | Why |
|---------|----------|-----|
| **Shared KV state via Deno KV** | Replace `Map<string, CircuitState>` with `Deno.openKv()` atomic operations | Cross-instance state survives cold starts and scale-out. Deno KV is built-in to Supabase Edge Functions (FoundationDB in production). |
| **Circuit state exposed via endpoint** | A `GET /circuit-status` endpoint or breadcrumb in Sentry showing circuit name + state + failure count | Lets operators know "OpenRouter has been flapping for 3 hours" without reading logs. |
| **Client-side circuit breaker** | On frontend, cache circuit state and stop sending requests for 30s after a 503 | Reduces load on edge functions during an outage. Simple -- just track last 503 timestamp in Zustand. |
| **Tiered circuit names** | Separate circuits for OpenRouter, Tavily (web search), image model | Don't let Tavily failures cascade to block chat. Currently there's only one `'openrouter'` circuit. |

### Anti-Patterns

| Practice | Why Avoid | Instead |
|----------|-----------|---------|
| Circuit breaker in frontend that calls OpenRouter directly | API key would leak to client | Circuit breaker lives in edge functions where API keys are stored |
| Half-open probes that let through a percentage of traffic | Confusing for users (intermittent failures) | Single probe request; if it succeeds, re-close the circuit |
| Same circuit for all upstream dependencies | Tavily failure blocks chat even when OpenRouter is fine | Separate circuit per service |

---

## 4. Shared Types Between Vite SPA and Deno Edge Functions

**State today:** Types are duplicated -- `src/types/index.ts` has `Artifact`, `Message`, etc. Edge functions define their own interfaces inline. No shared source of truth. CONCERNS.md TD-06.

### Table Stakes

| Element | Standard | Why |
|---------|----------|-----|
| **Shared package at `packages/shared/src/types.ts`** | Extract contract types (SSE event shapes, API request/response types, tool definitions) into a single source | These are the interfaces that cross the frontend/backend boundary. If one side changes, the other MUST know. |
| **Type export for frontend** | `packages/shared/package.json` has `"main": "./src/types.ts"`, frontend imports as `@lucen/shared` | Simplest approach -- no build step for the types package. Vite can resolve TypeScript files directly. |
| **Path alias for import** | `tsconfig.app.json` paths: `"@lucen/shared": ["./packages/shared/src"]` and `supabase/functions/_shared/types.ts` that re-exports | Both sides import from the same file. The Deno version uses a local re-export because Deno doesn't support npm workspace path aliases. |
| **What goes in shared** | `ArtifactType`, `Message` shape, `StreamChunk` (SSE format), `ToolCall` / `ToolResult`, `UsageEvent`, API error shapes, CORS policy strings | Only cross-boundary contracts. Internal types (store shapes, component props) stay in their modules. |

### Differentiators

| Element | Standard | Why |
|---------|----------|-----|
| **TypeScript project references** | Root `tsconfig.json` references both `packages/shared` and `src/`, run `tsc -b --clean` in CI | Gives compiler-level enforcement that shared types compile correctly. |
| **OpenAPI as contract source** | Generate types from an OpenAPI spec using `openapi-typescript` | Even stronger enforcement. The spec becomes the source of truth, and changes require both sides to comply. Overkill for a 10-function API but valuable as the project grows. |
| **Validation layer for shared types** | Zod schemas for request/response shapes, used for runtime validation on both sides | Catches mismatches at runtime instead of compile time. Zod + TypeScript gives dual safety. |

### Anti-Patterns

| Practice | Why Avoid | Instead |
|----------|-----------|---------|
| `npm link` or symlinks | Fragile, breaks across platforms | npm workspace with explicit paths |
| Copying types into `supabase/functions/_shared/` | Creates the drift problem we're solving | Type re-export file that imports from the shared package |
| Sharing ALL types (including internal components) | Bloat, unnecessary coupling | Share only API-contract types |

---

## 5. Structured Logging with Correlation IDs

**State today:** `src/lib/logger.ts` exists on frontend (basic leveled wrapper, no correlation IDs). `supabase/functions/_shared/logging.ts` exists on backend (JSON output with `requestId` and `userId` in context). 50+ raw `console.*` calls bypass the logger. CONCERNS.md TD-07.

### Table Stakes

| Element | Standard | Why |
|---------|----------|-----|
| **Frontend migration to logger** | Replace all `console.log`/`console.warn`/`console.error` calls (50+) with `logger.info`/`logger.warn`/`logger.error` | Raw console calls bypass level filtering, correlation IDs, and any future log transport. |
| **Correlation ID injection in services** | Generate a `correlationId` (UUID) in `src/services/openrouter.ts` and pass it through all async chains | Maps requests across service boundaries. When OpenRouter fails, the correlation ID ties the frontend log to the edge function log. |
| **Logger signature** | `logger.info('message', { correlationId, userId, ...extra })` as second arg | Structured data, not string interpolation. The current `src/lib/logger.ts` uses rest args but needs an explicit context object. |
| **Backend correlation from frontend** | Frontend sends `X-Correlation-Id` header; edge function logger picks it up via `request.headers.get('X-Correlation-Id')` | The `createLogger` in `logging.ts` already accepts a `requestId` in context. Plumb it from the HTTP request header. |
| **What to log on frontend** | Stream events (start, chunk, complete, error), store actions (auth transitions, credit changes, artifact status), network errors | Events that help diagnose "why did this chat break." Avoid logging every render or every store subscription. |
| **What to redact** | API keys, JWTs, user passwords, full message content (log length not content), file contents | The current `logger.ts` passes `...args` through with no redaction. Add a `redacted` utility that truncates and strips secrets. |

### Differentiators

| Element | Standard | Why |
|---------|----------|-----|
| **Log aggregation to Supabase** | Insert logs to a `logs` table with correlation ID and level indexed | Searchable log trail without external service. Less useful at low volume but valuable for debugging. |
| **`child()` logger for modules** | `createLogger('chat-proxy').child({ module: 'rateLimit' })` for sub-module context | The `logging.ts` already has `child()` method. Use it in the refactored modules after splitting monoliths. |
| **Sentry breadcrumbs from logger** | Logger automatically adds Sentry breadcrumbs on `warn` and `error` calls | Every `logger.warn` becomes a Sentry breadcrumb, giving context to errors. Currently Sentry is present but breadcrumb integration is not confirmed. |

### Anti-Patterns

| Practice | Why Avoid | Instead |
|----------|-----------|---------|
| Correlation IDs via global singleton | Leaks across requests in server-side contexts (not relevant for SPA but bad practice) | Pass explicitly through function parameters or context objects |
| Logging full file contents or messages | PII exposure, log bloat | Log file name, size, type (not content). Log message length, model (not content). |
| Console.error for expected errors (e.g., rate limit) | Noise in error monitoring | Use `logger.warn` for expected failures, `logger.error` for unexpected ones. |

---

## 6. CSP Headers for App with Sandboxed User Content

**State today:** `index.html` has a `<meta http-equiv>` CSP with `script-src 'self' 'unsafe-inline' 'unsafe-eval'`, `frame-src 'self' blob:`, `worker-src 'self' blob:`. Artifact iframes use `sandbox="allow-scripts"` (no `allow-same-origin`). The CSP is applied via `<meta>` tag, not HTTP header. CONCERNS.md SEC-02, PROD-04.

### Table Stakes

| Element | Standard | Why |
|---------|----------|-----|
| **Move CSP to HTTP header** | Add CSP in `supabase/functions/_shared/cors.ts` or Vercel `vercel.json` headers config | `<meta http-equiv>` CSP is weaker than HTTP header CSP -- some directives (`frame-ancestors`, `sandbox`) only work in headers. Also, meta CSP can't prevent certain exfiltration paths. |
| **Retain `'unsafe-inline'` and `'unsafe-eval'` on script-src** | `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net` | Mermaid uses `eval()` for rendering. React may use inline event handlers in dev. `'unsafe-eval'` is a hard requirement for Mermaid. Accept this tradeoff. |
| **tighten `frame-src`** | `frame-src 'self' blob:;` (already present) | Artifact iframes use `blob:` URLs for `srcdoc`. No external framing needed. |
| **Add `sandbox` directive to CSP** | `sandbox allow-scripts` | Prevents the main page from allowing navigation popups or form submissions even if injected. This is redundant with the iframe sandbox attribute but adds defense-in-depth. |
| **Add `form-action 'self'`** | Already in CSP meta tag | Prevents forms from submitting to external origins. Important for login forms. |
| **Document all CSP violations** | Run the app with CSP reports enabled during testing, document which violations are expected (Mermaid eval, etc.) | Without documentation, developers will add `'unsafe-*'` directives or remove CSP entirely when they see console warnings. |

### Differentiators

| Element | Standard | Why |
|---------|----------|-----|
| **CSP reporting endpoint** | Add `report-uri` or `report-to` directive pointing to a `/csp-report` endpoint | Collects violation reports without breaking the app. Essential for tuning CSP in production. |
| **Sentry CSP report capture** | Wire the CSP report endpoint to create a Sentry event | Operational visibility. If `'unsafe-inline'` is blocked unexpectedly, you see it immediately. |
| **Hash-based script-src instead of `'unsafe-inline'`** | Generate SHA-256 hashes for all inline scripts in `index.html` | Eliminates the need for `'unsafe-inline'`. Only works if you control all inline scripts. Mermaid's eval is still a blocker. |

### Anti-Patterns

| Practice | Why Avoid | Instead |
|----------|-----------|---------|
| Setting CSP via `<meta>` tag alone | Weaker than HTTP header, can't enforce `frame-ancestors` or `sandbox` | Use `vercel.json` header config or inject in edge function response |
| Blocking `'unsafe-eval'` with Mermaid present | Mermaid's renderer requires `eval()` or `Function()` -- it will break silently | Accept `'unsafe-eval'` and document why |
| Overly restrictive CSP that breaks artifact iframes | Artifact iframes with `sandbox="allow-scripts"` need script execution | The CSP on the main page does not apply to iframe srcdoc content -- each iframe is a separate document context |

---

## 7. Feature Flags / Kill Switches

**State today:** `supabase/functions/_shared/featureFlags.ts` uses `Deno.env.get('FEATURE_*')`. Defaults to enabled. `isKillSwitched('CHAT')` is called at the top of `chat-proxy`. No other edge function checks kill switches. CONCERNS.md FAG-05, PROD-06.

### Table Stakes

| Element | Standard | Why |
|---------|----------|-----|
| **Kill switch check at every edge function entry** | `if (isKillSwitched('CLASSIFY_INTENT')) return { error: 'disabled', status: 503 }` at the top of each function | Currently only `chat-proxy` checks. All 11 functions need it. Without this, a production bug requires a code deploy to disable. |
| **Naming convention** | `FEATURE_<FUNCTION_NAME>` convention for environment variables | Consistent. The `featureFlags.ts` already normalizes to `FEATURE_*` prefix. Just need to set the vars. |
| **Graceful frontend response** | When an edge function returns `{ error: 'disabled' }`, frontend shows a one-time banner explaining the feature is temporarily unavailable | Prevents confusing errors. User should know it's intentional, not a bug. |
| **Deno.env.get() is sufficient** | Feature flags via env vars are the right pattern for edge functions | Simple, synchronous, no external dependency. `Deno.env.get()` is instant. KV would add latency and cost. |

### Differentiators

| Element | Standard | Why |
|---------|----------|-----|
| **Supabase `feature_flags` table toggle** | A SQL table `feature_flags` with `name`, `enabled`, `updated_at`. Edge functions query it on cold start, cache for TTL | Enables toggle without redeploying env vars. Supabase function secrets require `supabase secrets set` CLI. A DB table can be toggled from the dashboard. |
| **Frontend feature flags from `/get-model-config`** | Return `{ features: { web_search: true, artifacts: true, python: false } }` from model config endpoint | Frontend can hide/disable features based on server-side config. Currently the model config endpoint exists but doesn't return feature flags. |
| **Gradual rollout (canary)** | `isFeatureEnabled` accepts a percentage: `isFeatureEnabled('NEW_PARSER', 0.1)` (10% of users) | Useful for phasing in risky changes. Needs a deterministic user hash for consistent experience. |

### Anti-Patterns

| Practice | Why Avoid | Instead |
|----------|-----------|---------|
| Feature flags in frontend Zustand store only | User can bypass by modifying localStorage | Kill switches MUST be enforced server-side (edge functions). Frontend flags are only for UI hiding. |
| Using Deno KV for every flag check | Adds latency and cost per request | `Deno.env.get()` is synchronous and free. Use KV only for rate limit / circuit breaker state that needs cross-instance sharing. |
| More than 10 feature flags | Cognitive overhead, untested flag combinations | Keep flags focused on kill-switch patterns (disable entire features) not fine-grained toggles. |

---

## 8. SVG Sanitization

**State today:** `sanitizeSvg()` in `src/components/ArtifactRenderer.tsx:28-43` uses 8 regex replacements. Strips `<script>`, `<foreignObject>`, `<iframe>`, `<object>`, `<embed>`, event handlers, `javascript:` URIs, and external `<use>` references. CONCERNS.md SEC-01, BUG-07.

### Table Stakes

| Element | Standard | Why |
|---------|----------|-----|
| **Replace regex with DOMPurify** | `npm install dompurify @types/dompurify`, replace `sanitizeSvg()` with `DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } })` | Regex-based sanitization is provably bypassable. DOMPurify is a battle-tested sanitizer that handles edge cases (mixed case, encoded entities, nested contexts) that regex misses. |
| **Keep SVG profile** | `USE_PROFILES: { svg: true }` enables SVG-specific tags (`<path>`, `<circle>`, `<g>`, etc.) and attributes while blocking script execution | Generic HTML sanitization would strip SVG elements. The SVG profile is specifically designed for this use case. |
| **Keep existing regex as fallback** | If DOMPurify fails to load (network error on CDN), fall back to the regex sanitizer | Defense-in-depth. DOMPurify returns the original string on error -- the regex fallback is better than unsanitized output. |
| **Sanitize ALL paths** | Verify the sanitizer is called on every SVG rendering path (not just the main preview path) | CONCERNS.md notes `sanitizeSvg` exists but "may not be called on all rendering paths." Audit all `<ArtifactRenderer>` usage. |

### Differentiators

| Element | Standard | Why |
|---------|----------|-----|
| **DOMParser-based validation** | Before DOMPurify, parse SVG with `new DOMParser().parseFromString(svg, 'image/svg+xml')` and check for parse errors | Catches malformed SVG that DOMPurify might pass through. DOMParser alone is NOT sanitization (per the docs), but it's good pre-validation. |
| **Allowlist-based approach** | Instead of DOMPurify's blocklist, configure `ALLOWED_TAGS` and `ALLOWED_ATTR` as a strict allowlist | Blocklists miss edge cases. An allowlist says "only these SVG tags and attributes" -- everything else is stripped. Safer but requires maintenance as features are added. |
| **Unit test suite for bypasses** | 20+ test cases: mixed-case event handlers, data: URIs, SVG `<use>` with external href, nested `<svg>`, `<script>` in CDATA, `javascript:` in href, `onfocusin` event, etc. | Proves the sanitizer is effective. Without bypass tests, you can't tell if a change introduces a regression. |

### Anti-Patterns

| Practice | Why Avoid | Instead |
|----------|-----------|---------|
| Regex-based sanitization alone | Provably bypassable (mixed case, encoded entities, nested contexts) | Use DOMPurify or a proper DOM parser |
| Using `DOMParser.parseFromString` alone as sanitizer | Parse is NOT sanitize -- DOMParser doesn't block event handlers or script execution | Combine DOMParser validation + DOMPurify sanitization |
| Trusting `innerHTML` assignment even with sanitization | Sanitizer bugs happen. Defense-in-depth means never trusting sanitized input in the main DOM | Render SVGs in a sandboxed iframe or use `<object>` with `data:` URI (same-origin restrictions apply) |

---

## 9. Mermaid `securityLevel`

**State today:** Both `ArtifactRenderer.tsx:488` and `ArtifactWorkspace.tsx:74` already set `securityLevel: 'strict'`. The CONCERNS.md bug (BUG-08) about `securityLevel: 'loose'` appears to be already fixed in the recent "Fix 28 issues" commits.

### Table Stakes

| Element | Standard | Why |
|---------|----------|-----|
| **`securityLevel: 'strict'`** | Already set in both render paths. **Verify it stays** during any config refactoring. | In `strict` mode, Mermaid strips all event handlers from diagram elements. `click` callbacks, `tooltip` on click, and `href` in node definitions are silently removed. |
| **No click callbacks** | In `strict` mode, Mermaid's `click` event handler directive is ignored | This is intentional -- diagram labels generated by AI models could include malicious `click` callbacks. Losing click functionality is acceptable. |
| **Future: `securityLevel: 'sandbox'`** | Renders diagram inside a sandboxed iframe, isolating it from the main document | If click callbacks become necessary, use `sandbox` mode instead of `loose`. Sandbox mode uses an iframe with `sandbox` attribute. |

### Differentiators

| Element | Standard | Why |
|---------|----------|-----|
| **Unit test for Mermaid securityLevel** | Test that `mermaid.initialize` is called with `securityLevel: 'strict'` and that configuration changes don't revert it | Regression guard. A future developer might change it to `'loose'` to enable click handlers, not realizing the security implication. |
| **`node_modules` pin verification** | Verify the installed `mermaid` version supports `securityLevel: 'strict'` (v11+ does) | Mermaid v10 had different security behavior. The project has `mermaid ^11.13.0` -- verify this. |

### Anti-Patterns

| Practice | Why Avoid | Instead |
|----------|-----------|---------|
| `securityLevel: 'loose'` to enable click handlers | Allows arbitrary JS execution from AI-generated diagram labels | Accept the tradeoff that click callbacks don't work in strict mode |
| Allowing `click` callback configuration through user-facing settings | Users won't understand the security implications | Keep it locked at `'strict'` for all users |
| Assuming `securityLevel: 'sandbox'` is more secure than `'strict'` | Sandbox uses iframe isolation; strict strips all event handlers. Both prevent JS execution. Strict has less overhead. | Use `'strict'` unless iframe isolation is explicitly needed. |

---

## 10. Pyodide Web Worker Timeouts

**State today:** No Pyodide or Python execution worker found in `src/`. The `ArtifactType` enum (`'html' | 'svg' | 'mermaid' | 'file'`) does NOT include `'python'`. The CONCERNS.md bug (BUG-09) about "Python artifact (Pyodide) has no execution timeout" describes a component that appears **not yet implemented** in the current codebase.

### Table Stakes (if Python execution is re-added)

| Element | Standard | Why |
|---------|----------|-----|
| **Worker.terminate() after timeout** | `setTimeout(() => worker.terminate(), EXECUTION_TIMEOUT_MS)` where timeout is 30s for preview, 120s for full execution | `worker.terminate()` is the only reliable way to stop a Pyodide worker running an infinite loop. Pyodide does NOT expose a Python-level interrupt mechanism in the browser. |
| **Timeout as environment variable** | `PYTHON_EXECUTION_TIMEOUT_MS` with default 30000 (30s) | Developers need to adjust based on model performance. Hardcoding leads to frustration. |
| **User-facing timeout message** | When timeout fires, show "Python execution timed out after 30s" instead of a broken worker | A terminated worker leaves no error state. The UI must set a flag before termination. |
| **Worker recreation after timeout** | After terminate(), create a new worker for the next execution. Pyodide MUST be re-initialized. | Terminated workers cannot be restarted. Re-init is slow (WASM download) but unavoidable. |

### Differentiators

| Element | Standard | Why |
|---------|----------|-----|
| **Progress-based timeout** | Send periodic `{ type: 'heartbeat' }` from worker; if no heartbeat for 10s, terminate | Catches hung I/O (not just infinite loops) but doesn't terminate long-running valid computations. |
| **Memory limit via `crossOriginIsolated` + `performance.measureUserAgentSpecificMemory()`** | Estimate Pyodide heap usage and terminate if it exceeds a threshold | Prevents runaway memory usage. Requires `crossOriginIsolated` header which conflicts with CSP needs. Complex. |
| **Operation budgeting** | Count Python bytecode instructions via AST analysis before execution; reject code with >N instructions | Prevents infinite loops theoretically. In practice, instruction counting is imprecise and misses some loop patterns. |

### Anti-Patterns

| Practice | Why Avoid | Instead |
|----------|-----------|---------|
| Pyodide's `setInterruptBuffer` / `interruptBuffer` | Requires Python code to call `signal.signal(SIGINT)`, which infinite loops won't reach | `worker.terminate()` is the only reliable mechanism |
| Running Pyodide on the main thread | Blocks the entire UI, can't use timeout | Always use a Web Worker; this is already the intended architecture |
| `while(true)` detection via static analysis | Trivially bypassable (`while(1)`, `for(;;)`, recursive functions) | Runtime timeout with worker termination |

---

## Feature Dependencies

```
Test Infrastructure (Vitest + Playwright)
    └──requires──> npm packages (vitest, @vitest/coverage-istanbul, @testing-library/react, @testing-library/jest-dom, @playwright/test)
                       └──requires──> package.json update + npm install

Shared Types Package
    └──requires──> directory layout (packages/shared/src/)
                       └──requires──> tsconfig.app.json path alias update
                       └──requires──> supabase/functions/_shared/types.ts re-export file

Circuit Breaker (shared KV)
    └──enhances──> Rate Limiting (shared KV)
    └──requires──> Deno.openKv() availability on Supabase (confirmed available)

Structured Logging (correlation IDs)
    └──requires──> Monolith refactoring (split openrouter.ts + chat-proxy/index.ts)
                       └──benefits from──> Test Infrastructure (can test refactored modules)

CSP Headers (HTTP header, not meta)
    └──requires──> Understanding Vercel header configuration or edge middleware

Feature Flags / Kill Switches
    └──requires──> Apply checkRateLimit to all functions FIRST (same pattern: modify all function entry points)

SVG Sanitization (DOMPurify)
    └──enhances──> CSP Headers (layered defense)
    └──requires──> npm install dompurify @types/dompurify

Pyodide Timeouts
    └──requires──> Python execution feature to exist (currently NOT in codebase -- deferred)
```

### Dependency Notes

- **Test Infrastructure must come before monolith refactoring.** Without tests, the refactoring is blind. Write tests for the current monolithic functions first, then refactor, then watch the tests pass.
- **Structured logging benefits from the split of monoliths**, but does not strictly require it. Start replacing `console.*` calls with `logger.*` immediately; the correlation ID plumbing gets easier after the split.
- **Rate limiting and kill switches both require touching every edge function entry point.** Do them in the same pass to minimize churn.
- **CSP headers conflict with nothing.** Can be done independently at any time.
- **Pyodide is deferred.** No Python execution infrastructure exists in the current codebase. The timeout concern is speculative until the feature is built.

---

## Phase Ordering Recommendations

Based on research, the following build order for the stabilization milestone:

### Phase 1: Foundation
- [ ] Test Infrastructure (Vitest + Playwright) -- enables testing everything that follows
- [ ] Shared Types Package -- reduces risk of contract drift during refactoring

### Phase 2: Structural
- [ ] Split monoliths (openrouter.ts, chat-proxy/index.ts) -- manageable in tested modules
- [ ] Structured Logging (correlation IDs) -- plumb through refactored modules
- [ ] Apply rate limiting + kill switches to ALL edge functions -- single pass through all entry points

### Phase 3: Security
- [ ] CSP Headers -- independent, can be done in parallel
- [ ] SVG Sanitization (DOMPurify) -- replaces regex, needs test harness from Phase 1
- [ ] Mermaid securityLevel verification -- confirm already fixed, add regression tests

### Phase 4: Resilience
- [ ] Circuit Breaker (shared KV) -- depends on understanding Deno KV availability
- [ ] Rate limit persistence (Redis/Upstash) -- if in-memory is insufficient after testing
- [ ] Pyodide timeouts -- deferred until Python execution feature is built

### Phase 5: Verification
- [ ] End-to-end tests (Playwright) -- depends on test infrastructure from Phase 1
- [ ] Failing test regression suite -- reproduce BUG-01 through BUG-10 as automated tests
- [ ] CSP report endpoint + monitoring

---

## Prioritization Matrix

| Item | User Impact | Implementation Cost | Priority |
|------|-------------|---------------------|----------|
| Test Infrastructure | LOW (dev-only) | MEDIUM | P1 (enables everything else) |
| Shared Types | LOW (dev-only) | LOW | P1 (reduces refactoring risk) |
| Rate Limiting (all functions) | MEDIUM | LOW | P1 (security gap) |
| Rate Limiting (Redis) | LOW | MEDIUM | P3 (in-memory is acceptable for dev) |
| Circuit Breaker (shared KV) | MEDIUM | MEDIUM | P2 (in-memory works for single-instance) |
| Structured Logging | LOW (dev-only) | MEDIUM | P2 (helps debugging) |
| CSP Headers | LOW | LOW | P2 (existing meta CSP provides partial protection) |
| SVG Sanitization (DOMPurify) | MEDIUM | LOW | P1 (XSS vulnerability) |
| Mermaid securityLevel | LOW | LOW | P1 (already fixed, just verify) |
| Pyodide Timeouts | N/A | MEDIUM | P5 (feature not implemented) |
| Kill Switches (all functions) | MEDIUM | LOW | P1 (production hardening required) |
| CSP report endpoint | LOW | LOW | P3 (nice to have) |

---

## Sources

- [Vitest Documentation](https://vitest.dev/guide/) -- Configuration, coverage, jsdom setup
- [Playwright Documentation](https://playwright.dev/docs/test-configuration) -- E2E test config, webServer, projects
- [DOMPurify GitHub](https://github.com/cure53/DOMPurify) -- SVG sanitization via USE_PROFILES
- [Deno KV Documentation](https://docs.deno.com/deploy/kv/manual/) -- Atomic operations, FoundationDB in production
- [MDN CSP: frame-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/frame-src) -- CSP for iframe-sandboxed content
- Codebase analysis: `src/lib/logger.ts`, `supabase/functions/_shared/*.ts`, `src/components/ArtifactRenderer.tsx`, `index.html`

---
*Feature research for: Lucen v2.3 Stabilization Milestone*
*Researched: 2026-06-08*