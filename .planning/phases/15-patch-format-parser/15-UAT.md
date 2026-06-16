---
status: testing
phase: 15-patch-format-parser
source:
  - 15-01-SUMMARY.md
started: "2026-06-16T07:47:00Z"
updated: "2026-06-16T07:47:00Z"
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 1
name: Smart Artifact Patching
expected: |
  Ask the AI to generate a simple HTML artifact. Then ask it to change a specific line or style. The AI should use Git conflict markers (`<<<<<<< SEARCH`, `=======`, `>>>>>>> REPLACE`) to patch the artifact efficiently instead of regenerating the entire file.
awaiting: user response

## Tests

### 1. Smart Artifact Patching
expected: Ask the AI to generate a simple HTML artifact. Then ask it to change a specific line or style. The AI should use Git conflict markers (`<<<<<<< SEARCH`, `=======`, `>>>>>>> REPLACE`) to patch the artifact efficiently instead of regenerating the entire file.
result: [pending]

### 2. HTML Sanity Check
expected: Manually edit the patch or request a patch that intentionally breaks HTML syntax (e.g., leaving a tag unclosed). The UI should surface an HTML sanity check failure error rather than corrupting the preview.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0

## Gaps
