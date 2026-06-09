---
phase: 04-security-hardening
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/services/fileProcessor.ts
  - src/services/fileProcessor.test.ts
autonomous: true
requirements:
  - SEC-05
must_haves:
  truths:
    - "0-byte file uploads are rejected immediately with a friendly validation error message."
    - "Identical file uploads are deduplicated in the attachment queue via SHA-256 content hashes."
    - "Encrypted or password-protected PDF/Word documents are detected, and clear user-facing error messages are surfaced on the attachment cards."
  artifacts:
    - path: "src/services/fileProcessor.ts"
      provides: "Deduplication via Web Crypto hashing, 0-byte size checks, and PDF/Word encryption exception wrapping"
    - path: "src/services/fileProcessor.test.ts"
      provides: "Unit tests verifying hashing logic, size check rejections, and encryption exception handling"
  key_links:
    - from: "src/services/fileProcessor.ts"
      to: "crypto.subtle.digest"
      via: "SHA-256 Web Crypto hashing"
---

<objective>
Update fileProcessor.ts to reject empty files, deduplicate uploads using client-side SHA-256 hashing, and capture/translate password-protection errors for PDF and DOCX documents.

Purpose: Prevent server storage bloat from duplicates/empty files and improve error UX for encrypted files.
Output: Hashing deduplication, size validation, and exception translation in fileProcessor.ts.
</objective>

<execution_context>
@.agent/gsd-core/workflows/execute-plan.md
@.agent/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/04-security-hardening/04-CONTEXT.md
@src/services/fileProcessor.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement pre-flight size, hash dedup, and decryption error checks</name>
  <files>src/services/fileProcessor.ts</files>
  <action>
    In src/services/fileProcessor.ts:
    Add a check in processFiles to reject any file where size === 0, adding a descriptive error message to the returned errors list (per D-06).
    Implement SHA-256 content hashing for files using browser-native crypto.subtle.digest('SHA-256', buffer) (per D-05).
    Perform upload deduplication by checking hashes of currently uploading/attached files. If a duplicate exists, omit it from processing and append a warning to the errors list.
    Modify extractPdfText to catch PDFJS password protection exceptions (err.name === 'PasswordException') and throw a dedicated error message (per D-07).
    Modify extractDocxText to catch zip reading errors (which occur on password-protected DOCX files) and return a clean, descriptive message.
  </action>
  <verify>
    npm run lint passes.
  </verify>
  <done>
    fileProcessor.ts validates size, checks content hash, and maps decryption errors cleanly.
  </done>
</task>

<task type="auto">
  <name>Task 2: Write unit tests for file validation and deduplication</name>
  <files>src/services/fileProcessor.test.ts</files>
  <action>
    Create a new test file src/services/fileProcessor.test.ts.
    Write tests asserting that empty (0-byte) files are rejected with the friendly error message.
    Write tests validating that duplicate uploads are detected and skipped based on their content hash.
    Mock PDFJS PasswordException and verify that extractPdfText returns the friendly password-protected error message.
  </action>
  <verify>
    npx vitest run src/services/fileProcessor.test.ts
  </verify>
  <done>
    Unit tests verify the updated fileProcessor validation rules.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| User Files → Client Processor | Untrusted user document files parsed locally to extract text and generate base64/data URLs. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-04-04 | Denial of Service | fileProcessor.ts / DB storage | mitigate | Reject empty files and deduplicate uploads by content hash before storage. |
| T-04-05 | Tampering | fileProcessor.ts / doc parsers | mitigate | Wrap parser execution in try/catch to safely handle password-protected or malformed zip archives. |
</threat_model>

<verification>
npx vitest run src/services/fileProcessor.test.ts
</verification>

<success_criteria>
0-byte files are rejected. Identical files are deduplicated. Decryption failures throw clean warning messages. Vitest suite passes.
</success_criteria>

<output>
Create .planning/phases/04-security-hardening/04-02-SUMMARY.md when done
</output>
