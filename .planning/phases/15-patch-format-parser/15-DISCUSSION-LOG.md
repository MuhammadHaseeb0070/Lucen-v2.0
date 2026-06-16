# Phase 15 Discussion Log

## Parser Leniency
**Options:**
- (Recommended) Lenient matching — Allow trailing whitespace, case insensitivity, and optional labels.
- Strict matching — Must be exactly `<<<<<<< SEARCH`, `=======`, `>>>>>>> REPLACE` with no deviations.
**Decision:** Lenient matching

## Sentinel Enforcement
**Options:**
- (Recommended) Return a status object (e.g., `{ type: 'sentinel', value: 'FULL_REGEN_REQUIRED' }`).
- Throw a custom error (e.g., `PatchSentinelError`).
**Decision:** Return a status object

## HTML Sanity Check Strategy
**Options:**
- (Recommended) Use `DOMParser` for full DOM tree parsing.
- Use fast regex heuristics to count open/close tags.
**Decision:** Use `DOMParser`
