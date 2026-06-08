# Requirements: Lucen v2.3 Stabilization Milestone

**Defined:** 2026-06-08
**Core Value:** Ship a secure, performant, and well-tested version of Lucen that the user can deploy with confidence — every known concern resolved, every regression guarded.

## v1 Requirements

Requirements for this stabilization milestone. Each maps to roadmap phases.

### Test Infrastructure

- [x] **TEST-01**: Vitest is installed and configured (jsdom 29, Vite-shared config) with a "run" npm script
- [x] **TEST-02**: Playwright is installed and configured for E2E with a "e2e" npm script and at least one smoke test
- [x] **TEST-03**: Coverage thresholds configured (initial: Lines 50%, Branches 40%, Functions 45%, Statements 50%)
- [x] **TEST-04**: Unit tests exist for `src/lib/artifactParser.ts`, `src/lib/logger.ts`, `src/lib/iframeErrorBridge.ts`, and the theme fingerprint helper
- [x] **TEST-05**: Regression test exists for the Mermaid `securityLevel: 'strict'` config (guards BUG-08 against regression)

### Tech Debt — Structural

- [ ] **TD-01**: `src/services/openrouter.ts` (1,770 lines) is decomposed into `messages/`, `rag/`, `streaming/`, `continuation/` modules with a facade re-export so no other file needs to change
- [ ] **TD-02**: `supabase/functions/chat-proxy/index.ts` (1,668 lines) is decomposed into `auth.ts`, `streamHandler.ts`, `billing.ts`, with a thin orchestrator index
- [ ] **TD-03**: The three key names for the web-search flag (`web_search_enabled`, `webSearchEnabled`, `enableWebSearch`) are unified to `web_search_enabled` everywhere; legacy keys emit a deprecation warning
- [ ] **TD-04**: Color palettes are extracted from `src/store/themeStore.ts` to `src/config/themes.ts`; theme store becomes pure state + actions
- [ ] **TD-05**: `setViewerFile` in `uiStore.ts` is typed with a proper `ViewerFile` interface (no more `any`)
- [x] **TD-06**: A shared types package (Zod 4.x schemas + inferred types) lives in `src/shared/` and is consumable from edge functions via path alias; type drift between FE and BE is now a compile error
- [ ] **TD-07**: All 50+ raw `console.log/warn/error` calls in `src/services/`, `src/store/`, `src/components/` are migrated to `src/lib/logger.ts` with correlation IDs (`crypto.randomUUID()`)
- [ ] **TD-08**: Cross-store `getState()` coupling in `authStore`, `chatStore`, `themeStore` is replaced with Zustand `subscribeWithSelector` via a single `orchestration.ts` module; stores import nothing from other stores
- [ ] **TD-09**: All 4 persisted Zustand stores (`chatStore`, `uiStore`, `creditsStore`, `sideChatStore`) have a `version` field and a `migrate` function; PII in persisted slices is audited and removed

### Known Bugs

- [ ] **BUG-01**: In `src/services/openrouter.ts:processStream`, `onDone` is always called after `onError` (so the UI exits loading state)
- [ ] **BUG-02**: `src/lib/artifactParser.ts` strips orphaned closing tags, not just opening tags, after an incomplete `<lucen_artifact>` boundary
- [ ] **BUG-03**: `src/components/ArtifactRenderer.tsx` validates that HTML artifact content is non-empty and has a `<body>` before injecting into `srcdoc`; otherwise shows a "this artifact is empty" placeholder
- [ ] **BUG-04**: `src/lib/iframeErrorBridge.ts:injectIntoHtml` regex is fixed to match only `<head>` (not `</head>`); injection script lands inside `<head>` reliably
- [x] **BUG-05**: `supabase/functions/chat-proxy/index.ts` always assigns `finishReason` in every streaming path; Sentry breadcrumb fires when billing is computed against a null `finishReason`
- [ ] **BUG-06**: `chat-proxy` always emits `[DONE]` after an internal error so the frontend continuation loop terminates
- [ ] **BUG-07**: All SVG rendering paths in `src/components/ArtifactRenderer.tsx` (both `<svg>` in main DOM and SVG in iframes) call sanitization — verified by a test that enumerates every code path
- [ ] **BUG-08** *(regression-only — already fixed)*: Mermaid config in `ArtifactRenderer.tsx` and `ArtifactWorkspace.tsx` uses `securityLevel: 'strict'`. A regression test asserts this on every CI run
- [ ] **BUG-10**: `src/store/artifactStore.ts` and the artifact worker properly reset state when `focusedArtifactId` changes — old results never bleed into the new artifact

### Security

- [ ] **SEC-01**: `src/components/ArtifactRenderer.tsx:sanitizeSvg` is replaced with `DOMPurify.sanitize(content, { USE_PROFILES: { svg: true } })`; DOMPurify is the single sanitization entry point for SVG
- [ ] **SEC-02**: `vercel.json` adds `Content-Security-Policy` headers via `Report-Only` first; after one week of clean runs, switches to enforce. Policy uses `strict-dynamic` with nonces
- [ ] **SEC-03**: Sentry alert fires in `chat-proxy` when `decodeJwtPayload` succeeds but `admin.getUserById` fails (forged-JWT signal)
- [ ] **SEC-04**: All 11 edge functions call `checkRateLimit` at entry; per-function limits configured; consistent 429 response shape with `Retry-After` header
- [ ] **SEC-05**: `src/services/fileProcessor.ts` rejects 0-byte files with a friendly error; deduplicates by content hash; surfaces a clear error for encrypted/protected PDFs and DOCX
- [x] **SEC-06**: Chat stream pipeline refreshes the JWT mid-stream and rejects with 401 if it expires during a long generation; no silent failure on the deduction call

### Performance

- [ ] **PERF-01**: `buildThemeApplyFingerprint` in `themeStore.ts` is memoized — no `JSON.stringify` per state change; output only when input changes (deep compare)
- [ ] **PERF-02**: `React.memo` is applied to `ChatArea`, `MessageBubble`, `FileLibrary` (and other large presentational components) with stable props verified
- [ ] **PERF-03**: Debug store ring buffer has a TTL eviction (entries older than 30 min are purged) and a max-bytes threshold
- [ ] **PERF-04**: The continuation engine in `src/services/openrouter.ts` is loaded via dynamic `import()` so the initial bundle excludes it
- [ ] **PERF-05**: Circuit-breaker state moves to Upstash Redis (HTTP REST client) with TTL auto-expiry; in-memory `Map` stays only as a dev fallback

### Phase 5 Production Hardening

- [ ] **PROD-01**: Sentry is fully wired in `src/main.tsx` with `release`, `environment`, and breadcrumbs for auth, credit deduction, and stream errors
- [ ] **PROD-02**: Production rate limiter is Redis-backed (Upstash) with shared state across all edge function instances; in-memory dev fallback
- [ ] **PROD-03**: Circuit breaker for OpenRouter uses shared Redis state with graceful-degradation UI ("AI temporarily unavailable, retrying")
- [ ] **PROD-04**: Feature flags / kill switches: every edge function entry point checks `isKillSwitched()`; new flags follow the same pattern (Deno.env for now, KV later)
- [ ] **PROD-05**: Playwright E2E tests cover: sign-in, send message, attach file, run artifact, buy credits, view subscription
- [ ] **PROD-06**: Iframe sandbox in `ArtifactRenderer.tsx` is tightened to `allow-scripts` only (remove `allow-popups`, `allow-forms`, `allow-modals`); HTML artifacts with those features surface a clear UX notice

### Verification Support (per user direction)

- [x] **VERIFY-01**: For every change that touches runtime behavior, the executor writes either (a) a unit/E2E test, OR (b) exact manual steps to repeat and what to expect — based on which is easier/more important
- [x] **VERIFY-02**: At every phase boundary, the user is given a summary of: files changed, what to test, expected behavior, and how to roll back

## v2 Requirements

Deferred to a future milestone. Tracked but not in the current roadmap.

### Python / Pyodide Execution

- **PY-01**: When Python artifacts are reintroduced, the Pyodide Web Worker uses `Worker.terminate()` driven by an `AbortController` timeout (the only reliable interrupt for WASM-without-yield-points)
- **PY-02**: Python execution surfaces a clear "timed out" error to the user

### Other deferred

- **RAG-01**: Embedding model versioning and migration tooling (if the embedding model ever changes)
- **RATE-01**: Per-tier rate limits (Free / Pro / Admin) — current implementation is uniform
- **CSP-01**: CSP report endpoint and violation monitoring in production
- **E2E-01**: Browser-mode Vitest for component rendering tests (in addition to E2E)
- **BILL-01**: Weekly reconciliation cron between Stripe/Lemon Squeezy ledger and `credit_ledgers` to detect drift

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Net-new product features | This is a stabilization pass, not a feature release |
| Migration off Lemon Squeezy, OpenRouter, Supabase, Vercel | Vendors are stable; vendor swaps are out of scope |
| Full rewrite of the 13 Zustand stores | Only break the cross-store `getState()` chains that are documented (TD-08); do not redesign the whole state layer |
| SSR / Next.js migration | Vite SPA stays |
| Mobile app | Explicitly out per `PROJECT_SPEC.md` |
| New AI model integrations | The model config system already supports additions; adding a new provider is a separate milestone |
| New payment provider | Lemon Squeezy is stable; Stripe migration is a separate milestone |
| Test framework shopping | If we add Vitest, it stays Vitest. If we add Playwright, it stays Playwright |

## Removed from CONCERNS.md (verified during research)

| Item | Original CONCERNS.md ID | Why Removed |
|------|-------------------------|-------------|
| Mermaid `securityLevel: 'loose'` | BUG-08 | Already fixed in `ArtifactRenderer.tsx` and `ArtifactWorkspace.tsx` per code analysis. Regression test only (TEST-05). |
| Python/Pyodide execution timeout | BUG-09 | No Python execution infrastructure exists in the current codebase. Becomes relevant only if/when Python artifacts are reintroduced (see v2 PY-01). |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TEST-01 | Phase 1 | Complete |
| TEST-02 | Phase 1 | Complete |
| TEST-03 | Phase 1 | Complete |
| TEST-04 | Phase 1 | Complete |
| TEST-05 | Phase 1 | Complete |
| TD-06 | Phase 1 | Complete |
| BUG-05 | Phase 1 | Complete |
| SEC-06 | Phase 1 | Complete |
| VERIFY-01 | Phase 1 (ongoing) | Complete |
| VERIFY-02 | Phase 1 (ongoing) | Complete |
| TD-01 | Phase 2 | Pending |
| TD-02 | Phase 2 | Pending |
| TD-07 | Phase 2 | Pending |
| TD-08 | Phase 2 | Pending |
| TD-09 | Phase 2 | Pending |
| BUG-01 | Phase 2 | Pending |
| BUG-02 | Phase 2 | Pending |
| BUG-04 | Phase 2 | Pending |
| BUG-10 | Phase 2 | Pending |
| PERF-01 | Phase 2 | Pending |
| PERF-02 | Phase 2 | Pending |
| PERF-03 | Phase 2 | Pending |
| PERF-04 | Phase 2 | Pending |
| TD-03 | Phase 3 | Pending |
| TD-04 | Phase 3 | Pending |
| TD-05 | Phase 3 | Pending |
| SEC-04 | Phase 3 | Pending |
| PROD-02 | Phase 3 | Pending |
| PROD-03 | Phase 3 | Pending |
| PROD-04 | Phase 3 | Pending |
| PERF-05 | Phase 3 | Pending |
| SEC-01 | Phase 4 | Pending |
| SEC-03 | Phase 4 | Pending |
| SEC-05 | Phase 4 | Pending |
| BUG-03 | Phase 4 | Pending |
| BUG-07 | Phase 4 | Pending |
| PROD-01 | Phase 5 | Pending |
| PROD-05 | Phase 5 | Pending |
| PROD-06 | Phase 5 | Pending |
| SEC-02 | Phase 5 | Pending |
| BUG-06 | Phase 5 | Pending |

**Coverage:**

- v1 requirements: 41 total
- Mapped to phases: 41
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-08*
*Last updated: 2026-06-08 after roadmap creation*
