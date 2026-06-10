export interface ModelConfig {
  modelDisplayName: string;
  supportsReasoning: boolean;
  contextWindowTokens: number;
  maxOutputTokens: number;
  tokensPerSecond: number;
}

// Registry of known popular models
export const KNOWN_MODELS: Record<string, ModelConfig> = {
  'minimax/minimax-01': {
    modelDisplayName: 'Lucen M2.7',
    supportsReasoning: true,
    contextWindowTokens: 131072,
    maxOutputTokens: 32768,
    tokensPerSecond: 40,
  },
  'openai/gpt-4o': {
    modelDisplayName: 'GPT-4o',
    supportsReasoning: false,
    contextWindowTokens: 128000,
    maxOutputTokens: 16384,
    tokensPerSecond: 80,
  },
  'openai/gpt-4o-mini': {
    modelDisplayName: 'GPT-4o mini',
    supportsReasoning: false,
    contextWindowTokens: 128000,
    maxOutputTokens: 16384,
    tokensPerSecond: 100,
  },
  'openai/o1': {
    modelDisplayName: 'o1',
    supportsReasoning: true,
    contextWindowTokens: 200000,
    maxOutputTokens: 32768,
    tokensPerSecond: 20,
  },
  'openai/o1-mini': {
    modelDisplayName: 'o1-mini',
    supportsReasoning: true,
    contextWindowTokens: 128000,
    maxOutputTokens: 16384,
    tokensPerSecond: 30,
  },
  'openai/o3-mini': {
    modelDisplayName: 'o3-mini',
    supportsReasoning: true,
    contextWindowTokens: 200000,
    maxOutputTokens: 32768,
    tokensPerSecond: 50,
  },
  'google/gemini-2.5-pro': {
    modelDisplayName: 'Gemini 2.5 Pro',
    supportsReasoning: false,
    contextWindowTokens: 2000000,
    maxOutputTokens: 8192,
    tokensPerSecond: 40,
  },
  'google/gemini-2.5-flash': {
    modelDisplayName: 'Gemini 2.5 Flash',
    supportsReasoning: false,
    contextWindowTokens: 1000000,
    maxOutputTokens: 8192,
    tokensPerSecond: 80,
  },
  'deepseek/deepseek-r1': {
    modelDisplayName: 'DeepSeek R1',
    supportsReasoning: true,
    contextWindowTokens: 163840,
    maxOutputTokens: 8192,
    tokensPerSecond: 30,
  },
  'deepseek/deepseek-chat': {
    modelDisplayName: 'DeepSeek V3',
    supportsReasoning: false,
    contextWindowTokens: 64000,
    maxOutputTokens: 8192,
    tokensPerSecond: 60,
  },
  'x-ai/grok-2-1212': {
    modelDisplayName: 'Grok 2',
    supportsReasoning: false,
    contextWindowTokens: 131072,
    maxOutputTokens: 4096,
    tokensPerSecond: 50,
  },
};

/**
 * Resolves configuration parameters for a model ID, falling back to sensible defaults.
 */
export function getModelConfig(modelId: string): ModelConfig {
  if (!modelId) {
    return {
      modelDisplayName: 'Unknown Model',
      supportsReasoning: false,
      contextWindowTokens: 128000,
      maxOutputTokens: 4096,
      tokensPerSecond: 40,
    };
  }

  // Exact match
  if (KNOWN_MODELS[modelId]) {
    return { ...KNOWN_MODELS[modelId] };
  }

  // Partial match heuristics
  const idLower = modelId.toLowerCase();
  const isReasoning = idLower.includes('r1') || idLower.includes('/o1') || idLower.includes('o3-') || idLower.includes('reasoning') || idLower.includes('thinking');
  let displayName = modelId.split('/').pop() || modelId;
  displayName = displayName
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  let contextWindow = 128000;
  if (idLower.includes('gemini-2.5')) {
    contextWindow = idLower.includes('pro') ? 2000000 : 1000000;
  } else if (idLower.includes('r1') || idLower.includes('o1') || idLower.includes('o3')) {
    contextWindow = 200000;
  }

  let maxOutput = 8192;
  if (idLower.includes('o1') || idLower.includes('o3') || idLower.includes('minimax-01')) {
    maxOutput = 32768;
  } else if (idLower.includes('grok')) {
    maxOutput = 4096;
  }

  return {
    modelDisplayName: displayName,
    supportsReasoning: isReasoning,
    contextWindowTokens: contextWindow,
    maxOutputTokens: maxOutput,
    tokensPerSecond: idLower.includes('flash') || idLower.includes('mini') ? 80 : 40,
  };
}

/**
 * Normalizes OpenRouter API request parameters based on specific model quirks.
 */
export function normalizeModelParams(modelId: string, payload: Record<string, any>): Record<string, any> {
  const normalized = { ...payload };
  const idLower = (modelId || '').toLowerCase();

  // 1. OpenAI reasoning models: require temperature = 1 or omitted, strip unsupported params
  const isOpenAiReasoning = idLower.includes('/o1') || idLower.includes('/o3') || idLower.includes('openai/o1') || idLower.includes('openai/o3');
  
  if (isOpenAiReasoning) {
    // Strip temperature, top_p, penalties
    delete normalized.temperature;
    delete normalized.top_p;
    delete normalized.presence_penalty;
    delete normalized.frequency_penalty;

    // OpenAI o1 series requires max_completion_tokens instead of max_tokens
    if (normalized.max_tokens !== undefined) {
      normalized.max_completion_tokens = normalized.max_tokens;
      delete normalized.max_tokens;
    }
  }

  // 2. Adjust reasoning effort/payload for supporting models
  if (normalized.is_reasoning || normalized.reasoning) {
    const supportsReasoning = getModelConfig(modelId).supportsReasoning;
    if (supportsReasoning) {
      // Setup correct OpenRouter reasoning payload structure
      normalized.reasoning = {
        enabled: true,
        ...(idLower.includes('o1') || idLower.includes('o3') ? { effort: 'high' } : {})
      };
      delete normalized.is_reasoning;
    } else {
      // Model does not support reasoning, strip it to prevent validation error
      delete normalized.is_reasoning;
      delete normalized.reasoning;
    }
  }

  return normalized;
}

/**
 * Builds dynamic HTTP response headers matching the successful model's metadata, respecting env overrides.
 */
export function getDynamicHeaders(chosenModel: string, modelType: string): Record<string, string> {
  const modelConfig = getModelConfig(chosenModel);
  const isSide = modelType === 'side-chat-model';
  const isMain = modelType === 'main-chat-model';
  const prefix = isSide ? 'SIDE_CHAT_' : isMain ? 'MAIN_CHAT_' : '';

  const denoEnv = (globalThis as any).Deno?.env;

  let displayName = modelConfig.modelDisplayName;
  if (prefix && denoEnv?.get(`${prefix}MODEL_NAME`)) {
    displayName = denoEnv.get(`${prefix}MODEL_NAME`)!;
  }
  let supportsReasoning = String(modelConfig.supportsReasoning);
  if (prefix && denoEnv?.get(`${prefix}SUPPORTS_REASONING`)) {
    supportsReasoning = denoEnv.get(`${prefix}SUPPORTS_REASONING`)!;
  }
  let contextWindow = String(modelConfig.contextWindowTokens);
  if (prefix && denoEnv?.get(`${prefix}CONTEXT_WINDOW`)) {
    contextWindow = denoEnv.get(`${prefix}CONTEXT_WINDOW`)!;
  }
  let maxOutput = String(modelConfig.maxOutputTokens);
  if (prefix && denoEnv?.get(`${prefix}MAX_OUTPUT`)) {
    maxOutput = denoEnv.get(`${prefix}MAX_OUTPUT`)!;
  }
  let tokensPerSecond = String(modelConfig.tokensPerSecond);
  if (prefix) {
    const envTps = isSide
      ? denoEnv?.get('SIDE_CHAT_TOKENS_PER_SECOND')
      : denoEnv?.get('VITE_MAIN_CHAT_TOKENS_PER_SECOND') ?? denoEnv?.get('MAIN_CHAT_TOKENS_PER_SECOND');
    if (envTps) tokensPerSecond = envTps;
  }

  return {
    'x-model-name': displayName,
    'x-supports-reasoning': supportsReasoning,
    'x-context-window': contextWindow,
    'x-max-output': maxOutput,
    'x-tokens-per-second': tokensPerSecond,
    'Access-Control-Expose-Headers': 'x-model-name, x-supports-reasoning, x-context-window, x-max-output, x-tokens-per-second',
  };
}


