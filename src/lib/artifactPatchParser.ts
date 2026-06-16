// ============================================================
// Artifact Patch Parser — extracts Git-style conflict markers from a stream
//
// Matches patterns like:
//   <<<<<<< SEARCH
//   OLD_STRING
//   =======
//   NEW_STRING
//   >>>>>>> REPLACE
//
// The parser is intentionally tolerant of trailing labels/whitespace
// (e.g. `<<<<<<< SEARCH HTML`) and matches case-insensitively.
//
// Sentinel parsing:
// If the content explicitly dictates `FULL_REGEN_REQUIRED` or `AMBIGUOUS_PATCH`,
// it returns a sentinel result.
// ============================================================

export interface PatchBlock {
  /** Original (literal) text the model wants to find in the artifact. */
  search: string;
  /** Replacement text. */
  replace: string;
}

export interface ParsedPatch {
  /** The artifact_id (undefined in git marker mode since we rely on the context to provide it). */
  artifactId?: string;
  /** Semantic version label (undefined in git marker mode). */
  versionLabel?: string;
  /** Ordered list of search/replace blocks. */
  blocks: PatchBlock[];
  /** True if the patch container was unclosed when parsing happened. */
  isStreaming: boolean;
  /** Char offset (in the parsed string) where this patch's opening tag started. */
  startOffset: number;
  /** Char offset where the closing tag ended (or content.length when streaming). */
  endOffset: number;
}

export type PatchParseResult =
  | { type: 'success'; cleanContent: string; patches: ParsedPatch[] }
  | { type: 'sentinel'; value: 'FULL_REGEN_REQUIRED' | 'AMBIGUOUS_PATCH' };

// We want to match:
// <<<<<<< SEARCH [optional text]
// (search text)
// =======
// (replace text)
// >>>>>>> REPLACE [optional text]
//
// [\s\S]*? is used to match newlines as well.
const GIT_PATCH_RE = /<<<<<<<\s*SEARCH[^\n]*\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>>\s*REPLACE[^\n]*/gi;

// Partial match for streaming detection.
export const PARTIAL_PATCH_OPEN_RE = /<<<<<<<\s*SEARCH[^\n]*\n([\s\S]*)$/i;
export const INCOMPLETE_PATCH_TAG_RE = /<<<<<<<[^S]*$/i;

/**
 * Trim a single leading/trailing newline from a captured group.
 */
function trimEdgeNewlines(s: string): string {
  let out = s;
  if (out.startsWith('\r\n')) out = out.slice(2);
  else if (out.startsWith('\n')) out = out.slice(1);
  if (out.endsWith('\r\n')) out = out.slice(0, -2);
  else if (out.endsWith('\n')) out = out.slice(0, -1);
  return out;
}

/**
 * Parse Git conflict marker patch blocks from a raw assistant response chunk.
 *
 * @param content     raw assistant text
 * @param forceClose  flip a streaming patch to closed; used when the
 *                    owning message.isStreaming flips to false.
 */
export function parsePatches(
  content: string,
  forceClose = false,
): PatchParseResult {
  if (!content) {
    return { type: 'success', cleanContent: '', patches: [] };
  }

  // 1. Sentinel check
  if (/\bFULL_REGEN_REQUIRED\b/.test(content)) {
    return { type: 'sentinel', value: 'FULL_REGEN_REQUIRED' };
  }
  if (/\bAMBIGUOUS_PATCH\b/.test(content)) {
    return { type: 'sentinel', value: 'AMBIGUOUS_PATCH' };
  }

  if (!content.includes('<<<<<<<')) {
    return { type: 'success', cleanContent: content, patches: [] };
  }

  const blocks: PatchBlock[] = [];
  let cleanContent = content;

  // First strip markdown fences that the model may have wrapped around the patch
  cleanContent = cleanContent.replace(
    /```(?:xml|patch|lucen|html)?\s*\n(<<<<<<<[\s\S]*?>>>>>>>[^\n]*)\s*\n?```/g,
    '$1',
  );

  let firstStartOffset = -1;
  let lastEndOffset = -1;

  cleanContent = cleanContent.replace(GIT_PATCH_RE, (match, search, replace, offset) => {
    blocks.push({
      search: trimEdgeNewlines(search),
      replace: trimEdgeNewlines(replace),
    });
    if (firstStartOffset === -1) firstStartOffset = offset;
    lastEndOffset = offset + match.length;
    return '';
  });

  const isStreaming = !forceClose && PARTIAL_PATCH_OPEN_RE.test(cleanContent);
  const partialMatch = cleanContent.match(PARTIAL_PATCH_OPEN_RE);
  if (partialMatch) {
    const [fullMatch] = partialMatch;
    const matchOffset = cleanContent.indexOf(fullMatch);
    if (firstStartOffset === -1) firstStartOffset = matchOffset;
    lastEndOffset = cleanContent.length;
    cleanContent = cleanContent.slice(0, matchOffset);
  } else {
    // Incomplete opening tag
    const incompleteMatch = cleanContent.match(INCOMPLETE_PATCH_TAG_RE);
    if (incompleteMatch) {
      cleanContent = cleanContent.slice(0, cleanContent.indexOf(incompleteMatch[0]));
    }
  }

  const patches: ParsedPatch[] = [];
  if (blocks.length > 0 || isStreaming) {
    patches.push({
      blocks,
      isStreaming,
      startOffset: firstStartOffset === -1 ? 0 : firstStartOffset,
      endOffset: lastEndOffset === -1 ? 0 : lastEndOffset,
    });
  }

  return {
    type: 'success',
    cleanContent: cleanContent.trim() === '' && content.trim() !== ''
      ? cleanContent
      : cleanContent,
    patches,
  };
}

export function isInsidePatch(priorAssistantText: string): boolean {
  if (PARTIAL_PATCH_OPEN_RE.test(priorAssistantText)) return true;
  if (INCOMPLETE_PATCH_TAG_RE.test(priorAssistantText)) return true;
  const lastOpen = priorAssistantText.lastIndexOf('<<<<<<<');
  const lastClose = priorAssistantText.lastIndexOf('>>>>>>>');
  return lastOpen > lastClose;
}
