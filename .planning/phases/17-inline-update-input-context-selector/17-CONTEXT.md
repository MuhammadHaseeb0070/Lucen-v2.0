# Phase 17: Inline Update Input & Context Selector - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the redesigned React UI component for updating artifacts inline (`ArtifactPatchInput.tsx`), replacing any existing implementation. It anchors statically/sticky at the bottom of the artifact container, ensures 100% responsiveness and no overlap with scrollable editor/preview content, integrates a segmented message context selector (0 to 3 messages), features custom glassmorphic styling matching a premium dark-mode theme, and displays step-by-step inline status feedbacks for the parsing/patching lifecycle.

</domain>

<decisions>
## Implementation Decisions

### Layout & Positioning
- **D-01:** Anchor the update box statically/sticky at the very bottom of the artifact panel/sidebar container. The preview panel or code editor above it will scroll independently, guaranteeing zero visual overlaps or obstructed content.

### Context Selector UX
- **D-02:** Build a Segmented Context Pill Selector (0 / 1 / 2 / 3 pills) next to the input field. It defaults to 0, updates visually on click, and includes tooltips detailing the message context that will be appended.

### Visual Style & Aesthetics
- **D-03:** Apply a Premium Glassmorphic design. This features a semi-transparent background (`backdrop-filter: blur(12px) saturate(180%)`), thin borders (`1px solid var(--divider)` or light translucent values), soft glowing shadow transitions on focus, and modern Outfit/Inter typography.

### State Transitions & Feedbacks
- **D-04:** Implement an Inline Multi-stage Feedback system. The input field displays live step-by-step progress text matching the active patching stage (e.g. "Reading...", "Applying patches...", "Verifying..."), blinks red on failure, and shows a green success state upon completion before resetting.

### the agent's Discretion
- Layout adjustments for mobile viewports (e.g., stacking or expanding elements full-width for touch targets).
- Specific iconography and transition durations (e.g. spring transitions or ease-in-out curves).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone & Goals
- [.planning/ROADMAP.md](file:///.planning/ROADMAP.md) — Overall project roadmap and phase descriptions.
- [.planning/REQUIREMENTS.md](file:///.planning/REQUIREMENTS.md) §FR2 — Detailed triggers and user update input requirements.

### Existing Implementation Files
- [src/components/ArtifactPatchInput.tsx](file:///src/components/ArtifactPatchInput.tsx) — The current component to be completely deleted and replaced.
- [src/components/ArtifactWorkspace.tsx](file:///src/components/ArtifactWorkspace.tsx) — The parent workspace container where the input is mounted.
- [src/components/ArtifactStatusPipeline.tsx](file:///src/components/ArtifactStatusPipeline.tsx) — The overlay component driving the status progress step names.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `useArtifactStore`: Accesses `patchStatus` (e.g. `reading`, `patching`, `verifying`, `failed`, `complete`) and functions like `executeArtifactPatch`.
- `useChatStore`: Accesses `activeConversationId` and the `getContextMessages` method to retrieve recent chat history.

### Established Patterns
- **CSS variables**: Reuse `--bg-surface`, `--divider`, `--accent`, `--accent-soft`, `--text-primary`, `--dur-fast`, `--ease`, and styling tokens to maintain visual consistency.
- **Lucide icons**: Utilize standard Lucide icons (`MessageSquare`, `ArrowUpCircle`, `Loader2`, `CheckCircle`, `AlertCircle`) for button icons and status indications.

### Integration Points
- `ArtifactWorkspace.tsx` lines 463-465: Replaces the rendered child `<ArtifactPatchInput artifactId={activeArtifact.id} />` with the newly engineered component.

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

*Phase: 17-Inline Update Input & Context Selector*
*Context gathered: 2026-06-18*
