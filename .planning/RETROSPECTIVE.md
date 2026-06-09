# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v2.3 — Stabilization Milestone

**Shipped:** 2026-06-09
**Phases:** 5 | **Plans:** 9 | **Sessions:** 4

### What Was Built
- Test infrastructure (Vitest + Playwright) with V8 coverage gates and mocked browser smoke tests.
- Code refactoring: Decomposed the massive 1,770-line `openrouter.ts` and 1,668-line `chat-proxy` monoliths.
- Telemetry: Centralized Sentry error monitoring and log-integrated breadcrumbs.
- Hardened security: DOMPurify SVG/Mermaid sanitization, restricted sandbox iframes with warnings, mid-stream JWT refreshing, and forged JWT signal alerting.
- billing/rate limit protection: Added Upstash Redis-backed rate limiting and circuit breakers across all 11 edge functions.

### What Worked
- Monolithic refactoring before bug-fixing made it much easier to isolate and test bugs.
- Playwright E2E mock network intercepts (`page.route()`) allowed fast, reproducible testing without active credentials.

### What Was Inefficient
- Vite production builds do not cover Deno edge functions. Missing imports and missing `await` statements on async functions in Deno went uncaught by the compiler, leading to post-deploy runtime issues.

### Patterns Established
- Centralized structured logging utilizing correlation IDs across frontend and edge functions.
- Client-side content hashing for file deduplication.

### Key Lessons
- **Deno static checking:** Ensure Deno files are validated or executed in their own runtime environment, as standard frontend compiler checks skip them.
- **Awaiting Async Utilities:** Always double-check that asynchronous helpers (like `checkRateLimit`) are awaited, or promise evaluation will cause logical bypasses.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v2.3 | 4 | 5 | Refactored legacy monoliths and added Vitest/Playwright tests from scratch. |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v2.3 | 52 | 77.09% | 2 |

### Top Lessons (Verified Across Milestones)

1. Decomposing complex monoliths early saves significant QA time.
2. Centralized structured logging simplifies cross-isolate runtime troubleshooting.
