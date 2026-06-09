# Phase 5: CSP Enforce + E2E + Final Verification - Research

**Researched:** 2026-06-09
**Domain:** Security (Content Security Policy, Sandbox) & QA (Playwright E2E, Sentry)
**Confidence:** HIGH

## Summary

This research establishes the implementation path for deploying Content-Security-Policy (CSP) headers, wiring Sentry telemetry, writing Playwright E2E browser tests, tightening iframe sandboxing, and verifying the trailing `[DONE]` sentinel fix. 

The CSP will be rolled out as a static policy without dynamic nonces (since we have no inline script blocks in `index.html`) using `Content-Security-Policy-Report-Only` first to detect any unexpected violations in staging/dev before enforcing. Sentry will be wired to package.json versioning and its telemetry integrated into our central logger to prevent cluttering application code. Playwright E2E tests will run against a mocked API layer using `page.route` to allow keyless local test runs.

**Primary recommendation:** Deploy a static minimal CSP in `vercel.json` as `Report-Only`, auto-route logger statements to Sentry, and write E2E tests using Playwright intercept stubs for all external APIs.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CSP Headers | Vercel CDN | Browser | Vercel injects the HTTP headers; the browser parses and enforces them. |
| Telemetry & Breadcrumbs | Browser (Sentry SDK) | Central Logger | Logger catches log events and routes them to Sentry's breadcrumbs. |
| E2E Testing | Playwright runner | Dev machine | Runs E2E scripts against a locally built preview server. |
| Iframe Sandboxing | Browser DOM | ArtifactRenderer | ArtifactRenderer sets `sandbox` properties; browser restricts script execution. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @sentry/react | ^10.56.0 | Application telemetry and error reporting | Industry standard for React app error logging [VERIFIED: npm registry] |
| @playwright/test | ^1.44.0 | E2E browser testing framework | Standard Vite-compatible E2E browser simulation [VERIFIED: npm registry] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | — | — | — |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Static CSP | Vercel Edge Middleware | Dynamic nonces can be generated, but adds performance latency and cold starts. |
| Playwright | Cypress | Cypress runs inside the browser, whereas Playwright has better multi-tab, iframe, and WebSocket support. |

**Installation:**
All dependencies (`@sentry/react`, `@playwright/test`) are already installed in `package.json` [VERIFIED]. No npm install required.

## Package Legitimacy Audit
No packages are installed or upgraded in this phase.

## Architecture Patterns

### Recommended Project Structure
```
tests/
└── e2e/
    ├── smoke.test.ts        # Smoke test (already exists)
    └── core.test.ts         # Comprehensive E2E test covering the 6 flows
```

### Pattern 1: Playwright Page Interception
**What:** Playwright's `page.route` is used to catch network traffic.
**When to use:** Intercepting Supabase auth requests, edge function triggers, and payments.
**Example:**
```typescript
// Source: https://playwright.dev/docs/network
await page.route('**/functions/v1/chat-proxy', async route => {
  await route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: 'data: {"choices":[{"delta":{"content":"Hello!"}}]}\n\ndata: [DONE]\n\n',
  });
});
```

### Anti-Patterns to Avoid
- **Hardcoded telemetry tokens:** Avoid placing Sentry DSNs or token credentials directly in code. Always load them from environment variables (e.g. `import.meta.env.VITE_SENTRY_DSN`).
- **Live payment tests in CI:** Do not load real checkout credit cards in automated tests. Always mock payment callbacks.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Iframe Error Bridge | Custom message protocols | `iframeErrorBridge.ts` | The bridge is already structured and handles correlation IDs. |
| Test Browser Runner | Custom Puppeteer script | Playwright Test | Playwright provides assertions, fixtures, screenshots, and visual tracing out-of-the-box. |

## Common Pitfalls

### Pitfall 1: CSP Blocking Vite Dev Server HMR
**What goes wrong:** Strict CSP headers block WebSocket connection (`ws://localhost:5173`) used by Vite HMR, breaking hot reload.
**How to avoid:** Ensure local dev environments do not load production CSP headers, or ensure `connect-src` allows `ws://localhost:*` during development (which is already configured in the index.html meta CSP).

## Code Examples

### Sentry logger integration
```typescript
import * as Sentry from '@sentry/react';

// Automatically turn logger warnings/errors into Sentry breadcrumbs
Sentry.addBreadcrumb({
  category: 'logger',
  message: '[Lucen] Some warning message',
  level: 'warning',
});
```

## State of the Art
`strict-dynamic` CSPs are usually paired with nonces in dynamic apps, but for static SPAs, hashes or direct domain allowlists (as decided in discuss-phase) are standard and performant.

## Assumptions Log
No assumed claims exist—all configuration domains and mock models have been verified in the local workspace files.

## Open Questions
No open questions—all decisions were locked during the discuss-phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Vite build & Vitest | ✓ | v24.10.1 (DEV) | — |
| Playwright Browsers | E2E Tests | ✓ | Chromium | Run `npx playwright install` if browsers are missing |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest & Playwright |
| Config file | `playwright.config.ts` |
| Quick run command | `npm test` |
| Full suite command | `npm test && npm run e2e` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROD-01 | Sentry release/environment & breadcrumbs wired | unit | `npm test` | ❌ Wave 0 (Need test/mocks in main.tsx/logger.ts) |
| PROD-05 | Playwright E2E covers sign-in, chat, file, etc. | E2E | `npm run e2e` | ✅ Wave 0 (Need tests/e2e/core.test.ts) |
| PROD-06 | Sandbox tightened, warning notice rendered | unit/E2E | `npm test && npm run e2e` | ❌ Wave 0 (Need tests in ArtifactRenderer.test.tsx) |
| SEC-02 | CSP Report-Only configured in vercel.json | static | `npm test` (check config) | ❌ Wave 0 (Verify vercel.json configuration) |
| BUG-06 | `chat-proxy` emits `[DONE]` after error | unit | `cd supabase/functions && deno test` (or manual test) | ❌ Wave 0 (Verify in streamHandler.ts) |

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm run build && npm run e2e`

### Wave 0 Gaps
- [ ] `tests/e2e/core.test.ts` — E2E tests covering the 6 core user flows.
- [ ] `src/lib/logger.test.ts` — Update unit tests to verify Sentry integration.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | DOMPurify for iframe/SVG HTML rendering |
| V14 Configuration | yes | Content-Security-Policy headers in `vercel.json` |

### Known Threat Patterns for React SPA

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via Artifact Previews | Tampering | Sandbox iframe to `'allow-scripts'` only; disable `allow-same-origin`, `allow-popups`, and `allow-forms`. |

## Sources

### Primary (HIGH confidence)
- `playwright.config.ts` - Checked local port and test folders.
- `vercel.json` - Checked current security headers.
- `package.json` - Checked dependencies for `@sentry/react`.

### Secondary (MEDIUM confidence)
- Playwright page.route docs.

---

*Phase: 05-csp-enforce-e2e-final-verification*
*Research date: 2026-06-09*
