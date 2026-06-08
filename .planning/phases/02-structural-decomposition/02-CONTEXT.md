# Phase 2: Structural Decomposition - Context

**Gathered:** 2026-06-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Decompose the two massive monoliths (`src/services/openrouter.ts` and `supabase/functions/chat-proxy/index.ts`) into small, testable sub-modules. Unify logging under a structured wrapper with end-to-end correlation IDs, break cross-store coupling using a centralized Zustand orchestration layer, and apply targeted performance optimizations.

</domain>

<decisions>
## Implementation Decisions

### Monolith Decomposition
- **D-01:** Facade Re-export pattern: Split `src/services/openrouter.ts` and `supabase/functions/chat-proxy/index.ts` into folders with sub-modules, and re-export via their original entry paths so that no other files in the codebase have to modify their imports.
  - `src/services/openrouter.ts` decomposes into: `messages/`, `rag/`, `streaming/`, `continuation/`
  - `supabase/functions/chat-proxy/index.ts` decomposes into: `auth.ts`, `streamHandler.ts`, `billing.ts` with a thin orchestrator index.

### Zustand Decoupling
- **D-02:** Centralized store orchestration: Create a single `src/store/orchestration.ts` file that sets up all cross-store subscriptions using Zustand's `subscribeWithSelector`, allowing stores to be tested and loaded in isolation.

### Structured Logging
- **D-03:** End-to-End Correlation: Generate correlation IDs on the frontend and pass them via `X-Correlation-ID` headers to edge functions for full tracing. Migrate all 50+ raw `console.log/warn/error` calls across `src/services/`, `src/store/`, and `src/components/` to `src/lib/logger.ts`.

### Performance Memoization
- **D-04:** Targeted Optimization: Compute the theme fingerprint hash only when color fields actually change (using a deep compare against the last computed state instead of a 60Hz JSON stringify on color slider drag), and apply `React.memo` strictly to `MessageBubble` to prevent re-rendering loops during chat streaming.

### the agent's Discretion
- None.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core value, constraints, key decisions for the stabilization milestone.
- `.planning/REQUIREMENTS.md` — TD-01, TD-02, TD-07, TD-08, TD-09, BUG-01, BUG-02, BUG-04, BUG-10, PERF-01, PERF-02, PERF-03, PERF-04: the exact requirements this phase must satisfy.
- `.planning/ROADMAP.md` — Phase 2 goals and success criteria.
- `.planning/STATE.md` — Current milestone status.

### Codebase Analysis
- `.planning/codebase/CONCERNS.md` — Technical tech debt and known bugs mapping.
- `.planning/codebase/ARCHITECTURE.md` — Core architectural layers and store interactions.
- `.planning/codebase/STACK.md` — Technologies, environments, and configs.
- `.planning/codebase/CONVENTIONS.md` — Style guidelines, patterns, and formats.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/logger.ts` — Structured logging library; will be modified to handle correlation IDs and JSON format.
- `src/lib/artifactParser.ts` — HTML tag parsing and stripping; will be fixed for orphaned tag handling.
- `src/lib/iframeErrorBridge.ts` — Inject error scripts; will be corrected to target `<head>` correctly.

### Established Patterns
- Zustand stores with `persist` middleware (`chatStore`, `uiStore`, `creditsStore`, `sideChatStore`) — must be versioned and migrated with a fallback schema.
- Deno Edge Functions proxy — uses `supabase` clients for auth and session retrieval.

### Integration Points
- `src/services/openrouter.ts` — The monolithic client routing service; split facade will reside here.
- `supabase/functions/chat-proxy/index.ts` — The monolithic proxy Deno function; split facade will reside here.

</code_context>

<specifics>
## Specific Ideas
- No specific requirements — open to standard approaches.
</specifics>

<deferred>
## Deferred Ideas
- None — discussion stayed within phase scope.
</deferred>

---

*Phase: 02-Structural Decomposition*
*Context gathered: 2026-06-08*
