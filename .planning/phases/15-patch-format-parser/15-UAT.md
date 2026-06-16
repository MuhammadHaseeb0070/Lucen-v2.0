---
status: complete
phase: 15-patch-format-parser
source:
  - 15-01-SUMMARY.md
started: "2026-06-16T07:47:00Z"
updated: "2026-06-16T08:00:00Z"
---

## Current Test

[testing complete]

## Tests

### 1. Smart Artifact Patching
expected: Ask the AI to generate a simple HTML artifact. Then ask it to change a specific line or style. The AI should use Git conflict markers (`<<<<<<< SEARCH`, `=======`, `>>>>>>> REPLACE`) to patch the artifact efficiently instead of regenerating the entire file.
result: issue
reported: "no error but tnothign different becuas this si simjilar as it was workkign before thiss i the usage logs of token firs tone is first calculator and secodn is the gpt one for tbh e tielgeenrtaion adnthird is for the update \"6/16/2026, 12:54:56 AM Completed Chat minimax-m2.7:nitro 11,362 2,097 69 7.7s — -13.4590 6/16/2026, 12:54:26 AM Completed Title gpt-4o-mini 199 4 0 1.8s — -0.0000 6/16/2026, 12:54:24 AM Completed Chat minimax-m2.7:nitro 9,301 2,292 250 8.9s — -11.5930 \""
severity: major

### 2. HTML Sanity Check
expected: Ask the AI to generate a patch that intentionally breaks HTML syntax (e.g., leaving a tag unclosed). The UI should surface an HTML sanity check failure error rather than corrupting the preview.
result: issue
reported: "waht the hell youa re takingabuot man read the coe before asking quesiton how can i manulaye dit it is read only we made it like this user cant manulaly chaneg the code."
severity: major

## Summary

total: 2
passed: 0
issues: 2
pending: 0
skipped: 0

## Gaps

- truth: "Ask the AI to generate a simple HTML artifact. Then ask it to change a specific line or style. The AI should use Git conflict markers (`<<<<<<< SEARCH`, `=======`, `>>>>>>> REPLACE`) to patch the artifact efficiently instead of regenerating the entire file."
  status: diagnosed
  reason: "User reported: no error but tnothign different becuas this si simjilar as it was workkign before thiss i the usage logs of token firs tone is first calculator and secodn is the gpt one for tbh e tielgeenrtaion adnthird is for the update \"6/16/2026, 12:54:56 AM Completed Chat minimax-m2.7:nitro 11,362 2,097 69 7.7s — -13.4590 6/16/2026, 12:54:26 AM Completed Title gpt-4o-mini 199 4 0 1.8s — -0.0000 6/16/2026, 12:54:24 AM Completed Chat minimax-m2.7:nitro 9,301 2,292 250 8.9s — -11.5930 \""
  severity: major
  test: 1
  root_cause: "The system prompt does not properly instruct the model to use Git conflict markers for patches, or the patching pathway is not being triggered, causing a full regeneration instead of a surgical patch."
  artifacts:
    - path: "src/config/prompts.ts"
      issue: "System prompt missing strict patch format enforcement"
  missing:
    - "Add strict patch format instructions to the system prompt"
    - "Ensure the LLM only outputs the patch block when modifying an existing artifact"
  debug_session: .planning/debug/patch-format-failure.md

- truth: "Ask the AI to generate a patch that intentionally breaks HTML syntax (e.g., leaving a tag unclosed). The UI should surface an HTML sanity check failure error rather than corrupting the preview."
  status: diagnosed
  reason: "User reported: waht the hell youa re takingabuot man read the coe before asking quesiton how can i manulaye dit it is read only we made it like this user cant manulaly chaneg the code."
  severity: major
  test: 2
  root_cause: "The test assumes users can manually edit artifacts, but the current UI implements artifacts as read-only. The test is flawed, and the HTML sanity check should be verified via AI generation instead of manual user edits."
  artifacts:
    - path: ".planning/phases/15-patch-format-parser/15-UAT.md"
      issue: "Test 2 expects manual editing which is not supported by the UI"
  missing:
    - "Update the test to ask the AI to generate broken HTML instead of asking the user to manually edit the code"
  debug_session: .planning/debug/manual-edit-unsupported.md
