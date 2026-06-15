# Phase 5: CSP Enforce + E2E + Final Verification - Research

**Researched:** 2026-06-09
**Domain:** Security Headers (Content-Security-Policy), Error Telemetry (Sentry), Browser E2E Automation (Playwright), Iframe Isolation (Sandbox)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 (Deployment Phase):** Deploy Content-Security-Policy headers in `vercel.json` in `Content-Security-Policy-Report-Only` first. Once the app runs in production for 1 week without blocking critical assets or throwing false positive errors, switch it to enforce mode.
- **D-02 (Static CSP):** Since Lucen is a static single-page application built with Vite and hosted on Vercel, and we have no inline script blocks in the production `index.html`, do not use dynamic nonces. Use static SHA-256 hashes for any build-time inline scripts (if introduced) or strictly allow `'self'` and specific trusted hosts to avoid Vercel Edge Middleware runtime latency.
- **D-03 (Strict Domains Allowlist):** Only allow specific trusted external domains in the CSP headers: Supabase (database/auth APIs/websockets), OpenRouter (chat API), Sentry (telemetry), Tavily (web search API), Lemon Squeezy (checkouts), Google Fonts, and jsDelivr CDN (for static assets like Mermaid or Shiki).
- **D-04 (Deferred Violation Reporting):** Defer configuring the `report-uri` or `report-to` directives in the initial deployment to keep setup simple and minimize noise, since the developer can monitor console logs directly during Report-Only validation.
- **D-05 (Unified Logging Breadcrumbs):** Integrate Sentry breadcrumbs directly into the existing `src/lib/logger.ts` wrapper. Every call to `logger.info`, `logger.warn`, and `logger.error` will automatically call `Sentry.addBreadcrumb` to record navigation and execution state.
- **D-06 (Release Versioning via Vite Define):** Configure Sentry's `release` option dynamically in `src/main.tsx` by reading from a build-time constant (`APP_VERSION` injected in `vite.config.ts` using `package.json` version).
- **D-07 (Detailed Billing Errors):** Capture the full exception and send it directly to Sentry using `Sentry.captureException` for any database or network failures during the credit deduction/billing phase.
- **D-08 (PII Redaction):** Redact all message prompt/response contents, email inputs, and user-identifiable metadata from events sent to Sentry. Only log metadata, tokens, cost calculations, and generic system errors.
- **D-09 (Network Layer Mocking):** Intercept and stub all backend API calls (Supabase Auth, edge functions like `/functions/v1/chat-proxy`, etc.) inside Playwright E2E tests using Playwright's native `page.route` interception.
- **D-10 (UI Login Automation):** Automate the login tests by filling out the actual email, password, or OTP forms in the UI, matching it with mocked Supabase Auth responses, to assert validation states and input behaviors.
- **D-11 (Checkout Mocking):** Test the Lemon Squeezy payment flows by intercepting the checkout popup triggers and triggering the store's successful payment state callbacks, verifying that the credit balance UI updates correctly.
- **D-12 (Data Isolation):** Use mock users like `test-e2e@lucen.app` with predefined mock session payloads inside the intercepted routes to test all user roles (Free vs regular vs Pro/Admin).
- **D-13 (Tightened Sandbox):** Tighten the iframe sandbox in `ArtifactRenderer.tsx` to `allow-scripts` only. Remove `allow-forms`, `allow-popups`, and `allow-modals`.
- **D-14 (UX Sandbox Notice):** When an HTML artifact is rendered, check the generated code for elements that require disallowed capabilities (such as `<form>` tags, `window.open`, `alert()`, or iframe/popup-based scripts). If detected, display a subtle warning banner in the preview header: "This artifact may contain interactive elements (forms, popups) that are disabled due to sandbox security."

### the agent's Discretion
- The exact styling, text, and positioning of the iframe sandbox UX warning notice.
- The precise configuration-based rate limits for each individual edge function.
- The specific playwright test directory and files names under `tests/e2e/`.

### Deferred Ideas
- None — discussion stayed within phase scope.
</user_constraints>

<architectural_responsibility_map>
## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Content-Security-Policy | Vercel CDN | — | Served via static headers in `vercel.json` for all frontend requests |
| Sentry Error Telemetry | Browser/Client | — | Initialized and tracked on the frontend SPA; integrated into logger.ts |
| Playwright E2E Tests | Browser/Client | Local mock API | Automates chromium browser against a mock network layer in node env |
| Sandbox warning notice | Browser/Client | — | React UI layer check inside ArtifactRenderer |
| [DONE] Sentinel bug fix | API/Backend | — | Handled in chat-proxy Edge Function to terminate SSE streams on error |
</architectural_responsibility_map>

<research_summary>
## Summary

Researched the standard structure of CSP headers in `vercel.json`, Sentry SDK integration, Playwright's network routing API, and iframe sandbox limitations.

1. **CSP Setup:** Vite SPA hosted on Vercel is completely static, so dynamic server-side nonces are not feasible without Edge Middleware. Since we have no inline script blocks in `index.html`, a static CSP served via `vercel.json` is optimal. It should restrict script-src to `'self'` and safe script CDNs (jsDelivr), restrict connect-src to Supabase, OpenRouter, Tavily, and Sentry, and restrict style-src to `'self'` and inline styles (which React 19 uses for styled-components/dynamic themes).
2. **Sentry integration:** In Vite, Sentry can detect build-time release tags using Vite's `define` configuration. In `src/lib/logger.ts`, we can map warn and error levels to `Sentry.addBreadcrumb` using Sentry's client SDK. Billing errors caught in database edge handlers or client transaction methods will trigger `Sentry.captureException` with user details redacted.
3. **Playwright Interception:** Playwright provides `page.route()` to intercept all AJAX and fetch requests. We can intercept auth requests and simulate OTP/password flows. We will mock `/functions/v1/chat-proxy` returning chunks of SSE events (`text/event-stream`), verifying the frontend parses streaming chunks and renders artifacts correctly.
4. **Sandbox and Warning Banner:** Tightening the sandbox is as simple as setting `sandbox="allow-scripts"` on the preview iframe. To warn users of interactive features disabled by the sandbox, we will run a light regex check on the preview content inside a React `useMemo` block (looking for `<form>`, `<input>`, `window.open`) and conditionally render an warning banner.
5. **[DONE] Sentinel Bug Fix:** The chat-proxy's `streamHandler.ts` must catch all internal exceptions and write `data: [DONE]\n\n` prior to closing the write stream controller so the client's `processStream` parser cleanly terminates instead of hanging in a loading loop. (The codebase has this partially configured, so we will verify and cover it with integration test logic).

**Primary recommendation:** Define CSP in `vercel.json` under `Content-Security-Policy-Report-Only`, initialize Sentry with defined versions in `main.tsx`, extend `logger.ts` with breadcrumbs, implement custom HTML tags verification in `ArtifactRenderer.tsx` for the sandbox warning banner, and add Playwright E2E tests in `tests/e2e/core.test.ts`.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @sentry/react | ^10.56.0 | Error telemetry | Industry standard for React performance and error tracking |
| @playwright/test | ^1.44.0 | E2E test runner | Standard test runner for modern web applications |
| dompurify | ^3.4.8 | HTML/SVG sanitization | Fast and standard sanitization engine for frontends |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Static CSP | Vercel Edge Middleware | Middleware adds dynamic nonce injection capability but introduces extra execution time and cold starts on static assets. |
| Playwright route mocking | Mock Service Worker (MSW) | MSW is loaded in-browser and requires service worker configurations which can conflict with development bundling. Playwright `page.route` operates out-of-process and is simpler to maintain. |
</standard_stack>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Playwright mock stream | Custom network stub server | `page.route()` with chunked writes | Native Playwright route APIs can fulfill responses with chunked data directly, keeping tests self-contained |
| Event monitoring | Custom error reporting system | Sentry SDK | Sentry automatically handles breadcrumb sorting, environment mapping, and browser stack-trace mapping |
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: CSP Blocking Vite HMR in Dev Mode
**What goes wrong:** Adding strict CSP headers in local dev blocks hot-reload websockets (`ws://localhost:*`) or script loading.
**Why it happens:** Local dev HMR uses dynamic eval and script injections.
**How to avoid:** Only apply strict CSP headers on the production Vercel deployment (`vercel.json`) and leave development config relaxed.

### Pitfall 2: Sentry Breadcrumbs Flooding
**What goes wrong:** Recording too many verbose console logs as Sentry breadcrumbs hits limit thresholds and drops important events.
**Why it happens:** Setting logger levels to capture all logs including verbose debug items.
**How to avoid:** Only append breadcrumbs for log levels equal to or higher than `info` (i.e. `info`, `warn`, `error`).

### Pitfall 3: Playwright Mock Stream EOF
**What goes wrong:** Playwright routes that mock streams finish immediately without simulating time delays, which causes the frontend to skip streaming UI states.
**Why it happens:** Writing the entire mock SSE stream content to the route at once.
**How to avoid:** Use custom chunked writes or delays in `page.route` callbacks to simulate live streaming behavior.
</common_pitfalls>

<code_examples>
## Code Examples

### 1. `vercel.json` CSP Configuration (Report-Only)
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy-Report-Only",
          "value": "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; img-src 'self' data: blob: https://*.supabase.co https://*.supabase.in https://openrouter.ai; font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; connect-src 'self' https://*.supabase.co https://*.supabase.in https://openrouter.ai https://api.tavily.com wss://*.supabase.co wss://*.supabase.in https://*.ingest.sentry.io; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self';"
        }
      ]
    }
  ]
}
```

### 2. Sentry Integration in `src/lib/logger.ts`
```typescript
import * as Sentry from '@sentry/react';

function recordSentryBreadcrumb(level: 'info' | 'warning' | 'error', message: string, data?: any) {
  try {
    Sentry.addBreadcrumb({
      category: 'app.logger',
      message: message,
      level: level,
      data: data,
    });
  } catch (err) {
    // Sentry not initialized or failed
  }
}
```

### 3. Playwright E2E Chat Stream Interception
```typescript
await page.route('**/functions/v1/chat-proxy', async (route) => {
  const responseHeaders = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  };
  
  await route.fulfill({
    status: 200,
    headers: responseHeaders,
    body: 'event: content_start\ndata: {"after_tool_calls":false,"model":"minimax/minimax-01"}\n\n' +
          'data: {"choices":[{"delta":{"content":"Hello world!"}}]}\n\n' +
          'data: [DONE]\n\n'
  });
});
```

### 4. Artifact sandbox notice check inside `HtmlRenderer`
```typescript
const showSandboxNotice = useMemo(() => {
  if (isStreaming) return false;
  const lower = previewContent.toLowerCase();
  return (
    lower.includes('<form') ||
    lower.includes('<input') ||
    lower.includes('<textarea') ||
    lower.includes('window.open') ||
    lower.includes('alert(')
  );
}, [previewContent, isStreaming]);
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CSP with 'unsafe-inline' scripts | Static hashes or strictly external bundles | 2024+ | Drastically reduces XSS exploit surface on static single-page deployments |
| MSW in browser tests | Playwright `page.route` mocks | 2023+ | Keeps test configurations clean, avoids compiling dev-only workers into production packages |
</sota_updates>

<open_questions>
## Open Questions
- **Sentry DSN format validation:** We must ensure the DSN environment parsing doesn't crash the frontend if the variable is blank, and that the CSP `connect-src` supports the host pattern correctly.
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- Vercel Headers Configuration (https://vercel.com/docs/projects/project-configuration#headers)
- MDN CSP Guide (https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- Playwright page.route reference (https://playwright.dev/docs/api/class-page#page-route)

### Secondary (MEDIUM confidence)
- Sentry React SDK custom instrumentation guidelines (https://docs.sentry.io/platforms/javascript/guides/react/)
</sources>

<metadata>
- Target: Phase 5 Planning
- Confidence: HIGH
- Timestamp: 2026-06-09
</metadata>

---

*Phase: 05-csp-enforce-e2e-final-verification*
*Research completed: 2026-06-09*
*Ready for planning: yes*
## RESEARCH COMPLETE
