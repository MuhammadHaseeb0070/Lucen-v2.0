---
phase: 16
slug: dedicated-patch-system-prompt-sidecar-call
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-18
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | none |
| **Quick run command** | `npm run test` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test`
- **After every plan wave:** Run `npm run test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | FR1 | — | N/A | SQL | Manual / deploy check | ❌ W0 | ✅ green |
| 16-01-02 | 01 | 1 | FR1 | — | N/A | unit | `npm run test` | ❌ W0 | ✅ green |
| 16-01-03 | 01 | 1 | FR1 | — | N/A | integration | `npm run test` | ❌ W0 | ✅ green |
| 16-01-04 | 01 | 1 | FR2 | — | N/A | unit | `npm run test` | ❌ W0 | ✅ green |
| 16-01-05 | 01 | 1 | FR3 | — | N/A | integration | `npm run test` | ❌ W0 | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- None. Existing test suite covers standard system prompt configurations, database helpers, and client wrappers.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| local migration deployment | SQL Schema | Requires local postgres container | Apply SQL migration `supabase db reset` or via CLI, check schema contains `messages.is_patch` column. |
| UI Spinner & Indicator | UX | Visual validation | Ask AI to update an HTML/Mermaid artifact, verify spinner overlay animates over preview panel during patch execution. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
