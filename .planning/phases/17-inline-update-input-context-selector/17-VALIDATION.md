---
phase: 17
slug: inline-update-input-context-selector
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-18
---

# Phase 17 — Validation Strategy

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

- **After every task commit:** Run manual check on layout and component state
- **After every plan wave:** Run `npm run test` to check for test suite regressions
- **Before `/gsd-verify-work`:** Full unit tests must be green, and manual checks verified

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | FR2.1 | — | N/A | manual | Manual layout check | ❌ W0 | ⬜ pending |
| 17-01-02 | 01 | 1 | FR2.1 | — | N/A | visual | CSS rules verification | ❌ W0 | ⬜ pending |
| 17-01-03 | 01 | 1 | FR2.2 | — | N/A | manual | Component test & state mapping | ❌ W0 | ⬜ pending |
| 17-01-04 | 01 | 1 | FR2.4 | — | N/A | integration | E2E manual flow test | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- None. Existing test suite covers stores, parsers, and database interactions.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Responsive Layout & No Overlap | FR2.1 | Viewport check | Resize the window. Ensure the scrollable artifact code area never overlaps with the sticky footer update input bar. |
| Context Pills | FR2.2 | Interaction check | Click on 0, 1, 2, and 3 pills. Verify the active states update visually with correct glowing style, and correct message count slices are passed to `executeArtifactPatch`. |
| Step progress & flash states | FR2.4 | Visual check | Trigger a patch. Verify the progress text updates inline (e.g. "Applying patches..."). Verify green border flash on success and red border flash on failure. |

---

## Validation Sign-Off

- [x] All tasks have verification or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without verify
- [x] Wave 0 covers all references
- [x] No watch-mode flags
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
