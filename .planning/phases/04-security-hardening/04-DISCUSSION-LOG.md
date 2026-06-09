# Phase 4: Security Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-08
**Phase:** 4-Security Hardening
**Areas discussed:** SVG Sanitization Scope & Custom Rules, File Upload Deduplication & Error Handling, Empty/Malformed HTML Artifact Placeholder, Forged JWT Alerting & Sentry Severity

---

## SVG Sanitization Scope & Custom Rules

| Option | Description | Selected |
|--------|-------------|----------|
| Strict SVG Profile (USE_PROFILES: { svg: true }) | Strips all HTML/JS, including `<foreignObject>` and script tags, ensuring maximum security. | ✓ |
| Custom Profile | Allow custom CSS/styling variables and filters in SVG while strictly blocking scripts, iframes, and `<foreignObject>`. | |
| Direct import in ArtifactRenderer.tsx | Import DOMPurify from 'dompurify' directly in ArtifactRenderer.tsx and execute inline. | ✓ |
| Centralized Sanitizer Service | Create a reusable wrapper for DOMPurify so that other parts of the app can share the config. | |
| Sanitize Mermaid Output | Sanitize the SVG string returned by Mermaid rendering before inserting it into the DOM. | ✓ |
| Rely on Mermaid's strict mode | Trust Mermaid's internal 'strict' security level setting to prevent scripts in labels. | |
| Sanitize HTML/SVG inside iframe | Run DOMPurify on the entire HTML document before sending it to the sandbox iframe. | ✓ |
| Rely on iframe sandbox isolation | Trust the sandboxed iframe boundaries to safely execute any scripts without risk to host page. | |

**User's choice:** Selected strict profile, direct import, sanitize Mermaid output, and sanitize HTML/SVG inside iframe (recommended configuration options).
**Notes:** Decided to apply defense-in-depth sanitization across all rendering paths, regardless of Mermaid's internal security modes or the sandboxed iframe boundaries.

---

## File Upload Deduplication & Error Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Skip duplicate and warn | Skip the duplicate file from the processing list and return a warning notification to the user. | ✓ |
| Silent ignore / overwrite | Silently deduplicate without notifying the user. | |
| Web Crypto API SHA-256 | Use browser's native `crypto.subtle.digest` to calculate hex hash. | ✓ |
| External Hash Library | Install a hash library like md5 or sha256 from npm. | |
| Immediate 0-byte rejection | Reject 0-byte files immediately with an explicit warning. | ✓ |
| Allow empty files | Permit 0-byte uploads but don't parse/index them. | |
| Mark attachment with extraction error | Catch decryption/decoding errors and display custom error messages on the file card. | ✓ |
| Global error toast | Throw a global error notification and prevent all files from uploading. | |

**User's choice:** Skip duplicates with warning, use native Web Crypto API, immediate 0-byte rejection, and show file card error for encrypted docs.
**Notes:** Surfacing specific, helpful file extraction errors (such as password protection) directly on the attachment cards provides a better user experience than generic or global errors.

---

## Empty/Malformed HTML Artifact Placeholder

| Option | Description | Selected |
|--------|-------------|----------|
| Validate content & structure | Verify that the trimmed HTML code contains a `<body>` or other structural tags and readable content. | ✓ |
| Simple non-empty check | Verify only that the trimmed code is not empty. | |
| Inline error card with switcher | Display a styled error box inside the preview pane with a button to switch to Code view. | ✓ |
| Fallback directly to Code view | Automatically switch the viewMode tab from Preview to Code. | |
| Validate only on stream end | Do not show the malformed/empty placeholder while streaming is in progress. | ✓ |
| Real-time validation during stream | Show error placeholder immediately if the partial stream is invalid. | |
| Tighten sandbox to allow-scripts | Remove allow-forms, allow-popups, allow-modals sandbox attributes. | ✓ |
| Keep existing loose sandbox | Retain the broad iframe sandbox config. | |

**User's choice:** Validate content & structure, display inline error card with switcher, validate only on stream end, and tighten sandbox attributes.
**Notes:** Validating after streaming completes prevents flashing error states for partially loaded tags. Tightening sandbox attributes implements strict production-grade sandboxing.

---

## Forged JWT Alerting & Sentry Severity

| Option | Description | Selected |
|--------|-------------|----------|
| Severity: Critical / Error | Log forged JWT signatures as error/critical in Sentry. | ✓ |
| Severity: Warning | Classify as a simple security warning. | |
| Decoupled Deno Sentry alerts | Import @sentry/deno and capture messages directly in auth.ts. | ✓ |
| Forward error to frontend | Forward the signature error to the client and let the client log to Sentry. | |
| Redact Authorization token | Include metadata (correlation ID, path, userID sub) but strictly redact the authorization token. | ✓ |
| Log raw request | Capture the entire raw request headers/payload. | |
| Terminate stream on expiry | Abruptly stop the stream and return a 401 error. | ✓ |
| Graceful finish then reject | Allow stream to complete but prevent credit deductions/next prompts. | |

**User's choice:** Critical severity, Deno-side capture, redact token from metadata, and terminate stream immediately on mid-stream expiry.
**Notes:** Forged JWT attempts represent active threat vectors and warrant high Sentry alert severity.

---

## the agent's Discretion
- The exact layout, coloring, and icon of the malformed HTML placeholder.
- The precise regex patterns for matching PDF password exceptions and Word extraction errors.
- The visual styling of the duplicate file warning toast.

## Deferred Ideas
- None — all topics fell within the current stabilization milestone scope.

---

*Phase: 04-security-hardening*
*Discussion log generated: 2026-06-08*
