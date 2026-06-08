import type { Message } from '../../types';
import { supabase } from '../../lib/supabase';
import { captureCall } from '../../store/debugStore';
import { logger } from '../../lib/logger';

function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function retrieveRelevantChunks(
  messages: Message[],
  conversationId: string | null,
  correlationId?: string
): Promise<string | null> {
  logger.debug('[RAG] Starting check. ConvID:', conversationId, { correlationId });

  if (!conversationId) {
    return null;
  }

  const hasFiles = messages.some(m =>
    m.attachments?.some(a => a.type !== 'image')
  );
  if (!hasFiles) {
    return null;
  }

  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser || !lastUser.content || lastUser.content.length < 2) {
    return null;
  }

  logger.debug('[RAG] Requirements met, calling Supabase...', { correlationId });

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  try {
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) {
      logger.debug('[RAG] Aborted: No active auth session.', { correlationId });
      return null;
    }

    const retrieveRequestId = newRequestId();
    const retrieveEndpoint = `${supabaseUrl}/functions/v1/retrieve-chunks`;
    const retrieveBody = {
      query: lastUser.content,
      conversation_id: conversationId,
      top_k: 5,
      request_id: retrieveRequestId,
    };
    const finalizeRetrieve = captureCall({
      id: retrieveRequestId,
      kind: 'retrieve',
      endpoint: retrieveEndpoint,
      request: retrieveBody,
    });

    const response = await fetch(retrieveEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': anonKey || '',
      },
      body: JSON.stringify(retrieveBody),
    });

    if (!response.ok) {
      const t = await response.text().catch(() => '');
      finalizeRetrieve({ status: response.status, response: t.slice(0, 4000), error: `HTTP ${response.status}` });
      logger.debug('[RAG] Supabase error:', response.status, { correlationId });
      return null;
    }
    const data = await response.json();
    finalizeRetrieve({ status: response.status, response: data });
    const chunks = data.chunks as Array<{ file_name: string; content: string; similarity: number }>;

    if (!chunks || chunks.length === 0) {
      logger.debug('[RAG] No chunks returned from search.', { correlationId });
      return null;
    }

    const relevant = chunks.filter(c => c.similarity > 0.5);
    if (relevant.length === 0) {
      logger.debug('[RAG] No chunks met similarity threshold (> 0.5).', { correlationId });
      return null;
    }

    const parts = relevant.map(c =>
      `── From: ${c.file_name} (relevance: ${Math.round(c.similarity * 100)}%) ──\n${c.content}`
    );

    logger.debug(`[RAG] Success! Injected ${relevant.length} chunks.`, { correlationId });
    return `[Relevant file context retrieved for this query]\n${parts.join('\n\n')}`;

  } catch (err) {
    logger.error('[RAG] Final Catch Error:', err, { correlationId });
    return null;
  }
}
