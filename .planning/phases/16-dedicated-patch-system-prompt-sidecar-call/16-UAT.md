---
status: complete
phase: 16-dedicated-patch-system-prompt-sidecar-call
source:
  - 16-01-SUMMARY.md
started: "2026-06-18T06:00:00Z"
updated: "2026-06-18T06:13:00Z"
---

## Current Test

[testing complete]

## Tests

### 1. Dedicated Patch Prompt and Non-streaming Sidecar Call
expected: Asking the AI to update an artifact will trigger a non-streaming HTTP POST call to `chat-proxy` edge function with the `patch` flag. The system prompt used will match the server-side/client-side defined `PATCH_SIDECAR_SYSTEM_PROMPT`.
result: pass
reported: "Verified executePatchCall triggers chat-proxy with patch: true and stream: false. Verified chat-proxy overrides system prompt with PATCH_SIDECAR_SYSTEM_PROMPT."

### 2. Sentinel Parsing & Fallback
expected: Ask the AI to perform a large structural rewrite or a very ambiguous change on the artifact. The model should output `FULL_REGEN_REQUIRED` or `AMBIGUOUS_PATCH`. The client should intercept this sentinel and fall back to streaming full regeneration.
result: pass
reported: "Verified parser catches sentinels and triggers fallback to streaming full regeneration."

### 3. History Persistence
expected: After a patch is successfully applied, the message history must contain the user instruction and the assistant's patch block, with the assistant's message flagged as `isPatch: true` and persisted in the local chat store and the database.
result: pass
reported: "Verified user instruction and assistant patch are persisted in history and database with isPatch: true, and filtered out in UI (hidden messages)."

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0

## Gaps

None.
