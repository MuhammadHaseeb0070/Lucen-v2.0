# Phase 16: Dedicated Patch System Prompt & Sidecar Call - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Create a dedicated system prompt for patching and execute it via a sidecar call. Includes defining `PATCH_SIDECAR_SYSTEM_PROMPT` in `src/config/prompts.ts`, routing client updates via `chat-proxy` with a `patch: true` payload, and implementing fallback-tolerant non-streaming sidecar calls in `src/services/openrouter/patchClient.ts`.

</domain>

<decisions>
## Implementation Decisions

### Sidecar Endpoint Architecture
- Integrate custom patch execution mode inside `supabase/functions/chat-proxy/index.ts` (triggered by a payload flag or header) to reuse auth/rate-limit/billing logic.

### Patch System Prompt Source
- Use `PATCH_SIDECAR_SYSTEM_PROMPT` defined in `src/config/prompts.ts`.

### Authentication & Security
- Standard Supabase JWT authorization on the edge function call.

### Credit / Billing Deduction
- Standard token-based credit deduction (which is naturally cheap due to small patch size).

### Model Selection for Patches
- Match the current active chat model (primary, secondary, or tertiary fallback).

### Execution Mode
- Non-streaming call (raw POST fetch returning full response).

### Context Scope
- Minimal context (only system prompt + active artifact code + user instruction).

### Fallback on Total Failure
- Fall back to standard full regeneration if all models in the fallback chain fail or return empty/broken patch code.

### Client-side Service Location
- Inside a new file `src/services/openrouter/patchClient.ts` as a sibling to `client.ts`.

### UI Loading Indicator
- Spinner overlay on the artifact preview pane itself.

### Database / History Persistence
- Save successfully applied patch assistant messages in the conversation database history (content containing only the patch block) with metadata `isPatch: true`.

### Sentinel Routing Protocol
- Catch sentinel strings (`FULL_REGEN_REQUIRED` or `AMBIGUOUS_PATCH`) in the client parser, cancel the patch path, and automatically initiate a normal `streamChat` call in full regeneration mode.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/services/openrouter/client.ts` for fetch wrappers and fallback loops.
- `src/config/prompts.ts` for prompt exports.
- `supabase/functions/chat-proxy/index.ts` for routing and stream handlers.

### Established Patterns
- Non-streaming edge function calls (e.g., `generate-title`).
- Zustand store management for UI state (typing indicators, panel toggles).

### Integration Points
- `src/store/chatStore.ts` (where user updates trigger actions).
- `supabase/functions/chat-proxy/index.ts` (main entry point for openrouter calls).

</code_context>

<specifics>
## Specific Ideas

- No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope.

</deferred>
