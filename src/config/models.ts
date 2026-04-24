import type { ModelInfo } from '../types';

/**
 * Model configuration — 100% env-driven so you can swap any OpenRouter model
 * without code changes. Every variable has a fallback so the app still boots
 * if you leave some blank, but for production you should fill in the real
 * numbers from the model's OpenRouter page so the output budget, context
 * pruning, and cost accounting all match reality.
 */

// ─── Legacy fallback (used when role-specific vars are missing) ───────────
const DEFAULT_MODEL_ID = import.meta.env.VITE_OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const DEFAULT_MODEL_NAME =
    import.meta.env.VITE_OPENROUTER_MODEL_NAME || DEFAULT_MODEL_ID.split('/').pop() || 'AI';

// ─── Role-specific model ids ──────────────────────────────────────────────
const MAIN_MODEL_ID = import.meta.env.VITE_MAIN_CHAT_MODEL || DEFAULT_MODEL_ID;
const SIDE_MODEL_ID = import.meta.env.VITE_SIDE_CHAT_MODEL || DEFAULT_MODEL_ID;

const MAIN_MODEL_NAME =
    import.meta.env.VITE_MAIN_CHAT_MODEL_NAME || MAIN_MODEL_ID.split('/').pop() || DEFAULT_MODEL_NAME;
const SIDE_MODEL_NAME =
    import.meta.env.VITE_SIDE_CHAT_MODEL_NAME || SIDE_MODEL_ID.split('/').pop() || DEFAULT_MODEL_NAME;

// ─── Safe env parsing helpers ─────────────────────────────────────────────
function envInt(key: string, fallback: number): number {
    const raw = (import.meta.env as Record<string, string | undefined>)[key];
    if (!raw) return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envFloat(key: string, fallback: number): number {
    const raw = (import.meta.env as Record<string, string | undefined>)[key];
    if (!raw) return fallback;
    const n = parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
    const raw = (import.meta.env as Record<string, string | undefined>)[key];
    if (raw === undefined) return fallback;
    return raw === 'true' || raw === '1';
}

// ─── Legacy generic fallbacks (existing deployments use these) ────────────
const LEGACY_CONTEXT = envInt('VITE_MODEL_CONTEXT_WINDOW', 131072);
const LEGACY_MAX_OUTPUT = envInt('VITE_MODEL_MAX_OUTPUT', 32768);
const LEGACY_SUPPORTS_REASONING = envBool('VITE_SUPPORTS_REASONING', false);

// ─── MAIN chat model capacity / spec ──────────────────────────────────────
const MAIN_CONTEXT_WINDOW = envInt('VITE_MAIN_CHAT_CONTEXT_WINDOW', LEGACY_CONTEXT);
const MAIN_MAX_OUTPUT = envInt('VITE_MAIN_CHAT_MAX_OUTPUT', LEGACY_MAX_OUTPUT);
const MAIN_SUPPORTS_REASONING = envBool('VITE_MAIN_CHAT_SUPPORTS_REASONING', LEGACY_SUPPORTS_REASONING);
const MAIN_REASONING_LEAK = envBool('VITE_MAIN_CHAT_REASONING_LEAK', false);
const MAIN_SUPPORTS_VISION = envBool('VITE_MAIN_MODEL_SUPPORTS_VISION', false);
const MAIN_TOKENS_PER_SECOND = envInt('VITE_MAIN_CHAT_TOKENS_PER_SECOND', 40);
const MAIN_INPUT_COST_PER_1M = envFloat('VITE_MAIN_CHAT_INPUT_COST_PER_1M', 0);
const MAIN_OUTPUT_COST_PER_1M = envFloat('VITE_MAIN_CHAT_OUTPUT_COST_PER_1M', 0);

// ─── SIDE chat model (used for title generation, intent classify, etc.) ───
const SIDE_CONTEXT_WINDOW = envInt('VITE_SIDE_CHAT_CONTEXT_WINDOW', LEGACY_CONTEXT);
const SIDE_MAX_OUTPUT = envInt('VITE_SIDE_CHAT_MAX_OUTPUT', LEGACY_MAX_OUTPUT);
const SIDE_SUPPORTS_REASONING = envBool('VITE_SIDE_CHAT_SUPPORTS_REASONING', false);
const SIDE_REASONING_LEAK = envBool('VITE_SIDE_CHAT_REASONING_LEAK', false);
const SIDE_SUPPORTS_VISION = envBool('VITE_SIDE_MODEL_SUPPORTS_VISION', false);
const SIDE_TOKENS_PER_SECOND = envInt('VITE_SIDE_CHAT_TOKENS_PER_SECOND', 60);
const SIDE_INPUT_COST_PER_1M = envFloat('VITE_SIDE_CHAT_INPUT_COST_PER_1M', 0);
const SIDE_OUTPUT_COST_PER_1M = envFloat('VITE_SIDE_CHAT_OUTPUT_COST_PER_1M', 0);

// ─── Platform budgets (exported for outputBudget + openrouter services) ───
export const PLATFORM_MAX_STREAM_SECONDS = envInt('VITE_PLATFORM_MAX_STREAM_SECONDS', 140);
export const CONTINUATION_MAX_CHUNKS_ARTIFACT = envInt('VITE_CONTINUATION_MAX_CHUNKS_ARTIFACT', 12);
export const CONTINUATION_MAX_CHUNKS_CHAT = envInt('VITE_CONTINUATION_MAX_CHUNKS_CHAT', 4);
export const ABSOLUTE_OUTPUT_CEILING = envInt('VITE_ABSOLUTE_OUTPUT_CEILING', 32768);
export const STREAM_IDLE_TIMEOUT_MS = envInt('VITE_STREAM_IDLE_TIMEOUT_MS', 30000);
export const MIDSTREAM_PERSIST_MS = envInt('VITE_MIDSTREAM_PERSIST_MS', 1500);

export function getActiveModel(isSideChat = false): ModelInfo {
    const id = isSideChat ? SIDE_MODEL_ID : MAIN_MODEL_ID;
    const name = isSideChat ? SIDE_MODEL_NAME : MAIN_MODEL_NAME;
    const provider = id.split('/')[0] || 'Unknown';

    const contextWindow = isSideChat ? SIDE_CONTEXT_WINDOW : MAIN_CONTEXT_WINDOW;
    const maxOutputTokens = isSideChat ? SIDE_MAX_OUTPUT : MAIN_MAX_OUTPUT;
    const supportsReasoning = isSideChat ? SIDE_SUPPORTS_REASONING : MAIN_SUPPORTS_REASONING;
    const reasoningLeak = isSideChat ? SIDE_REASONING_LEAK : MAIN_REASONING_LEAK;
    const supportsVision = isSideChat ? SIDE_SUPPORTS_VISION : MAIN_SUPPORTS_VISION;
    const tokensPerSecond = isSideChat ? SIDE_TOKENS_PER_SECOND : MAIN_TOKENS_PER_SECOND;
    const inputCostPer1m = isSideChat ? SIDE_INPUT_COST_PER_1M : MAIN_INPUT_COST_PER_1M;
    const outputCostPer1m = isSideChat ? SIDE_OUTPUT_COST_PER_1M : MAIN_OUTPUT_COST_PER_1M;

    return {
        id,
        name,
        provider,
        supportsReasoning,
        supportsVision,
        reasoningLeak,
        maxTokens: maxOutputTokens,
        maxOutputTokens,
        contextWindow,
        tokensPerSecond,
        inputCostPer1k: inputCostPer1m / 1000,
        outputCostPer1k: outputCostPer1m / 1000,
        inputCostPer1m,
        outputCostPer1m,
    };
}
