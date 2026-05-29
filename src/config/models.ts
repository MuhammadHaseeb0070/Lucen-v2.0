import type { ModelInfo } from '../types';
import { supabase, isSupabaseEnabled } from '../lib/supabase';
import { updateVariantIds } from './subscriptionConfig';
import { setAdminEmails } from './admin';

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
    modelDisplayName: 'Lucen M2.7',
    supportsReasoning: true,
    contextWindowTokens: 131072,
    maxOutputTokens: 32768,
    tokensPerSecond: 40,
    platformMaxStreamSeconds: 140,
};

let sideConfig: ModelConfig = {
    modelDisplayName: 'Lucen Helper',
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
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            if (data.mainConfig && typeof data.mainConfig === 'object') {
                mainConfig = {
                    modelDisplayName: data.mainConfig.modelDisplayName ?? mainConfig.modelDisplayName,
                    supportsReasoning: !!data.mainConfig.supportsReasoning,
                    contextWindowTokens: Number(data.mainConfig.contextWindowTokens) || mainConfig.contextWindowTokens,
                    maxOutputTokens: Number(data.mainConfig.maxOutputTokens) || mainConfig.maxOutputTokens,
                    tokensPerSecond: Number(data.mainConfig.tokensPerSecond) || mainConfig.tokensPerSecond,
                    platformMaxStreamSeconds: Number(data.mainConfig.platformMaxStreamSeconds) || mainConfig.platformMaxStreamSeconds,
                };
            }
            if (data.sideConfig && typeof data.sideConfig === 'object') {
                sideConfig = {
                    modelDisplayName: data.sideConfig.modelDisplayName ?? sideConfig.modelDisplayName,
                    supportsReasoning: !!data.sideConfig.supportsReasoning,
                    contextWindowTokens: Number(data.sideConfig.contextWindowTokens) || sideConfig.contextWindowTokens,
                    maxOutputTokens: Number(data.sideConfig.maxOutputTokens) || sideConfig.maxOutputTokens,
                    tokensPerSecond: Number(data.sideConfig.tokensPerSecond) || sideConfig.tokensPerSecond,
                    platformMaxStreamSeconds: Number(data.sideConfig.platformMaxStreamSeconds) || sideConfig.platformMaxStreamSeconds,
                };
            }
            
            if (data.lsVariantRegular) {
                updateVariantIds(data.lsVariantRegular, undefined);
            } else {
                console.warn('[ModelConfig] lsVariantRegular is missing or empty in backend response');
            }

            if (data.lsVariantPro) {
                updateVariantIds(undefined, data.lsVariantPro);
            } else {
                console.warn('[ModelConfig] lsVariantPro is missing or empty in backend response');
            }

            if (Array.isArray(data.adminEmails)) {
                setAdminEmails(data.adminEmails);
            }
            console.debug('[ModelConfig] Loaded securely from backend:', { mainConfig, sideConfig });
        } else {
            console.warn('[ModelConfig] received null or malformed data payload from backend:', data);
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
