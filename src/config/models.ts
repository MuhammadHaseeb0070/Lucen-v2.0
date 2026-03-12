import type { ModelInfo } from '../types';

// Fully driven by .env — just set VITE_OPENROUTER_MODEL and VITE_OPENROUTER_MODEL_NAME
const DEFAULT_MODEL_ID = import.meta.env.VITE_OPENROUTER_MODEL || 'deepseek/deepseek-v3.2';
const DEFAULT_MODEL_NAME = import.meta.env.VITE_OPENROUTER_MODEL_NAME || DEFAULT_MODEL_ID.split('/').pop() || 'AI';

const MAIN_MODEL_ID = import.meta.env.VITE_MAIN_CHAT_MODEL || DEFAULT_MODEL_ID;
const SIDE_MODEL_ID = import.meta.env.VITE_SIDE_CHAT_MODEL || DEFAULT_MODEL_ID;

const MAIN_MODEL_NAME = import.meta.env.VITE_MAIN_CHAT_MODEL_NAME || MAIN_MODEL_ID.split('/').pop() || DEFAULT_MODEL_NAME;
const SIDE_MODEL_NAME = import.meta.env.VITE_SIDE_CHAT_MODEL_NAME || SIDE_MODEL_ID.split('/').pop() || DEFAULT_MODEL_NAME;

export function getActiveModel(isSideChat = false): ModelInfo {
    const id = isSideChat ? SIDE_MODEL_ID : MAIN_MODEL_ID;
    const name = isSideChat ? SIDE_MODEL_NAME : MAIN_MODEL_NAME;
    const provider = id.split('/')[0] || 'Unknown';
    const supportsReasoning = import.meta.env.VITE_SUPPORTS_REASONING === 'true';
    return {
        id,
        name,
        provider,
        supportsReasoning,
        maxTokens: 16384,
        inputCostPer1k: 0.001,
        outputCostPer1k: 0.002,
    };
}
