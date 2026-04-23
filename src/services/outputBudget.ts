import type { Message } from '../types';

/**
 * Response mode dictates how many output tokens a single model call is
 * allowed to produce. Anything longer is handled via structured
 * continuation (see streamViaEdgeFunctionWrapper in openrouter.ts).
 *
 *  - 'artifact'  — response likely contains a <lucen_artifact> (code, HTML,
 *                  SVG, mermaid, downloadable file). Small cap keeps each
 *                  request well under the Supabase Edge wall-clock limit and
 *                  prevents the browser from re-rendering huge documents on
 *                  every chunk.
 *  - 'chat'      — plain conversational response. Larger cap is fine because
 *                  markdown text is cheap to re-render.
 */
export type ResponseMode = 'artifact' | 'chat';

export const PER_CALL_OUTPUT: Record<ResponseMode, number> = {
    artifact: 2048,
    chat: 6144,
};

// Hard server-side ceiling. Even if a client somehow requests more, we never
// exceed this. This is the last line of defence against runaway generation.
export const ABSOLUTE_CEILING = 8192;

// Heuristic that classifies the *likely* shape of the upcoming response from
// the current user turn. We don't run a model for this — a cheap regex is
// enough because the cost of being wrong is one extra continuation call.
const BUILD_VERBS = /\b(build|make|create|generate|write|produce|draft|design|code|render|compose)\b/i;
const ARTIFACT_NOUNS =
    /\b(html|app|site|website|page|component|widget|game|dashboard|form|calculator|chart|graph|diagram|flowchart|mermaid|svg|icon|logo|illustration|artifact|document|file|script|snippet|report|resume|cv|email template|landing page)\b/i;
const ARTIFACT_FILE_EXT = /\.(html|svg|mermaid|md|json|csv|yaml|yml|env|py|ts|tsx|js|jsx|css|xml|txt)\b/i;
const ARTIFACT_IMPERATIVE =
    /\b(give me|show me|turn this into|convert to|export as|download|full code|complete code|entire code)\b/i;
const EXPLICITLY_SHORT =
    /\b(one[- ]liner|one line|short answer|quick|briefly|in a sentence|tl;?dr|summar(?:ize|y)|explain)\b/i;

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
    // The last user message is the most reliable signal for what the assistant
    // is about to produce.
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return 'chat';

    const text = extractText(lastUser.content).trim();
    if (!text) return 'chat';

    // User explicitly asked for something short → always chat mode.
    if (EXPLICITLY_SHORT.test(text) && !ARTIFACT_IMPERATIVE.test(text)) {
        return 'chat';
    }

    // Strong artifact signals
    if (ARTIFACT_IMPERATIVE.test(text)) return 'artifact';
    if (BUILD_VERBS.test(text) && ARTIFACT_NOUNS.test(text)) return 'artifact';
    if (ARTIFACT_FILE_EXT.test(text)) return 'artifact';

    // If the user attached code/image files and is asking for a
    // transformation/rewrite, the response is likely an artifact.
    const hasCodeAttachment = (lastUser.attachments || []).some(
        (a) => a.type !== 'image' && (a.textContent || '').length > 200,
    );
    if (hasCodeAttachment && BUILD_VERBS.test(text)) return 'artifact';

    return 'chat';
}

export function getPerCallOutput(mode: ResponseMode): number {
    return Math.min(PER_CALL_OUTPUT[mode], ABSOLUTE_CEILING);
}
