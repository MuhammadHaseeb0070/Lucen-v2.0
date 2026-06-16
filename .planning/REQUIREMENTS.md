# Requirements: v3.1 — Smart Artifact Patching System

## Summary

Replace full-regeneration artifact updates with a surgical SEARCH/REPLACE patching pipeline. Two triggers share one pipeline: (1) user types an update instruction below the artifact, (2) "Fix with AI" auto-captures runtime errors. The AI responds with patch blocks only; the frontend parses, validates uniqueness, applies atomically, and runs sanity checks. Failed patches fall back to full regeneration.

## Functional Requirements

### FR1 — Patch Protocol
- FR1.1: AI responds with SEARCH/REPLACE patch blocks (format TBD — git markers or XML)
- FR1.2: SEARCH section must contain enough context (3–5 lines) for unique match
- FR1.3: Multiple blocks per response for multi-location edits
- FR1.4: Sentinel `FULL_REGEN_REQUIRED` when change exceeds ~30% of the file → fallback to full regen
- FR1.5: Sentinel `AMBIGUOUS_PATCH` when unique match cannot be found → fallback to full regen

### FR2 — Trigger 1: User Update Input
- FR2.1: Small text input + "Update" button directly below each artifact
- FR2.2: Optional context selector (0–3 recent chat messages) next to the input, defaults to 0
- FR2.3: Sends the current artifact code + user instruction + system prompt to the AI
- FR2.4: Response parsed and applied as patches; no explanation text rendered

### FR3 — Trigger 2: Error Auto-Fix
- FR3.1: When artifact crashes, "Fix with AI" button appears (already exists)
- FR3.2: Clicking it captures the error message and sends a patch request
- FR3.3: Uses the same patching pipeline as Trigger 1
- FR3.4: Self-heal cap of 3 attempts (already exists)

### FR4 — Patch Application Engine
- FR4.1: Parse response, extract all SEARCH/REPLACE blocks (ignore explanation text)
- FR4.2: If sentinel detected, skip patching → full regen fallback
- FR4.3: For each SEARCH block, verify exactly 1 match in current code; 0 or >1 matches → entire batch fails
- FR4.4: Apply patches top-to-bottom, re-searching in already-modified code after each
- FR4.5: Post-patch sanity check: HTML closing tag validation, Python syntax parse
- FR4.6: Sanity failure → revert to pre-patch code → trigger full regen
- FR4.7: Atomic — all patches apply or none

### FR5 — Version History
- FR5.1: Every successful patch, error fix, and full regen creates a new version entry
- FR5.2: Version entry shows: version number, timestamp, one-line description, status badge
- FR5.3: Status badges: `patch ✓`, `error fix ✓`, `patch failed → regen`
- FR5.4: Collapsible version history panel below each artifact (collapsed by default)
- FR5.5: Preview any version, restore any version (creates new entry, no overwrite), delete permanently
- FR5.6: AI always patches against the latest version's code

### FR6 — Post-Patch Feedback
- FR6.1: After successful patch, show "Did this look right?" with thumbs up/down
- FR6.2: Thumbs down instantly reverts to previous version
- FR6.3: Shown only for patches, not for full regenerations

### FR7 — Request Queuing
- FR7.1: Only one patch request runs at a time per artifact
- FR7.2: Rapid Update clicks are queued, not dropped

## Non-Functional Requirements

### NFR1 — Performance
- NFR1.1: Patch engine completes in <50ms for 100k-char artifacts (already met)
- NFR1.2: Parser extracts blocks from AI response in <10ms

### NFR2 — Token Economy
- NFR2.1: Patch responses are dramatically smaller than full regen (targeting 5-20x reduction)
- NFR2.2: Token cost warnings for large artifacts (already exists at 40k chars)

### NFR3 — Reliability
- NFR3.1: Deterministic matching — never silently land a patch in the wrong place (already guaranteed by 4-strategy engine)
- NFR3.2: Atomic application — partial patches never persist
- NFR3.3: Graceful degradation — any failure falls back to full regeneration

## Out of Scope

- Real-time collaborative editing (multiplayer patches)
- Diff visualization (showing what changed between versions)
- Manual code editing inside the artifact workspace
- Patch protocol for excel/word/pdf artifact types (HTML/SVG/mermaid only initially)
