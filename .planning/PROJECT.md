# Lucen v2.3 — Stabilization Milestone

## What This Is

A stabilization pass on Lucen v2.3 — an AI chat SPA (React 19 + Vite + Supabase). The product is already live, the user works on the `dev` branch daily, and pushes to production via Vercel + Supabase. This milestone exists to fix every concern documented in `.planning/codebase/CONCERNS.md` and finish the Phase 5 production hardening that the Phase 1–4 audit deferred, without breaking the dev/prod flow the user relies on.

## Core Value

Ship a secure, performant, and well-tested version of Lucen that the user can deploy with confidence — every known concern resolved, every regression guarded.

## Requirements

### Validated

- ✓ React 19 SPA with Vite + TypeScript strict mode builds (`tsc -b && vite build`)
- ✓ Supabase auth (email + OTP + password reset) — JWT-validated across all edge functions
- ✓ AI chat streaming via OpenRouter proxy (chat-proxy edge function)
- ✓ RAG: file → chunk → embed → pgvector retrieval (768-dim)
- ✓ Credit/subscription system: Lemon Squeezy checkout, atomic credit deduction, FIFO ledger
- ✓ Artifact system: `<lucen_artifact>` parsing, HTML/SVG/Mermaid render, versioning, voting, public Hub
- ✓ React workspace sandbox (Code editor, preview iframe, terminal, diagnostics, AI panel)
- ✓ 13 Zustand stores with persistence for chat, UI, credits, side-chat
- ✓ Marketing pages (home, about, contact, packages, terms, privacy, refund)
- ✓ Sentry dependency present (`@sentry/react`)
- ✓ Phase 1–4 audit fixes shipped (C1–C5, H1–H9, H11, H13, S1/S2) per `AUDIT_PROGRESS.md`

### Active

> Each item below is sourced from `.planning/codebase/CONCERNS.md` (analysis date 2026-06-08). Items are grouped by category; per-item REQ-IDs are assigned in `REQUIREMENTS.md` and traced to phases in `ROADMAP.md`.

**Tech Debt (TD-01..TD-09):**
- [ ] Split monolithic `src/services/openrouter.ts` (1,770 lines) into focused modules
- [ ] Split monolithic `supabase/functions/chat-proxy/index.ts` (1,668 lines) into focused modules
- [ ] Unify the three different key names for the web-search flag (`web_search_enabled` / `webSearchEnabled` / `enableWebSearch`)
- [ ] Extract hardcoded color palettes out of `src/store/themeStore.ts` into `src/config/themes.ts`
- [ ] Replace `setViewerFile: (file: any)` in `uiStore.ts` with a proper `ViewerFile` type
- [ ] Introduce shared types between frontend and edge functions (no more independent drift)
- [ ] Replace raw `console.*` calls with the structured `src/lib/logger.ts` (correlation IDs, JSON output)
- [ ] Break cross-store `getState()` coupling — use Zustand `subscribe` for cross-store events
- [ ] Set up test infrastructure (Vitest + Playwright) and add integration tests for auth, chat, credits, webhooks, artifacts

**Known Bugs (BUG-01..BUG-10):**
- [ ] `processStream`: `onDone` is not called after `onError` (leaves UI in loading state, can loop forever)
- [ ] `artifactParser`: `INCOMPLETE_TAG_RE` strips only opening tags; orphaned closing tags pass through
- [ ] `ArtifactRenderer`: empty/malformed HTML artifacts render as whitespace with no error
- [ ] `iframeErrorBridge`: `injectIntoHtml` regex matches `</head>` instead of `<head>`
- [ ] `chat-proxy`: `finishReason` is not assigned in some streaming paths (zero-cost billing)
- [ ] `chat-proxy`: missing `[DONE]` sentinel after internal server error (infinite continuation loop)
- [ ] SVG `innerHTML` rendering is not sanitized on all paths (regex can be bypassed)
- [ ] Mermaid renders with `securityLevel: 'loose'` (allows JS in diagram labels)
- [ ] Python artifact (Pyodide) has no execution timeout — infinite loop blocks the worker
- [ ] `focusedArtifactId` does not reset store/worker state on switch (stale results shown)

**Security (SEC-01..SEC-06):**
- [ ] Replace regex-based SVG sanitization with DOMParser-based sanitization; add bypass tests
- [ ] Add Content Security Policy headers on the main app
- [ ] Audit `chat-proxy` JWT path: alert (Sentry) if local `decodeJwtPayload` succeeds but `admin.getUserById` fails (forged JWT signal)
- [ ] Apply `checkRateLimit` to every edge function (currently only `chat-proxy` has it)
- [ ] Add file-upload content security: 0-byte validation, content-hash dedup, friendly errors for encrypted PDFs/DOCX
- [ ] Refresh JWT mid-stream; reject with 401 if the token expires during a long stream

**Performance (PERF-01..PERF-05):**
- [ ] Memoize `buildThemeApplyFingerprint` in `themeStore.ts` (60Hz `JSON.stringify` on slider drag)
- [ ] Apply `React.memo` to large presentational components (`ChatArea`, `MessageBubble`, `FileLibrary`)
- [ ] Add TTL or max-bytes eviction to the debug store ring buffer
- [ ] Lazy-load `src/services/openrouter.ts` via dynamic `import()` for the continuation engine
- [ ] Move circuit-breaker state to shared KV (Deno KV or Upstash Redis) so it survives across isolates and restarts

**Phase 5 Production Hardening (PROD-01..PROD-06):**
- [ ] Wire Sentry fully (verify init in `main.tsx`, set release + env, add breadcrumbs for auth/credit/stream errors)
- [ ] Rate limiting on all edge functions (Redis-backed for production; in-memory acceptable for dev)
- [ ] Production-grade circuit breaker for OpenRouter (shared KV state + graceful-degradation UI)
- [ ] CSP headers (default-src 'self'; frame-src 'self'; img-src 'self' data: https:; script-src 'self')
- [ ] End-to-end tests for the core user flows: sign-in, send message, attach file, run artifact, buy credits
- [ ] Feature flags / kill switches: each edge function checks `isKillSwitched()` at entry

**Fragile Areas — must be handled during the above (FAG-01..FAG-05):**
- [ ] chat-proxy tool-call round loop (verify with checklist: no-tools, empty results, all 3 parallel, tool timeout, >12K output)
- [ ] `chatStore` midstream persistence (verify: tab-close during flush, HMR during flush, two streams, sendBeacon failure)
- [ ] Artifact parser regex logic (regress against: nested artifacts, multi-line tags, special chars, streaming partials)
- [ ] `authStore` init sequence (rapid login/logout, cross-tab sign-out, session expiry, HMR during init)
- [ ] Edge function shared infra (every new flag must be guarded; every new endpoint must rate-limit)

### Out of Scope

- Net-new product features not in CONCERNS.md — this is a stabilization pass, not a feature release.
- Migration off Lemon Squeezy, OpenRouter, Supabase, Vercel — vendors are stable for this milestone.
- Full rewrite of the 13 Zustand stores — only break the cross-store `getState()` chains that are documented; do not redesign the whole state layer.
- SSR / Next.js migration — Vite SPA stays.
- Mobile app — explicitly out per `PROJECT_SPEC.md`.

## Context

- **Codebase state:** Mature. 13 stores, 11 edge functions, 36 SQL migrations, ~50 React components. Two rounds of audit fixes recently shipped ("Fix 28 issues: artifact parser, security, streaming, Python reliability, prompts" and "Improve artifact quality: anti-AI design system, Python self-knowledge, pre-flight validation"). See `.planning/codebase/CONCERNS.md` for the full state of known issues.
- **User workflow:** User works on `dev` branch locally (no `supabase start` / `vite` running — verification is done by pushing to Vercel + Supabase dev). When the build is "good", they promote to `main` and the prod Vercel/Supabase deploys pick it up. There is no automated test runner in CI today.
- **Verification strategy (per user direction):** Test the things that are easy to test and most important. For things that need manual checks, give exact steps to repeat and what to expect.
- **Prior audit:** `AUDIT_PROGRESS.md` documents the Phase 1–4 audit (C/H/S items, all resolved) and the Phase 5 hardening still outstanding. The artifact audit found 28 issues — recent commits indicate the artifact ones are addressed, but verification is pending.
- **Memory note:** `MEMORY.md` references `artifact-audit-findings.md` from 2026-06-06 (2 days old). The recent git history suggests the bulk of those fixes have shipped, but per the system reminder, claims about specific code states should be verified against the live source before being treated as fact.

## Constraints

- **No local dev environment:** The user does not run `supabase start` or `vite` locally. All verification must work against `tsc -b`, `eslint`, and `vite build` for compile-time checks; runtime checks are done by the user on the deployed Vercel + Supabase dev environment.
- **Test infrastructure is greenfield:** There is no Vitest, Jest, or Playwright in `package.json` today. The first phase of this milestone must add them.
- **Single-language project:** TypeScript everywhere — frontend (`src/`) and edge functions (`supabase/functions/`) both target TypeScript. No Python, no Go.
- **Vite SPA, not SSR:** No Next.js migration. No server components.
- **No test infrastructure migration to a different runner:** If we add Vitest, it stays Vitest. If we add Playwright, it stays Playwright. No framework-shopping.
- **API key isolation:** OpenRouter, Tavily, Lemon Squeezy keys must stay server-side. Frontend never holds these.
- **Deployment:** Pushes to `dev` go to Vercel preview + Supabase dev. When the user is happy, `dev` → `main` triggers prod.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Refactor monoliths before fixing bugs inside them | Lower risk — fixes land in small, testable modules instead of 1,700-line files | — Pending |
| Set up tests in an early phase (not the last phase) | Tests guard every subsequent fix; addresses TD-09 from day one | — Pending |
| Use Vitest for unit tests, Playwright for E2E | Vitest pairs naturally with Vite (shared config, fast HMR); Playwright is the standard for browser E2E | — Pending |
| Lazy-load `openrouter.ts` continuation engine | Cuts initial bundle; perf concern (PERF-04) | — Pending |
| Replace regex SVG sanitization with DOMParser | Regex is bypassable; DOMParser is the correct primitive (SEC-01) | — Pending |
| Move circuit-breaker state to shared KV | In-memory state is per-isolate; lost on cold start (PERF-05, PROD-03) | — Pending |
| Apply rate limit to every edge function (not just chat-proxy) | Other functions are unprotected; trivial to abuse (SEC-04) | — Pending |
| Use Zustand `subscribe` for cross-store events | Breaks the `getState()` spaghetti (TD-08) | — Pending |
| Provide exact manual test steps for non-automatable changes | User has no local env and no E2E harness yet; their words: "tell me exact steps to repeat and tell me what happened" | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state (users, feedback, metrics)
5. Re-verify CONCERNS.md is empty of unaddressed items (or document any that remain)

---
*Last updated: 2026-06-08 after stabilization milestone initialization*
