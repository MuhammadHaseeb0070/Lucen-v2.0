import {
  CONTINUATION_MAX_CHUNKS_ARTIFACT,
  CONTINUATION_MAX_CHUNKS_CHAT,
} from '../../config/models';
import type { ResponseMode } from '../outputBudget';
import { PARTIAL_OPEN_RE, INCOMPLETE_TAG_RE } from '../../lib/artifactParser';

export const STALL_MIN_CONTINUATION_CHARS = 200;
export const REPETITION_WINDOW = 500;
export const REPETITION_THRESHOLD = 0.85;
export const REPETITION_MIN_OVERLAP_CHARS = 120;
export const PER_TURN_OUTPUT_CHAR_BUDGET = 200_000;
export const CONTINUATION_FULL_TEXT_LIMIT = 12_000;
export const CONTINUATION_TAIL_CHARS = 4_000;

export function getMaxChunksForMode(mode: ResponseMode): number {
  const configured = mode === 'artifact'
    ? CONTINUATION_MAX_CHUNKS_ARTIFACT
    : CONTINUATION_MAX_CHUNKS_CHAT;
  return configured === 0 ? 0 : Math.max(3, configured);
}

export function isInsideArtifact(priorAssistantText: string): boolean {
  if (PARTIAL_OPEN_RE.test(priorAssistantText)) return true;
  if (INCOMPLETE_TAG_RE.test(priorAssistantText)) return true;
  const lastOpen = priorAssistantText.lastIndexOf('<lucen_artifact');
  const lastClose = priorAssistantText.lastIndexOf('</lucen_artifact>');
  return lastOpen > lastClose;
}

export function isRepeatingLastWindow(prior: string, pass: string): boolean {
  if (!prior || !pass) return false;
  const tail = prior.slice(-REPETITION_WINDOW);
  const head = pass.slice(0, REPETITION_WINDOW);
  if (tail.length < REPETITION_MIN_OVERLAP_CHARS || head.length < REPETITION_MIN_OVERLAP_CHARS) return false;

  let longestOverlap = 0;
  const maxLen = Math.min(tail.length, head.length);
  for (let n = maxLen; n >= REPETITION_MIN_OVERLAP_CHARS; n--) {
    if (tail.slice(tail.length - n) === head.slice(0, n)) {
      longestOverlap = n;
      break;
    }
  }
  if (longestOverlap < REPETITION_MIN_OVERLAP_CHARS) return false;
  const ratio = longestOverlap / Math.min(tail.length, head.length);
  return ratio >= REPETITION_THRESHOLD;
}

export function isLowEntropy(text: string, windowSize = 500, threshold = 20): boolean {
  if (text.length < windowSize) return false;
  const tail = text.slice(-windowSize);
  const bigrams = new Set<string>();
  for (let i = 0; i < tail.length - 1; i++) {
    bigrams.add(tail[i] + tail[i + 1]);
  }
  return bigrams.size < threshold;
}

export function hasStructuralRegression(text: string): boolean {
  if (text.length < 2000) return false;
  const tail = text.slice(-1500);
  const scriptOpens = (tail.match(/<script[\s>]/gi) || []).length;
  const scriptCloses = (tail.match(/<\/script>/gi) || []).length;
  const styleOpens = (tail.match(/<style[\s>]/gi) || []).length;
  const styleCloses = (tail.match(/<\/style>/gi) || []).length;
  const unbalanced = (scriptOpens - scriptCloses) + (styleOpens - styleCloses);
  return unbalanced > 5;
}

export function buildStructuralSummary(text: string, maxLen = 600): string {
  const lines = text.split('\n');
  const totalChars = text.length;
  const totalLines = lines.length;
  const parts: string[] = [];
  parts.push(`[Prior output: ${totalChars} chars, ${totalLines} lines]`);

  const tagRe = /<(\/?)(\w+)[\s>]/g;
  const openStack: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text)) !== null) {
    if (m[1]) {
      const idx = openStack.lastIndexOf(m[2]);
      if (idx >= 0) openStack.splice(idx, 1);
    } else {
      openStack.push(m[2]);
    }
  }
  if (openStack.length > 0) {
    parts.push(`Currently open tags: ${openStack.slice(-8).join(' > ')}`);
  }
  return parts.join('\n').slice(0, maxLen);
}

export function buildContinuationMessages(
  apiMessages: Array<Record<string, unknown>>,
  priorAssistantText: string,
): Array<Record<string, unknown>> {
  const insideArtifact = isInsideArtifact(priorAssistantText);

  let assistantContent: string;
  if (priorAssistantText.length <= CONTINUATION_FULL_TEXT_LIMIT) {
    assistantContent = priorAssistantText;
  } else {
    const summary = buildStructuralSummary(
      priorAssistantText.slice(0, priorAssistantText.length - CONTINUATION_TAIL_CHARS),
    );
    const tail = priorAssistantText.slice(-CONTINUATION_TAIL_CHARS);
    assistantContent = `${summary}\n\n[...truncated for context window...]\n\n${tail}`;
  }

  const messages: Array<Record<string, unknown>> = [
    ...apiMessages,
    { role: 'assistant', content: assistantContent },
  ];

  if (insideArtifact) {
    messages.push({
      role: 'system',
      content:
        'You are mid-stream inside an unclosed <lucen_artifact> tag. Do NOT re-emit the opening tag. Continue the artifact body exactly where it left off. Emit </lucen_artifact> once the content is complete.',
    });
  }

  messages.push({
    role: 'user',
    content:
      'Continue from exactly where you stopped. Do not repeat anything, do not add any preamble, do not acknowledge the cut, do not summarize.',
  });

  return messages;
}
