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
| **Framework** | vitest + playwright |
| **Config file** | vite.config.ts / playwright.config.ts |
| **Quick run command** | `npm run test` |
| **Full suite command** | `npm run test && npm run e2e` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test`
- **After every plan wave:** Run `npm run test && npm run e2e`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | SEC-02 | — | N/A | config | `npm run build` | ✅ W1 | ⬜ pending |
| 05-02-01 | 01 | 2 | PROD-01 | — | Verify Sentry is initialized with release/env and redacts PII | unit | `npx vitest run src/main.test.tsx` | ❌ W2 | ⬜ pending |
| 05-02-02 | 01 | 2 | PROD-01 | — | Route logger warnings/errors to Sentry breadcrumbs | unit | `npx vitest run src/lib/logger.test.ts` | ❌ W2 | ⬜ pending |
| 05-03-01 | 01 | 3 | PROD-06 | — | Tighten iframe sandbox and render warning notice banner | unit | `npx vitest run src/components/ArtifactRenderer.test.tsx` | ❌ W3 | ⬜ pending |
| 05-04-01 | 01 | 4 | BUG-06 | — | Ensure chat-proxy writes [DONE] sentinel on internal errors | unit | `npx vitest run supabase/functions/chat-proxy/` | ❌ W4 | ⬜ pending |
| 05-05-01 | 01 | 5 | PROD-05 | — | Playwright E2E tests for the 6 core flows pass successfully | E2E | `npm run e2e` | ❌ W5 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Manual verification in dev environment | VERIFY-01 / VERIFY-02 | Verify Sentry alerts trigger on dev/staging | Deploy to Supabase dev, force a credit billing exception, and check the Sentry console logs for user redactions. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending 2026-06-09
