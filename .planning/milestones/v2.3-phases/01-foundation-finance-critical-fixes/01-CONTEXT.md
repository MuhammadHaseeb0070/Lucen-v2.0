# Phase 1: Foundation + Finance-Critical Fixes - Context

**Gathered:** 2026-06-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver test infrastructure (Vitest + Playwright), a shared types package (`src/shared/`), and fix two finance‑critical bugs (finishReason billing drift BUG‑05 and JWT expiry mid‑stream SEC‑06). This foundation guards every subsequent change — tests run and shared types compile before monolith decomposition proceeds.
</domain>

<decisions>
## Implementation Decisions

### Bug Fix Implementation
- **D-01:** For BUG‑05 (finishReason billing drift) — add Sentry breadcrumb and ensure `finishReason` is assigned in every streaming path (including error/early‑exit). The Sentry breadcrumb will be placed in the centralized billing function, not distributed per error path.
- **D-02:** For SEC‑06 (JWT expiry mid‑stream) — attempt to refresh the JWT using Supabase auth API mid‑stream; if refresh succeeds, continue the stream; otherwise reject with 401. This matches the requirement “refresh JWT mid‑stream and rejects with 401 on expiry”.
- **D-03:** Write unit tests for both BUG‑05 and SEC‑06 fixes after the test infrastructure is ready (Vitest). Tests will verify billing logic and token‑refresh behavior.

### Test Infrastructure
- **D-04:** Vitest configuration will extend the existing `vite.config.ts` with a `test` property (no separate `vitest.config.ts`). This keeps the config unified and leverages Vite’s built‑in test support.
- **D-05:** Coverage thresholds (lines 50%, branches 40%, functions 45%, statements 50%) will be enforced as CI gates — tests fail when thresholds are not met.
- **D-06:** Unit test files will be placed as `*.test.ts` files alongside the source files (e.g., `artifactParser.test.ts` next to `artifactParser.ts`), not in `__tests__` directories.
- **D-07:** Playwright E2E tests will live in a `tests/e2e/` directory and run only on Chromium (simpler setup). At least one smoke test will be written as required by the roadmap success criteria.

### Shared Types Integration
- **D-08:** Configure `supabase/functions/import_map.json` to map the `shared/` path to `../../src/shared/` so both frontend and Deno edge functions can import it directly without duplication.

### Manual Verification
- **D-09:** Document manual verification steps for non-automatable changes in a centralized `VERIFICATION.md` file inside the phase's planning directory (`.planning/phases/01-foundation-finance-critical-fixes/`).

### Claude's Discretion
- No “you decide” responses — all choices were explicit.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core value, constraints, key decisions for the stabilization milestone.
- `.planning/REQUIREMENTS.md` — TEST‑01..TEST‑05, TD‑06, BUG‑05, SEC‑06, VERIFY‑01, VERIFY‑02: the exact requirements this phase must satisfy.
- `.planning/ROADMAP.md` — Phase 1 goal, success criteria, requirement mapping.
- `.planning/STATE.md` — Current project status (Phase 1 ready to plan).

### Codebase Analysis
- `.planning/codebase/CONCERNS.md` — Known issues: BUG‑05 (finishReason), SEC‑06 (JWT expiry), TD‑06 (shared types).
- `.planning/codebase/TESTING.md` — Current test gaps, recommended test strategy, listing of pure‑function files suitable for unit tests.
- `.planning/codebase/STACK.md` — Technology stack (Vite, React 19, TypeScript 5.9, Zustand, Supabase Edge Functions).
- `.planning/codebase/ARCHITECTURE.md` — Architecture patterns (component‑service‑store, SSE streaming, edge‑function proxy, Zustand stores with persistence).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/artifactParser.ts` — Pure function `parseArtifacts()`; candidate for first unit tests.
- `src/lib/logger.ts` — Structured logging wrapper; can be used for migration of raw `console.*` calls (TD‑07).
- `src/lib/iframeErrorBridge.ts` — Utility for iframe error handling; also a unit‑test candidate.
- `src/services/openrouter.ts` — Monolithic streaming service (1,770 lines) will be split in Phase 2; bug fixes must be applied to this file before decomposition.
- `supabase/functions/chat-proxy/index.ts` — Monolithic edge function (1,668 lines) will be split in Phase 2; BUG‑05 and SEC‑06 fixes must be applied here first.

### Established Patterns
- Zustand stores with `persist` middleware (`chatStore`, `uiStore`, `creditsStore`, `sideChatStore`) — test infrastructure should support mocking these stores.
- Edge‑function proxy pattern — all external API calls go through Supabase Edge Functions; test infrastructure must be able to mock edge‑function responses.
- SSE streaming with 16ms batching — any unit tests for streaming logic should respect the batching cadence.
- Web Workers for CPU‑intensive tasks (`tokenizer.worker.ts`, `artifactParse.worker.ts`) — unit tests can mock worker communication.

### Integration Points
- **Test‑runner integration:** Add `npm run test` (Vitest) and `npm run e2e` (Playwright) scripts to `package.json`.
- **Coverage reporting:** Configure `coverage` in Vitest config to output `lcov` for CI.
- **Shared‑types package:** Create `src/shared/` directory with Zod schemas and inferred TypeScript types; add path alias to `tsconfig.app.json` and `tsconfig.node.json` (for edge‑functions) so both frontend and backend can import them without duplication.
- **Sentry integration:** BUG‑05 fix requires importing `@sentry/deno` (or `@sentry/react` for frontend) for breadcrumb emission; ensure Sentry is already wired in `src/main.tsx`.
</code_context>

<specifics>
## Specific Ideas
- No specific UI/UX references — the phase is about infrastructure and bug fixes.
- The user emphasized “exact manual verification steps for non‑automatable changes” (VERIFY‑01). Implementation will follow the decision in D-09.
</specifics>

<deferred>
## Deferred Ideas
- None — discussion stayed within phase scope.
</deferred>

---

*Phase: 01-foundation-finance-critical-fixes*
*Context gathered: 2026-06-08*