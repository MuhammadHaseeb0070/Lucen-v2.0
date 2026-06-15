# Phase 8: Multi-Model Fallback Engine - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement sequential model fallback execution loop for streaming and non-streaming requests in the `chat-proxy` edge function.

</domain>

<decisions>
## Implementation Decisions

- **D-01 (Fallback Logging):** Log primary model failures to Sentry as warnings with redacted metadata, and write detailed error output to the Deno edge function console.
- **D-02 (Seamless UI Fallback):** Failovers happen silently for the end-user (no warning system messages injected in the chat content), but the response headers (`x-model-name`, `x-supports-reasoning`, `x-context-window`, `x-max-output`, `x-tokens-per-second`) are dynamically updated to match the model that successfully responded, letting the client UI sync its active state.
- **D-03 (Double-Layer Fallback):** If the new multi-model secrets (`PRIMARY`, `SECONDARY`, `TERTIARY`) are not configured, the system checks legacy environment variables (`MAIN_CHAT_MODEL` / `SIDE_CHAT_MODEL`), and falls back to hardcoded defaults (`minimax/minimax-01` for main, `openai/gpt-4o-mini` for side) if those are also missing.

</decisions>

<canonical_refs>
## Canonical References

### Project Context
- `.planning/PROJECT.md` — Core requirements and status.
- `.planning/REQUIREMENTS.md` — REQ-01, REQ-02, REQ-05.
- `.planning/ROADMAP.md` — Phase 8 goals and progress.

### Codebase Analysis
- `supabase/functions/chat-proxy/index.ts` — Edge function router.
- `supabase/functions/chat-proxy/streamHandler.ts` — Streaming controller.
- `supabase/functions/get-model-config/index.ts` — Metadata sync endpoint.

</canonical_refs>
