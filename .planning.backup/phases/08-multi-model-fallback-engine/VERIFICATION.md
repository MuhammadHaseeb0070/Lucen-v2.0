# Centralized Manual Verification Plan - Phase 8 & 9 (Multi-Model Fallback Engine)

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| REQ-01 | 08-01-SUMMARY.md | Multi-Model Secret Configuration | passed | `/get-model-config` tested |
| REQ-02 | 08-01-SUMMARY.md | Sequential Fallback Execution Loop | passed | Fallback logic handles API outages transparently |
| REQ-03 | 08-01-SUMMARY.md | Parameter Normalization | passed | Reasoning models strip forbidden parameters |
| REQ-04 | 08-01-SUMMARY.md | Dynamic Header Sync | passed | Headers sync `x-supports-reasoning` properly |
| REQ-05 | 08-01-SUMMARY.md | Configuration Sync | passed | Proxy configurations properly handled |

## Tech Debt
- None identified.

## Status
passed

---

### Test Case 1: Active Primary Model Resolution
1. Set the following environment variables:
   - `MAIN_CHAT_MODEL_PRIMARY="openai/gpt-4o"`
   - `MAIN_CHAT_MODEL_SECONDARY="openai/gpt-4o-mini"`
   - `MAIN_CHAT_MODEL_TERTIARY="google/gemini-2.5-pro"`
2. Perform a request to `/get-model-config` endpoint.
3. **Acceptance Criteria**: Verify that the returned config lists the primary model as the active main chat model.

### Test Case 2: Multi-Secret Fallback Flow
1. Clear/unset `MAIN_CHAT_MODEL_PRIMARY` (or set it to `""`). Keep `MAIN_CHAT_MODEL_SECONDARY` and `MAIN_CHAT_MODEL_TERTIARY` set.
2. Call `/get-model-config` and initiate a chat via the proxy.
3. **Acceptance Criteria**: The system resolves `MAIN_CHAT_MODEL_SECONDARY` (`openai/gpt-4o-mini`) as the active model.
4. Clear `MAIN_CHAT_MODEL_SECONDARY`. Call `/get-model-config`.
5. **Acceptance Criteria**: The system resolves `MAIN_CHAT_MODEL_TERTIARY` (`google/gemini-2.5-pro`).
6. Clear `MAIN_CHAT_MODEL_TERTIARY`.
7. **Acceptance Criteria**: The system falls back to legacy variables (`MAIN_CHAT_MODEL` / `SIDE_CHAT_MODEL`) or hardcoded defaults (`minimax/minimax-01` for main).

---

## REQ-02: Sequential Fallback Execution Loop (Streaming & Non-Streaming)

### Objective
Verify that if a model fails downstream (e.g., due to rate limits, invalid token, model outage), the proxy transparently tries the next model in the chain without failing the user's request.

### Test Case 1: Non-Streaming API Outage / Failover
1. Set:
   - `MAIN_CHAT_MODEL_PRIMARY="invalid/model-does-not-exist"`
   - `MAIN_CHAT_MODEL_SECONDARY="openai/gpt-4o-mini"`
2. Send a non-streaming chat request via the API proxy.
3. **Acceptance Criteria**:
   - The edge function console shows a warning/error log for the primary model failure.
   - The user gets a successful response from `openai/gpt-4o-mini`.
   - The response header `x-model-name` matches `gpt-4o-mini` (or its custom configured display name).

### Test Case 2: Streaming API Outage / Failover
1. Set:
   - `MAIN_CHAT_MODEL_PRIMARY="invalid/model-does-not-exist"`
   - `MAIN_CHAT_MODEL_SECONDARY="openai/gpt-4o-mini"`
2. Start a streaming chat request from the UI.
3. **Acceptance Criteria**:
   - The stream initiates and runs smoothly.
   - Downstream edge function fails silently for the first model and falls back to `openai/gpt-4o-mini` instantly.
   - Response headers delivered to the client browser dynamically reflect `openai/gpt-4o-mini` metadata.

---

## REQ-03 & REQ-04: Parameter Normalization & Dynamic Header Sync

### Objective
Ensure reasoning model requests are stripped of forbidden params (preventing API errors) and headers match the actual executing model.

### Test Case 1: OpenAI Reasoning Model Request (o1/o3-mini)
1. Set `MAIN_CHAT_MODEL_PRIMARY="openai/o3-mini"`.
2. Send a request to `/chat-proxy` with `temperature: 0.7` and `top_p: 0.9` configured in the UI.
3. **Acceptance Criteria**:
   - The request completes successfully.
   - Inspect the request payload to OpenRouter: verification shows `temperature`, `top_p`, and other parameters are stripped or set to compatible defaults (e.g., `max_completion_tokens` instead of `max_tokens`).
   - The response headers show `x-supports-reasoning: true`.

### Test Case 2: Client State Dynamic Update
1. Set `MAIN_CHAT_MODEL_PRIMARY="invalid/model-does-not-exist"` (reasoning model, e.g. `openai/o1-mini`) and `MAIN_CHAT_MODEL_SECONDARY="openai/gpt-4o-mini"` (non-reasoning).
2. Start a streaming request.
3. **Acceptance Criteria**:
   - Since the first fails, the second handles the request.
   - Inspect the response headers: `x-supports-reasoning` is `false`, and `x-model-name` is `GPT-4o-mini`.
   - Verify in the UI that the store state is dynamically synced to show that the current model does *not* support reasoning, and does not render reasoning/thinking blocks.
