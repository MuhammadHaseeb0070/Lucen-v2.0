import type { Message } from '../../types';
import {
  getActiveModel,
  ABSOLUTE_OUTPUT_CEILING,
} from '../../config/models';
import { useUIStore } from '../../store/uiStore';
import { supabase, isSupabaseEnabled } from '../../lib/supabase';
import { useTokenStore } from '../../store/tokenStore';
import {
  detectResponseMode,
  getPerCallOutput,
  narrowForInput,
  SAFETY_HEADROOM,
  MIN_PER_CALL_OUTPUT,
  type ResponseMode,
} from '../outputBudget';
import { captureCall } from '../../store/debugStore';
import { retrieveRelevantChunks } from './rag';
import { buildApiMessages, pruneMessagesForContext } from './messages';
import { processStream, type StreamCallbacks, type StreamFinalizeSummary } from './streaming';
import { logger } from '../../lib/logger';

const SYSTEM_PROMPT_RESERVE = 5000;
const NETWORK_RETRY_DELAYS_MS = [500, 1000, 2000];

export interface StreamOptions {
  systemPromptOverride?: string;
  signal?: AbortSignal;
  isSideChat?: boolean;
  webSearchEnabled?: boolean;
  conversationId?: string;
  messageId?: string;
  continuation?: { priorAssistantText: string };
}

export interface CallAccounting {
  parentRequestId: string;
  messageId?: string;
  conversationId?: string;
  callKind: 'chat' | 'chat_continuation';
  inputCostPer1M: number;
  outputCostPer1M: number;
  correlationId: string;
}

export function generateRequestId(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function computeOutputBudget(
  apiMessages: Array<Record<string, unknown>>,
  contextWindow: number,
  perCallCap: number,
  correlationId?: string
): Promise<number> {
  try {
    const serialized = apiMessages
      .map((m) => {
        const content = m.content;
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
          return (content as Array<Record<string, unknown>>)
            .filter((p) => p.type === 'text')
            .map((p) => p.text as string)
            .join(' ');
        }
        return '';
      })
      .join('\n');

    const { countAsync } = useTokenStore.getState();
    const inputTokens = await countAsync(serialized);

    const budget = narrowForInput(perCallCap, inputTokens, contextWindow);

    logger.debug(
      `[TokenBudget] input=${inputTokens} ctx=${contextWindow} cap=${perCallCap} → budget=${budget}`,
      { correlationId }
    );
    return budget;
  } catch (err) {
    logger.warn('[TokenBudget] Counting failed, using fallback:', err, { correlationId });
    return Math.max(MIN_PER_CALL_OUTPUT, perCallCap);
  }
}

export async function streamChat(
  messages: Message[],
  callbacks: StreamCallbacks,
  options: StreamOptions = {}
): Promise<void> {
  const clientCorrelationId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : generateRequestId();
  try {
    const model = getActiveModel(options.isSideChat);

    const ragContext = await retrieveRelevantChunks(
      messages,
      options.conversationId || null,
      clientCorrelationId
    );

    if (!isSupabaseEnabled() || !supabase) {
      callbacks.onError('Please sign in to use chat.');
      callbacks.onDone(false);
      return;
    }

    const { data: { session }, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      callbacks.onError('Session expired. Please sign in again.');
      callbacks.onDone(false);
      return;
    }
    if (!session?.access_token) {
      callbacks.onError('Please sign in to use chat.');
      callbacks.onDone(false);
      return;
    }

    const isContinuation = !!options.continuation;
    const mode: ResponseMode = options.isSideChat
      ? 'chat'
      : isContinuation
        ? 'artifact'
        : detectResponseMode(messages);
    const perCallCap = getPerCallOutput(mode, model);

    const conversationBudget = Math.max(
      4096,
      model.contextWindow - perCallCap - SAFETY_HEADROOM - SYSTEM_PROMPT_RESERVE,
    );
    const { pruned: prunedMessages, droppedCount } = pruneMessagesForContext(messages, conversationBudget);

    let segmentSummary: string | null = null;
    if (droppedCount > 5) {
      try {
        const dropped = messages.filter(m => !prunedMessages.some(pm => pm.id === m.id));
        const droppedText = dropped.map(m => `${m.role}: ${m.content}`).join('\n');
        const { data } = await supabase.functions.invoke('generate-title', {
          body: {
            mode: 'summary',
            text_to_summarize: droppedText
          }
        });
        if (data?.summary) {
          segmentSummary = data.summary;
        }
      } catch (err) {
        logger.warn('[streamChat] failed to generate segment summary:', err, { correlationId: clientCorrelationId });
      }
    }

    const apiMessages = buildApiMessages(prunedMessages, options.systemPromptOverride, ragContext, {
      supportsVision: model.supportsVision,
      omittedTurnsCount: droppedCount,
      segmentSummary,
    });

    const outputBudget = await computeOutputBudget(
      apiMessages,
      model.contextWindow,
      perCallCap,
      clientCorrelationId
    );

    const continuationMod = await import('./continuation');
    const messagesWithBudget: Array<Record<string, unknown>> = isContinuation
      ? continuationMod.buildContinuationMessages(apiMessages, options.continuation!.priorAssistantText)
      : [
        ...apiMessages,
        {
          role: 'system',
          content:
            "[System Note: You have a large but STRICT token budget for this response. Plan your answer so it naturally finishes in this budget—pick depth and breadth you can carry to a clear ending (no mid-sentence cutoffs). If the ask is too large for one pass, deliver one complete useful slice and state that scope in plain language. Answer the user's real need directly. For artifacts: build a COMPLETE, working version — choose a scope you can finish, not one you'll have to truncate. Do not create an artifact unless they explicitly want a renderable or downloadable deliverable. Never mention tokens, budgets, limits, or chunking.]",
        },
      ];

    const isReasoningEnabled = options.isSideChat ? false : model.supportsReasoning;

    const rootRequestId = generateRequestId();
    const baseKind = 'chat';

    const accounting: CallAccounting = {
      parentRequestId: rootRequestId,
      messageId: options.messageId,
      conversationId: options.conversationId,
      callKind: isContinuation ? 'chat_continuation' : baseKind,
      inputCostPer1M: model.inputCostPer1m || 0,
      outputCostPer1M: model.outputCostPer1m || 0,
      correlationId: clientCorrelationId,
    };

    await streamViaEdgeFunctionWrapper(
      messagesWithBudget,
      model,
      session.access_token,
      callbacks,
      outputBudget,
      isReasoningEnabled,
      options.webSearchEnabled,
      options.signal,
      mode,
      0,
      isContinuation ? options.continuation!.priorAssistantText : '',
      accounting,
    );
  } catch (err: unknown) {
    logger.error('[streamChat] top-level catch:', err, { correlationId: clientCorrelationId });
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.onError(msg);
    callbacks.onDone(false);
  }
}

async function streamViaEdgeFunctionWrapper(
  apiMessages: Array<Record<string, unknown>>,
  model: ReturnType<typeof getActiveModel>,
  accessToken: string,
  callbacks: StreamCallbacks,
  outputBudget: number,
  isReasoningEnabled: boolean,
  webSearchEnabled?: boolean,
  signal?: AbortSignal,
  mode: ResponseMode = 'chat',
  continuationCount = 0,
  accumulated = '',
  accounting?: CallAccounting,
): Promise<void> {
  let passChars = 0;
  let passText = '';
  let fullResponse = accumulated;
  let contentChunkCount = 0;
  let reasoningChunkCount = 0;

  const continuationMod = await import('./continuation');
  const maxChunks = continuationMod.getMaxChunksForMode(mode);

  const innerCallbacks: StreamCallbacks = {
    ...callbacks,
    onChunk: (chunk, isContinuation) => {
      contentChunkCount++;
      passChars += chunk.length;
      passText += chunk;
      fullResponse += chunk;
      callbacks.onChunk(chunk, isContinuation || continuationCount > 0);
    },
    onReasoning: (reasoning) => {
      reasoningChunkCount++;
      callbacks.onReasoning(reasoning);
    },
    onDone: async (truncated) => {
      const userAborted = signal?.aborted === true;
      const hitChunkCeiling = continuationCount >= maxChunks;
      const isReasoningOnlyPass = reasoningChunkCount > 0 && contentChunkCount === 0;
      const stalled = isReasoningOnlyPass
        ? (continuationCount >= 1)
        : (contentChunkCount === 0 && reasoningChunkCount === 0 ? true : passChars < continuationMod.STALL_MIN_CONTINUATION_CHARS);
      const hitOutputCeiling = fullResponse.length >= ABSOLUTE_OUTPUT_CEILING * 4;
      const hitTurnBudget = fullResponse.length >= continuationMod.PER_TURN_OUTPUT_CHAR_BUDGET;
      const repeating =
        continuationCount > 0 &&
        continuationMod.isRepeatingLastWindow(accumulated, passText);
      const lowEntropy = continuationCount > 0 && continuationMod.isLowEntropy(passText);
      const structuralIssue = continuationCount > 0 && continuationMod.hasStructuralRegression(fullResponse);

      const shouldContinue =
        truncated === true
        && !userAborted
        && !hitChunkCeiling
        && !stalled
        && !repeating
        && !hitOutputCeiling
        && !hitTurnBudget
        && !lowEntropy
        && !structuralIssue;

      if (!shouldContinue) {
        const surfaceTruncated = truncated === true;
        if (lowEntropy) {
          logger.warn('[Continuation] low entropy detected (repetitive output) — stopping loop', { correlationId: accounting?.correlationId });
        } else if (structuralIssue) {
          logger.warn('[Continuation] structural regression detected — stopping loop', { correlationId: accounting?.correlationId });
        } else if (repeating) {
          logger.warn('[Continuation] repetition detected — stopping loop', { correlationId: accounting?.correlationId });
        } else if (stalled && truncated) {
          logger.warn('[Continuation] pass produced too few chars — stalled', { correlationId: accounting?.correlationId });
        } else if (hitTurnBudget) {
          logger.info('[Continuation] per-turn output budget reached — stopping', { correlationId: accounting?.correlationId });
        } else if (hitChunkCeiling) {
          logger.info(`[Continuation] max chunks reached (${maxChunks}) — stopping`, { correlationId: accounting?.correlationId });
        } else if (hitOutputCeiling) {
          logger.info('[Continuation] absolute output ceiling reached — stopping', { correlationId: accounting?.correlationId });
        }
        callbacks.onDone(surfaceTruncated);
        return;
      }

      logger.info(
        `[Continuation] truncated → auto-continue (${continuationCount + 1}/${maxChunks})`,
        { correlationId: accounting?.correlationId }
      );
      const continuationMessages = continuationMod.buildContinuationMessages(apiMessages, fullResponse);
      if (isReasoningOnlyPass) {
        continuationMessages.push({
          role: 'system',
          content: 'Please continue your response',
        });
      }

      await streamViaEdgeFunctionWrapper(
        continuationMessages,
        model,
        accessToken,
        callbacks,
        outputBudget,
        isReasoningEnabled,
        webSearchEnabled,
        signal,
        mode,
        continuationCount + 1,
        fullResponse,
        accounting ? { ...accounting, callKind: 'chat_continuation' } : undefined,
      );
    },
  };

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= NETWORK_RETRY_DELAYS_MS.length; attempt++) {
    if (signal?.aborted) {
      callbacks.onDone(false);
      return;
    }
    try {
      await streamViaEdgeFunctionWithInnerCallbacks(
        apiMessages,
        model,
        accessToken,
        innerCallbacks,
        outputBudget,
        isReasoningEnabled,
        webSearchEnabled,
        signal,
        mode,
        accounting,
      );
      return;
    } catch (err) {
      lastErr = err;
      if (signal?.aborted) {
        callbacks.onDone(false);
        return;
      }
      const delay = NETWORK_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      logger.warn(
        `[Continuation] network error on attempt ${attempt + 1} — retrying in ${delay}ms`,
        err,
        { correlationId: accounting?.correlationId }
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  callbacks.onError(
    lastErr instanceof Error ? lastErr.message : 'Streaming failed after retries',
  );
}

async function streamViaEdgeFunctionWithInnerCallbacks(
  apiMessages: Array<Record<string, unknown>>,
  model: ReturnType<typeof getActiveModel>,
  accessToken: string,
  innerCallbacks: StreamCallbacks,
  outputBudget: number,
  isReasoningEnabled: boolean,
  webSearchEnabled?: boolean,
  signal?: AbortSignal,
  mode: ResponseMode = 'chat',
  accounting?: CallAccounting,
): Promise<void> {
  let networkError: Error | null = null;
  const wrappedCallbacks: StreamCallbacks = {
    ...innerCallbacks,
    onError: (msg) => {
      const retryable =
        /network|fetch|timeout|econn|abort|5\d\d|gateway|unavailable/i.test(msg);
      if (retryable && !signal?.aborted) {
        networkError = new Error(msg);
        return;
      }
      innerCallbacks.onError(msg);
    },
  };

  await streamViaEdgeFunction(
    apiMessages,
    model,
    accessToken,
    wrappedCallbacks,
    outputBudget,
    isReasoningEnabled,
    webSearchEnabled,
    signal,
    mode,
    accounting,
  );

  if (networkError) {
    throw networkError;
  }
}

async function streamViaEdgeFunction(
  apiMessages: Array<Record<string, unknown>>,
  model: ReturnType<typeof getActiveModel>,
  accessToken: string,
  callbacks: StreamCallbacks,
  outputBudget: number,
  isReasoningEnabled: boolean,
  webSearchEnabled?: boolean,
  signal?: AbortSignal,
  mode: ResponseMode = 'chat',
  accounting?: CallAccounting,
): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const templateMode = useUIStore.getState().templateMode;
  const isReasoning = isReasoningEnabled;

  if (!anonKey) {
    logger.error('[OpenRouter] VITE_SUPABASE_ANON_KEY is missing. Edge Function call will likely fail.', { correlationId: accounting?.correlationId });
  }

  const perCallRequestId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const requestPayload: Record<string, unknown> = {
    messages: apiMessages,
    model: model.id,
    max_tokens: outputBudget,
    mode,
    is_reasoning: isReasoning,
    template_mode: templateMode,
    request_id: perCallRequestId,
    parent_request_id: accounting?.parentRequestId,
    conversation_id: accounting?.conversationId,
    message_id: accounting?.messageId,
    call_kind: accounting?.callKind ?? 'chat',
    input_cost_per_1m: accounting?.inputCostPer1M ?? model.inputCostPer1m,
    output_cost_per_1m: accounting?.outputCostPer1M ?? model.outputCostPer1m,
  };

  (requestPayload as any).web_search_enabled = !!webSearchEnabled;
  (requestPayload as any).web_search_used = false;
  (requestPayload as any).web_search_fallback_requested = false;

  logger.debug('[OpenRouter] sendingRequest', {
    model: model.id,
    is_reasoning: isReasoning,
    template_mode: templateMode,
    correlationId: accounting?.correlationId,
  });

  const chatEndpoint = `${supabaseUrl}/functions/v1/chat-proxy`;
  const finalizeChat = captureCall({
    id: perCallRequestId,
    parentId: accounting?.parentRequestId,
    kind: accounting?.callKind ?? 'chat',
    endpoint: chatEndpoint,
    modelId: model.id,
    request: { ...requestPayload, stream: true },
  });

  const response = await fetch(chatEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'apikey': anonKey || '',
      'X-Correlation-ID': accounting?.correlationId || generateRequestId(),
    },
    body: JSON.stringify({
      ...requestPayload,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    const errBody = await response.text();
    finalizeChat({ status: response.status, response: errBody.slice(0, 8000), error: `HTTP ${response.status}` });
    logger.debug('[OpenRouter] edgeError', {
      status: response.status,
      statusText: response.statusText,
      bodyHead: errBody.slice(0, 500),
      correlationId: accounting?.correlationId,
    });
    let errorMsg: string;
    try {
      const parsed = JSON.parse(errBody);
      const details = parsed.details || '';
      errorMsg = parsed.error || `API Error ${response.status}`;
      if (response.status === 401) {
        errorMsg = 'Session expired. Please sign in again.';
        if (details) {
          logger.warn('[Auth] 401 details:', details, { correlationId: accounting?.correlationId });
        }
      }
    } catch {
      errorMsg = response.status === 401
        ? 'Session expired. Please sign in again.'
        : `API Error ${response.status}`;
    }
    logger.error('[streamViaEdgeFunction] HTTP error:', response.status, errorMsg, { correlationId: accounting?.correlationId });
    callbacks.onError(errorMsg); 
    return;
  }

  await processStream(response, callbacks, model.id, signal, (summary) => {
    finalizeChat({
      status: response.status,
      response: summary,
    });
  }, accounting?.correlationId);
}
