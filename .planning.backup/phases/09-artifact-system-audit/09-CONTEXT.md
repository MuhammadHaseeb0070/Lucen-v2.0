# Phase 09 Context: Artifact System Audit & UX Overhaul

## Domain
The Artifact Execution System (specifically the Python Pyodide engine) and its UI/UX constraints.

## Locked Requirements
(No SPEC.md was loaded for this phase.)

## Decisions Captured

### CSP Handling
- **Decision:** Tightly whitelist specific PyPI/JSDelivr domains.
- **Rationale:** More secure; locks down outbound connections to exact package hosts rather than using broad wildcards.

### Cancellation UX
- **Decision:** Place a 'Stop' button next to the loading state and leave a 'Cancelled' placeholder when stopped.
- **Rationale:** Gives the user clear visibility of what was attempted rather than silently deleting the artifact block.

### Live Terminal Stream
- **Decision:** Display the live stdout/stderr stream in a collapsible accordion.
- **Rationale:** Keeps the UI cleaner for average users by hiding technical noise by default, but remains accessible.

### Unsupported Library Fallback
- **Decision:** Show a clear error with a "Fix with AI" button.
- **Rationale:** Cheaper and faster; keeps the user in control of whether to spend tokens retrying or to rewrite the prompt.

## Code Context
- **Pyodide Worker:** Located at `src/workers/pyodide.worker.ts`
- **Artifact Renderer:** Located at `src/components/ArtifactRenderer.tsx`
- **CSP Headers:** Located in `index.html`

## Deferred Ideas
None.
