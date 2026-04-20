import type { ModelInfo } from '../types';

const DEFAULT_MODEL_ID = import.meta.env.VITE_OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const DEFAULT_MODEL_NAME = import.meta.env.VITE_OPENROUTER_MODEL_NAME || DEFAULT_MODEL_ID.split('/').pop() || 'AI';

const MAIN_MODEL_ID = import.meta.env.VITE_MAIN_CHAT_MODEL || DEFAULT_MODEL_ID;
const SIDE_MODEL_ID = import.meta.env.VITE_SIDE_CHAT_MODEL || DEFAULT_MODEL_ID;

const MAIN_MODEL_NAME = import.meta.env.VITE_MAIN_CHAT_MODEL_NAME || MAIN_MODEL_ID.split('/').pop() || DEFAULT_MODEL_NAME;
const SIDE_MODEL_NAME = import.meta.env.VITE_SIDE_CHAT_MODEL_NAME || SIDE_MODEL_ID.split('/').pop() || DEFAULT_MODEL_NAME;

// ─── Model Capacity ───────────────────────────────────────────────────────────
// These can be overridden in .env to support any model without code changes.
// Defaults are conservative values that work safely across most modern LLMs.
//
//   VITE_MODEL_CONTEXT_WINDOW  — total context (input + output). e.g. 131072 for Grok
//   VITE_MODEL_MAX_OUTPUT      — max output the model supports. e.g. 32768 for Grok
//
const MODEL_CONTEXT_WINDOW = parseInt(import.meta.env.VITE_MODEL_CONTEXT_WINDOW || '400000', 10);
const MODEL_MAX_OUTPUT = parseInt(import.meta.env.VITE_MODEL_MAX_OUTPUT || '128000', 10);

// The SENT max_tokens starts at the model output ceiling but gets reduced
// dynamically based on actual input size (see openrouter.ts computeOutputBudget).
const STATIC_MAX_TOKENS = MODEL_MAX_OUTPUT;

// Whether the main/side model can natively accept images.
// Defaults to false (safest) so images are routed through the vision helper
// and only the main model's text pipeline is used for the final reply.
const MAIN_SUPPORTS_VISION = import.meta.env.VITE_MAIN_MODEL_SUPPORTS_VISION === 'true';
const SIDE_SUPPORTS_VISION = import.meta.env.VITE_SIDE_MODEL_SUPPORTS_VISION === 'true';

export function getActiveModel(isSideChat = false): ModelInfo {
    const id = isSideChat ? SIDE_MODEL_ID : MAIN_MODEL_ID;
    const name = isSideChat ? SIDE_MODEL_NAME : MAIN_MODEL_NAME;
    const provider = id.split('/')[0] || 'Unknown';
    const supportsReasoning = import.meta.env.VITE_SUPPORTS_REASONING === 'true';
    const supportsVision = isSideChat ? SIDE_SUPPORTS_VISION : MAIN_SUPPORTS_VISION;
    return {
        id,
        name,
        provider,
        supportsReasoning,
        supportsVision,
        maxTokens: STATIC_MAX_TOKENS,
        maxOutputTokens: MODEL_MAX_OUTPUT,
        contextWindow: MODEL_CONTEXT_WINDOW,
        inputCostPer1k: 0.001,
        outputCostPer1k: 0.002,
    };
}
