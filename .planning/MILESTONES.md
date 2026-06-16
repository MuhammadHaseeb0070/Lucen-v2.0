# Milestones

## v3.0 Core Messaging & Tool Pipeline Stabilization (Shipped: 2026-06-16)

**Phases completed:** 3 phases (Phases 12-14), 3 plans, 14 tasks

**Key accomplishments:**

- **Horizontal Privilege Escalation Prevention:** Added `.eq('user_id', user.id)` checks and proper 404 responses to get-file-content and describe-image edge functions.
- **Deno Import Resolving:** Fixed a serverless script ReferenceError in the web-search helper.
- **Client Routing & Hydration Sync:** Enabled parametric path routing `/chat/:id` and unified mount/hydration synchronization to resolve layout redirect loops.
- **Worker Hang watchdog:** Implemented a client-side 60s timeout watchdog that terminates and re-initializes Pyodide web workers on infinite loops.
- **Parser & Artifact Cleanup:** Refactored fenced markdown unwrapping sequence and limited automatic workspace opening to active streams.
- **Smooth Streaming UI:** Shifted to requestAnimationFrame for SSE chunk batching and postponed high-overhead syntax highlighting during active streaming.
- **Steps UI Default Expansion:** Expanded the tool steps block by default in chat message bubbles.

---
