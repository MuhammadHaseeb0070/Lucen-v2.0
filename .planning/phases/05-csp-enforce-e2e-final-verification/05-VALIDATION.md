---
phase: 5
slug: csp-enforce-e2e-final-verification
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-09
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (E2E) & Vitest (Unit) |
| **Config file** | `playwright.config.ts` & `vite.config.ts` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test && npm run e2e` |
| **Estimated runtime** | ~25 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test && npm run e2e`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | SEC-02 | — | Static CSP Report-Only configuration | static | `npm run build` | ✅ | ⬜ pending |
| 05-01-02 | 01 | 1 | PROD-01 | — | Sentry error monitoring & telemetry logs | unit | `npx vitest run src/lib/logger.test.ts` | ✅ | ⬜ pending |
| 05-01-03 | 01 | 1 | PROD-06 | — | Tightened sandbox with warning notice | unit | `npx vitest run src/components/ArtifactRenderer.test.tsx` | ✅ | ⬜ pending |
| 05-01-04 | 01 | 1 | BUG-06 | — | chat-proxy [DONE] sentinel on edge error | unit | `cd supabase/functions && deno test` | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 1 | PROD-05 | — | Playwright E2E tests for the 6 core flows | E2E | `npx playwright test tests/e2e/core.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/e2e/core.test.ts` — stubs/tests for core flows (sign-in, send message, attach file, run artifact, buy credits, view subscription)
- [ ] `supabase/functions/chat-proxy/streamHandler_test.ts` — test verifying [DONE] sentinel response on internal error

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CSP Report-Only Logging | SEC-02 | Vercel HTTP headers require deployment | Deploy to Vercel dev environment, open DevTools Console, verify `Content-Security-Policy-Report-Only` header is present and reports violations without blocking resources. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
