import { STREAM_IDLE_TIMEOUT_MS } from '../../config/models';
import { sanitizeMinimaxTags } from '../../lib/stringUtil';
import { logger } from '../../lib/logger';

const OPENROUTER_RAW_DEBUG = false;
const OPENROUTER_RAW_DEBUG_MAX_CHARS = 250_000;

export interface StreamCallbacks {
  onChunk: (content: string, isContinuation?: boolean) => void;
  onReasoning: (reasoning: string) => void;
  onDone: (truncated?: boolean) => void;
  onError: (error: string) => void;
  onWebSearchUsed?: (urls?: string[]) => void;
  onClarificationNeeded?: (question: string) => void;
  onToolActivity?: (event: { id: string; tool: string; status: 'running' | 'completed' | 'failed'; label: string; args?: any; durationMs?: number }) => void;
  onUsageReceipt?: (receipt: { tools_used: any[]; prompt_tokens: number; completion_tokens: number; reasoning_tokens: number; total_credits: number; search_credits: number }) => void;
}

export interface StreamFinalizeSummary {
  endedWith: 'done' | 'eof' | 'abort' | 'error' | 'watchdog';
  truncated: boolean;
  sawNaturalFinish: boolean;
  watchdogFired: boolean;
  chunkCount: number;
  reasoningChunkCount: number;
  contentChunkCount: number;
  content: string;
  reasoning: string;
  error?: string;
}

export function sanitizeAssistantOutput(t: string): string {
  if (!t || typeof t !== 'string') return t ?? '';

  t = t ? sanitizeMinimaxTags(t) : (t ?? '');

  t = t.replace(/^(?:\s*(?:assistant|system|user)\s*:\s*)+/i, '');

  t = t.replace(/<lucen_system>[\s\S]*?<\/lucen_system>/gi, '');
  t = t.replace(/<active_template>[\s\S]*?<\/active_template>/gi, '');
  t = t.replace(/<template[\s\S]*?<\/template>/gi, '');
  t = t.replace(/<assistant_vision_notice>[\s\S]*?<\/assistant_vision_notice>/gi, '');
  t = t.replace(/<runtime_context>[\s\S]*?<\/runtime_context>/gi, '');
  t = t.replace(/<image_perception>[\s\S]*?<\/image_perception>/gi, '');

  t = t.replace(/<(?:lucen_system|runtime_context|assistant_vision_notice|image_perception)[^>\n]{0,80}$/gi, '');

  return t;
}

export async function processStream(
  response: Response,
  callbacks: StreamCallbacks,
  modelId?: string,
  signal?: AbortSignal,
  onFinalize?: (summary: StreamFinalizeSummary) => void,
  correlationId?: string,
): Promise<void> {
  let hasDoneBeenCalled = false;
  const originalOnDone = callbacks.onDone;
  const wrappedOnDone = (truncated?: boolean) => {
    if (!hasDoneBeenCalled) {
      hasDoneBeenCalled = true;
      originalOnDone(truncated);
    }
  };

  const wrappedCallbacks = {
    ...callbacks,
    onDone: wrappedOnDone,
  };

  const originalOnFinalize = onFinalize;
  if (originalOnFinalize) {
    onFinalize = (summary) => {
      originalOnFinalize({
        ...summary,
        content: summary.content ? sanitizeMinimaxTags(summary.content) : (summary.content ?? ''),
        reasoning: summary.reasoning ? sanitizeMinimaxTags(summary.reasoning) : (summary.reasoning ?? ''),
      });
    };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    wrappedCallbacks.onError('No response stream available');
    wrappedCallbacks.onDone(false);
    onFinalize?.({
      endedWith: 'error',
      truncated: false,
      sawNaturalFinish: false,
      watchdogFired: false,
      chunkCount: 0,
      reasoningChunkCount: 0,
      contentChunkCount: 0,
      content: '',
      reasoning: '',
      error: 'no response stream',
    });
    return;
  }

  const FINALIZE_CONTENT_CAP = 120_000;
  let accContent = '';
  let accReasoning = '';
  let accContentRaw = '';
  let accReasoningRaw = '';
  let sentContentLength = 0;
  let sentReasoningLength = 0;

  const decoder = new TextDecoder();
  let buffer = '';
  let wasTruncated = false;
  let sawNaturalFinish = false;
  let watchdogFired = false;
  let lastDataAt = Date.now();

  let chunkCount = 0;
  let reasoningChunkCount = 0;
  let contentChunkCount = 0;
  let lastDeltaSummary: Record<string, unknown> | null = null;
  let lastReasoningTail: string | null = null;
  let lastContentTail: string | null = null;
  let rawSse = '';
  const reasoningSamples: string[] = [];
  const contentSamples: string[] = [];

  const logStreamSummary = (why: 'done' | 'eof' | 'abort' | 'error' | 'watchdog') => {
    logger.debug('[OpenRouter] streamSummary', {
      why,
      modelId,
      truncated: wasTruncated,
      sawNaturalFinish,
      watchdogFired,
      chunkCount,
      reasoningChunkCount,
      contentChunkCount,
      lastDeltaSummary,
      lastReasoningTail,
      lastContentTail,
      reasoningSamples,
      contentSamples,
      correlationId,
    });

    if (OPENROUTER_RAW_DEBUG) {
      logger.debug('[OpenRouter] rawSseTail', rawSse, { correlationId });
    }
  };

  const watchdogTimer = setInterval(() => {
    if (Date.now() - lastDataAt <= STREAM_IDLE_TIMEOUT_MS) return;
    watchdogFired = true;
    try {
      reader.cancel('watchdog-idle-timeout').catch(() => {});
    } catch {
      // ignore
    }
  }, Math.max(1000, Math.floor(STREAM_IDLE_TIMEOUT_MS / 4)));

  const onAbort = () => {
    try {
      reader.cancel('user-abort').catch(() => {});
    } catch {
      // ignore
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  let currentEvent: string | null = null;
  let sawToolActivityEvent = false;
  let treatReasoningAsContent = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lastDataAt = Date.now();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed.startsWith('event: ')) {
          currentEvent = trimmed.slice(7).trim();
          continue;
        }
        if (!trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          wrappedCallbacks.onDone(wasTruncated);
          logStreamSummary('done');
          onFinalize?.({
            endedWith: 'done',
            truncated: wasTruncated,
            sawNaturalFinish,
            watchdogFired,
            chunkCount,
            reasoningChunkCount,
            contentChunkCount,
            content: accContent,
            reasoning: accReasoning,
          });
          return;
        }

        if (currentEvent === 'tool_activity') {
          try {
            const activityData = JSON.parse(data);
            sawToolActivityEvent = true;
            wrappedCallbacks.onToolActivity?.(activityData);
          } catch {
            // skip
          }
          currentEvent = null;
          continue;
        }
        if (currentEvent === 'usage_receipt') {
          try {
            const eventData = JSON.parse(data);
            wrappedCallbacks.onUsageReceipt?.(eventData);
          } catch { /* ignore */ }
          currentEvent = null;
          continue;
        }
        if (currentEvent === 'content_start') {
          try {
            const eventData = JSON.parse(data);
            if (eventData?.model) {
              modelId = eventData.model;
            }
            if (eventData?.after_tool_calls) {
              treatReasoningAsContent = true;
            }
          } catch { /* ignore */ }
          currentEvent = null;
          continue;
        }
        if (currentEvent === 'web_search_results') {
          try {
            const eventData = JSON.parse(data);
            if (eventData?.urls && Array.isArray(eventData.urls)) {
              const urlStrings = eventData.urls.map((u: any) => u.url);
              wrappedCallbacks.onWebSearchUsed?.(urlStrings);
            }
          } catch { /* ignore */ }
          currentEvent = null;
          continue;
        }
        currentEvent = null;

        try {
          if (OPENROUTER_RAW_DEBUG) {
            rawSse += `${trimmed}\n`;
            if (rawSse.length > OPENROUTER_RAW_DEBUG_MAX_CHARS) {
              rawSse = rawSse.slice(-OPENROUTER_RAW_DEBUG_MAX_CHARS);
            }
          }

          const parsed = JSON.parse(data);
          if (parsed && parsed.error) {
            logger.error('[processStream] API error chunk:', parsed.error, { correlationId });
            wrappedCallbacks.onError(parsed.error.message ?? (typeof parsed.error === 'string' ? parsed.error : 'Stream error'));
            wrappedCallbacks.onDone(false);
            return;
          }
          const choice = parsed.choices?.[0];
          if (!choice) continue;

          if (choice.finish_reason === 'length') {
            wasTruncated = true;
          } else if (
            choice.finish_reason === 'stop' ||
            choice.finish_reason === 'content_filter' ||
            choice.finish_reason === 'tool_calls' ||
            choice.finish_reason === 'end_turn'
          ) {
            sawNaturalFinish = true;
            
            if (choice.finish_reason === 'tool_calls' && !sawToolActivityEvent) {
              wrappedCallbacks.onToolActivity?.({
                id: `call_fallback_${Date.now()}`,
                tool: 'tool',
                status: 'running',
                label: 'Working...'
              });
            }
          }

          const delta = choice.delta;
          if (!delta) continue;

          chunkCount++;
          const deltaKind = {
            hasContent: typeof delta.content === 'string' && delta.content.length > 0,
            hasReasoning: Boolean(delta.reasoning || delta.reasoning_content),
            finish_reason: choice.finish_reason || null,
          };
          lastDeltaSummary = deltaKind;

          if (delta.reasoning || delta.reasoning_content) {
            const reasoningChunk = String(delta.reasoning || delta.reasoning_content || '');
            const shouldRouteToChunk = treatReasoningAsContent;

            if (shouldRouteToChunk) {
              accContentRaw += reasoningChunk;
              const newSanitized = sanitizeAssistantOutput(accContentRaw);
              const deltaToSend = newSanitized.slice(sentContentLength);
              if (deltaToSend) {
                wrappedCallbacks.onChunk(deltaToSend);
                sentContentLength += deltaToSend.length;
              }
              contentChunkCount++;
              lastContentTail = reasoningChunk.slice(-220);
              if (accContent.length < FINALIZE_CONTENT_CAP) {
                accContent += reasoningChunk;
              }
            } else if (reasoningChunk.includes('<lucen_artifact')) {
              accContentRaw += reasoningChunk;
              const newSanitized = sanitizeAssistantOutput(accContentRaw);
              const deltaToSend = newSanitized.slice(sentContentLength);
              if (deltaToSend) {
                wrappedCallbacks.onChunk(deltaToSend);
                sentContentLength += deltaToSend.length;
              }
              contentChunkCount++;
              lastContentTail = reasoningChunk.slice(-220);
              if (accContent.length < FINALIZE_CONTENT_CAP) {
                accContent += reasoningChunk;
              }
            } else {
              accReasoningRaw += reasoningChunk;
              const newSanitized = sanitizeAssistantOutput(accReasoningRaw);
              const deltaToSend = newSanitized.slice(sentReasoningLength);
              if (deltaToSend) {
                wrappedCallbacks.onReasoning(deltaToSend);
                sentReasoningLength += deltaToSend.length;
              }
            }
            reasoningChunkCount++;
            lastReasoningTail = reasoningChunk.slice(-220);
            if (accReasoning.length < FINALIZE_CONTENT_CAP) {
              accReasoning += reasoningChunk;
            }
            if (OPENROUTER_RAW_DEBUG && reasoningSamples.length < 6 && reasoningChunk.trim()) {
              reasoningSamples.push(reasoningChunk.slice(0, 400));
            }
          }

          if (delta.content) {
            const contentStr = String(delta.content);
            accContentRaw += contentStr;
            const newSanitized = sanitizeAssistantOutput(accContentRaw);
            const deltaToSend = newSanitized.slice(sentContentLength);
            if (deltaToSend) {
              wrappedCallbacks.onChunk(deltaToSend);
              sentContentLength += deltaToSend.length;
            }
            contentChunkCount++;
            lastContentTail = contentStr.slice(-220);
            if (accContent.length < FINALIZE_CONTENT_CAP) {
              accContent += contentStr;
            }
            if (OPENROUTER_RAW_DEBUG && contentSamples.length < 6 && contentStr.trim()) {
              contentSamples.push(contentStr.slice(0, 400));
            }
          }
        } catch {
          // ignore
        }
      }
    }

    if (buffer.trim()) {
      const finalLine = buffer.trim();
      buffer = '';
      if (finalLine.startsWith('data: ')) {
        const data = finalLine.slice(6);
        if (data === '[DONE]') {
          wrappedCallbacks.onDone(wasTruncated);
          logStreamSummary('done');
          onFinalize?.({
            endedWith: 'done',
            truncated: wasTruncated,
            sawNaturalFinish,
            watchdogFired,
            chunkCount,
            reasoningChunkCount,
            contentChunkCount,
            content: accContent,
            reasoning: accReasoning,
          });
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];
          if (choice) {
            if (choice.finish_reason === 'length') wasTruncated = true;
            else if (choice.finish_reason === 'stop' || choice.finish_reason === 'end_turn') sawNaturalFinish = true;
            const delta = choice.delta;
            if (delta?.content) {
              const contentStr = String(delta.content);
              accContentRaw += contentStr;
              const newSanitized = sanitizeAssistantOutput(accContentRaw);
              const deltaToSend = newSanitized.slice(sentContentLength);
              if (deltaToSend) {
                wrappedCallbacks.onChunk(deltaToSend);
                sentContentLength += deltaToSend.length;
              }
              contentChunkCount++;
              if (accContent.length < FINALIZE_CONTENT_CAP) accContent += contentStr;
            }
            if (delta?.reasoning || delta?.reasoning_content) {
              const rawRc = String(delta.reasoning || delta.reasoning_content || '');
              if (treatReasoningAsContent || rawRc.includes('<lucen_artifact')) {
                accContentRaw += rawRc;
                const newSanitized = sanitizeAssistantOutput(accContentRaw);
                const deltaToSend = newSanitized.slice(sentContentLength);
                if (deltaToSend) {
                  wrappedCallbacks.onChunk(deltaToSend);
                  sentContentLength += deltaToSend.length;
                }
                contentChunkCount++;
                if (accContent.length < FINALIZE_CONTENT_CAP) accContent += rawRc;
              } else {
                accReasoningRaw += rawRc;
                const newSanitized = sanitizeAssistantOutput(accReasoningRaw);
                const deltaToSend = newSanitized.slice(sentReasoningLength);
                if (deltaToSend) {
                  wrappedCallbacks.onReasoning(deltaToSend);
                  sentReasoningLength += deltaToSend.length;
                }
              }
              reasoningChunkCount++;
              if (accReasoning.length < FINALIZE_CONTENT_CAP) accReasoning += rawRc;
            }
          }
        } catch { /* ignore */ }
      }
    }

    const sawAnyUsefulOutput = contentChunkCount > 0 || reasoningChunkCount > 0;
    const eofTruncated = wasTruncated || (!sawNaturalFinish && sawAnyUsefulOutput);
    if (!wasTruncated && eofTruncated) {
      logger.debug('[OpenRouter] eofWithoutFinishReason — treating as truncated', {
        contentChunkCount,
        reasoningChunkCount,
        correlationId,
      });
    }
    wrappedCallbacks.onDone(eofTruncated);
    logStreamSummary('eof');
    onFinalize?.({
      endedWith: 'eof',
      truncated: eofTruncated,
      sawNaturalFinish,
      watchdogFired,
      chunkCount,
      reasoningChunkCount,
      contentChunkCount,
      content: accContent,
      reasoning: accReasoning,
    });
  } catch (err: unknown) {
    const userAborted = signal?.aborted === true && !watchdogFired;
    if (watchdogFired) {
      logger.debug('[OpenRouter] watchdog fired — treating as truncated', {
        contentChunkCount,
        idleMs: Date.now() - lastDataAt,
        correlationId,
      });
      wrappedCallbacks.onDone(true);
      logStreamSummary('watchdog');
      onFinalize?.({
        endedWith: 'watchdog',
        truncated: true,
        sawNaturalFinish,
        watchdogFired: true,
        chunkCount,
        reasoningChunkCount,
        contentChunkCount,
        content: accContent,
        reasoning: accReasoning,
      });
    } else if (userAborted || (err instanceof Error && err.name === 'AbortError')) {
      wrappedCallbacks.onDone(false);
      logStreamSummary('abort');
      onFinalize?.({
        endedWith: 'abort',
        truncated: false,
        sawNaturalFinish,
        watchdogFired,
        chunkCount,
        reasoningChunkCount,
        contentChunkCount,
        content: accContent,
        reasoning: accReasoning,
      });
    } else {
      logger.error('[processStream] EXCEPTION:', err, { correlationId });
      const msg = err instanceof Error ? err.message : 'Unknown error';
      wrappedCallbacks.onError(msg);
      wrappedCallbacks.onDone(false);
      logStreamSummary('error');
      onFinalize?.({
        endedWith: 'error',
        truncated: false,
        sawNaturalFinish,
        watchdogFired,
        chunkCount,
        reasoningChunkCount,
        contentChunkCount,
        content: accContent,
        reasoning: accReasoning,
        error: msg,
      });
    }
  } finally {
    clearInterval(watchdogTimer);
    signal?.removeEventListener('abort', onAbort);
    // BUG-01 Fix: Guarantee onDone is ALWAYS called if it hasn't been already
    if (!hasDoneBeenCalled) {
      wrappedCallbacks.onDone(wasTruncated);
    }
  }
}
