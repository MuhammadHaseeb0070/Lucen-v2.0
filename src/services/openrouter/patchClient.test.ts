import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executePatchCall } from './patchClient';
import { supabase, ensureFreshSession } from '../../lib/supabase';
import { getActiveModel } from '../../config/models';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
  ensureFreshSession: vi.fn(),
}));

vi.mock('../../config/models', () => ({
  getActiveModel: vi.fn(),
}));

describe('patchClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should return error if session is not fresh', async () => {
    vi.mocked(ensureFreshSession).mockResolvedValue(false);

    const result = await executePatchCall({
      currentCode: 'some code',
      instruction: 'change code',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Session expired');
  });

  it('should invoke chat-proxy function successfully', async () => {
    vi.mocked(ensureFreshSession).mockResolvedValue(true);
    vi.mocked(getActiveModel).mockReturnValue({ id: 'main-chat-model' } as any);
    
    const mockResponse = {
      choices: [
        {
          message: {
            content: '<<<<<<< SEARCH\nsome code\n=======\nnew code\n>>>>>>> REPLACE',
          },
        },
      ],
    };
    
    vi.mocked(supabase!.functions.invoke).mockResolvedValue({
      data: mockResponse,
      error: null,
    });

    const result = await executePatchCall({
      currentCode: 'some code',
      instruction: 'change code',
      conversationId: 'test-conv',
      messageId: 'test-msg',
    });

    expect(result.ok).toBe(true);
    expect(result.content).toContain('<<<<<<< SEARCH');
    expect(supabase!.functions.invoke).toHaveBeenCalledWith('chat-proxy', {
      body: expect.objectContaining({
        model: 'main-chat-model',
        patch: true,
        stream: false,
        conversation_id: 'test-conv',
        message_id: 'test-msg',
      }),
    });
  });

  it('should return error if Edge Function returns an error', async () => {
    vi.mocked(ensureFreshSession).mockResolvedValue(true);
    vi.mocked(getActiveModel).mockReturnValue({ id: 'main-chat-model' } as any);
    
    vi.mocked(supabase!.functions.invoke).mockResolvedValue({
      data: null,
      error: new Error('Edge function error'),
    });

    const result = await executePatchCall({
      currentCode: 'some code',
      instruction: 'change code',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Edge function error');
  });
});
