---
phase: 4
slug: security-hardening
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-08
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + Playwright |
| **Config file** | `vite.config.ts` |
| **Quick run command** | `npx vitest run src/components/ArtifactRenderer.test.tsx src/services/fileProcessor.test.ts` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/components/ArtifactRenderer.test.tsx src/services/fileProcessor.test.ts`
- **After every plan wave:** Run `npm run test`
- **Before `/gsd-verify-work`:** Full suite must be green (Vitest & Playwright)
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | SEC-01 | T-04-01 | DOMPurify sanitizes raw SVG | unit | `npx vitest run src/components/ArtifactRenderer.test.tsx` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | BUG-07 | T-04-01 | Mermaid and iframe SVGs are sanitized | unit | `npx vitest run src/components/ArtifactRenderer.test.tsx` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | BUG-03 | — | Shows fallback card on malformed/empty HTML | unit | `npx vitest run src/components/ArtifactRenderer.test.tsx` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | SEC-05 | — | rejects 0-byte, dedups identical, error handling | unit | `npx vitest run src/services/fileProcessor.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 3 | SEC-03 | T-04-03 | Fired Sentry alert on local/getUserById drift | manual / log verify | Manual verification checklist in VERIFICATION.md | ✅ (N/A) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/components/ArtifactRenderer.test.tsx` — test suite stub covering DOMPurify configurations
- [ ] `src/services/fileProcessor.test.ts` — test suite stub covering 0-byte validation, hashing and password-protected files

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Forged JWT Alerting | SEC-03 | Relies on server-side edge function auth execution and Sentry integrations. | Tamper with JWT signature locally, send request to `/functions/v1/chat-proxy`, check server logs and Sentry dashboard for Captured Error message. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
