---
phase: 1
slug: foundation-finance-critical-fixes
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-08
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + playwright |
| **Config file** | vite.config.ts (Vitest) / playwright.config.ts (Playwright) |
| **Quick run command** | `npm run test` |
| **Full suite command** | `npm run test && npm run e2e` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test`
- **After every plan wave:** Run `npm run test && npm run e2e`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | TEST-01 | — | N/A | config | `npm run test` | ✅ W1 | ⬜ pending |
| 01-01-02 | 01 | 1 | TEST-02 | — | N/A | config | `npm run e2e` | ✅ W1 | ⬜ pending |
| 01-01-03 | 01 | 1 | TEST-03 | — | N/A | config | `npm run test` | ✅ W1 | ⬜ pending |
| 01-01-04 | 01 | 1 | TD-06 | — | N/A | compiler | `npm run build` | ✅ W1 | ⬜ pending |
| 01-02-01 | 01 | 2 | BUG-05 | — | Ensure finishReason is always assigned and Sentry breadcrumb is added | unit | `npx vitest run src/lib/billing.test.ts` | ❌ W2 | ⬜ pending |
| 01-02-02 | 01 | 2 | SEC-06 | — | Ensure token refreshes mid-stream and rejects with 401 on expiry | unit | `npx vitest run src/lib/auth.test.ts` | ❌ W2 | ⬜ pending |
| 01-03-01 | 01 | 3 | TEST-04 | — | N/A | unit | `npx vitest run src/lib/artifactParser.test.ts src/lib/logger.test.ts src/lib/iframeErrorBridge.test.ts` | ❌ W3 | ⬜ pending |
| 01-03-02 | 01 | 3 | TEST-05 / BUG-08 | — | Verify Mermaid securityLevel strict config | unit | `npx vitest run src/lib/mermaid.test.ts` | ❌ W3 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Manual verification in dev environment | VERIFY-01 / VERIFY-02 | Verifying actual deployed edge function integration | Deploy to Supabase dev, execute chat streaming, check user balance mutations and Sentry logs. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending 2026-06-08
