import { describe, it, expect, beforeAll } from 'vitest';

// Mock Deno environment for Vitest/Node run
beforeAll(() => {
  if (typeof (globalThis as any).Deno === 'undefined') {
    (globalThis as any).Deno = {
      env: {
        get: (key: string) => {
          const mockEnv: Record<string, string> = {
            'MAIN_CHAT_MODEL_NAME': 'Custom Main Name',
            'MAIN_CHAT_SUPPORTS_REASONING': 'true',
            'MAIN_CHAT_CONTEXT_WINDOW': '100000',
            'MAIN_CHAT_MAX_OUTPUT': '20000',
            'VITE_MAIN_CHAT_TOKENS_PER_SECOND': '45',
          };
          return mockEnv[key] ?? undefined;
        },
      },
    };
  }
});

import { getModelConfig, getDynamicHeaders } from '../../supabase/functions/_shared/models';

describe('Shared Models Module', () => {
  describe('getModelConfig', () => {
    it('should resolve known models correctly', () => {
      const config = getModelConfig('openai/o3-mini');
      expect(config.modelDisplayName).toBe('o3-mini');
      expect(config.supportsReasoning).toBe(true);
      expect(config.maxOutputTokens).toBe(32768);
    });

    it('should fall back to sensible defaults for unknown models', () => {
      const config = getModelConfig('unknown/some-experimental-model');
      expect(config.modelDisplayName).toBe('Some Experimental Model');
      expect(config.supportsReasoning).toBe(false);
    });

    it('should detect reasoning capability from model names', () => {
      const config = getModelConfig('deepseek/deepseek-r1');
      expect(config.supportsReasoning).toBe(true);
    });
  });


  describe('getDynamicHeaders', () => {
    it('should generate headers using environment overrides if matched', () => {
      const headers = getDynamicHeaders('openai/gpt-4o', 'main-chat-model');
      expect(headers['x-model-name']).toBe('Custom Main Name');
      expect(headers['x-supports-reasoning']).toBe('true');
      expect(headers['x-context-window']).toBe('100000');
      expect(headers['x-max-output']).toBe('20000');
      expect(headers['x-tokens-per-second']).toBe('45');
    });

    it('should generate default headers for non-overridden models', () => {
      const headers = getDynamicHeaders('openai/gpt-4o', 'side-chat-model');
      expect(headers['x-model-name']).toBe('GPT-4o');
      expect(headers['x-supports-reasoning']).toBe('false');
      expect(headers['x-context-window']).toBe('128000');
      expect(headers['x-max-output']).toBe('16384');
      expect(headers['x-tokens-per-second']).toBe('80');
    });
  });
});
