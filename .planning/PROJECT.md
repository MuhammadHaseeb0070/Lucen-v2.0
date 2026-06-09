# Lucen v2.3 — Stabilization Milestone

## What This Is

A stabilization pass on Lucen v2.3 — an AI chat SPA (React 19 + Vite + Supabase). The product is already live, the user works on the `dev` branch daily, and pushes to production via Vercel + Supabase. This milestone has resolved all concerns documented in `.planning/codebase/CONCERNS.md` and finished the production hardening.

## Core Value

Ship a secure, performant, and well-tested version of Lucen that the user can deploy with confidence.

## Requirements

### Validated

- ✓ React 19 SPA with Vite + TypeScript strict mode builds (`tsc -b && vite build`) — v2.3
- ✓ Supabase auth (email + OTP + password reset) — JWT-validated across all edge functions — v2.3
- ✓ AI chat streaming via OpenRouter proxy (chat-proxy edge function) — v2.3
- ✓ RAG: file → chunk → embed → pgvector retrieval (768-dim) — v2.3
- ✓ Credit/subscription system: Lemon Squeezy checkout, atomic credit deduction, FIFO ledger — v2.3
- ✓ Artifact system: `<lucen_artifact>` parsing, HTML/SVG/Mermaid render, versioning, voting, public Hub — v2.3
- ✓ React workspace sandbox (Code editor, preview iframe, terminal, diagnostics, AI panel) — v2.3
- ✓ 13 Zustand stores with persistence for chat, UI, credits, side-chat — v2.3
- ✓ Marketing pages (home, about, contact, packages, terms, privacy, refund) — v2.3
- ✓ Sentry error monitoring integration — v2.3
- ✓ Monolithic openrouter.ts and chat-proxy split into focused modules — v2.3
- ✓ Rate limiting and circuit breakers with shared Upstash Redis state — v2.3
- ✓ DOMPurify SVG/Mermaid sanitization and restricted allow-scripts sandbox — v2.3
- ✓ Vitest + Playwright test infrastructure with 42 unit and 10 E2E tests — v2.3
- ✓ JWT verification mid-stream and forged JWT alert safeguards — v2.3
- ✓ File upload size limit validations, content-hash deduplication, and encrypted file error states — v2.3

### Active

- **Parallel Web Search**: Support parallelizable tool execution for `web_search` to fetch results concurrently.
- **Dynamic Step Limits**: Prevent step ceiling truncation errors by scaling `maxRounds` dynamically (up to 5 rounds for attachment + web search calls).
- **Stronger Final Turn Prompting**: Prevent LLM tool leakages in final rounds by prompting with strong negative constraints when limits are reached.
- **Defensive Tag Sanitization**: Harden client-side XML tag stripping to defensively clean all possible parameters and leaked tool tags.
- **Premium Steps and Citations UI**: Restyle tool step statuses and domain citations to be beautiful, glassmorphic, and dynamic.

### Out of Scope

- Net-new product features not in CONCERNS.md — this was a stabilization pass, not a feature release.
- Migration off Lemon Squeezy, OpenRouter, Supabase, Vercel — vendors are stable for this milestone.
- Full rewrite of the 13 Zustand stores — only broke the cross-store `getState()` chains that were documented; did not redesign the whole state layer.
- SSR / Next.js migration — Vite SPA stays.
- Mobile app — explicitly out per `PROJECT_SPEC.md`.

## Context

- **Codebase state:** Stable and refactored. Test suites cover all critical utilities and flows. Built successfully with 0 compilation errors.
- **User workflow:** User works on `dev` branch locally. Pushes to `dev` trigger Vercel preview and Supabase development deployments automatically.
- **Verification strategy:** 42 Vitest unit tests + 10 Playwright E2E tests executing network mocks.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Refactor monoliths before fixing bugs inside them | Lower risk — fixes land in small, testable modules instead of 1,700-line files | ✓ Done |
| Set up tests in an early phase (not the last phase) | Tests guard every subsequent fix; addresses TD-09 from day one | ✓ Done |
| Use Vitest for unit tests, Playwright for E2E | Vitest pairs naturally with Vite (shared config, fast HMR); Playwright is the standard for browser E2E | ✓ Done |
| Lazy-load `openrouter.ts` continuation engine | Cuts initial bundle; perf concern (PERF-04) | ✓ Done |
| Replace regex SVG sanitization with DOMParser | Regex is bypassable; DOMParser (DOMPurify) is the correct primitive (SEC-01) | ✓ Done |
| Move circuit-breaker state to shared KV | In-memory state is per-isolate; lost on cold start (PERF-05, PROD-03) | ✓ Done |
| Apply rate limit to every edge function (not just chat-proxy) | Other functions are unprotected; trivial to abuse (SEC-04) | ✓ Done |
| Use Zustand `subscribe` for cross-store events | Breaks the `getState()` spaghetti (TD-08) | ✓ Done |

---
*Last updated: 2026-06-09 after v2.3 stabilization milestone*
