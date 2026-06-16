# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v3.0 — Core Messaging & Tool Pipeline Stabilization

**Shipped:** 2026-06-16
**Phases:** 3 | Plans: 3 | Sessions: N/A

### What Was Built
- **Horizontal Privilege Escalation Prevention:** Added `.eq('user_id', user.id)` checks and proper 404 responses to `get-file-content` and `describe-image` edge functions.
- **Deno Import Resolving:** Fixed a serverless script ReferenceError in the web-search helper.
- **Client Routing & Hydration Sync:** Enabled parametric path routing `/chat/:id` and unified mount/hydration synchronization to resolve layout redirect loops.
- **Worker Hang Watchdog:** Implemented a client-side 60s timeout watchdog that terminates and re-initializes Pyodide web workers on infinite loops.
- **Parser & Artifact Cleanup:** Refactored fenced markdown unwrapping sequence and limited automatic workspace opening to active streams.
- **Smooth Streaming UI:** Shifted to requestAnimationFrame for SSE chunk batching and postponed high-overhead syntax highlighting during active streaming.
- **Steps UI Default Expansion:** Expanded the tool steps block by default in chat message bubbles.

### What Worked
- High efficiency due to targeted, direct-in-code phase execution.
- Robust client-side watchdogs resolving complex asynchronous worker freezes.

### What Was Inefficient
- Development without creating physical `.planning/phases/` subdirectories led to a discrepancy in planning stats tracking (0 plans/phases reported by gsd-tools).

### Patterns Established
- Watchdog pattern for asynchronous Web Workers to recover from browser-level infinite loops.

### Key Lessons
1. Always maintain consistent directory structures in planning phases even during rapid iteration to preserve automated reporting stats.
2. Web Workers executing heavy Pyodide runtimes require strict main-thread watchdog timers to prevent silent UI freezes.

### Cost Observations
- Model mix: 100% Claude Sonnet
- Sessions: N/A
- Notable: Iterative bug hunting was highly localized and rapid.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v3.0      | N/A      | 3      | Direct code stabilization check & inline verification |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v3.0      | 52    | ~85%     | 0                 |

### Top Lessons (Verified Across Milestones)

1. Keep user boundaries strictly validated at the DB/row level to prevent horizontal privilege escalation.
2. Routing state must be synchronized on mount to avoid infinite redirection loops.
