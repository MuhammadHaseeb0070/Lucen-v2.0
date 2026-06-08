# Technical Concerns

**Last updated:** 2026-06-08

## Tech Debt

### 1. Monolithic `src/services/openrouter.ts` (1,770 lines)

- **Issue:** Single file handling message building, pruning, streaming, SS parsing, continuation loops, artifact detection, token estimation, RAG injection, and error recovery. Violates single responsibility principle.
- **Files:** `src/services/openrouter.ts`
- **Impact:** Untestable. Any change risks breaking 5+ concerns. 40+ `console.warn`/`console.error` calls are scattered throughout with no structured approach.
- **Fix approach:** Split into focused modules: `messages/` (build, prune), `streaming/` (SSE parsing, state machine), `continuation/` (loop logic), `rag/` (context injection).

### 2. Monolithic `supabase/functions/chat-proxy/index.ts` (1,668 lines)

- **Issue:** A single edge function handling auth, rate limiting, circuit breaker, tool orchestration, streaming, billing, and usage recording in one file.
- **Files:** `supabase/functions/chat-proxy/index.ts`
- **Impact:** Difficult to reason about or test. The stream loop (lines 719-1627) is a single ~900-line block with deeply nested try/catch and multiple concerns interleaved.
- **Fix approach:** Split tool orchestration into a dedicated module, move billing into a shared helper, keep only stream orchestration in `chat-proxy`.

### 3. Three different names for `web_search_enabled`

- **Issue:** The frontend sends, and the backend accepts, three different key names for the same boolean flag: `web_search_enabled`, `webSearchEnabled`, and `enableWebSearch`. Only `web_search_enabled` is actually checked in `chat-proxy` at line 433.
- **Files:** `supabase/functions/chat-proxy/index.ts:361-396`, `src/services/openrouter.ts`
- **Impact:** Confusion risk. A client sending the wrong key name silently fails to enable web search.
- **Fix approach:** Normalize to `web_search_enabled` throughout the codebase. Add deprecation warnings for legacy keys.

### 4. 37KB `themeStore.ts` with hardcoded color data

- **Issue:** `src/store/themeStore.ts` (958 lines) contains ~700 lines of hardcoded color palettes mixed with business logic and persistence.
- **Files:** `src/store/themeStore.ts`
- **Impact:** Diff noise, hard to maintain theme data, complicates store testing.
- **Fix approach:** Extract color data to `src/config/themes.ts`.

### 5. `setViewerFile` accepts `any`

- **Issue:** `src/store/uiStore.ts:38` declares `setViewerFile: (file: any) => void`. No type safety on viewer file shape.
- **Files:** `src/store/uiStore.ts:38`
- **Impact:** Runtime errors from malformed file data, loss of autocomplete.
- **Fix approach:** Define and use a proper `ViewerFile` type.

### 6. No shared types between frontend and edge functions

- **Issue:** SSE event types, tool definitions, and API contracts are defined independently on frontend and backend. No shared type source.
- **Files:** All edge functions and frontend services.
- **Impact:** Silent regressions when one side changes a contract without the other. Deserialization errors at runtime.
- **Fix approach:** Create a shared types package or use OpenAPI/GraphQL contract.

### 7. No structured logging on frontend

- **Issue:** The `src/lib/logger.ts` provides a basic leveled-logging wrapper, but most code bypasses it in favor of raw `console.log`/`console.error` calls. No correlation IDs, no structured JSON output, no log aggregation.
- **Files:** `src/lib/logger.ts`, 50+ raw `console.*` calls across `src/services/`, `src/store/`, `src/components/`
- **Impact:** Cannot diagnose production issues without reproducing them. No searchable log trail.
- **Fix approach:** Migrate all `console.*` calls to use the `logger` module. Add correlation IDs per request chain.

### 8. Cross-store imports and Zustand subscription soup

- **Issue:** Stores import each other directly (e.g., `authStore` imports `chatStore`, `chatStore` uses `uiStore`). This creates spaghetti dependencies.
- **Files:** `src/store/authStore.ts`, `src/store/chatStore.ts`, `src/store/themeStore.ts`, and others.
- **Impact:** Refactoring one store can break others. Hard to test stores in isolation.
- **Fix approach:** Use Zustand's `subscribe` for cross-store communication. Each store should be independently loadable.

### 9. No end-to-end tests

- **Issue:** Zero test files found in `src/`. No `.test.ts` or `.spec.ts` files exist anywhere in the project source.
- **Files:** Entire project.
- **Impact:** Every deployment is a leap of faith. The recent "Fix 28 issues" commit fixing the same bug multiple times confirms this.
- **Fix approach:** Add integration tests for: auth flow, chat stream, credit deduction, webhook processing, artifact pipeline.

---

## Known Bugs

### 1. `onDone` not called after `onError` in `processStream`

- **Symptoms:** If an SSE stream emits an error, `onDone` is never called, leaving the UI in a loading state indefinitely. Continuation loop may retry forever.
- **Files:** `src/services/openrouter.ts:1748`
- **Trigger:** Upstream error from chat-proxy during streaming.
- **Workaround:** User must manually refresh.

### 2. Artifact parser orphaned closing tags pass through

- **Symptoms:** `INCOMPLETE_TAG_RE` only strips opening tags; orphaned closing tags survive, producing garbage HTML like `</head> </li> </li>`.
- **Files:** `src/lib/artifactParser.ts:206`
- **Trigger:** Incomplete HTML artifact streamed from model — very common.
- **Workaround:** None. The HTML renderer shows broken layout.

### 3. HTML artifact renderer does not validate meaningful content

- **Symptoms:** `ArtifactRenderer.tsx:143-158` doesn't verify that content is valid HTML before injecting into `srcdoc`. Empty or malformed HTML renders as whitespace with no error.
- **Files:** `src/components/ArtifactRenderer.tsx:143-158`
- **Trigger:** Any artifact with an empty body or broken markup.
- **Workaround:** None.

### 4. `injectIntoHtml` regex matches closing `</head>` tags

- **Symptoms:** `iframeErrorBridge.ts:224` uses `/<head[^>]*>/i` which matches `</head>` — the injection script gets placed AFTER the closing head tag instead of inside it.
- **Files:** `src/lib/iframeErrorBridge.ts:224`
- **Trigger:** Any HTML artifact with proper `<head>` and `</head>` tags.
- **Workaround:** None. Injection script may not execute before page errors.

### 5. `finishReason` not assigned in some chat-proxy streaming paths

- **Symptoms:** Billing calculation uses `finishReason` but certain streaming code paths never assign it. Results in zero-cost deductions for completed streams.
- **Files:** `supabase/functions/chat-proxy/index.ts:1494`
- **Trigger:** Non-standard SSE format from OpenRouter where `finish_reason` isn't on every chunk.
- **Workaround:** Revenue loss without alerting.

### 6. Missing `[DONE]` after server error in chat-proxy

- **Symptoms:** When chat-proxy encounters an internal error, the `[DONE]` sentinel is not always emitted. The frontend never terminates the stream, leading to an infinite continuation loop.
- **Files:** `supabase/functions/chat-proxy/index.ts:1612-1618`
- **Trigger:** Any internal error in the chat-proxy stream handler.
- **Workaround:** None. User sees infinite loading.

### 7. SVG `innerHTML` XSS — no sanitization on rendering path

- **Symptoms:** SVG artifacts are rendered directly via `innerHTML` in the main DOM tree without sanitization. A crafted `<script>` or `onload` event in SVG executes in the main document context.
- **Files:** `src/components/ArtifactRenderer.tsx:28-43` (sanitizeSvg exists but may not be called on all rendering paths)
- **Trigger:** AI model generates SVG with embedded JavaScript.
- **Workaround:** `sanitizeSvg` function exists but verify it is called on ALL SVG rendering paths. It strips `<script>`, `<foreignObject>`, `<iframe>`, `<object>`, `<embed>`, event handlers, and `javascript:` URIs.

### 8. Mermaid `securityLevel: 'loose'` allows JS in diagram labels

- **Symptoms:** Mermaid diagrams render with `securityLevel: 'loose'`, which allows JavaScript execution inside diagram labels.
- **Files:** Mermaid configuration in component files.
- **Trigger:** AI model generates Mermaid with click event handlers in labels.
- **Workaround:** Switch to `securityLevel: 'strict'` or `'sandbox'`.

### 9. No Python execution timeout

- **Symptoms:** Python artifacts execute in a Pyodide web worker. If code enters an infinite loop or hangs on I/O, the worker is blocked indefinitely. No timeout mechanism.
- **Files:** Python artifact execution worker (Pyodide WASM worker).
- **Trigger:** User prompts AI to generate Python code with an infinite loop.
- **Workaround:** None. Worker is permanently blocked, must reload the page.

### 10. `focusedArtifactId` drops results on content change

- **Symptoms:** When `focusedArtifactId` changes, the store and worker state are not properly reset. Results from previous runs persist or are dropped.
- **Files:** `src/store/artifactStore.ts` and related artifact worker files.
- **Trigger:** User switches artifacts while Python is executing.
- **Workaround:** None. Old results may show for new artifact.

---

## Security Concerns

### 1. SVG/HTML artifact XSS (defense-in-depth gaps)

- **Risk:** SVG artifacts are rendered with `innerHTML` into the main document DOM tree. While `sanitizeSvg()` exists in `ArtifactRenderer.tsx:28-43`, it uses regex-based sanitization that can be bypassed (e.g., mixed-case event handlers, encoded entities). HTML artifacts in iframes are sandboxed, but SVG is not.
- **Files:** `src/components/ArtifactRenderer.tsx:28-43`
- **Current mitigation:** `sanitizeSvg()` regex strips known dangerous patterns.
- **Recommendations:** Use DOMParser API for proper SVG sanitization instead of regex. Add unit tests for sanitization bypasses.

### 2. No Content Security Policy headers

- **Risk:** The application sends no CSP headers. Artifact iframes render arbitrary user-generated HTML with `allow-scripts` sandbox. While iframes are cross-origin isolated, the main page has no CSP protection against injection in other contexts.
- **Files:** Application server configuration.
- **Current mitigation:** Iframe sandbox attribute (no `allow-same-origin`).
- **Recommendations:** Add CSP headers: `default-src 'self'; frame-src 'self'; img-src 'self' data: https:; script-src 'self'`.

### 3. Edge function JWT verification still uses local decode in some paths

- **Risk:** While the audit says all 8 edge functions were fixed to use `supabase.auth.getUser(token)`, verify that this is consistent. The `chat-proxy` function decodes JWT locally first (`decodeJwtPayload`) for userId extraction, then verifies via `admin.getUserById` — but the local decode path could still be exploited if verification is skipped in any code path.
- **Files:** `supabase/functions/chat-proxy/index.ts:330-356`
- **Current mitigation:** Two-step: local decode for user ID, then Supabase admin verification.
- **Recommendations:** Add a Sentry alert if `admin.getUserById` fails after local decode succeeded (indicates forged JWT attempt).

### 4. No rate limiting across most edge functions

- **Risk:** Only `chat-proxy` has rate limiting (30 req/min per user at line 343). Other edge functions (`describe-image`, `classify-intent`, `embed`, `retrieve-chunks`, `generate-title`, `ls-webhook`, `deduct-credits`, `web-search`, `get-file-content`, `get-model-config`, `ls-checkout`) have no rate limiting.
- **Files:** All edge functions except `supabase/functions/chat-proxy/index.ts`
- **Current mitigation:** In-memory sliding-window rate limiter exists in `supabase/functions/_shared/rateLimit.ts` but is only used by chat-proxy.
- **Recommendations:** Apply `checkRateLimit` to all edge functions. For production, migrate to Redis-backed rate limiting.

### 5. File upload content security

- **Risk:** No content moderation on user-uploaded images sent to vision model. No PII detection on document content sent to embedding model. Encrypted/password-protected PDFs/DOCX files cause extraction errors (crash or cryptic message).
- **Files:** `src/services/fileProcessor.ts`, `supabase/functions/describe-image/index.ts`, `supabase/functions/embed/index.ts`
- **Current mitigation:** None.
- **Recommendations:** Add file size validation for 0-byte files. Add content hash dedup for duplicate uploads. Add user-facing error messages for encrypted/protected files.

### 6. No JWT expiry check mid-stream

- **Risk:** If a user's JWT expires during a long streaming session, the stream continues but the final credit deduction call may fail. No mechanism refreshes the token mid-stream.
- **Files:** `supabase/functions/chat-proxy/index.ts`
- **Current mitigation:** None.
- **Recommendations:** Add token refresh callback in the stream pipeline. Reject with 401 if token expires.

---

## Performance Concerns

### 1. 60Hz `JSON.stringify` in theme fingerprint

- **Problem:** `buildThemeApplyFingerprint` (line 648-679) runs `JSON.stringify` on ~20 color fields on every state change. During slider drags at 60Hz, this means 60 full JSON stringifications per second.
- **Files:** `src/store/themeStore.ts:648-679`
- **Cause:** No memoization on the fingerprint computation.
- **Improvement path:** Use a simple hash or only compute fingerprint on actual change (deep compare input vs last output).

### 2. No memoization on heavy component renders

- **Problem:** Several large components (`ChatArea.tsx` at 1,402 lines, `MessageBubble.tsx` at 767 lines, `FileLibrary.tsx` at 824 lines) perform significant work on each render. No consistent `React.memo` usage across the codebase.
- **Files:** `src/components/ChatArea.tsx`, `src/components/MessageBubble.tsx`, `src/components/FileLibrary.tsx`
- **Cause:** Components were built iteratively without profiling.
- **Improvement path:** Add `React.memo` to pure presentational components. Profile with React DevTools to identify expensive re-renders.

### 3. Ring buffer debug capture fills memory in dev

- **Problem:** The debug store ring buffer (max 200 entries at line 22 of `debugStore.ts`) captures full request/response payloads in development. While `redactPayload` truncates strings to 20K chars, each entry can still be significant. In a long dev session, this accumulates.
- **Files:** `src/store/debugStore.ts`
- **Cause:** `DEBUG_CAPTURE_ENABLED` requires both dev mode AND `VITE_DEV_PAYLOAD_CAPTURE='true'` now, but session-level accumulation persists.
- **Improvement path:** Add a TTL-based eviction (entries older than 30 minutes are purged). Or add a max total bytes threshold.

### 4. OpenRouter monolithic file has no lazy loading

- **Problem:** `src/services/openrouter.ts` is imported eagerly by components that only need chat functionality. The file is always loaded, including the continuation logic, artifact parsing, and RAG code.
- **Files:** `src/services/openrouter.ts`
- **Cause:** No code splitting on the router service.
- **Improvement path:** Use dynamic `import()` for continuation logic. Split artifact parsing into a separate module.

### 5. No circuit breaker for real production use

- **Problem:** The `circuitBreaker.ts` exists in `_shared/` with in-memory state (per-Deno-isolate). When OpenRouter is down, each edge function instance independently burns through 5 failures before opening, and half-open probes still cause degraded requests.
- **Files:** `supabase/functions/_shared/circuitBreaker.ts`
- **Cause:** Circuit breaker is per-isolate memory, not shared across instances.
- **Improvement path:** Use a shared KV store (Deno KV or Upstash Redis) for cross-instance circuit state. Add graceful degradation UI ("AI temporarily unavailable").

---

## Fragile Areas

### 1. Tool call round loop in chat-proxy

- **Files:** `supabase/functions/chat-proxy/index.ts` (stream handler, ~900 lines)
- **Why fragile:** The stream handler is a single deeply-nested async function managing: SSE parsing, tool execution (parallel + sequential), credit checks per round, artifact injection, format contract enforcement, emergency retry fallback, `[DONE]` sentinel handling, mid-stream keepalives, and usage recording. Any regressed condition check or missed edge case breaks the entire pipeline.
- **Safe modification:** Always add tests (even manual checklists) for: tool call without tools, empty tool results, all 3 tools called in parallel, tool timeout, tool with >12K char output.
- **Test coverage:** Zero.

### 2. Mid-stream persistence in chatStore

- **Files:** `src/store/chatStore.ts` (885 lines)
- **Why fragile:** The `scheduleMidstreamFlush`, `flushAllStreamingMessages`, `cancelMidstreamFlush` trio uses module-level `Map` state, timer IDs, and `sendBeacon` fallback. Race conditions between tab close, visibility change, HMR, and concurrent message saves are not fully provably safe.
- **Safe modification:** When changing persistence, verify: tab-close during flush, HMR cycle during flush, two messages streaming simultaneously, network failure during sendBeacon.
- **Test coverage:** Zero. Manual testing only.

### 3. Artifact parser regex logic

- **Files:** `src/lib/artifactParser.ts`, `src/lib/iframeErrorBridge.ts`
- **Why fragile:** The `<lucen_artifact>` tag extraction uses regex that can fail on nested tags, malformed XML, or streaming fragments. The `injectIntoHtml` regex in `iframeErrorBridge.ts` matches `</head>` as `<head>`. The `INCOMPLETE_TAG_RE` strips only opening tags. Chain of 3 interacting bugs caused the empty HTML artifact issue.
- **Safe modification:** Regressions must be verified against: nested artifacts, multi-line tags, attributes with special characters, streaming partial tags.
- **Test coverage:** Zero.

### 4. Initialization/startup sequence in authStore

- **Files:** `src/store/authStore.ts` (417 lines)
- **Why fragile:** Module-level mutable state (`initPromise`, `syncInFlight`, `syncTimer`, `authSubscription`) is managed across `initialize()`, `signIn()`, `signOut()`, `syncDataOnLogin()`, and `disposeAuthStore()`. Timer-based dedup (500ms setTimeout) is fragile. HMR cleanup depends on `disposeAuthStore` being called at the right time.
- **Safe modification:** All changes must verify: rapid login/logout cycles, cross-tab sign-out, session expiry recovery, HMR during initialization.
- **Test coverage:** Zero.

### 5. Edge function shared infrastructure prototypes

- **Files:** `supabase/functions/_shared/rateLimit.ts`, `supabase/functions/_shared/circuitBreaker.ts`, `supabase/functions/_shared/featureFlags.ts`
- **Why fragile:** These use in-memory `Map` state per Deno isolate, meaning rate limits and circuit breaker state are lost on function cold start and are not shared across instances. The feature flags are checked via synchronous `Deno.env.get()` — well-tested in production, but the kill switch pattern requires explicit isKillSwitched() calls at every entry point, which is easy to miss.
- **Safe modification:** Adding a new feature flag requires `isKillSwitched()` check at every edge function entry point. Adding rate limiting requires explicit `checkRateLimit()` call. Both are manual, easy to forget.
- **Test coverage:** Zero for rateLimit/circuitBreaker integration.

---

## Recently Addressed

The following concerns from the Phase 1-4 audit (completed 2026-06-02, documented in `AUDIT_PROGRESS.md`) have been fixed:

### Critical Bugs (All Fixed)
- **C1** — RAG embedding dead code in chatStore: Fixed at `src/store/chatStore.ts:407-486`
- **C2** — First streaming chunk never persisted: Fixed at `src/store/chatStore.ts:415-419`  
- **C3** — Cross-tab sign-out data leak: Fixed at `src/store/authStore.ts:67-93`
- **C4** — maxRounds = 4 vs spec says 3: Fixed at `supabase/functions/chat-proxy/index.ts:727`
- **C5** — ls-webhook TOCTOU race: Documented DB migration needed, existing guards strengthened

### High Severity Bugs (All Fixed)
- **H1** — Duplicate addMessage/addMessageRemote: deduplicated at `src/store/chatStore.ts`
- **H2** — syncDataOnLogin race conditions: Fixed at `src/store/authStore.ts:327-352`
- **H3** — signIn can leave isLoading:true: Fixed at `src/store/authStore.ts:104-132`
- **H4** — otpVerified sticky flag: Fixed at `src/store/authStore.ts:179-212`
- **H5** — visibilitychange/beforeunload listener leak: Fixed at `src/store/chatStore.ts:84`
- **H6** — authStateChange subscription not stored: Fixed at `src/store/authStore.ts:67-93`
- **H7** — Tokenizer Worker never terminated: Fixed at `src/store/tokenStore.ts:23-46`
- **H8** — No combined file size limit: Fixed at `src/services/fileProcessor.ts:18-24`
- **H9** — Embed endpoint fire-and-forget: Fixed at `src/services/fileProcessor.ts:422-486`
- **H11** — Credit deduction silently swallows errors: Fixed at `supabase/functions/chat-proxy/index.ts:1547-1551`
- **H13** — All images get same description: Fixed at `supabase/functions/describe-image/index.ts`

### Security Issues (All Fixed)
- **S1/S2** — JWT verification: All 8 edge functions now use `supabase.auth.getUser(token)`
- Fixed files: `classify-intent`, `embed`, `retrieve-chunks`, `get-file-content`, `web-search`, `describe-image`, `deduct-credits`, `get-model-config`

### Phase 5 — Still Outstanding (Production Hardening)
- Sentry error monitoring (`@sentry/react` is in `package.json` dependencies but not confirmed integrated)
- Rate limiting on all edge functions (only chat-proxy has it)
- Circuit breaker for OpenRouter (prototype exists in `_shared/circuitBreaker.ts`)
- Content Security Policy headers
- End-to-end tests
- Feature flags / kill switches (prototype exists in `_shared/featureFlags.ts`)

### Artifact Audit Fixes (Audited 2026-06-05)
The artifact audit documented in memory (`artifact-audit-findings.md`) identified 28 issues across 5 phases. Based on recent git log mentioning "Fix 28 issues: artifact parser, security, streaming, Python reliability, prompts" and "Improve artifact quality: anti-AI design system, Python self-knowledge, pre-flight validation", these appear to be partially addressed. Verification of individual fix status is pending.

---

*Concerns audit: 2026-06-08. Sources: AUDIT_PROGRESS.md, artifact-audit-findings, source code analysis, git log.*