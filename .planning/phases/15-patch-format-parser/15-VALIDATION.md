---
phase: 15
slug: patch-format-parser
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-16
---

# Phase 15 — Validation Strategy

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
| 15-01-01 | 01 | 1 | FR1, FR4 | — | N/A | unit | `npm run test` | ❌ W0 | ✅ green |
| 15-01-02 | 01 | 1 | FR1 | — | N/A | unit | `npm run test` | ❌ W0 | ✅ green |
| 15-01-03 | 01 | 1 | FR4 | — | N/A | unit | `npm run test` | ❌ W0 | ✅ green |
| 15-02-01 | 02 | 1 | FR1 | — | N/A | unit | `npm run test` | ❌ W0 | ✅ green |
| 15-02-02 | 02 | 1 | FR4 | — | N/A | unit | `npm run test` | ❌ W0 | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/lib/__tests__/artifactPatchParser.test.ts` — new unit tests for lenient git marker parsing
- [x] `src/lib/__tests__/artifactPatcher.test.ts` — new unit tests for HTML sanity check

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| N/A | FR1, FR4 | N/A | N/A |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
