import { supabase, ensureFreshSession } from '../../lib/supabase';
import { getActiveModel } from '../../config/models';
import { PATCH_SIDECAR_SYSTEM_PROMPT } from '../../config/prompts';
import { logger } from '../../lib/logger';

export interface PatchCallRequest {
  currentCode: string;
  instruction: string;
  conversationId?: string;
  messageId?: string;
  chatContext?: any[];
}

export interface PatchCallResponse {
  ok: boolean;
  content: string;
  error?: string;
}

export async function executePatchCall({
  currentCode,
  instruction,
  conversationId,
  messageId,
  chatContext,
}: PatchCallRequest): Promise<PatchCallResponse> {
  try {
    if (!supabase) {
      return { ok: false, content: '', error: 'Supabase client not initialized' };
    }

    const fresh = await ensureFreshSession();
    if (!fresh) {
      return { ok: false, content: '', error: 'Session expired. Please sign in again.' };
    }

    const model = getActiveModel();

    const userMessageContent = `Current Artifact Code:
\`\`\`
${currentCode}
\`\`\`

User Instruction:
${instruction}`;

    const messages = [
      { role: 'system', content: PATCH_SIDECAR_SYSTEM_PROMPT },
      ...(chatContext || []),
      { role: 'user', content: userMessageContent }
    ];

    logger.debug('[PatchClient] sending patch request', {
      conversationId,
      messageId,
      model: model.id,
    });

    const { data, error } = await supabase.functions.invoke('chat-proxy', {
      body: {
        messages,
        model: model.id,
        stream: false,
        patch: true,
        call_kind: 'patch',
        conversation_id: conversationId,
        message_id: messageId,
      },
    });

    if (error) {
      logger.error('[PatchClient] Edge Function returned error:', error);
      return { ok: false, content: '', error: error.message || String(error) };
    }

    const choice = data?.choices?.[0];
    const content = choice?.message?.content || '';

    if (!content) {
      return { ok: false, content: '', error: 'No response content returned from model' };
    }

    return { ok: true, content };
  } catch (err: any) {
    logger.error('[PatchClient] Exception in executePatchCall:', err);
    return { ok: false, content: '', error: err.message || String(err) };
  }
}
