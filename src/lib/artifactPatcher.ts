// ============================================================
// Artifact Patcher — deterministic search/replace engine
//
// Implements NFR1.1 / NFR1.2 / NFR4.1 from the Lucen Agentic Patching
// Engine blueprint:
//
//   - Match-or-fail: exactly 1 match required; otherwise the patch
//     fails. No diff-match-patch fuzziness — we never silently land a
//     patch in the wrong place.
//   - Three deterministic strategies, tried in order:
//       1. Exact substring match (cheapest, strictest).
//       2. CRLF/LF-normalised match (handles models that emit \n on a
//          file that uses \r\n, or vice-versa).
//       3. Indentation-normalised match (collapses leading whitespace
//          runs so tab-vs-spaces drift doesn't break patches).
//     Each strategy must produce EXACTLY ONE hit; otherwise we fall
//     through to the next one. The first strategy with exactly-one-hit
//     wins.
//   - Performance: pure string ops, no regex backtracking on user
//     content. Easily completes well under 50ms for ~100k-char inputs.
//
// All functions are pure (no I/O, no side effects, no Date.now). They
// can be unit-tested by feeding fixtures and asserting on the result.
// ============================================================

import type { PatchBlock } from './artifactPatchParser';

/** Reason a single block failed to apply. */
export type BlockFailureReason =
  | 'no_match'
  | 'multi_match'
  | 'empty_search';

/** Strategy used to locate the search block, when one succeeded. */
export type MatchStrategy = 'exact' | 'crlf_normalized' | 'indent_normalized';

export interface AppliedBlock {
  blockIndex: number;
  strategy: MatchStrategy;
  /** Character offset in the (pre-replace) content where the match started. */
  matchStart: number;
  /** Length (in original content chars) of the matched region. */
  matchLength: number;
}

export interface PatchSuccess {
  ok: true;
  newContent: string;
  appliedBlocks: AppliedBlock[];
}

export interface PatchFailure {
  ok: false;
  /** Index of the block that failed (0-based). */
  blockIndex: number;
  reason: BlockFailureReason;
  /** When reason === 'multi_match', how many matches were found. */
  matchCount?: number;
  /** Diagnostic excerpt of the search block (first ~200 chars) for retry context. */
  searchExcerpt: string;
}

export type PatchResult = PatchSuccess | PatchFailure;

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Find every occurrence of `needle` in `haystack` (non-overlapping). Pure
 * indexOf scan — no regex, so special characters in either side are
 * treated literally (important for `<script>` blocks with `${...}`).
 */
function findAllIndices(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const out: number[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    out.push(idx);
    from = idx + needle.length;
  }
  return out;
}

/** Replace the substring [start, start+len) in `haystack` with `replacement`. */
function spliceString(
  haystack: string,
  start: number,
  len: number,
  replacement: string,
): string {
  return haystack.slice(0, start) + replacement + haystack.slice(start + len);
}

/**
 * Detect the dominant line ending of a string. Defaults to LF when the
 * input has no line breaks at all.
 */
function detectLineEnding(text: string): '\r\n' | '\n' {
  // Cheap heuristic: count CRLF; if it's the majority of newlines, use it.
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      if (i > 0 && text[i - 1] === '\r') crlf++;
      else lf++;
    }
  }
  return crlf > lf ? '\r\n' : '\n';
}

/** Normalize CRLF/CR to LF. Pure transform; reversible by re-applying detected ending. */
function toLf(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Re-apply a target line ending to text that may currently use any. Used
 * after we successfully match in the LF-normalised projection so the
 * inserted replacement keeps the artifact's original convention.
 */
function applyLineEnding(text: string, ending: '\r\n' | '\n'): string {
  const lf = toLf(text);
  return ending === '\n' ? lf : lf.replace(/\n/g, '\r\n');
}

/**
 * Build a parallel projection of `original` and a mapping function from
 * "index in projection" → "index in original". Each strategy that
 * normalises the original content needs this so we can apply the
 * replacement at the correct offset in the unmodified string.
 *
 * For simple strategies (exact, CRLF), the mapping is identity-ish: we
 * normalise the original ONCE, find a unique match in the projection,
 * then walk the original string to compute the matching offsets. The
 * indent strategy uses the same approach but with a more aggressive
 * projection.
 */
interface Projection {
  /** The transformed text we search in. */
  projected: string;
  /**
   * Walks `original` and returns the start/end offsets in `original`
   * that correspond to a match found at projected[matchStart..matchEnd).
   * Returns null if the projection is non-recoverable (shouldn't happen
   * for our well-defined strategies).
   */
  unmap: (matchStart: number, matchLength: number) => { start: number; length: number } | null;
}

/**
 * Build an indent-normalised projection AND a map back to original
 * indices. We walk the original character-by-character, emitting into
 * the projection, and remember the boundary indices.
 */
function buildIndentProjection(original: string): Projection {
  const projected: string[] = [];
  // For each char emitted into `projected`, what's the corresponding
  // index in `original` where it starts? We use a slightly different
  // approach: an array `projToOrig` of length projected.length+1,
  // where projToOrig[i] is the original index at which projected[i]
  // begins (or for i === projected.length, the index just past the
  // end of the matched region in original).
  const projToOrig: number[] = [];

  let i = 0;
  let atLineStart = true;
  while (i < original.length) {
    const ch = original[i];

    if (atLineStart && (ch === ' ' || ch === '\t')) {
      // Collapse the entire leading whitespace run to a single space.
      const runStart = i;
      while (i < original.length && (original[i] === ' ' || original[i] === '\t')) i++;
      // Only emit a space if the run actually had leading whitespace
      // AND the next char isn't a newline (a line that's pure whitespace
      // collapses to empty).
      if (i < original.length && original[i] !== '\n' && original[i] !== '\r') {
        projToOrig.push(runStart);
        projected.push(' ');
      }
      atLineStart = false;
      continue;
    }

    if (ch === '\n') {
      // Strip trailing whitespace before emitting the newline by
      // looking BACK at what we just emitted. This is the cheaper
      // alternative to a forward scan.
      while (
        projected.length > 0 &&
        (projected[projected.length - 1] === ' ' || projected[projected.length - 1] === '\t')
      ) {
        // Only strip if the corresponding source chars are trailing
        // whitespace too — i.e. on the same line as `ch`. We can verify
        // by checking that projToOrig[length-1] points at a space/tab
        // in original.
        const lastOrig = projToOrig[projToOrig.length - 1];
        const c = original[lastOrig];
        if (c !== ' ' && c !== '\t') break;
        projected.pop();
        projToOrig.pop();
      }
      projToOrig.push(i);
      projected.push('\n');
      i++;
      atLineStart = true;
      continue;
    }

    if (ch === '\r') {
      // Normalize CRLF → LF in the projection too. Skip the \r and
      // let the next iteration handle the \n.
      i++;
      continue;
    }

    projToOrig.push(i);
    projected.push(ch);
    i++;
    atLineStart = false;
  }
  // Sentinel for end-of-string mapping.
  projToOrig.push(original.length);

  return {
    projected: projected.join(''),
    unmap: (matchStart: number, matchLength: number) => {
      if (matchStart < 0 || matchStart > projected.length) return null;
      const matchEnd = matchStart + matchLength;
      if (matchEnd < 0 || matchEnd > projected.length) return null;
      const origStart = projToOrig[matchStart];
      const origEndExclusive = projToOrig[matchEnd];
      if (origStart === undefined || origEndExclusive === undefined) return null;
      return { start: origStart, length: origEndExclusive - origStart };
    },
  };
}

// ─── Strategy attempts ────────────────────────────────────────────────

interface MatchAttempt {
  /** Number of matches found in this strategy. */
  matchCount: number;
  /** Resolved start/length in the ORIGINAL content (only when matchCount === 1). */
  origStart?: number;
  origLength?: number;
}

function attemptExact(original: string, search: string): MatchAttempt {
  const hits = findAllIndices(original, search);
  if (hits.length !== 1) return { matchCount: hits.length };
  return { matchCount: 1, origStart: hits[0], origLength: search.length };
}

function attemptCrlfNormalized(original: string, search: string): MatchAttempt {
  const lfOriginal = toLf(original);
  const lfSearch = toLf(search);
  // If there's no CRLF anywhere, this strategy is identical to exact —
  // skip the redundant work.
  if (lfOriginal === original && lfSearch === search) {
    return { matchCount: 0 };
  }
  const hits = findAllIndices(lfOriginal, lfSearch);
  if (hits.length !== 1) return { matchCount: hits.length };
  // Walk original to find the index that corresponds to lfOriginal[hits[0]].
  // Since LF-normalisation only DELETES \r chars, we can advance both
  // pointers together: every char in lfOriginal corresponds to either
  // the same char or one-past-a-\r in original.
  const target = hits[0];
  let lfIdx = 0;
  let origIdx = 0;
  while (origIdx < original.length && lfIdx < target) {
    if (original[origIdx] === '\r' && original[origIdx + 1] === '\n') {
      origIdx++; // skip the \r; let the next iteration consume \n
      continue;
    }
    origIdx++;
    lfIdx++;
  }
  // Now origIdx is the start in `original`. Walk forward to compute the
  // length that covers lfSearch.length lf-chars.
  const startOrig = origIdx;
  let consumed = 0;
  while (origIdx < original.length && consumed < lfSearch.length) {
    if (original[origIdx] === '\r' && original[origIdx + 1] === '\n') {
      origIdx++;
      continue;
    }
    origIdx++;
    consumed++;
  }
  return {
    matchCount: 1,
    origStart: startOrig,
    origLength: origIdx - startOrig,
  };
}

function attemptIndentNormalized(original: string, search: string): MatchAttempt {
  const projOriginal = buildIndentProjection(original);
  // For the search side, simply normalise to the same projection. We don't
  // need a back-map for `search` — only for `original`.
  const projSearchObj = buildIndentProjection(search);
  const lfSearch = projSearchObj.projected;

  if (!lfSearch) return { matchCount: 0 };

  const hits = findAllIndices(projOriginal.projected, lfSearch);
  if (hits.length !== 1) return { matchCount: hits.length };

  const mapped = projOriginal.unmap(hits[0], lfSearch.length);
  if (!mapped) return { matchCount: 0 };

  return { matchCount: 1, origStart: mapped.start, origLength: mapped.length };
}

// ─── Top-level apply ──────────────────────────────────────────────────

/**
 * Apply a single block to `content`. Tries each strategy in order. The
 * FIRST strategy that returns a unique match wins; subsequent strategies
 * are not tried. This gives us deterministic behavior — patches always
 * resolve via the strictest possible strategy.
 *
 * NOTE: when strategy === 'indent_normalized', the inserted replacement
 * keeps its model-emitted formatting verbatim. We don't try to "re-indent"
 * to match the original because that's heuristic territory and would be
 * a different feature ("auto-format the replacement"). Today, the model
 * is responsible for producing replacement text that matches the
 * artifact's existing indentation style.
 */
export function applyBlock(content: string, block: PatchBlock): {
  ok: true;
  newContent: string;
  applied: AppliedBlock;
} | { ok: false; reason: BlockFailureReason; matchCount?: number } {
  const search = block.search;
  const replace = block.replace;

  if (search.length === 0) return { ok: false, reason: 'empty_search' };

  // Re-apply the original line ending to the replacement so we don't
  // mix CRLF + LF inside a single artifact.
  const targetEnding = detectLineEnding(content);
  const adjustedReplace = applyLineEnding(replace, targetEnding);

  // Strategy 1: exact.
  const exact = attemptExact(content, search);
  if (exact.matchCount === 1) {
    return {
      ok: true,
      newContent: spliceString(content, exact.origStart!, exact.origLength!, adjustedReplace),
      applied: {
        blockIndex: -1,
        strategy: 'exact',
        matchStart: exact.origStart!,
        matchLength: exact.origLength!,
      },
    };
  }
  if (exact.matchCount > 1) {
    return { ok: false, reason: 'multi_match', matchCount: exact.matchCount };
  }

  // Strategy 2: CRLF/LF-normalised.
  const crlf = attemptCrlfNormalized(content, search);
  if (crlf.matchCount === 1) {
    return {
      ok: true,
      newContent: spliceString(content, crlf.origStart!, crlf.origLength!, adjustedReplace),
      applied: {
        blockIndex: -1,
        strategy: 'crlf_normalized',
        matchStart: crlf.origStart!,
        matchLength: crlf.origLength!,
      },
    };
  }
  if (crlf.matchCount > 1) {
    return { ok: false, reason: 'multi_match', matchCount: crlf.matchCount };
  }

  // Strategy 3: indent-normalised.
  const indent = attemptIndentNormalized(content, search);
  if (indent.matchCount === 1) {
    return {
      ok: true,
      newContent: spliceString(content, indent.origStart!, indent.origLength!, adjustedReplace),
      applied: {
        blockIndex: -1,
        strategy: 'indent_normalized',
        matchStart: indent.origStart!,
        matchLength: indent.origLength!,
      },
    };
  }
  if (indent.matchCount > 1) {
    return { ok: false, reason: 'multi_match', matchCount: indent.matchCount };
  }

  return { ok: false, reason: 'no_match' };
}

/**
 * Apply a sequence of blocks left-to-right. Each block operates on the
 * RESULT of the previous block (so a single patch can chain edits, e.g.
 * change A to B, then change B to C — though in practice models emit
 * disjoint blocks).
 *
 * On the first failure, we abort and return the failure with the offending
 * block's index. The artifact content is NOT modified — the caller is
 * responsible for either rolling back or retrying at the LLM layer.
 */
export function applyPatch(originalContent: string, blocks: PatchBlock[]): PatchResult {
  if (blocks.length === 0) {
    return { ok: true, newContent: originalContent, appliedBlocks: [] };
  }

  let current = originalContent;
  const applied: AppliedBlock[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const result = applyBlock(current, block);
    if (!result.ok) {
      return {
        ok: false,
        blockIndex: i,
        reason: result.reason,
        matchCount: result.matchCount,
        searchExcerpt: block.search.slice(0, 200),
      };
    }
    current = result.newContent;
    applied.push({ ...result.applied, blockIndex: i });
  }

  return { ok: true, newContent: current, appliedBlocks: applied };
}
