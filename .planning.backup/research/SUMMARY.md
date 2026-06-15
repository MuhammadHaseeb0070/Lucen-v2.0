# Research Summary

**Project:** Lucen v2.3 Stabilization Milestone
**Domain:** AI Chat SPA (React 19 + Vite + Supabase + Deno Edge Functions)
**Researched:** 2026-06-08
**Confidence:** HIGH

## Executive Summary

Lucen is a mature AI chat SPA with 13 Zustand stores, 11 edge functions, 36 SQL migrations, and two monoliths exceeding 1,600 lines each. The stabilization milestone must fix every documented concern in CONCERNS.md, add test infrastructure from scratch, harden billing and security to production standards, and decompose two critical monoliths -- all without breaking the user's daily dev-to-prod push workflow (no local dev server; verification is via tsc -b, vite build, and manual deployment to Vercel + Supabase dev).

The recommended approach is a 5-phase plan that respects the dependency chain. Phase 1 must prioritize the finance-critical fixes: the finishReason drift bug (BUG-05, causing silent revenue loss), the negative credit race condition (Pitfall 13), and the JWT expiry mid-stream gap (SEC-06). These are the only bugs in the milestone that cause ongoing revenue loss. Phase 1 also installs the test infrastructure (Vitest + Playwright) and shared types that every subsequent phase depends on. The two monoliths must be decomposed in Phase 2 before the structural logging, rate limiting, and circuit breaker changes land, because all of these touch the same code paths.

Key risks are: (1) the webhook idempotency race (Pitfall 2) which can double-grant credits under concurrent delivery, (2) CSP deployment that breaks the app because script-src 'self' blocks the SPA's own inline scripts, and (3) the in-memory circuit breaker and rate limiter state that is lost on every cold start, providing no protection at scale. Each of these is well-understood and has a documented mitigation.

## Key Findings

### Outdated CONCERNS.md Items (Already Fixed)

Two items in CONCERNS.md are stale and should be removed or updated before roadmap creation:

1. **Mermaid securityLevel 'loose' (BUG-08):** Both ArtifactRenderer.tsx and ArtifactWorkspace.tsx already set securityLevel 'strict'. The FEATURES research confirmed this was fixed in the recent "Fix 28 issues" commits. This item only needs regression test coverage, not a fix.

2. **Pyodide Python execution timeout (BUG-09):** No Pyodide or Python execution infrastructure exists in the current codebase. The ArtifactType enum ('html', 'svg', 'mermaid', 'file') does not include 'python'. This is a speculative concern for a feature that has not been implemented. Defer entirely -- it becomes relevant only if Python artifacts are re-added.

### Recommended Stack

The stack is already established (React 19, Vite, Supabase, Deno Edge Functions). This research prescribes locked versions and new supporting libraries for stabilization targets.

**Existing technologies -- locked versions:**
- React 19.2.7 / React DOM 19.2.3: Latest React 19 stable. Do NOT upgrade to React 20 during stabilization.
- TypeScript ~5.9.3: Pin to 5.9.x series. TS 6.0.3 breaks path resolution patterns.
- Vite 8.0.16: Current npm latest. Existing code uses Vite 7.3; if migration breaks, pin to 7.3.x.
- Zustand 5.0.14: Latest 5.x stable, needed for subscribeWithSelector migration.
- Mermaid ^11.15.0: Update from ^11.13.0 for securityLevel sandbox config.
- Supabase JS Client ^2.107.0: Existing ^2.98.0 range allows this.

**New supporting libraries:**
- Vitest 4.1.x + Playwright 1.60.x: Test infrastructure. Vitest over Jest because it shares Vite config pipeline. jsdom over happy-dom.
- DOMPurify ^3.4.8: SVG/HTML sanitization via browser-native DOMParser. Replaces regex-based sanitizeSvg(). Cure53-maintained.
- Zod ^4.4.3: Runtime type validation + type inference for shared API contracts. Verify Deno compat; fallback to Zod 3.23.x.
- Deno KV (built-in): Primary shared state for rate limiting and circuit breakers (Supabase Pro+). Upstash Redis as fallback.
- uuid ^14.0.0: Already in deps, used for correlation ID generation.

**What NOT to add:** Jest, happy-dom, sanitize-html, pino/winston (browser), Bull/BullMQ, Redis TCP client, Turborepo/Nx/pnpm workspaces.

### Expected Features

**Must have (table stakes -- Phase 1 priority):**
- Test infrastructure with Vitest + Playwright (zero test files currently)
- Core test targets: stores, services, lib (artifactParser, logger, sanitizeSvg)
- E2E flow tests: sign-in, send message, attach file, run artifact, buy credits
- Coverage thresholds: Lines 50%, Branches 40%, Functions 45%, Statements 50% (initial)

**Must have -- finance-critical (Phase 1):**
- Fix finishReason drift in all streaming paths (BUG-05)
- Fix negative credit race condition (deduct_credits RPC + CHECK constraint)
- Address JWT expiry mid-stream (SEC-06)

**Must have -- Phase 3 billing-critical:**
- Per-function rate limits on all 11 edge functions (only chat-proxy has it)
- Consistent 429 error shape with Retry-After header
- Kill switch checks at EVERY edge function entry point
- Shared KV state for circuit breaker (in-memory Map is lost on cold start)

**Should have (structural):**
- Shared types package between frontend and edge functions
- Structured logging with correlation IDs (replace 50+ raw console.* calls)
- Zustand subscribeWithSelector for cross-store events (break getState() spaghetti)
- SVG sanitization via DOMPurify (replace regex bypassable sanitizer)
- CSP headers via vercel.json (currently meta-tag only)
- Stricter iframe sandbox: remove allow-popups, allow-forms, allow-modals

**Defer (v2+ or already fixed):**
- Pyodide Python execution timeout (feature not implemented)
- Mermaid securityLevel fix (already fixed, just needs regression tests)
- Rate limit tiering per user role (Free/Pro/Admin)
- Browser-mode Vitest for component rendering tests
- CSP report endpoint and monitoring

### Architecture Approach

Major components after decomposition:

1. **Frontend src/services/ (modulith decomposition):**
   - messages/ -- buildApiMessages, pruneHistory, contextBuilder (pure functions)
   - streaming/ -- SSE parser, stream client, event routing (highest risk)
   - continuation/ -- auto-continuation loop, repetition/stall detection
   - rag/ -- chunk retrieval, context injection
   - Facade index.ts preserving public API; thin openrouter.ts re-exports

2. **Edge function chat-proxy/ decomposition:**
   - index.ts -- orchestrator only (~300-400 lines)
   - auth.ts -- JWT decode + Supabase verify + expiry check
   - streamHandler.ts -- OpenRouter fetch + SSE pump + tool call loop
   - billing.ts -- Credit deduction, usage accounting, finalization guard

3. **Shared types:** npm workspace package or path alias + manual sync script

4. **Cross-store communication:** subscribeWithSelector middleware in orchestration module

5. **Edge function shared state:** Upstash Redis (sorted set for rate limiting, TTL-expiry for circuit breaker). Lazy Redis client init. Feature flags remain in Deno.env.get().

### Critical Pitfalls

Top 5 by severity:

1. **Streaming finishReason drift causes silent revenue loss (Catastrophic).** Prevention: Normalize finishReason extraction to single function. Add Sentry breadcrumb on null at billing time. **Phase 1.**

2. **Webhook idempotency race (Catastrophic).** Lemon Squeezy at-least-once delivery can double-grant credits. Prevention: Advisory lock + ON CONFLICT DO NOTHING. Weekly reconciliation cron. **Phase 3.**

3. **Negative credit balances from concurrent deductions (Catastrophic).** Prevention: SELECT ... FOR UPDATE, CHECK constraint. **Phase 1/3.**

4. **CSP deployment breaking the app (Material).** script-src self blocks all inline scripts. Prevention: Report-Only first, strict-dynamic with nonces. **Phase 5.**

5. **In-memory circuit breaker lost on cold start (Material).** Each Deno isolate burns through failure budget independently. Prevention: Upstash Redis with TTL auto-expiry. **Phase 3.**

## Implications for Roadmap

### Phase 1: Foundation + Finance-Critical Fixes
**Rationale:** Test infrastructure must come before refactoring. finishReason drift and negative credit bugs cause ongoing revenue loss.
**Delivers:** Test infrastructure, shared types, highest-value bug fixes.
**Addresses:** Test infrastructure (Vitest + Playwright), shared types package, core test targets.
**Avoids:** Pitfall 1 (finishReason drift), Pitfall 13 (negative credit race), Pitfall 5 (JWT expiry).
**Tasks:** npm install test deps, write vitest/playwright configs, write initial unit tests, create shared types, fix BUG-05, add FOR UPDATE to deduct_credits, add CHECK constraint, implement JWT TTL check.
**Research flag:** Standard patterns. No research-phase needed.

### Phase 2: Structural Decomposition
**Rationale:** Monoliths must be decomposed before cross-cutting changes land. Tests guard every extraction.
**Delivers:** Decomposed frontend services (messages, streaming, continuation, rag) and edge function modules.
**Addresses:** Monolith splits (TD-01, TD-02), structured logging, Zustand subscribeWithSelector.
**Avoids:** Pitfall 4 (Zustand persist leaking PII), Pitfall 9 (worker termination on route change).
**Tasks:** Extract messages/, rag/, streaming/, continuation/ in dependency order. Split chat-proxy. Migrate getState() to subscribeWithSelector. Replace console.* with logger.*. Audit persisted stores. Fix BUG-01/02/04/06/10.
**Research flag:** Steps 3-5 (streaming/continuation extraction) need manual test checklists.

### Phase 3: Billing Hardening + Production Shared State
**Rationale:** Billing system is the most financially critical surface. Shared state must be production-grade.
**Delivers:** Atomic webhook processing, shared KV state, consistent rate limiting.
**Addresses:** Rate limiting (all functions), kill switches (all functions), circuit breaker (shared KV).
**Avoids:** Pitfall 2 (webhook idempotency race), Pitfall 6 (in-memory circuit breaker).
**Tasks:** Fix webhook idempotency with advisory lock. Migrate rate limiter and circuit breaker to Upstash Redis. Apply checkRateLimit and isKillSwitched to all 11 functions. Add CHECK constraint. Review migrations.
**Research flag:** Upstash Redis requires user signup + REST URL configuration.

### Phase 4: Security Hardening
**Rationale:** SVG sanitization, iframe sandbox, and postMessage bridge fix are independent of billing work.
**Delivers:** DOMPurify-based SVG sanitization, tighter iframe sandbox, validated postMessage bridge.
**Addresses:** SVG sanitization (SEC-01), iframe sandbox tightening.
**Avoids:** Pitfall 8 (postMessage abuse), Pitfall 19 (mixed content).
**Tasks:** Replace regex sanitizeSvg() with DOMPurify. Audit all SVG rendering paths. Tighten iframe sandbox. Add origin validation to iframeErrorBridge. Write bypass tests.
**Research flag:** Standard patterns. No research-phase needed.

### Phase 5: CSP + Vite Configuration + Verification
**Rationale:** CSP must come last because it requires knowing the final bundle script loading patterns.
**Delivers:** Production CSP headers, hidden source maps, E2E regression suite.
**Addresses:** CSP headers (SEC-02), Vite source map hardening, E2E flow tests (PROD-05).
**Avoids:** Pitfall 3 (CSP deployment breaking app), Pitfall 10 (source map exposure).
**Tasks:** Deploy CSP as Report-Only. Collect violations for 1 week. Set strict-dynamic with nonces. Set build.sourcemap hidden. Write Playwright E2E tests. Write regression tests for BUG-01 through BUG-10. Add meta CSP inside artifact iframes. Handle mixed content.
**Research flag:** CSP policy exact values need validation against production vite build output.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All version numbers verified against npm registry. CSP config values need production validation. |
| Features | HIGH | Sourced from codebase analysis plus official docs. |
| Architecture | HIGH | Verified against existing codebase: openrouter.ts (1,770 lines), chat-proxy/index.ts (1,668 lines), stores use getState(). |
| Pitfalls | HIGH | Verified against CONCERNS.md, codebase analysis, 36 SQL migrations. |

**Overall confidence:** HIGH

### Gaps to Address

1. **Deno KV availability on Supabase:** Resolve with user before Phase 3.
2. **Zod 4 on Deno compatibility:** Verify during Phase 1 installation.
3. **Vite 7 to 8 migration:** Test with vite build in Phase 1; pin to 7.3.x if it breaks.
4. **CSP exact values:** Validate against production build in Phase 5.
5. **JWT refresh mechanism:** Needs user input in Phase 1 planning.
6. **Pyodide status:** User should confirm if Python artifacts are expected in v2.3.

## Sources

### Primary (HIGH confidence)
- npm registry (2026-06-08) -- All version numbers verified
- Codebase analysis -- openrouter.ts (1,770 lines), chat-proxy/index.ts (1,668 lines), ArtifactRenderer.tsx, all stores, all 11 edge functions, all 36 SQL migrations
- CONCERNS.md -- All TD, BUG, SEC, PERF, FAG, PROD items
- PROJECT.md -- Stabilization milestone requirements
- Vitest docs (v4.1.7), Playwright docs (v1.60.x), DOMPurify (Cure53), Supabase docs

### Secondary (MEDIUM confidence)
- Zod documentation -- Deno compatibility notes
- Vercel docs -- vercel.json header configuration, CSP best practices
- Upstash Redis for Deno -- npm:@upstash/redis REST API patterns

### Tertiary (LOW confidence)
- Deno KV availability on Supabase -- conflicting information between sources
- Vite 7 to 8 migration -- Plugin API changes not verified

---
*Research completed: 2026-06-08*
*Ready for roadmap: yes*
