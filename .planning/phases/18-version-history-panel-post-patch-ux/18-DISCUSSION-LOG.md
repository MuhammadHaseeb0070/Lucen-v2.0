# Phase 18: Version History Panel & Post-Patch UX - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-18
**Phase:** 18-Version History Panel & Post-Patch UX
**Areas discussed:** History Panel Placement & Toggle, Version Description Source, Deletion & Parent Chain Repair, Post-Patch Feedback UX

---

## History Panel Placement & Toggle

| Option | Description | Selected |
|--------|-------------|----------|
| Collapsible Bottom Drawer | Situate the history list as a collapsible drawer directly above the update bar. Toggle it using a button next to the input, pushing the renderer up slightly when opened. | ✓ |
| Full-Page View Mode | Add a 'History' button in the workspace header next to 'Preview' and 'Code', displaying the complete version history in the main workspace pane when active. | |

**User's choice:** Collapsible Bottom Drawer
**Notes:** Keeps layout context intact by letting the user see both the editor/preview and the scrollable list of historical versions simultaneously.

---

## Version Description Source

| Option | Description | Selected |
|--------|-------------|----------|
| Contextual Derivation | Use the user's update instruction text for patches, 'Initial creation' for V1, 'AI Auto-Fix' for error heals, and a truncated prompt snippet for chat-driven full regenerations. | ✓ |
| AI-Generated Summaries | Have the AI model output a short 3-5 word change description with every patch, saving it as part of the database version record metadata. | |

**User's choice:** Contextual Derivation
**Notes:** Avoids API latency and keeps version descriptions directly aligned with what was requested or triggered.

---

## Deletion & Parent Chain Repair

| Option | Description | Selected |
|--------|-------------|----------|
| Lineage Parent Pointer Repair | Update the child version's parent_id to point to the deleted version's parent, maintaining a continuous chain. If deleting the head, set the previous version as head. | ✓ |
| Soft Delete | Add a deleted flag in the database table and filter out deleted versions in the UI without modifying parent pointers or indices. | |
| Cascading Delete | Delete the selected version and automatically delete all subsequent child versions that branched off of it. | |

**User's choice:** Lineage Parent Pointer Repair
**Notes:** Ensures database referential integrity by actively updating children parent pointers when deleting intermediate versions, avoiding dangling nodes.

---

## Post-Patch Feedback UX

| Option | Description | Selected |
|--------|-------------|----------|
| Floating Action Banner | Show a sleek, floating feedback toast at the bottom of the workspace right after a patch lands. Thumbs down instantly reverts/undos the patch. | ✓ |
| Inline Feedback | Replace the update input bar content temporarily with the thumbs up/down buttons, showing them until the user clicks one or clicks away. | |

**User's choice:** Floating Action Banner
**Notes:** Standard floating action feedback toast is non-obtrusive, auto-dismissible, and lets users preview the change before making an undo decision.

---

## the agent's Discretion

- Styling layout of list items (fonts, layout lines, list icons).
- Floating feedback toast timing (dismisses after 6-8 seconds automatically).

## Deferred Ideas

None — discussion stayed within phase scope.
