# Phase 18: Version History Panel & Post-Patch UX - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the collapsible version history panel and post-patch feedback UX for artifacts. It includes rendering a collapsible bottom drawer displaying the list of all historical versions, their timestamps, status badges, and change descriptions derived contextually. It also implements preview, restore (append new head), and permanent delete (repairing parent pointers in database lineage) capabilities, as well as a post-patch floating feedback toast to support instant patch reverts.

</domain>

<decisions>
## Implementation Decisions

### History Panel Placement & Toggle
- **D-01:** Implement the Version History Panel as a collapsible bottom drawer sitting directly above the update input footer. Toggle it using a compact history button inside the update input bar. When expanded, the drawer pushes the editor/renderer panels upward to prevent overlays.

### Version Description Source
- **D-02:** Use Contextual Derivation to set the one-line description of each version:
  - V1 version: 'Initial creation'
  - Error heals: 'AI Auto-Fix: [error details]'
  - Inline patches: Use the user's typed update instruction content
  - Chat-driven full regenerations: Use a truncated snippet of the user's chat prompt message.

### Deletion & Parent Chain Repair
- **D-03:** When a historical version is deleted, repair the database lineage chain:
  - Update the direct child version's `parent_id` to point to the deleted version's parent.
  - If the deleted version is the active HEAD, set the preceding version in the sorted history list as the new HEAD in the database.

### Post-Patch Feedback UX
- **D-04:** Render a sleek, temporary floating feedback toast at the bottom of the workspace immediately after a patch is successfully verified: "Did this look right? [Thumbs Up] [Thumbs Down]". Clicking Thumbs Down instantly triggers a revert call to the previous version and rolls back the workspace view.

### the agent's Discretion
- Design of the history list items (visual badges, list dividers, spacing).
- Floating toast animations and display timeout (e.g. automatically disappearing after 6-8 seconds if no action is taken).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone & Goals
- [.planning/ROADMAP.md](file:///.planning/ROADMAP.md) — Overall project roadmap.
- [.planning/REQUIREMENTS.md](file:///.planning/REQUIREMENTS.md) §FR5, §FR6 — Detailed version history and post-patch requirements.

### Existing Implementation Files
- [src/services/artifactVersionDb.ts](file:///src/services/artifactVersionDb.ts) — Database helper service containing `createPatchedVersion`, `revertTo`, and database version functions.
- [src/components/ArtifactWorkspace.tsx](file:///src/components/ArtifactWorkspace.tsx) — Main workspace component where version panels will be integrated.
- [src/components/ArtifactVersionSelector.tsx](file:///src/components/ArtifactVersionSelector.tsx) — Existing compact pagination component that handles page-switching.
- [src/lib/artifactSidecar.ts](file:///src/lib/artifactSidecar.ts) — Executed when patches are successfully applied, where database versions must be saved.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createPatchedVersion`, `revertTo`, `getLineageByArtifactId`, `ensureLineageId` inside `src/services/artifactVersionDb.ts`.
- `useArtifactStore`'s `lineages` record caches full version lists, and `currentVersionByLineage` tracks currently viewed version index.

### Established Patterns
- **RPC procedures**: `create_patched_artifact_version` and `revert_artifact_to_version` PG procedures reside in Supabase.
- **Zustand store calls**: `appendLineageVersion` is used to update the local lineage cache.

### Integration Points
- `src/lib/artifactSidecar.ts`: Replace the legacy update db call `updateArtifactContent` with `createPatchedVersion` to write version chain records on successful patches.
- `src/components/ArtifactWorkspace.tsx`: Mount the new version history bottom drawer and floating feedback toast.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 18-Version History Panel & Post-Patch UX*
*Context gathered: 2026-06-18*
