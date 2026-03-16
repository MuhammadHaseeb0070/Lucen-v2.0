import type { Artifact, ArtifactType } from '../types';

const SUPPORTED_TYPES: Set<string> = new Set(['html', 'svg', 'mermaid']);

// Matches complete artifact tags.
// Handles: double or single quotes, attributes in any order,
// extra whitespace, and multiline content.
const COMPLETE_ARTIFACT_RE =
  /<lucen_artifact\s+(?:type=["']([^"']+)["']\s+title=["']([^"']+)["']|title=["']([^"']+)["']\s+type=["']([^"']+)["'])\s*>([\s\S]*?)<\/lucen_artifact>/g;

// Matches a partial (still-streaming) opening tag with no closing tag.
const PARTIAL_OPEN_RE =
  /<lucen_artifact\s+(?:type=["']([^"']+)["']\s+title=["']([^"']+)["']|title=["']([^"']+)["']\s+type=["']([^"']+)["'])\s*>([\s\S]*)$/;

// Matches a tag that's still being written (attributes incomplete).
const INCOMPLETE_TAG_RE = /<lucen_artifact[^>]*$/;

function extractTypeAndTitle(
  m1: string | undefined,
  m2: string | undefined,
  m3: string | undefined,
  m4: string | undefined
): { type: string; title: string } {
  // type=... title=... order
  if (m1 && m2) return { type: m1.trim().toLowerCase(), title: m2.trim() };
  // title=... type=... order
  if (m3 && m4) return { type: m4.trim().toLowerCase(), title: m3.trim() };
  return { type: 'html', title: 'Artifact' };
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
export function parseArtifacts(
  content: string,
  messageId: string
): ParseResult {
  if (!content || !content.includes('<lucen_artifact')) {
    return { cleanContent: content, artifacts: [] };
  }

  const artifacts: Artifact[] = [];
  let cleanContent = content;
  let index = 0;

  // Strip markdown fences that AI might accidentally wrap around the entire artifact block
  cleanContent = cleanContent.replace(
    /```(?:xml|html|svg|mermaid)?\s*\n(<lucen_artifact[\s\S]*?<\/lucen_artifact>)\s*\n?```/g,
    '$1'
  );

  // Extract all complete artifacts
  cleanContent = cleanContent.replace(
    COMPLETE_ARTIFACT_RE,
    (_match, m1, m2, m3, m4, code: string) => {
      const { type, title } = extractTypeAndTitle(m1, m2, m3, m4);
      artifacts.push({
        id: `${messageId}-artifact-${index++}`,
        type: (SUPPORTED_TYPES.has(type) ? type : type) as ArtifactType,
        title: title || 'Artifact',
        content: code.trim(),
        messageId,
      });
      return '';
    }
  );

  // Check for a partial (still-streaming) artifact at the end
  const partialMatch = cleanContent.match(PARTIAL_OPEN_RE);
  if (partialMatch) {
    const [fullMatch, m1, m2, m3, m4, partialCode] = partialMatch;
    const { type, title } = extractTypeAndTitle(m1, m2, m3, m4);
    artifacts.push({
      id: `${messageId}-artifact-${index}`,
      type: (SUPPORTED_TYPES.has(type) ? type : type) as ArtifactType,
      title: title || 'Artifact',
      content: (partialCode || '').trim(),
      messageId,
      isStreaming: true,
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
