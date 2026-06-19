import type { Artifact, ArtifactType, ExecutionPlan, ExecutionStep } from '../types';

const SUPPORTED_TYPES: Set<string> = new Set(['html', 'svg', 'mermaid', 'file', 'excel', 'word', 'pdf']);

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

function parseArtifactAttrs(attrs: string): {
  type: string;
  title: string;
  filename?: string;
  imported: boolean;
  dbId?: string;
  lineageId?: string;
  parentId?: string;
  version?: number;
  isHead?: boolean;
  meta?: { mode?: string };
} {
  const typeRaw = getAttr(attrs, 'type');
  const titleRaw = getAttr(attrs, 'title');
  const filenameRaw = getAttr(attrs, 'filename');
  const importedRaw = getAttr(attrs, 'imported');
  const dbIdRaw = getAttr(attrs, 'db_id');
  const lineageIdRaw = getAttr(attrs, 'lineage_id');
  const parentIdRaw = getAttr(attrs, 'parent_id');
  const versionRaw = getAttr(attrs, 'version_no') || getAttr(attrs, 'version');
  const isHeadRaw = getAttr(attrs, 'is_head');
  const modeRaw = getAttr(attrs, 'mode');

  const type = (typeRaw || 'html').trim().toLowerCase();
  const filename = filenameRaw?.trim();
  const imported = importedRaw === 'true';

  // Title priority:
  // - explicit title
  // - filename (for file artifacts)
  // - generic fallback
  const title = (titleRaw?.trim() || filename || 'Artifact').trim();

  const parsedVersion = Number(versionRaw);
  const version = Number.isFinite(parsedVersion) && parsedVersion > 0 ? parsedVersion : undefined;
  const isHead = isHeadRaw === 'true' ? true : isHeadRaw === 'false' ? false : undefined;

  return {
    type,
    title,
    filename,
    imported,
    dbId: dbIdRaw?.trim() || undefined,
    lineageId: lineageIdRaw?.trim() || undefined,
    parentId: parentIdRaw?.trim() || undefined,
    version,
    isHead,
    meta: modeRaw
      ? {
          mode: modeRaw?.trim().toLowerCase(),
        }
      : undefined,
  };
}

export interface ParseResult {
  cleanContent: string;
  artifacts: Artifact[];
  executionPlan?: ExecutionPlan;
}

// Matches complete execution plan tags
const COMPLETE_PLAN_RE = /<lucen_execution_plan\s+title=["']([^"']+)["']>([\s\S]*?)<\/lucen_execution_plan>/g;
// Matches partial execution plan opening tag
const PARTIAL_PLAN_OPEN_RE = /<lucen_execution_plan\s+title=["']([^"']+)["']>([\s\S]*)$/;

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
/**
 * Strip markdown fenced code blocks that contain artifact-like tags.
 * This prevents user-pasted examples (e.g. ````<lucen_artifact ...>````)
 * from being treated as real artifacts. The fenced content is replaced
 * with itself intact so it still renders in markdown, but the artifact
 * regex won't match inside fences.
 */
function neutralizeFencedArtifactTags(text: string): string {
  return text.replace(/```[\s\S]*?```/g, (match) => {
    return match.replace(/<lucen_artifact/g, '<lucen\u200Bartifact')
                .replace(/<\/lucen_artifact>/g, '</lucen\u200Bartifact>')
                .replace(/<lucen_patch/g, '<lucen\u200Bpatch')
                .replace(/<\/lucen_patch>/g, '</lucen\u200Bpatch>')
                .replace(/<lucen_execution_plan/g, '<lucen\u200Bexecution\u200Bplan')
                .replace(/<\/lucen_execution_plan>/g, '</lucen\u200Bexecution\u200Bplan>');
  });
}

export function parseArtifacts(
  content: string,
  messageId: string,
  forceClose = false
): ParseResult {
  if (
    !content ||
    (!content.includes('<lucen_artifact') &&
     !content.includes('<lucen_patch') &&
     !content.includes('<lucen_execution_plan') &&
     !content.includes('</'))
  ) {
    return { cleanContent: content, artifacts: [] };
  }

  const artifacts: Artifact[] = [];
  let executionPlan: ExecutionPlan | undefined = undefined;
  // Strip markdown fences that AI might accidentally wrap around the entire artifact block first.
  // This must run before neutralizing fenced tags so the unwrap regex matches unmodified tags.
  // We only unwrap if the code fence starts at the beginning of the content (after optional details/thinking block)
  // to avoid stripping fences from user/model pasted syntax examples.
  let cleanContent = content.replace(
    /^(?:\s*<details>[\s\S]*?<\/details>)?\s*```(?:xml|html|svg|mermaid|file)?\s*\n(<lucen_artifact[\s\S]*?<\/lucen_artifact>)\s*\n?```/i,
    (match, artifact) => {
      const detailsMatch = match.match(/^\s*<details>[\s\S]*?<\/details>/i);
      return (detailsMatch ? detailsMatch[0] + '\n' : '') + artifact;
    }
  );

  cleanContent = neutralizeFencedArtifactTags(cleanContent);
  let index = 0;

  // Strip <lucen_patch> blocks BEFORE the artifact regex fires. Patches
  // are routed through artifactPatchParser.ts; if we let them flow into
  // the artifact extractor below they'd appear as conversational text
  // (which is wrong — they're tool calls, not prose).
  cleanContent = cleanContent.replace(
    /<lucen_patch\s*[^>]*>[\s\S]*?<\/lucen_patch>/g,
    ''
  );
  // Also strip any trailing partial patch — same rule as artifacts: the
  // owning patch parser handles it; this parser must not emit it as
  // conversational text.
  cleanContent = cleanContent.replace(/<lucen_patch\s*[^>]*>[\s\S]*$/, '');
  cleanContent = cleanContent.replace(/<lucen_patch[^>]*$/, '');

  // Extract execution plan
  cleanContent = cleanContent.replace(COMPLETE_PLAN_RE, (_match, title: string, stepsContent: string) => {
    const steps: ExecutionStep[] = [];
    const stepNodeRegex = /<\s*step\s+([^>]*?)(?:\s*\/>|>)/gi;
    let stepMatch;
    while ((stepMatch = stepNodeRegex.exec(stepsContent)) !== null) {
        const attrs = stepMatch[1];
        const titleMatch = /title="([^"]+?)"/i.exec(attrs);
        const descMatch = /description="([^"]+?)"/i.exec(attrs);
        if (titleMatch && descMatch) {
            steps.push({
                title: titleMatch[1],
                description: descMatch[1],
                status: 'pending'
            });
        }
    }
    executionPlan = { title, steps };
    return '';
  });

  // Check for partial execution plan
  const partialPlanMatch = cleanContent.match(PARTIAL_PLAN_OPEN_RE);
  if (partialPlanMatch && !executionPlan) {
    const [fullMatch, title, stepsContent] = partialPlanMatch;
    const steps: ExecutionStep[] = [];
    const stepNodeRegex = /<\s*step\s+([^>]*?)(?:\s*\/>|>)/gi;
    let stepMatch;
    while ((stepMatch = stepNodeRegex.exec(stepsContent || '')) !== null) {
        const attrs = stepMatch[1];
        const titleMatch = /title="([^"]+?)"/i.exec(attrs);
        const descMatch = /description="([^"]+?)"/i.exec(attrs);
        if (titleMatch && descMatch) {
            steps.push({
                title: titleMatch[1],
                description: descMatch[1],
                status: 'pending'
            });
        }
    }
    executionPlan = { title, steps };
    cleanContent = cleanContent.slice(0, cleanContent.indexOf(fullMatch));
  } else if (!executionPlan) {
    const incompletePlanMatch = cleanContent.match(/<lucen_execution_plan[^>]*$/);
    if (incompletePlanMatch) {
      cleanContent = cleanContent.slice(0, cleanContent.indexOf(incompletePlanMatch[0]));
    }
  }

  // Extract all complete artifacts
  cleanContent = cleanContent.replace(
    COMPLETE_ARTIFACT_RE,
    (_match, attrs: string, code: string) => {
      const { type, title, filename, imported, dbId, lineageId, parentId, version, isHead, meta } = parseArtifactAttrs(attrs || '');
      artifacts.push({
        id: `${messageId}-artifact-${index++}`,
        type: (SUPPORTED_TYPES.has(type) ? type : 'html') as ArtifactType,
        title: title || 'Artifact',
        filename,
        dbId,
        lineageId,
        parentId,
        version,
        isHead,
        content: code.trim(),
        messageId,
        isImported: imported,
        meta,
      });
      return '';
    }
  );

  // Check for a partial (still-streaming) artifact at the end
  const partialMatch = cleanContent.match(PARTIAL_OPEN_RE);
  if (partialMatch) {
    const [fullMatch, attrs, partialCode] = partialMatch;
    const { type, title, filename, imported, dbId, lineageId, parentId, version, isHead, meta } = parseArtifactAttrs(attrs || '');
    artifacts.push({
      id: `${messageId}-artifact-${index}`,
      type: (SUPPORTED_TYPES.has(type) ? type : 'html') as ArtifactType,
      title: title || 'Artifact',
      filename,
      dbId,
      lineageId,
      parentId,
      version,
      isHead,
      content: (partialCode || '').trim(),
      messageId,
      isImported: imported,
      // When forceClose is true (message stream has ended but the model
      // never emitted a </lucen_artifact>), mark the synthesized artifact
      // as NOT streaming so it renders as a complete — if truncated — card.
      isStreaming: !forceClose,
      generationStatus: forceClose ? 'partial_saved' : 'streaming',
      meta,
    });
    cleanContent = cleanContent.slice(0, cleanContent.indexOf(fullMatch));
  } else {
    // Check for an incomplete opening tag (still typing attributes)
    const incompleteMatch = cleanContent.match(INCOMPLETE_TAG_RE);
    if (incompleteMatch) {
      cleanContent = cleanContent.slice(0, cleanContent.indexOf(incompleteMatch[0]));
    }
  }

  // ── Strip orphaned closing HTML tags from cleanContent ──
  // After artifact extraction, the remaining text may contain orphaned
  // closing tags (e.g. </head>, </li>, </ul>) from malformed AI output.
  // These would render as visible garbage in the chat bubble, so we
  // strip lines that consist solely of HTML closing tags.
  cleanContent = stripOrphanedClosingTags(cleanContent);

  return {
    cleanContent: cleanContent.trim(),
    artifacts,
    executionPlan,
  };
}

function stripOrphanedClosingTags(text: string): string {
  // First strip all remaining lucen_artifact, lucen_patch, and lucen_execution_plan closing tags
  text = text.replace(/<\/lucen_artifact>/gi, '');
  text = text.replace(/<\/lucen_patch>/gi, '');
  text = text.replace(/<\/lucen_execution_plan>/gi, '');

  // Match a line that is only whitespace + HTML closing tags (possibly multiple).
  // Examples: "</head>", "</li></li></ul>", "  </body>  "
  const orphanedLineRe = /^\s*(?:<\/\w+>\s*)+$/gm;
  text = text.replace(orphanedLineRe, '');

  // Also strip any HTML closing tags at the very end of the text
  const trailingClosingTagsRe = /(?:\s*<\/\w+>\s*)+$/g;
  text = text.replace(trailingClosingTagsRe, '');

  return text;
}
