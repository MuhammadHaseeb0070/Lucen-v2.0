# Phase 5: CSP Enforce + E2E + Final Verification - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-09
**Phase:** 05-CSP Enforce + E2E + Final Verification
**Areas discussed:** CSP deployment strategy, Sentry integration & breadcrumbs, Playwright E2E mocking, Iframe sandbox UI/UX notice

---

## CSP deployment strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Report-Only in vercel.json first | Configure CSP headers as Report-Only for a week to catch violations before enforcing. | ✓ |
| Enforce immediately | Run in full blocking mode from day one. | |

**User's choice:** Report-Only in vercel.json first.
**Notes:** Helps log violations on dev/staging without breaking the app before promoting.

## Nonce generation approach

| Option | Description | Selected |
|--------|-------------|----------|
| Static CSP without nonces | Rely on static CSP because there are no inline scripts. | ✓ |
| Vercel Edge Middleware | Dynamically generate nonces per request, requiring middleware runtime. | |

**User's choice:** Static CSP without nonces.
**Notes:** Ensures max performance and avoids unnecessary middleware overhead since the production index.html has no inline scripts.

## External domains allowlist

| Option | Description | Selected |
|--------|-------------|----------|
| Strict minimal list | Allow only verified domains (Supabase, OpenRouter, Tavily, Sentry, Lemon Squeezy, Google Fonts, jsDelivr). | ✓ |
| Relaxed wildcard matching | Allow loose domain matching (e.g. *.supabase.co). | |

**User's choice:** Strict minimal list.
**Notes:** Follows least privilege principle.

## CSP reporting endpoint

| Option | Description | Selected |
|--------|-------------|----------|
| Defer reporting | No report-uri header in the initial v1. | ✓ |
| Send directly to Sentry | Use Sentry's report-uri or report-to endpoint. | |

**User's choice:** Defer reporting.
**Notes:** Keeps the initial setup simple.

## Sentry breadcrumbs collection

| Option | Description | Selected |
|--------|-------------|----------|
| Unified logging integration | Integrate Sentry breadcrumbs directly into the unified `src/lib/logger.ts`. | ✓ |
| Manual store wiring | Explicitly add Sentry.addBreadcrumb calls in individual stores. | |

**User's choice:** Unified logging integration.
**Notes:** Avoids duplicate boilerplate, keeping stores clean.

## Sentry release versioning

| Option | Description | Selected |
|--------|-------------|----------|
| Read from package.json version via Vite define | Injected at build time, e.g. `lucen@0.0.0`. | ✓ |
| Read from Vercel Git Commit SHA | Uses git SHA environment variables. | |

**User's choice:** Read from package.json version via Vite define.
**Notes:** Standard and clean version-tracking.

## Telemetry for billing errors

| Option | Description | Selected |
|--------|-------------|----------|
| Capture exception and send to Sentry | Sends a full error event to Sentry. | ✓ |
| Log warning breadcrumbs only | Keeps transaction logs quiet. | |

**User's choice:** Capture exception and send to Sentry.
**Notes:** Essential for monitoring finance-critical failures.

## PII redaction in telemetry

| Option | Description | Selected |
|--------|-------------|----------|
| Redact all message content and user data | Zero PII in Sentry events: redact prompts/responses. | ✓ |
| Standard masking | Uses Sentry's default DOM masking. | |

**User's choice:** Redact all message content and user data.
**Notes:** Prevents customer inputs from leaking into telemetry.

## E2E Mocking strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Playwright page.route interception | Intercept API and Edge Function requests directly in tests. | ✓ |
| Mock Service Worker (MSW) | Wires MSW into the main application. | |

**User's choice:** Playwright page.route interception.
**Notes:** Fast, reliable, needs no external services or local keys to run.

## E2E Login strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Automate UI interaction | Fill out the actual login forms and mock responses. | ✓ |
| Direct store/localStorage injection | Set logged-in state in Zustand/localStorage. | |

**User's choice:** Automate UI interaction.
**Notes:** Tests the actual form inputs and states.

## Lemon Squeezy checkout testing

| Option | Description | Selected |
|--------|-------------|----------|
| Intercept checkout window & mock purchase response | Intercept trigger and call success state callbacks. | ✓ |
| Load Lemon Squeezy sandbox pages | Load and interact with external checkout forms. | |

**User's choice:** Intercept checkout window & mock purchase response.
**Notes:** Prevents dependency on external staging/sandbox server availability.

---

## the agent's Discretion
- The exact styling, text, and positioning of the iframe sandbox UX warning notice.
- The precise configuration-based rate limits for each individual edge function.
- The specific playwright test directory and files names under `tests/e2e/`.

## Deferred Ideas
- None.
