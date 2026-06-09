# Phase 5: CSP Enforce + E2E + Final Verification - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning

<domain>
## Phase Boundary

CSP headers are deployed and enforced, Sentry is fully wired with release versioning and environment configs, a comprehensive Playwright E2E test suite covers the core user flows, the iframe sandbox is tightened to scripts-only with a UX warning banner for unsupported capabilities, and final verification checks confirm no outstanding concerns.

</domain>

<decisions>
## Implementation Decisions

### Content Security Policy (CSP)
- **D-01 (Deployment Phase):** Deploy Content-Security-Policy headers in `vercel.json` in `Content-Security-Policy-Report-Only` first. Once the app runs in production for 1 week without blocking critical assets or throwing false positive errors, switch it to enforce mode.
- **D-02 (Static CSP without Nonces):** Since Lucen is a static single-page application built with Vite and hosted on Vercel, and we have no inline script blocks in the production `index.html`, do not use dynamic nonces. Use static SHA-256 hashes for any build-time inline scripts (if introduced) or strictly allow `'self'` and specific trusted hosts to avoid Vercel Edge Middleware runtime latency.
- **D-03 (Strict Domains Allowlist):** Only allow specific trusted external domains in the CSP headers: Supabase (database/auth APIs/websockets), OpenRouter (chat API), Sentry (telemetry), Tavily (web search API), Lemon Squeezy (checkouts), Google Fonts, and jsDelivr CDN (for static assets like Mermaid or Shiki).
- **D-04 (Deferred Violation Reporting):** Defer configuring the `report-uri` or `report-to` directives in the initial deployment to keep setup simple and minimize noise, since the developer can monitor console logs directly during Report-Only validation.

### Sentry Integration & Breadcrumbs
- **D-05 (Unified Logging Breadcrumbs):** Integrate Sentry breadcrumbs directly into the existing `src/lib/logger.ts` wrapper. Every call to `logger.info`, `logger.warn`, and `logger.error` will automatically call `Sentry.addBreadcrumb` to record navigation and execution state. This avoids importing Sentry in every store/component and keeps store code clean.
- **D-06 (Release Versioning via Vite Define):** Configure Sentry's `release` option dynamically in `src/main.tsx` by reading from a build-time constant (e.g. `import.meta.env.VITE_APP_VERSION` or `APP_VERSION` defined in `vite.config.ts` using `package.json` version).
- **D-07 (Detailed Billing Errors):** Capture the full exception and send it directly to Sentry using `Sentry.captureException` for any database or network failures during the credit deduction/billing phase.
- **D-08 (PII Redaction):** Redact all message prompt/response contents, email inputs, and user-identifiable metadata from events sent to Sentry. Only log metadata, tokens, cost calculations, and generic system errors.

### Playwright E2E Testing
- **D-09 (Network Layer Mocking):** Intercept and stub all backend API calls (Supabase Auth, edge functions like `/functions/v1/chat-proxy`, etc.) inside Playwright E2E tests using Playwright's native `page.route` interception. This allows the E2E test suite to run fully green on any keyless developer environment.
- **D-10 (UI Login Automation):** Automate the login tests by filling out the actual email, password, or OTP forms in the UI, matching it with mocked Supabase Auth responses, to assert validation states and input behaviors.
- **D-11 (Checkout Mocking):** Test the Lemon Squeezy payment flows by intercepting the checkout popup triggers and triggering the store's successful payment state callbacks, verifying that the credit balance UI updates correctly.
- **D-12 (Data Isolation):** Use mock users like `test-e2e@lucen.app` with predefined mock session payloads inside the intercepted routes to test all user roles (Free vs regular vs Pro/Admin).

### Iframe Sandbox & UX Notice
- **D-13 (Tightened Sandbox):** Tighten the iframe sandbox in `ArtifactRenderer.tsx` to `allow-scripts` only. Remove `allow-forms`, `allow-popups`, and `allow-modals`.
- **D-14 (UX Sandbox Notice):** When an HTML artifact is rendered, check the generated code for elements that require disallowed capabilities (such as `<form>` tags, `window.open`, `alert()`, or iframe/popup-based scripts). If detected, display a subtle warning banner in the preview header: "This artifact may contain interactive elements (forms, popups) that are disabled due to sandbox security."

### the agent's Discretion
- The exact styling, text, and positioning of the iframe sandbox UX warning notice.
- The precise configuration-based rate limits for each individual edge function.
- The specific playwright test directory and files names under `tests/e2e/`.

</decisions>

<canonical_refs>
## Canonical References

### Project Context
- `.planning/PROJECT.md` — Stabilization milestone core requirements.
- `.planning/REQUIREMENTS.md` — PROD-01, PROD-05, PROD-06, SEC-02, BUG-06.
- `.planning/ROADMAP.md` — Phase 5 goals and success criteria.
- `.planning/STATE.md` — Current milestone status.

### Codebase Analysis
- `vercel.json` — Vercel routing and header configurations.
- `playwright.config.ts` — Playwright execution configuration.
- `src/main.tsx` — App entry point and Sentry init.
- `src/lib/logger.ts` — Logger wrapper for console and Sentry integration.
- `src/components/ArtifactRenderer.tsx` — HTML artifact sandboxed rendering.
- `supabase/functions/chat-proxy/streamHandler.ts` — Chat stream handler.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/logger.ts` — Can be modified to call `Sentry.addBreadcrumb` automatically.
- `src/main.tsx` — Location for Sentry initialization and version config.
- `src/components/ArtifactRenderer.tsx` — Adjust the iframe `sandbox` attribute and render sandbox warning banner.
- `tests/e2e/smoke.test.ts` — Starting template for new E2E tests.

### Established Patterns
- Fetch interception via Playwright page.route.
- Environmental fallbacks (e.g. local-only stub user) in the stores.

### Integration Points
- `tests/e2e/` for all Playwright E2E tests.
- `vercel.json` headers section.

</code_context>

<specifics>
## Specific Ideas
- The Playwright tests should be stored under `tests/e2e/` and execute as part of `npm run e2e`.
- The sandbox UX banner should match the existing Lucen styling (subtle yellow/amber warning box).

</specifics>

<deferred>
## Deferred Ideas
- None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-csp-enforce-e2e-final-verification*
*Context gathered: 2026-06-09*
