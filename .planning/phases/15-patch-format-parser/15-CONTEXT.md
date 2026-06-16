# Phase 15: Patch Format & Parser Migration

## Domain
Switching the parser to Git conflict markers and adding post-patch sanity checks.

## Decisions

### Patch Format
- **Git conflict markers:** The parser will use `<<<<<<< SEARCH / ======= / >>>>>>> REPLACE`.
- **Parser Leniency:** The parser will use lenient matching, allowing trailing whitespace, case insensitivity, and optional labels (e.g., `<<<<<<< SEARCH HTML`). This makes it resilient to LLM quirks.

### Sentinel Enforcement
- **Status Object:** Sentinels like `FULL_REGEN_REQUIRED` and `AMBIGUOUS_PATCH` will be surfaced by returning a status object (e.g., `{ type: 'sentinel', value: 'FULL_REGEN_REQUIRED' }`). This keeps the parsing flow pure and type-safe without relying on control flow via exceptions.

### HTML Sanity Check
- **DOMParser:** The post-patch HTML validation will use `DOMParser` for full DOM tree parsing. It provides 100% accuracy, and since this runs client-side in the browser, the overhead is negligible for normal artifacts.

## Canonical Refs
- `.planning/REQUIREMENTS.md` (FR1, FR4)

## Code Context
- `src/lib/artifactPatchParser.ts` (Current XML parser to be replaced)
- `src/lib/artifactPatcher.ts` (Patch engine, where sanity checks will be added)
- `src/types/index.ts` (Type definitions for patch results)
