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

## Milestone: v2.5 — Web Search Optimization

**Shipped:** 2026-06-09
**Phases:** 1 | **Plans:** 1 | **Sessions:** 1

### What Was Built
- Enabled parallel tool execution for web search to fetch results concurrently.
- Implemented dynamic `maxRounds` step limits up to 5 rounds.
- Added strict step limit negative constraints in final generation turns.
- Enhanced client-side XML tag stripping in `sanitizeMinimaxTags`.
- Restyled tool step statuses and domain citations.

### What Worked
- Parallelizing tool calls significantly reduced query latencies.
- Injected negative constraints effectively prevented tool leakages.

### What Was Inefficient
- Hardcoded tag patterns required repeated adjustments to cover edge cases.

### Key Lessons
- Scaling step limits dynamically prevents premature truncation when processing complex tool structures.

---

## Milestone: v2.6 — Excel-focused Pyodide Rebuild

**Shipped:** 2026-06-10
**Phases:** 1 | **Plans:** 1 | **Sessions:** 1

### What Was Built
- Transitioned artifact type from `'python'` to `'excel'` across types and parser.
- Rebuilt Pyodide worker to preload packages, enforce 60s timeout, and use headless Agg backend.
- Designed premium Excel UI renderer with multi-stage progress indicators and self-correction handler.
- Refactored master system prompt with strict rules on excel tags and capabilities.

### What Worked
- Pre-loading core libraries like pandas/openpyxl inside the worker avoided runtime import delays.
- Clear separation of worker client and worker execution logic.

### What Was Inefficient
- Managing large Pyodide WebAssembly payloads locally can hit initial memory thresholds on lower-end devices.

### Key Lessons
- Explicit, multi-stage loading progress states greatly improve the perceived performance and user experience of WASM-based runtimes.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v2.3 | 4 | 5 | Refactored legacy monoliths and added Vitest/Playwright tests from scratch. |
| v2.5 | 1 | 1 | Parallelized web search tools and implemented dynamic round scaling. |
| v2.6 | 1 | 1 | Rebuilt Pyodide environment focusing exclusively on Excel document generation. |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v2.3 | 52 | 77.09% | 2 |
| v2.5 | 52 | 77.09% | 0 |
| v2.6 | 58 | 77.50% | 0 |

### Top Lessons (Verified Across Milestones)

1. Decomposing complex monoliths early saves significant QA time.
2. Centralized structured logging simplifies cross-isolate runtime troubleshooting.
3. Explicit, multi-stage loading feedback improves the UX of heavy client-side computations (WASM/Pyodide).
