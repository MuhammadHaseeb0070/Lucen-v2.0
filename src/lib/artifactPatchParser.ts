// ============================================================
// Artifact Patch Parser — extracts <lucen_patch> blocks from a stream
//
// Mirrors the shape of `artifactParser.ts` but for the patching protocol:
//
//   <lucen_patch artifact_id="msg-123-artifact-0">
//     <block>
//       <search>OLD_STRING</search>
//       <replace>NEW_STRING</replace>
//     </block>
//     <block>
//       <search>...</search>
//       <replace>...</replace>
//     </block>
//   </lucen_patch>
//
// The parser is intentionally tolerant of whitespace between tags but
// treats everything BETWEEN <search>/<replace> tags as literal — no
// XML-entity decoding (search blocks are matched against the artifact's
// raw content, which itself contains literal `<` and `>`).
//
// Streaming-aware: when called mid-stream (forceClose === false), a
// patch container that hasn't been closed yet is reported as
// `isStreaming: true` with whatever blocks have completed so far. This
// lets the UI show progressive status without committing a partial
// patch to the artifact state.
// ============================================================

const COMPLETE_PATCH_RE =
  /<lucen_patch\s*([^>]*)>([\s\S]*?)<\/lucen_patch>/g;

/** Matches a partial (still-streaming) opening patch tag with no closer. */
export const PARTIAL_PATCH_OPEN_RE =
  /<lucen_patch\s*([^>]*)>([\s\S]*)$/;

/** Matches an incomplete opening tag where attributes are still being typed. */
export const INCOMPLETE_PATCH_TAG_RE = /<lucen_patch[^>]*$/;

const COMPLETE_BLOCK_RE = /<block>([\s\S]*?)<\/block>/g;
const SEARCH_RE = /<search>([\s\S]*?)<\/search>/;
const REPLACE_RE = /<replace>([\s\S]*?)<\/replace>/;

export interface PatchBlock {
  /** Original (literal) text the model wants to find in the artifact. */
  search: string;
  /** Replacement text. */
  replace: string;
}

export interface ParsedPatch {
  /** The artifact_id attribute on the patch container, when present. */
  artifactId?: string;
  /** Ordered list of search/replace blocks. */
  blocks: PatchBlock[];
  /** True if the patch container was unclosed when parsing happened. */
  isStreaming: boolean;
  /** Char offset (in the parsed string) where this patch's opening tag started. */
  startOffset: number;
  /** Char offset where the closing </lucen_patch> ended (or content.length when streaming). */
  endOffset: number;
}

export interface PatchParseResult {
  /** Conversational text with all <lucen_patch> blocks stripped out. */
  cleanContent: string;
  /** Parsed patches, in the order they appeared. */
  patches: ParsedPatch[];
}

function getAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i');
  const m = attrs.match(re);
  return m?.[1];
}

/**
 * Trim a single leading/trailing newline from a captured group. Models
 * commonly format their <search>/<replace> bodies with a leading
 * newline like:
 *
 *     <search>
 *     const X = 1;
 *     </search>
 *
 * The literal artifact content does NOT contain that leading newline,
 * so we strip exactly ONE leading and ONE trailing newline (and the
 * \r before it if present). We do NOT trim interior whitespace because
 * that would lose meaningful indentation.
 */
function trimEdgeNewlines(s: string): string {
  let out = s;
  // Strip one leading newline (with optional preceding \r).
  if (out.startsWith('\r\n')) out = out.slice(2);
  else if (out.startsWith('\n')) out = out.slice(1);
  // Strip one trailing newline (with optional preceding \r).
  if (out.endsWith('\r\n')) out = out.slice(0, -2);
  else if (out.endsWith('\n')) out = out.slice(0, -1);
  return out;
}

function parseBlocks(body: string): PatchBlock[] {
  const blocks: PatchBlock[] = [];
  COMPLETE_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMPLETE_BLOCK_RE.exec(body)) !== null) {
    const inner = m[1];
    const sm = inner.match(SEARCH_RE);
    const rm = inner.match(REPLACE_RE);
    if (!sm || !rm) continue;
    blocks.push({
      search: trimEdgeNewlines(sm[1]),
      replace: trimEdgeNewlines(rm[1]),
    });
  }
  return blocks;
}

/**
 * Parse `<lucen_patch>` blocks from a raw assistant response chunk.
 *
 * Behavior contract (mirrors artifactParser.parseArtifacts):
 *   - All complete patches are removed from `cleanContent`.
 *   - A trailing partial patch (opening tag present, closing tag missing)
 *     is removed from `cleanContent` and emitted with `isStreaming: true`
 *     UNLESS forceClose is true, in which case it's emitted with
 *     `isStreaming: false` and whatever blocks have been parsed so far.
 *   - An incomplete opening tag (still typing attributes) is hidden
 *     from `cleanContent` and produces no patch entry (the model
 *     hasn't even committed to the patch yet).
 *
 * @param content     raw assistant text (may contain any mix of text +
 *                    artifact tags + patch tags).
 * @param forceClose  flip a streaming patch to closed; used when the
 *                    owning message.isStreaming flips to false.
 */
export function parsePatches(
  content: string,
  forceClose = false,
): PatchParseResult {
  if (!content || !content.includes('<lucen_patch')) {
    return { cleanContent: content, patches: [] };
  }

  const patches: ParsedPatch[] = [];
  let cleanContent = content;

  // First strip markdown fences that the model may have wrapped around the
  // entire patch block (mirrors the artifact parser's defensive strip).
  cleanContent = cleanContent.replace(
    /```(?:xml|patch|lucen)?\s*\n(<lucen_patch[\s\S]*?<\/lucen_patch>)\s*\n?```/g,
    '$1',
  );

  // Extract complete patches.
  cleanContent = cleanContent.replace(
    COMPLETE_PATCH_RE,
    (match, attrs: string, body: string, offset: number) => {
      const artifactId = getAttr(attrs || '', 'artifact_id');
      patches.push({
        artifactId,
        blocks: parseBlocks(body),
        isStreaming: false,
        startOffset: offset,
        endOffset: offset + match.length,
      });
      return '';
    },
  );

  // Trailing partial patch (opening tag, no close yet).
  const partialMatch = cleanContent.match(PARTIAL_PATCH_OPEN_RE);
  if (partialMatch) {
    const [fullMatch, attrs, body] = partialMatch;
    const artifactId = getAttr(attrs || '', 'artifact_id');
    const matchOffset = cleanContent.indexOf(fullMatch);
    patches.push({
      artifactId,
      blocks: parseBlocks(body || ''),
      isStreaming: !forceClose,
      startOffset: matchOffset,
      endOffset: cleanContent.length,
    });
    cleanContent = cleanContent.slice(0, matchOffset);
  } else {
    // Incomplete opening tag (attributes still being typed).
    const incompleteMatch = cleanContent.match(INCOMPLETE_PATCH_TAG_RE);
    if (incompleteMatch) {
      cleanContent = cleanContent.slice(0, cleanContent.indexOf(incompleteMatch[0]));
    }
  }

  return {
    cleanContent: cleanContent.trim() === '' && content.trim() !== ''
      ? cleanContent // preserve whitespace if conversational text was empty
      : cleanContent,
    patches,
  };
}

/**
 * Mirror of `isInsideArtifact` from openrouter.ts continuation logic.
 * Returns true when the prior assistant text has an OPEN <lucen_patch>
 * that hasn't been closed yet — used by the auto-continuation pump to
 * tell the model "do NOT re-emit the opening patch tag, resume in the
 * body".
 */
export function isInsidePatch(priorAssistantText: string): boolean {
  if (PARTIAL_PATCH_OPEN_RE.test(priorAssistantText)) return true;
  if (INCOMPLETE_PATCH_TAG_RE.test(priorAssistantText)) return true;
  const lastOpen = priorAssistantText.lastIndexOf('<lucen_patch');
  const lastClose = priorAssistantText.lastIndexOf('</lucen_patch>');
  return lastOpen > lastClose;
}
