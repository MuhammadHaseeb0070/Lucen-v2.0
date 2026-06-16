# Phase 15: Technical Research

## Parser Format Migration
- `src/lib/artifactPatchParser.ts` currently uses XML `<lucen_patch>` and `<block><search></search><replace></replace></block>` tags.
- It needs to be rewritten to parse Git conflict markers:
  ```text
  <<<<<<< SEARCH
  ...
  =======
  ...
  >>>>>>> REPLACE
  ```
- **Leniency Requirements:** Optional whitespace before/after markers, optional labels (e.g., `<<<<<<< SEARCH HTML`), and case-insensitivity.

## Sentinel Enforcement
- The parser must detect `FULL_REGEN_REQUIRED` and `AMBIGUOUS_PATCH` sentinels (if the LLM yields them instead of a patch).
- **Decision:** Return a status object. `parsePatches` will be updated to return a union type, e.g.:
  ```typescript
  export type PatchParseResult = 
    | { type: 'success', cleanContent: string, patches: ParsedPatch[] }
    | { type: 'sentinel', value: 'FULL_REGEN_REQUIRED' | 'AMBIGUOUS_PATCH' };
  ```

## HTML Sanity Check
- `src/lib/artifactPatcher.ts` applies patches via pure string manipulation.
- We need to add an optional validation step post-patch.
- If the artifact format is 'html' or 'svg', we will use `new DOMParser().parseFromString(newContent, 'text/html')` to validate the entire resulting string.
- If the resulting document contains a `<parsererror>` node, the patch fails with a new reason: `'html_sanity_check_failed'`.
- `DOMParser` is a browser-only API, which is perfectly fine here since `artifactPatcher` runs client-side.

## Target Files
1. `src/lib/artifactPatchParser.ts` — Regex parser updates.
2. `src/lib/artifactPatcher.ts` — HTML post-patch validation logic.
