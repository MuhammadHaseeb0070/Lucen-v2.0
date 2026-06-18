---
status: draft
phase: 18-version-history-panel-post-patch-ux
started: "2026-06-18T06:50:00Z"
updated: "2026-06-18T06:50:00Z"
---

## Current Test

[testing pending]

## Tests

### 1. Database Patch Version Insertion
expected: Every successful inline patch write must execute `createPatchedVersion`, generating a new database row containing the correct parent pointer, sequential version number, and lineage ID mapping.
result: pending
reported: ""

### 2. Collapsible bottom drawer list and preview
expected: Toggling the history panel displays a bottom drawer container sitting directly above the update footer, scrollable independently, showing version numbers, formatted time, contextual descriptions (user instruction text), and status badges. Clicking a list item previews its content.
result: pending
reported: ""

### 3. Restore and permanent delete pointer chain repair
expected: Clicking "Use version" restores the chosen version (makes it head). Deleting a version row from the history list deletes it in Supabase, and updates its child version's `parent_id` to point to its parent, preventing any broken links. Deleting the head version automatically selects the previous version in the chain as the active head.
result: pending
reported: ""

### 4. Post-patch floating toast and undo trigger
expected: Immediately after a successful patch, a floating toast appears showing "Did this look right?". Clicking thumbs down (revert) rolls back the version immediately by calling revertTo the previous version. The toast auto-dismisses after a timeout.
result: pending
reported: ""

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0

## Gaps

None.
