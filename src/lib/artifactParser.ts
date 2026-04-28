import type { Artifact, ArtifactType } from '../types';

const SUPPORTED_TYPES: Set<string> = new Set(['html', 'svg', 'mermaid', 'file']);

// Matches complete artifact tags with any attributes.
const COMPLETE_ARTIFACT_RE =
  /<lucen_artifact\s+([^>]*)>([\s\S]*?)<\/lucen_artifact>/g;

// Matches a partial (still-streaming) opening tag with no closing tag.
export const PARTIAL_OPEN_RE =
  /<lucen_artifact\s+([^>]*)>([\s\S]*)$/;

// Matches a tag that's still being written (attributes incomplete).
export const INCOMPLETE_TAG_RE = /<lucen_artifact[^>]*$/;

function getAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i');
  const m = attrs.match(re);
  return m?.[1];
}

function parseArtifactAttrs(attrs: string): { type: string; title: string; filename?: string; imported: boolean } {
  const typeRaw = getAttr(attrs, 'type');
  const titleRaw = getAttr(attrs, 'title');
  const filenameRaw = getAttr(attrs, 'filename');
  const importedRaw = getAttr(attrs, 'imported');

  const type = (typeRaw || 'html').trim().toLowerCase();
  const filename = filenameRaw?.trim();
  const imported = importedRaw === 'true';

  // Title priority:
  // - explicit title
  // - filename (for file artifacts)
  // - generic fallback
  const title = (titleRaw?.trim() || filename || 'Artifact').trim();

  return { type, title, filename, imported };
}

export interface ParseResult {
  cleanContent: string;
  artifacts: Artifact[];
}

/**
 * Parse artifact tags from AI response content.
 * Returns clean conversational text and extracted artifact objects.
 *
 * Handles edge cases:
 * - Attributes in either order (type/title or title/type)
 * - Single or double quotes on attributes
 * - Extra whitespace in/around tags
 * - Partial tags during streaming
 * - Incomplete opening tags being typed
 * - AI accidentally wrapping in markdown code fences
 *
 * Artifact IDs are deterministic (messageId + index) for render stability.
 */
/**
 * @param forceClose If true, any partial (unclosed) artifact tag is treated
 * as complete — the artifact is emitted with `isStreaming: false` and the
 * already-streamed content, so a truncated response still renders a usable
 * card instead of staying in a half-parsed streaming state. Pass `true` when
 * the owning message.isStreaming has flipped to false.
 */
export function parseArtifacts(
  content: string,
  messageId: string,
  forceClose = false
): ParseResult {
  if (!content || !content.includes('<lucen_artifact')) {
    return { cleanContent: content, artifacts: [] };
  }

  const artifacts: Artifact[] = [];
  let cleanContent = content;
  let index = 0;

  // Strip markdown fences that AI might accidentally wrap around the entire artifact block
  cleanContent = cleanContent.replace(
    /```(?:xml|html|svg|mermaid|file)?\s*\n(<lucen_artifact[\s\S]*?<\/lucen_artifact>)\s*\n?```/g,
    '$1'
  );

  // Extract all complete artifacts
  cleanContent = cleanContent.replace(
    COMPLETE_ARTIFACT_RE,
    (_match, attrs: string, code: string) => {
      const { type, title, filename, imported } = parseArtifactAttrs(attrs || '');
      artifacts.push({
        id: `${messageId}-artifact-${index++}`,
        type: (SUPPORTED_TYPES.has(type) ? type : 'html') as ArtifactType,
        title: title || 'Artifact',
        filename,
        content: code.trim(),
        messageId,
        isImported: imported,
      });
      return '';
    }
  );

  // Check for a partial (still-streaming) artifact at the end
  const partialMatch = cleanContent.match(PARTIAL_OPEN_RE);
  if (partialMatch) {
    const [fullMatch, attrs, partialCode] = partialMatch;
    const { type, title, filename, imported } = parseArtifactAttrs(attrs || '');
    artifacts.push({
      id: `${messageId}-artifact-${index}`,
      type: (SUPPORTED_TYPES.has(type) ? type : 'html') as ArtifactType,
      title: title || 'Artifact',
      filename,
      content: (partialCode || '').trim(),
      messageId,
      isImported: imported,
      // When forceClose is true (message stream has ended but the model
      // never emitted a </lucen_artifact>), mark the synthesized artifact
      // as NOT streaming so it renders as a complete — if truncated — card.
      isStreaming: !forceClose,
    });
    cleanContent = cleanContent.slice(0, cleanContent.indexOf(fullMatch));
  } else {
    // Check for an incomplete opening tag (still typing attributes)
    const incompleteMatch = cleanContent.match(INCOMPLETE_TAG_RE);
    if (incompleteMatch) {
      cleanContent = cleanContent.slice(0, cleanContent.indexOf(incompleteMatch[0]));
    }
  }

  return {
    cleanContent: cleanContent.trim(),
    artifacts,
  };
}
