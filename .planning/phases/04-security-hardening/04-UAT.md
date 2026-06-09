---
status: testing
phase: 04-security-hardening
source:
  - 04-01-SUMMARY.md
  - 04-02-SUMMARY.md
  - 04-03-SUMMARY.md
started: "2026-06-09T05:55:00Z"
updated: "2026-06-09T05:55:00Z"
---

## Current Test

number: 1
name: SVG & Mermaid Sanitization
expected: |
  Rendering SVGs or Mermaid charts containing script tags or inline event handlers (like onload/onclick) successfully strips the malicious scripts, rendering only the clean diagram structure.
awaiting: user response

## Tests

### 1. SVG & Mermaid Sanitization
expected: Rendering SVGs or Mermaid charts containing script tags or inline event handlers (like onload/onclick) successfully strips the malicious scripts, rendering only the clean diagram structure.
result: [pending]

### 2. Restricted Iframe Sandbox
expected: HTML preview artifacts run in an iframe with the sandbox attribute restricted to 'allow-scripts' only. Disallowed features (like form submissions or popups) fail safely.
result: [pending]

### 3. Empty/Malformed HTML Artifact Placeholder
expected: If an HTML artifact completes streaming and contains empty or structurally malformed content, the preview pane renders a styled warning card with an AlertTriangle icon and a button to switch to Code view.
result: [pending]

### 4. 0-Byte File Rejection
expected: Uploading an empty (0-byte) file immediately triggers a toast warning notification indicating the file is empty and cannot be processed.
result: [pending]

### 5. File Hashing Deduplication
expected: Uploading identical files in a batch or attaching a file already present in the queue filters out the duplicate and surfaces a warning notification.
result: [pending]

### 6. Encrypted PDF/Word Document Warnings
expected: Attaching a password-protected PDF or Word document catches the decryption exception and displays a clear error state directly on the file card.
result: [pending]

### 7. Forged JWT Sentry Alerts
expected: Requests to chat-proxy with forged JWT signatures return a 401 response and dispatch a critical Sentry alert with correlation details and redacted tokens.
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0

## Gaps

[none yet]
