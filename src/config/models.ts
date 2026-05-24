import type { ModelInfo } from '../types';
import { supabase, isSupabaseEnabled } from '../lib/supabase';

export interface ModelConfig {
    modelDisplayName: string;
    supportsReasoning: boolean;
    contextWindowTokens: number;
    maxOutputTokens: number;
    tokensPerSecond: number;
    platformMaxStreamSeconds: number;
}

// Default display-safe fallbacks. Will be updated dynamically via initializeModelConfig.
let mainConfig: ModelConfig = {
    modelDisplayName: import.meta.env.VITE_MAIN_CHAT_MODEL_NAME || 'Lucen M2.7',
    supportsReasoning: import.meta.env.VITE_MAIN_CHAT_SUPPORTS_REASONING === 'true',
    contextWindowTokens: 131072,
    maxOutputTokens: 32768,
    tokensPerSecond: 40,
    platformMaxStreamSeconds: 140,
};

let sideConfig: ModelConfig = {
    modelDisplayName: import.meta.env.VITE_SIDE_CHAT_MODEL_NAME || 'Lucen Helper',
    supportsReasoning: false,
    contextWindowTokens: 131072,
    maxOutputTokens: 32768,
    tokensPerSecond: 60,
    platformMaxStreamSeconds: 140,
};

// ─── Platform budgets ─────────────────────────────────────────────────────
export const PLATFORM_MAX_STREAM_SECONDS = 140;
/** Grace passes — set to 0 to disable continuation entirely (one-shot). */
export const CONTINUATION_MAX_CHUNKS_ARTIFACT = 0;
export const CONTINUATION_MAX_CHUNKS_CHAT = 0;
export const ABSOLUTE_OUTPUT_CEILING = 32000;
export const CHAT_OUTPUT_CEILING = 32000;
export const ARTIFACT_OUTPUT_CEILING = 32000;
export const STREAM_IDLE_TIMEOUT_MS = 30000;
export const MIDSTREAM_PERSIST_MS = 1500;

export async function initializeModelConfig() {
    if (!isSupabaseEnabled() || !supabase) return;
    try {
        const { data, error } = await supabase.functions.invoke('get-model-config');
        if (error) {
            console.warn('[ModelConfig] failed to fetch from backend:', error);
            return;
        }
        if (data) {
            mainConfig = {
                modelDisplayName: data.modelDisplayName ?? mainConfig.modelDisplayName,
                supportsReasoning: !!data.supportsReasoning,
                contextWindowTokens: Number(data.contextWindowTokens) || mainConfig.contextWindowTokens,
                maxOutputTokens: Number(data.maxOutputTokens) || mainConfig.maxOutputTokens,
                tokensPerSecond: Number(data.tokensPerSecond) || mainConfig.tokensPerSecond,
                platformMaxStreamSeconds: Number(data.platformMaxStreamSeconds) || mainConfig.platformMaxStreamSeconds,
            };
            console.debug('[ModelConfig] Loaded securely from backend:', mainConfig);
        }
    } catch (err) {
        console.warn('[ModelConfig] Fetch exception:', err);
    }
}

export function getActiveModel(isSideChat = false): ModelInfo {
    const cfg = isSideChat ? sideConfig : mainConfig;

    return {
        id: isSideChat ? 'side-chat-model' : 'main-chat-model',
        name: cfg.modelDisplayName,
        provider: 'Lucen',
        supportsReasoning: cfg.supportsReasoning,
        supportsVision: false, // Obsolete with native agentic tool calling
        reasoningLeak: false,
        maxTokens: cfg.maxOutputTokens,
        maxOutputTokens: cfg.maxOutputTokens,
        contextWindow: cfg.contextWindowTokens,
        tokensPerSecond: cfg.tokensPerSecond,
        inputCostPer1k: 0,
        outputCostPer1k: 0,
        inputCostPer1m: 0,
        outputCostPer1m: 0,
    };
}

export function updateConfigFromHeaders(isSideChat: boolean, headers: Headers) {
    const name = headers.get('x-model-name');
    const supportsReasoning = headers.get('x-supports-reasoning');
    const contextWindow = headers.get('x-context-window');
    const maxOutput = headers.get('x-max-output');
    const tokensPerSecond = headers.get('x-tokens-per-second');

    const cfg = isSideChat ? sideConfig : mainConfig;
    if (name) cfg.modelDisplayName = name;
    if (supportsReasoning !== null) cfg.supportsReasoning = supportsReasoning === 'true';
    if (contextWindow) cfg.contextWindowTokens = Number(contextWindow) || cfg.contextWindowTokens;
    if (maxOutput) cfg.maxOutputTokens = Number(maxOutput) || cfg.maxOutputTokens;
    if (tokensPerSecond) cfg.tokensPerSecond = Number(tokensPerSecond) || cfg.tokensPerSecond;
}
