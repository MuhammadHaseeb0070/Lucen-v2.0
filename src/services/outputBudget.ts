import type { Message, ModelInfo } from '../types';
import { ABSOLUTE_OUTPUT_CEILING, PLATFORM_MAX_STREAM_SECONDS } from '../config/models';

/**
 * Response mode dictates how many output tokens a single model call is
 * allowed to produce. Anything longer is handled via the continuation loop
 * in streamViaEdgeFunctionWrapper.
 *
 *   - 'artifact' — response likely contains a <lucen_artifact> (code, HTML,
 *                  SVG, mermaid, file). Gets the biggest practical budget
 *                  because big documents benefit from single-pass coherence.
 *   - 'chat'     — plain conversational response. Slightly smaller default
 *                  because markdown chat rarely needs >6k tokens at once.
 */
export type ResponseMode = 'artifact' | 'chat';

// Minimum budget we'll ever send. Prevents degenerate "0 tokens" calls when
// the context pruning accidentally overshoots.
export const MIN_PER_CALL_OUTPUT = 1024;

// Safety headroom (tokens) for tokenizer approximation error + per-request
// role/BOS/EOS overhead. Subtracted from `contextWindow` when computing the
// upper bound on a single call.
export const SAFETY_HEADROOM = 512;

// Hard server-side ceiling. Exported for chat-proxy to mirror.
// Re-exported here so callers that already imported from this file keep
// working; sourced from the env-driven platform config.
export const ABSOLUTE_CEILING = ABSOLUTE_OUTPUT_CEILING;

// ─── Mode detection (heuristic — cheap, regex-based) ─────────────────────

const BUILD_VERBS = /\b(build|make|create|generate|write|produce|draft|design|code|render|compose)\b/i;
const ARTIFACT_NOUNS =
    /\b(html|app|site|website|page|component|widget|game|dashboard|form|calculator|chart|graph|diagram|flowchart|mermaid|svg|icon|logo|illustration|artifact|document|file|script|snippet|report|resume|cv|email template|landing page|story|essay|novel|chapter|article|book)\b/i;
const ARTIFACT_FILE_EXT = /\.(html|svg|mermaid|md|json|csv|yaml|yml|env|py|ts|tsx|js|jsx|css|xml|txt)\b/i;
const ARTIFACT_IMPERATIVE =
    /\b(give me|show me|turn this into|convert to|export as|download|full code|complete code|entire code)\b/i;
const LONG_FORM =
    /\b(long|full|complete|detailed|comprehensive|in depth|\d{3,}\s*(?:words?|tokens?|lines?))\b/i;
const EXPLICITLY_SHORT =
    /\b(one[- ]liner|one line|short answer|quick|briefly|in a sentence|tl;?dr|summar(?:ize|y))\b/i;

function extractText(content: Message['content'] | unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return (content as Array<Record<string, unknown>>)
            .filter((p) => p && (p as { type?: unknown }).type === 'text')
            .map((p) => String((p as { text?: unknown }).text || ''))
            .join(' ');
    }
    return '';
}

export function detectResponseMode(messages: Message[]): ResponseMode {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return 'chat';

    const text = extractText(lastUser.content).trim();
    if (!text) return 'chat';

    // User explicitly asked for something short → always chat mode.
    if (EXPLICITLY_SHORT.test(text) && !ARTIFACT_IMPERATIVE.test(text) && !LONG_FORM.test(text)) {
        return 'chat';
    }

    // Strong artifact signals
    if (ARTIFACT_IMPERATIVE.test(text)) return 'artifact';
    if (BUILD_VERBS.test(text) && ARTIFACT_NOUNS.test(text)) return 'artifact';
    if (ARTIFACT_FILE_EXT.test(text)) return 'artifact';

    // A user asking for long-form prose (essay, story, chapter) benefits from
    // artifact-mode caps even without an explicit "make a file" request.
    if (LONG_FORM.test(text) && BUILD_VERBS.test(text)) return 'artifact';

    // Code attachment + a build verb → user is asking for a transformation.
    const hasCodeAttachment = (lastUser.attachments || []).some(
        (a) => a.type !== 'image' && (a.textContent || '').length > 200,
    );
    if (hasCodeAttachment && BUILD_VERBS.test(text)) return 'artifact';

    return 'chat';
}

// ─── Dynamic per-call cap ────────────────────────────────────────────────

/**
 * Compute a safe per-call `max_tokens` value based on the model's real
 * capabilities and the Supabase streaming wall-clock budget.
 *
 *   timeCap       = tokensPerSecond * MAX_STREAM_SECONDS
 *                   (so the stream finishes before Supabase's 150s idle cut)
 *   leakBonus     = 2 for reasoning-leak models (MiniMax M2, DeepSeek R1)
 *                   in artifact mode — they need extra room for thinking
 *                   tokens that get mixed into the content channel.
 *   wallClockCap  = floor(timeCap * leakBonus)
 *
 *   final = min(
 *       wallClockCap,
 *       model.maxOutputTokens,                    // model capability
 *       ABSOLUTE_CEILING,                         // hard safety cap
 *       model.contextWindow - SAFETY_HEADROOM,    // leave room for input
 *   ) clamped to MIN_PER_CALL_OUTPUT
 */
export function getPerCallOutput(mode: ResponseMode, model: ModelInfo): number {
    const tps = Math.max(1, model.tokensPerSecond || 40);
    const timeCap = tps * PLATFORM_MAX_STREAM_SECONDS;

    const leakBonus = mode === 'artifact' && model.reasoningLeak ? 2 : 1;
    const wallClockCap = Math.floor(timeCap * leakBonus);

    const modelCap = Math.max(1, model.maxOutputTokens || wallClockCap);
    const ctxCap = Math.max(1, (model.contextWindow || wallClockCap) - SAFETY_HEADROOM);

    const raw = Math.min(wallClockCap, modelCap, ABSOLUTE_CEILING, ctxCap);
    return Math.max(MIN_PER_CALL_OUTPUT, raw);
}

/**
 * Shrink the per-call cap further when the *input* is already so large that
 * there's not enough context-window headroom for a full call. This is the
 * only case where the final budget goes BELOW `getPerCallOutput`.
 */
export function narrowForInput(
    perCallCap: number,
    inputTokens: number,
    contextWindow: number,
): number {
    const remaining = contextWindow - inputTokens - SAFETY_HEADROOM;
    if (remaining <= 0) return MIN_PER_CALL_OUTPUT;
    return Math.max(MIN_PER_CALL_OUTPUT, Math.min(perCallCap, remaining));
}
