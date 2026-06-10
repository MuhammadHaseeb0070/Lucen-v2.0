# Milestone v2.7 Requirements: Robust OpenRouter Multi-Model System

## Goals & Objectives
Build a highly consistent, parameter-normalized, and robust fallback system (Primary -> Secondary -> Tertiary) for OpenRouter API calls in both streaming and non-streaming modes across main and side chats.

## Functional Requirements

### REQ-01: Multi-Model Secret Configuration
- The system must recognize the following configuration environment variables/secrets:
  - Main Chat: `MAIN_CHAT_MODEL_PRIMARY`, `MAIN_CHAT_MODEL_SECONDARY`, `MAIN_CHAT_MODEL_TERTIARY`
  - Side Chat: `SIDE_CHAT_MODEL_PRIMARY`, `SIDE_CHAT_MODEL_SECONDARY`, `SIDE_CHAT_MODEL_TERTIARY`
- If the primary variable is not set or is empty, the system must automatically fall back to checking the secondary, and then the tertiary.
- If none of these variables are configured, fall back to hardcoded default models (e.g., `minimax/minimax-01` for main, `openai/gpt-4o-mini` for side).

### REQ-02: Sequential Fallback Execution Loop
- Integrate a try-catch/retry loop when requesting OpenRouter.
- If the request to the currently selected model fails (due to HTTP error, rate limit, token limit, or network timeout), the system must:
  - Log the failure (including correlation IDs).
  - Select the next available fallback model in the chain.
  - Execute the request again with the fallback model's specific configuration.
- The failover loop must handle both non-streaming requests in `chat-proxy/index.ts` and streaming requests in `chat-proxy/streamHandler.ts`.

### REQ-03: Parameter Normalization Registry
- Build a model-parameter normalization utility (e.g., `normalizeModelParams`).
- Detect special model families (e.g., OpenAI o1/o3-mini, DeepSeek R1) and translate parameters to prevent upstream OpenRouter API validation errors:
  - For reasoning models (e.g., `openai/o1`, `openai/o3-mini`): Strip `temperature` (or enforce it to `1.0`), strip `top_p`, `presence_penalty`, `frequency_penalty`, and map `max_tokens` to `max_completion_tokens`.
  - For models supporting thinking/reasoning budget: Include the appropriate `reasoning` payload structure (e.g. `reasoning: { effort: "high" }` or similar).

### REQ-04: Dynamic Metadata Header Synchronization
- Ensure the headers returned by the `chat-proxy` edge function (`x-model-name`, `x-supports-reasoning`, `x-context-window`, `x-max-output`, `x-tokens-per-second`) dynamically match the model that *actually* succeeded in the request chain.
- The client-side streaming client must receive and process these headers to dynamically update the store state.

### REQ-05: Update `get-model-config` Configuration Sync
- Update `get-model-config` edge function to dynamically resolve the configurations for both main and side chats using the first available non-empty model configured in their respective primary/secondary/tertiary chains.

## Traceability

| Requirement ID | Description | Phase | Verification Status |
|---|---|---|---|
| **REQ-01** | Multi-Model Secret Configuration | Phase 8 | Pending |
| **REQ-02** | Sequential Fallback Execution Loop | Phase 8 | Pending |
| **REQ-03** | Parameter Normalization Registry | Phase 9 | Pending |
| **REQ-04** | Dynamic Metadata Header Sync | Phase 9 | Pending |
| **REQ-05** | Update `get-model-config` Config | Phase 8 | Pending |
