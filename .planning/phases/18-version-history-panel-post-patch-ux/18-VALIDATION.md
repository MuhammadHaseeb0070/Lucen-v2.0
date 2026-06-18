---
phase: 18
slug: version-history-panel-post-patch-ux
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-18
---

# Phase 18 — Validation Strategy

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

- **After every task commit:** Run manual check on layout/database states
- **After every plan wave:** Run `npm run test` to check for test suite regressions
- **Before `/gsd-verify-work`:** Full unit tests must be green, and manual checks verified

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | FR5.1 | — | N/A | SQL | Manual db version row check | ❌ W0 | ✅ green |
| 18-01-02 | 01 | 1 | FR5.5 | — | N/A | unit | `npm run test` / pointer check | ❌ W0 | ✅ green |
| 18-01-03 | 01 | 1 | FR5.4 | — | N/A | manual | Collapsible drawer UI check | ❌ W0 | ✅ green |
| 18-01-04 | 01 | 1 | FR6.1 | — | N/A | manual | Toast visual check & revert | ❌ W0 | ✅ green |
| 18-01-05 | 01 | 1 | FR5.4 | — | N/A | integration | Resizing and layout toggle check | ❌ W0 | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- None. Existing test suite covers stores, parsers, and database interactions.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DB version inserts | FR5.1 | Database mapping | Edit an artifact twice. Check that `artifacts` table has three rows (V1, V2, V3) with correct `parent_id` and `version_no`. |
| History panel list and preview | FR5.4 | UI layout | Open the history drawer. Verify versions display description and timestamp. Click on V1 to preview its content in the renderer pane. |
| Reverts and deletion chain | FR5.5 | Database pointers | Delete V2. Check that V3's parent pointer updates to point to V1. Delete V3 (HEAD) and verify that V1 becomes the active HEAD version in the DB and UI. |
| Toast feedback and revert | FR6.1 | Visual state | Apply a patch. Verify the toast appears. Click Thumbs Down (revert) and confirm the change reverts immediately, restoring previous version content. |

---

## Validation Sign-Off

- [x] All tasks have verification or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without verify
- [x] Wave 0 covers all references
- [x] No watch-mode flags
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
