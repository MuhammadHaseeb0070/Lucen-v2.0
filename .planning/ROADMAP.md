# Roadmap: Lucen v2.3 Stabilization Milestone

## Overview

Ship a secure, performant, and well-tested version of Lucen by fixing every documented concern in CONCERNS.md — adding test infrastructure from scratch (Vitest + Playwright), decomposing two critical monoliths (openrouter.ts at 1,770 lines, chat-proxy/index.ts at 1,668 lines), hardening billing and security to production standards, and capping with CSP enforcement and end-to-end regression tests. Every phase guards against regression so the user's daily dev-to-prod push workflow stays unbroken.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation + Finance-Critical Fixes** — Test infrastructure (Vitest + Playwright), shared types package, fix finishReason billing drift (BUG-05) and JWT expiry mid-stream (SEC-06), initial unit tests (completed 2026-06-08)
- [ ] **Phase 2: Structural Decomposition** — Split both monoliths into focused modules, migrate to structured logging, replace cross-store getState() with subscribeWithSelector, fix bugs inside decomposed modules, apply performance memoization/lazy-loading
- [ ] **Phase 3: Billing Hardening + Production Shared State** — Rate limit all 11 edge functions, Redis-backed circuit breaker and rate limiter, kill switches on every entry point, unify web-search flag, extract themes, type ViewerFile
- [ ] **Phase 4: Security Hardening** — Replace regex SVG sanitization with DOMPurify, add Sentry alert on forged-JWT signal, file-upload content security, validate empty HTML artifacts, audit all SVG rendering paths
- [ ] **Phase 5: CSP Enforce + E2E + Final Verification** — Switch CSP from Report-Only to enforce with strict-dynamic, wire Sentry fully (release + env + breadcrumbs), Playwright E2E tests for 6 core flows, tighten iframe sandbox, fix trailing [DONE] sentinel bug, final verification summaries

## Phase Details

### Phase 1: Foundation + Finance-Critical Fixes

**Goal**: Tests exist, shared types compile, finance-critical bugs are fixed
**Mode**: mvp
**Depends on**: Nothing (first phase)
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TD-06, BUG-05, SEC-06, VERIFY-01, VERIFY-02
**Success Criteria** (what must be TRUE):

  1. `npm run test` invokes Vitest and reports coverage thresholds (lines 50%, branches 40%, functions 45%, statements 50%)
  2. `npm run e2e` invokes Playwright and runs at least one passing smoke test
  3. BUG-05 is fixed: `finishReason` is always assigned in every streaming path; a Sentry breadcrumb fires when billing runs against null
  4. SEC-06 is fixed: the stream pipeline refreshes the JWT mid-stream and rejects with 401 on expiry; no silent failure on the deduction call
  5. TD-06 is delivered: a shared types package (`src/shared/`) with Zod schemas compiles from both frontend and edge functions; type drift is a compile error

**Plans**: TBD

### Phase 2: Structural Decomposition

**Goal**: Both monoliths are decomposed, logging is structured, cross-store coupling is broken, bugs within the new modules are fixed, performance optimizations are applied
**Mode**: mvp
**Depends on**: Phase 1
**Requirements**: TD-01, TD-02, TD-07, TD-08, TD-09, BUG-01, BUG-02, BUG-04, BUG-10, PERF-01, PERF-02, PERF-03, PERF-04
**Success Criteria** (what must be TRUE):

  1. TD-01 is delivered: `src/services/openrouter.ts` is decomposed into `messages/`, `rag/`, `streaming/`, `continuation/` with a facade re-export; all existing imports continue to work unchanged
  2. TD-02 is delivered: `supabase/functions/chat-proxy/index.ts` is decomposed into `auth.ts`, `streamHandler.ts`, `billing.ts` with a thin orchestrator index; all existing endpoints respond identically
  3. TD-08 is delivered: cross-store `getState()` calls in `authStore`, `chatStore`, `themeStore` are replaced by Zustand `subscribeWithSelector` via `orchestration.ts`; stores no longer import from other stores
  4. TD-07 is delivered: all 50+ raw `console.log/warn/error` calls across `src/services/`, `src/store/`, `src/components/` are migrated to `src/lib/logger.ts` with correlation IDs
  5. BUG-01, BUG-02, BUG-04, BUG-10 are fixed: user sees UI exit loading state after stream errors, orphaned artifact closing tags are stripped, iframe injection script lands inside `<head>`, artifact state resets cleanly on focus change

**Plans**: TBD

### Phase 3: Billing Hardening + Production Shared State

**Goal**: All 11 edge functions are rate-limited and kill-switched, circuit breaker state is shared across isolates, theme/viewer types are clean, web-search flag is unified
**Mode**: mvp
**Depends on**: Phase 2
**Requirements**: TD-03, TD-04, TD-05, SEC-04, PROD-02, PROD-03, PROD-04, PERF-05
**Success Criteria** (what must be TRUE):

  1. SEC-04 + PROD-02 are delivered: all 11 edge functions call `checkRateLimit` at entry with per-function limits; 429 responses include a `Retry-After` header; rate limiter uses Redis-backed shared state (Upstash) in production
  2. PROD-03 + PERF-05 are delivered: the OpenRouter circuit breaker uses shared Redis state with TTL auto-expiry; UI shows "AI temporarily unavailable, retrying" when the circuit is open
  3. PROD-04 is delivered: every edge function entry point checks `isKillSwitched()` before processing; new flags follow the pattern
  4. TD-03 is delivered: `web_search_enabled` is the single key everywhere; legacy keys (`webSearchEnabled`, `enableWebSearch`) emit a deprecation warning
  5. TD-04 + TD-05 are delivered: color palettes live in `src/config/themes.ts`; `setViewerFile` accepts a properly typed `ViewerFile` interface

**Plans**: TBD

### Phase 4: Security Hardening

**Goal**: SVG sanitization is bulletproof (DOMPurify), CSP is deployed as Report-Only, Sentry alerts on forged-JWT signals, file uploads are secure, empty artifacts show a placeholder, all SVG rendering paths are verified
**Mode**: mvp
**Depends on**: Phase 3
**Requirements**: SEC-01, SEC-03, SEC-05, BUG-03, BUG-07
**Success Criteria** (what must be TRUE):

  1. SEC-01 is delivered: `sanitizeSvg` is replaced with `DOMPurify.sanitize(content, { USE_PROFILES: { svg: true } })`; DOMPurify is the single sanitization entry point for SVG; bypass tests confirm it catches patterns that bypassed the regex
  2. SEC-03 is delivered: a Sentry alert fires in `chat-proxy` when `decodeJwtPayload` succeeds but `admin.getUserById` fails (forged-JWT signal)
  3. SEC-05 is delivered: `fileProcessor.ts` rejects 0-byte files with a friendly error, deduplicates by content hash, and surfaces a clear error for encrypted/protected PDFs and DOCX
  4. BUG-03 is fixed: `ArtifactRenderer.tsx` validates HTML artifacts have non-empty content with a `<body>` before injecting into `srcdoc`; empty/malformed artifacts show a "this artifact is empty" placeholder
  5. BUG-07 is fixed: all SVG rendering paths in `ArtifactRenderer.tsx` (both `<svg>` in main DOM and SVG in iframes) call `DOMPurify.sanitize`; a test enumerates every code path

**Plans**: TBD

### Phase 5: CSP Enforce + E2E + Final Verification

**Goal**: CSP is enforced in production with strict-dynamic and nonces, Sentry is fully wired, Playwright E2E tests pass on 6 core flows, iframe sandbox is tightened, trailing [DONE] sentinel bug is fixed, the user receives final verification summaries
**Mode**: mvp
**Depends on**: Phase 4
**Requirements**: PROD-01, PROD-05, PROD-06, SEC-02, BUG-06
**Success Criteria** (what must be TRUE):

  1. SEC-02 is delivered: `vercel.json` serves `Content-Security-Policy` headers with `strict-dynamic` and nonces; switched to enforce after Report-Only collected violations for 1 week without breaking the app
  2. PROD-01 is delivered: Sentry is initialized in `main.tsx` with `release` and `environment`; breadcrumbs fire for auth, credit deduction, and stream errors
  3. PROD-05 is delivered: Playwright E2E tests cover sign-in, send message, attach file, run artifact, buy credits, and view subscription; all tests pass
  4. PROD-06 is delivered: iframe sandbox in `ArtifactRenderer.tsx` is tightened to `allow-scripts` only; artifacts that need `allow-popups`/`allow-forms`/`allow-modals` show a UX notice
  5. BUG-06 is fixed: `chat-proxy` always emits `[DONE]` after an internal error; the frontend continuation loop terminates cleanly; the user never sees infinite loading

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation + Finance-Critical Fixes | 3/3 | Complete    | 2026-06-08 |
| 2. Structural Decomposition | 0/0 | Not started | - |
| 3. Billing Hardening + Production Shared State | 0/0 | Not started | - |
| 4. Security Hardening | 0/0 | Not started | - |
| 5. CSP Enforce + E2E + Final Verification | 0/0 | Not started | - |
