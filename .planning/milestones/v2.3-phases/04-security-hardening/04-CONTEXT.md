# Phase 4: Security Hardening - Context

**Gathered:** 2026-06-08
**Status:** Ready for planning

<domain>
## Phase Boundary

SVG sanitization is bulletproof via DOMPurify, CSP is configured in Report-Only mode, Sentry alerts are wired for forged-JWT signals, file uploads are validated for size/duplication/encryption, and empty/malformed HTML artifacts display an informative placeholder.

</domain>

<decisions>
## Implementation Decisions

### SVG Sanitization Scope & Custom Rules
- **D-01 (Strict SVG Profile):** Replace custom regex sanitization in `ArtifactRenderer.tsx` with DOMPurify using `USE_PROFILES: { svg: true }`. This strictly strips all HTML/JS, including `<script>` and `<foreignObject>` tags.
- **D-02 (Direct Import in ArtifactRenderer):** Import `DOMPurify` from `dompurify` directly in `ArtifactRenderer.tsx` and execute inline to avoid unnecessary service abstractions.
- **D-03 (Mermaid Sanitization):** Sanitize Mermaid SVG output with DOMPurify before rendering it via `SafeHtml` to provide a layer of defense-in-depth on top of Mermaid's strict security mode.
- **D-04 (HTML Iframe Sanitization):** Sanitize the full HTML document with DOMPurify (allowing standard HTML profiles and inline SVG elements) before rendering it inside the sandboxed iframe in `HtmlRenderer`.

### File Upload Deduplication & Error Handling
- **D-05 (Deduplication Handling):** Calculate SHA-256 hash of file content using the browser's native Web Crypto API `crypto.subtle.digest('SHA-256', buffer)`. If a duplicate hash is detected, skip the duplicate upload and alert the user via a frontend warning notification.
- **D-06 (0-Byte File Rejection):** Reject 0-byte file uploads immediately during pre-flight checks with a clear, user-friendly error: "File [name] is empty (0 bytes) and cannot be processed."
- **D-07 (Encrypted/Protected File Handling):** Catch decryption exceptions in `fileProcessor.ts` (such as PDF password protection or Word document encryption), marking the file attachment status as error and surfacing a custom error message on the file card.

### Empty/Malformed HTML Artifact Placeholder
- **D-08 (HTML Validation Criteria):** Validate that HTML artifacts have non-empty content and contain a structure (such as `<body>`) before injecting into `srcdoc`.
- **D-09 (Empty/Malformed Placeholder UI):** Display a styled inline error card ("This HTML artifact is empty or malformed") with a button to switch to the "Code" view instead of rendering empty whitespace.
- **D-10 (Streaming Behavior):** Do not show the malformed/empty placeholder while streaming is in progress. Only apply validation and show the placeholder once streaming terminates.
- **D-11 (Sandbox Restrictions):** Tighten the iframe sandbox to `allow-scripts` only (removing `allow-forms`, `allow-popups`, `allow-popups-to-escape-sandbox`, `allow-modals`), and notify the user if their generated artifact relies on these disallowed features.

### Forged JWT Alerting & Sentry Severity
- **D-12 (Alert Severity):** Set severity level to Critical/Error in Sentry for any forged JWT signal (where decode succeeds locally but user signature validation fails).
- **D-13 (Decoupled Sentry Alerts):** Import `@sentry/deno` in `supabase/functions/chat-proxy/auth.ts` and capture a Sentry message/event with details.
- **D-14 (Redacted Metadata):** Include correlation ID, endpoint, request headers (redacted of Authorization bearer token), and decoded User ID (`sub`) claim in the Sentry event payload.
- **D-15 (Mid-stream JWT expiry):** Terminate the stream with a clear 401 error and log to Sentry if the JWT token expires during a live streaming session.

### the agent's Discretion
- The exact CSS styling of the "empty/malformed artifact" placeholder.
- The precise regex patterns used to match password-protection errors in mammoth/docx/pdfjs.
- The visual styling of the duplicate file warning toast/notification.

</decisions>

<specifics>
## Specific Ideas
- The duplicate warning toast should reuse the existing alert system style.
- When an HTML preview fails or is empty, the placeholder should look like a standard system card with an icon like `AlertTriangle` or `RotateCcw` to prompt a retry/re-generation.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core value, constraints, key decisions for the stabilization milestone.
- `.planning/REQUIREMENTS.md` — SEC-01, SEC-03, SEC-05, BUG-03, BUG-07: exact security requirements.
- `.planning/ROADMAP.md` — Phase 4 goal, success criteria, requirement mapping.
- `.planning/STATE.md` — Current project status.

### Codebase Analysis
- `.planning/codebase/CONCERNS.md` — Known security vulnerabilities and bug triggers.
- `.planning/codebase/ARCHITECTURE.md` — System architecture and component interactions.
- `.planning/codebase/STACK.md` — Tech stack: dependencies, versions, and build commands.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/ArtifactRenderer.tsx` — Handles iframe rendering, SVG processing, and Mermaid diagrams.
- `src/services/fileProcessor.ts` — Handles document text extraction, size verification, and base64 encoding.
- `supabase/functions/chat-proxy/auth.ts` — Local JWT payload decode and admin client session verification.

### Established Patterns
- DOMPurify is used as the single sanitization entry point for SVG and HTML inputs.
- Iframe isolation sandboxing (`allow-scripts` only) guards execution context.
- Try/catch blocks in extraction functions capture file-related parser errors.

### Integration Points
- `src/components/ArtifactRenderer.tsx` — SvgRenderer, HtmlRenderer, MermaidRenderer, SafeHtml.
- `src/services/fileProcessor.ts` — processFiles, processFile, extractPdfText, extractDocxText.
- `supabase/functions/chat-proxy/auth.ts` — handleAuthAndRateLimit.

</code_context>

<deferred>
## Deferred Ideas
- None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-security-hardening*
*Context gathered: 2026-06-08*
