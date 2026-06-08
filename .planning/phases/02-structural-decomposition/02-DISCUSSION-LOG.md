# Phase 2: Structural Decomposition - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-08
**Phase:** 02-Structural Decomposition
**Areas discussed:** Monolith Decomposition, Zustand Decoupling, Structured Logging, Performance Memoization

---

## Monolith Decomposition

| Option | Description | Selected |
|--------|-------------|----------|
| (Recommended) Re-export via Facade | Split into folders with sub-modules, and re-export via index.ts so no other files have to change imports. | ✓ |
| Separate Top-Level Files | Decompose into individual top-level files and update all imports across the codebase. | |
| You decide | Antigravity's discretion | |

**User's choice:** (Recommended) Re-export via Facade
**Notes:** Decided to split `openrouter.ts` and `chat-proxy` into directory structures with focused files, re-exporting them from the original paths so client files aren't broken.

---

## Zustand Decoupling

| Option | Description | Selected |
|--------|-------------|----------|
| (Recommended) Centralized orchestration.ts | Create a single src/store/orchestration.ts file that sets up all cross-store subscriptions. | ✓ |
| Decentralized store subscriptions | Let each store file call subscribe on other stores directly inside its setup. | |
| You decide | Antigravity's discretion | |

**User's choice:** (Recommended) Centralized orchestration.ts
**Notes:** A new `orchestration.ts` module will capture Zustand subscriptions to cleanly break the cross-store imports.

---

## Structured Logging

| Option | Description | Selected |
|--------|-------------|----------|
| (Recommended) End-to-End Correlation | Generate correlation IDs on the frontend and pass them via X-Correlation-ID headers to edge functions for full tracing. | ✓ |
| Isolate Correlation | Let the frontend and backend generate their own correlation IDs independently without passing headers. | |
| You decide | Antigravity's discretion | |

**User's choice:** (Recommended) End-to-End Correlation
**Notes:** Correlation IDs generated on the client will travel in headers to edge functions, allowing single actions to be traced across environments.

---

## Performance Memoization

| Option | Description | Selected |
|--------|-------------|----------|
| (Recommended) Target Optimization | Compute fingerprint hash only when color fields actually change (deep compare vs. last), and apply React.memo strictly to MessageBubble. | ✓ |
| Heavy Optimization | Debounce/throttle theme updates to 100ms, and apply React.memo to ChatArea, MessageBubble, and FileLibrary. | |
| You decide | Antigravity's discretion | |

**User's choice:** (Recommended) Target Optimization
**Notes:** Compute theme fingerprint using deep compares to avoid 60Hz stringify operations during color slider drags, and apply memoization strictly on MessageBubble component.

---

## the agent's Discretion
None.

## Deferred Ideas
None.
