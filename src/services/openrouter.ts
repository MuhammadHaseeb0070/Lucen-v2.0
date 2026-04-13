import type { Message } from '../types';
import { getActiveModel } from '../config/models';
import { formatFileSize } from './fileProcessor';
import { TEMPLATES, BASE_SYSTEM_PROMPT } from '../config/prompts';
import { useUIStore } from '../store/uiStore';
import { supabase, isSupabaseEnabled } from '../lib/supabase';
import { useTokenStore } from '../store/tokenStore';
import { PARTIAL_OPEN_RE, INCOMPLETE_TAG_RE } from '../lib/artifactParser';

// OpenRouter is only called server-side via chat-proxy; no direct client calls.

const OPENROUTER_RAW_DEBUG = false;
const OPENROUTER_RAW_DEBUG_MAX_CHARS = 250_000; // cap to avoid freezing the browser console

interface StreamCallbacks {
    onChunk: (content: string, isContinuation?: boolean) => void;
    onReasoning: (reasoning: string) => void;
    onDone: (truncated?: boolean) => void;
    onError: (error: string) => void;
    onWebSearchUsed?: () => void;
    onClarificationNeeded?: (question: string) => void;
}

interface StreamOptions {
    systemPromptOverride?: string;
    signal?: AbortSignal;
    isSideChat?: boolean;
    webSearchEnabled?: boolean;
}

/**
 * Build the `content` field for the API.
 * - No attachments → simple string (most efficient)
 * - With attachments → array of content parts (multimodal)
 * Puts text first (as recommended by OpenRouter), then images.
 */
function buildMessageContent(msg: Message, includeImages: boolean = true, includeFileText: boolean = true): string | Array<Record<string, unknown>> {
    if (!msg.attachments || msg.attachments.length === 0) {
        return msg.content;
    }

    const parts: Array<Record<string, unknown>> = [];
    const textAttachments = msg.attachments.filter((a) => a.textContent);
    const imageAttachments = msg.attachments.filter((a) => a.type === 'image' && a.dataUrl);

    // 1. Attachment summary — so the model knows exactly what files are present
    const summary = msg.attachments
        .map((a) => (a.type === 'image' ? `image: ${a.name}` : `file: ${a.name}`))
        .join(', ');
    const summaryBlock = `[Attachments: ${summary}]\n`;
    parts.push({ type: 'text', text: summaryBlock });

    // 2. Text file contents
    if (textAttachments.length > 0) {
        const contextBlock = includeFileText
            ? textAttachments
                .map((a) => `── File: ${a.name} (${formatFileSize(a.size)}) ──\n${a.textContent}`)
                .join('\n\n')
            : textAttachments
                .map((a) => `[File: ${a.name} — content was provided earlier in this conversation]`)
                .join('\n');
        parts.push({ type: 'text', text: contextBlock + '\n\n' });
    }

    // 3. User's message text (or fallback for image-only messages)
    const userText = msg.content.trim() || (imageAttachments.length > 0
        ? 'The user shared the image(s) above. Please look at them and respond accordingly.'
        : '');
    if (userText) {
        parts.push({ type: 'text', text: userText });
    }

    // 4. Image attachments (OpenRouter expects images after text)
    // Only include base64 images if explicitly requested (optimization: last 2 messages only)
    if (includeImages) {
        for (const img of imageAttachments) {
            parts.push({
                type: 'image_url',
                image_url: { url: img.dataUrl },
            });
        }
    }

    return parts;
}

/**
 * Build the full API message array with system prompts and conversation history.
 * Does NOT inject the token budget — that's done after counting in streamChat().
 */
function buildApiMessages(messages: Message[], systemPromptOverride?: string): Array<Record<string, unknown>> {
    const templateMode = useUIStore.getState().templateMode;

    // Prevent token/context pollution by taking only the last 30 messages max
    const recentMessages = messages.slice(-30);

    const systemMessages: Array<Record<string, unknown>> = [];

    if (systemPromptOverride) {
        // Use the override (e.g. for Side Chat)
        systemMessages.push({ role: 'system', content: systemPromptOverride });
    } else {
        // Use standard Base + Template
        const baseContent = BASE_SYSTEM_PROMPT;
        const templateContent = TEMPLATES[templateMode];

        systemMessages.push({ role: 'system', content: baseContent });
        if (templateContent) {
            systemMessages.push({
                role: 'system',
                content: `<active_template>\n${templateContent}\n</active_template>`,
            });
        }
    }

    // Assemble the API payload: System messages MUST come before the conversation history
    return [
        ...systemMessages,
        ...recentMessages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m, index) => ({
                role: m.role,
                // OPTIMIZATION: Only include raw image base64 for the last 2 messages.
                // For older messages, the model relies on the aiDescription in textContent.
                content: buildMessageContent(
                    m,
                    index >= recentMessages.length - 2,
                    index >= recentMessages.length - 3
                ),
            })),
    ];
}

// ─── Token Budget Constants ─────────────────────────────────────────────────
// MIN_OUTPUT_BUDGET: Never go below this — ensures even very long conversations
// can still receive a complete, useful reply.
const MIN_OUTPUT_BUDGET = 2048;

// SAFETY_HEADROOM: Reserved gap accounting for tokenizer approximation error
// and per-request model overhead (e.g. BOS/EOS, role tags).
const SAFETY_HEADROOM = 512;

/**
 * Compute how many output tokens are safely available for this request.
 *
 * Formula:
 *   remaining = contextWindow - inputTokens - SAFETY_HEADROOM
 *   budget    = clamp(remaining, MIN_OUTPUT_BUDGET, maxOutputTokens)
 *
 * For reasoning models (Grok, DeepSeek R1), reasoning tokens eat into the same
 * output budget. We do NOT apply a separate reasoning reserve here — OpenRouter
 * handles it internally, but a larger SAFETY_HEADROOM offsets this.
 */
async function computeOutputBudget(
    apiMessages: Array<Record<string, unknown>>,
    contextWindow: number,
    maxOutputTokens: number
): Promise<number> {
    try {
        // Serialize all messages to a single string for token counting.
        // We only count text parts — image parts are approximated by the safety headroom.
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

        const remaining = contextWindow - inputTokens - SAFETY_HEADROOM;
        const budget = Math.max(MIN_OUTPUT_BUDGET, Math.min(maxOutputTokens, remaining));

        console.debug(`[TokenBudget] input=${inputTokens} ctx=${contextWindow} maxOut=${maxOutputTokens} → budget=${budget}`);
        return budget;
    } catch (err) {
        // If token counting fails for any reason, fall back to a conservative default
        console.warn('[TokenBudget] Counting failed, using fallback:', err);
        return Math.min(maxOutputTokens, 16384);
    }
}

/**
 * Stream chat via Edge Function proxy (secure — API key stays server-side).
 */
export async function streamChat(
    messages: Message[],
    callbacks: StreamCallbacks,
    options: StreamOptions = {}
): Promise<void> {
    const model = getActiveModel(options.isSideChat);
    const apiMessages = buildApiMessages(messages, options.systemPromptOverride);

    if (!isSupabaseEnabled() || !supabase) {
        callbacks.onError('Please sign in to use chat.');
        return;
    }

    // ─── Ensure fresh JWT: refresh if expired (fixes 401 from stale tokens) ───
    const { data: { session }, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
        callbacks.onError('Session expired. Please sign in again.');
        return;
    }
    if (!session?.access_token) {
        callbacks.onError('Please sign in to use chat.');
        return;
    }

    // ─── Compute exact output budget based on actual input size ───────────────
    const outputBudget = await computeOutputBudget(
        apiMessages,
        model.contextWindow,
        model.maxOutputTokens
    );

    // ─── Inject token budget as a background instruction ─────────────────────
    // Keep this instruction quiet so the model doesn't mention tokens in its response.
    const messagesWithBudget: Array<Record<string, unknown>> = [
        ...apiMessages,
        {
            role: 'system',
            content: `[System Note: Your output limit is roughly ${outputBudget} tokens. Ensure your code/explanation completes within this boundary. Do not mention tokens, budgets, or length limits in your response; just answer naturally and completely.]`,
        },
    ];

    const isReasoningEnabled = options.isSideChat ? false : model.supportsReasoning;
    // IMPORTANT: we always stream so the UX stays responsive.
    // If a provider doesn't stream reasoning, `message.reasoning` may be empty.
    await streamViaEdgeFunctionWrapper(
        messagesWithBudget,
        model,
        session.access_token,
        callbacks,
        outputBudget,
        isReasoningEnabled,
        options.webSearchEnabled,
        options.signal
    );
}

/**
 * Wrapper for streamViaEdgeFunction to handle artifact continuation logic.
 */
async function streamViaEdgeFunctionWrapper(
    apiMessages: Array<Record<string, unknown>>,
    model: ReturnType<typeof getActiveModel>,
    accessToken: string,
    callbacks: StreamCallbacks,
    outputBudget: number,
    isReasoningEnabled: boolean,
    webSearchEnabled?: boolean,
    signal?: AbortSignal,
    continuationCount = 0
): Promise<void> {
    let fullResponse = '';
    
    // Intercept callback to track content for continuation check
    const innerCallbacks: StreamCallbacks = {
        ...callbacks,
        onChunk: (chunk, isContinuation) => {
            fullResponse += chunk;
            callbacks.onChunk(chunk, isContinuation || continuationCount > 0);
        },
        onDone: async (truncated) => {
            // Check if stream ended naturally but artifact is cut off
            const isPartialArtifact = PARTIAL_OPEN_RE.test(fullResponse) || INCOMPLETE_TAG_RE.test(fullResponse);
            
            if (isPartialArtifact && continuationCount < 2) {
                console.info(`[Continuation] Partial artifact detected. Retrying (${continuationCount + 1}/2)...`);
                
                const continuationMessages = [
                    ...apiMessages,
                    { role: 'assistant', content: fullResponse },
                    { 
                        role: 'user', 
                        content: "Continue exactly from where you stopped. Output only the continuation, starting from where the artifact content was cut off." 
                    }
                ];

                await streamViaEdgeFunctionWrapper(
                    continuationMessages,
                    model,
                    accessToken,
                    callbacks,
                    outputBudget,
                    isReasoningEnabled,
                    webSearchEnabled,
                    signal,
                    continuationCount + 1
                );
            } else {
                callbacks.onDone(truncated);
            }
        }
    };

    await streamViaEdgeFunction(
        apiMessages,
        model,
        accessToken,
        innerCallbacks,
        outputBudget,
        isReasoningEnabled,
        webSearchEnabled,
        signal
    );
}

/**
 * Stream via Supabase Edge Function (chat-proxy).
 */
async function resolveWebSearchContext(
    apiMessages: Array<Record<string, unknown>>
): Promise<{ shouldSearch: boolean; searchHint: string | null; urls: string[]; clarificationNeeded?: string | null }> {
    const noSearch = { shouldSearch: false, searchHint: null, urls: [], clarificationNeeded: null };

    const contextMessages = apiMessages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-6);

    if (contextMessages.length === 0) return noSearch;

    const extractText = (content: unknown): string => {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return (content as Array<Record<string, unknown>>)
                .filter((p) => p.type === 'text')
                .map((p) => p.text as string)
                .join(' ');
        }
        return '';
    };

    const lastUser = [...contextMessages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return noSearch;
    const lastUserText = extractText(lastUser.content).trim();

    // Hard skip — no AI call needed
    if (lastUserText.length < 3) return noSearch;
    const trivial = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|great|cool|perfect|lol|haha|done|stop|wait|go ahead|continue|agreed|nice|awesome|sounds good)[\s!.?]*$/i;
    if (trivial.test(lastUserText)) return noSearch;

    // Extract explicit URLs
    const urlRegex = /https?:\/\/[^\s"'<>]+/g;
    const urls = lastUserText.match(urlRegex) || [];

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) return { shouldSearch: true, searchHint: lastUserText, urls, clarificationNeeded: null };

    try {
        console.log('[classify-intent] calling with messages count:', contextMessages.length);
        const intentResponse = await fetch(`${supabaseUrl}/functions/v1/classify-intent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
                'apikey': anonKey || '',
            },
            body: JSON.stringify({ messages: contextMessages }),
        });

        console.log('[classify-intent] response status:', intentResponse.status);
        const result = await intentResponse.json();
        console.log('[classify-intent] result:', JSON.stringify(result));

        if (!intentResponse.ok) {
            return { shouldSearch: true, searchHint: lastUserText, urls, clarificationNeeded: null };
        }

        if (result.state === 'skip') return noSearch;

        if (result.state === 'clarify' && result.question) {
            return { shouldSearch: false, searchHint: null, urls, clarificationNeeded: result.question };
        }

        if (result.state === 'search') {
            return {
                shouldSearch: true,
                searchHint: result.query || lastUserText,
                urls,
                clarificationNeeded: null,
            };
        }

        return { shouldSearch: true, searchHint: lastUserText, urls, clarificationNeeded: null };

    } catch (err) {
        console.error('[classify-intent] FAILED:', err);
        return { shouldSearch: true, searchHint: lastUserText, urls, clarificationNeeded: null };
    }
}

/**
 * Stream via Supabase Edge Function (chat-proxy).
 */
async function streamViaEdgeFunction(
    apiMessages: Array<Record<string, unknown>>,
    model: ReturnType<typeof getActiveModel>,
    accessToken: string,
    callbacks: StreamCallbacks,
    outputBudget: number,
    isReasoningEnabled: boolean,
    webSearchEnabled?: boolean,
    signal?: AbortSignal
): Promise<void> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const templateMode = useUIStore.getState().templateMode;
    const isReasoning = isReasoningEnabled;

    if (!anonKey) {
        console.error('[OpenRouter] VITE_SUPABASE_ANON_KEY is missing. Edge Function call will likely fail.');
    }

    const requestPayload: Record<string, unknown> = {
        messages: apiMessages,
        model: model.id,
        max_tokens: outputBudget,
        is_reasoning: isReasoning,
        template_mode: templateMode,
    };

    if (webSearchEnabled) {
        const { shouldSearch, searchHint, urls, clarificationNeeded } = await resolveWebSearchContext(apiMessages);

        if (clarificationNeeded) {
            callbacks.onClarificationNeeded?.(clarificationNeeded);
            return;
        }

        if (shouldSearch) {
            requestPayload.plugins = [{ id: 'web', engine: 'exa', max_results: 5 }];
            callbacks.onWebSearchUsed?.();
            // Inject context-aware search hint so model searches correctly
            if (searchHint) {
                requestPayload.messages = [
                    ...(requestPayload.messages as Array<Record<string, unknown>>),
                    {
                        role: 'system',
                        content: `[Search Directive: The user's actual information need based on full conversation context is: "${searchHint}". Use this as your web search query. Do not search for something unrelated.]`,
                    },
                ];
            }
            // If user mentioned specific URLs, add fetch directive
            if (urls.length > 0) {
                requestPayload.messages = [
                    ...(requestPayload.messages as Array<Record<string, unknown>>),
                    {
                        role: 'system',
                        content: `[URL Directive: The user explicitly referenced these URLs: ${urls.join(', ')}. Retrieve and use their content in your response.]`,
                    },
                ];
            }
        }
    }

    // Debug: confirm this code path executed before we hit the Edge function.
    // eslint-disable-next-line no-console
    console.log('[OpenRouterDebug] sendingRequest', {
        model: model.id,
        is_reasoning: isReasoning,
        template_mode: templateMode,
    });

    if (OPENROUTER_RAW_DEBUG) {
        // eslint-disable-next-line no-console
        console.log('[OpenRouterDebug] requestHeadersRedacted', {
            'Content-Type': 'application/json',
            Authorization: 'Bearer [redacted]',
            apikey: anonKey ? '[present]' : '[missing]',
        });

        // Redact multimodal payload (image data URLs) so logs stay usable.
        const safePayload = JSON.parse(JSON.stringify(requestPayload)) as typeof requestPayload;
        try {
            const msgs = (safePayload as unknown as { messages?: unknown }).messages;
            if (Array.isArray(msgs)) {
                for (const m of msgs) {
                    if (!m || typeof m !== 'object') continue;
                    const content = (m as { content?: unknown }).content;
                    if (!Array.isArray(content)) continue;
                    for (const part of content) {
                        if (!part || typeof part !== 'object') continue;
                        const p = part as { type?: unknown; image_url?: unknown };
                        if (p.type !== 'image_url' || !p.image_url || typeof p.image_url !== 'object') continue;
                        const img = p.image_url as { url?: unknown };
                        if (typeof img.url === 'string' && img.url) {
                            const url = img.url;
                            img.url = `[redacted-dataurl len=${url.length}]`;
                        }
                    }
                }
            }
        } catch {
            // ignore redaction issues
        }

        // eslint-disable-next-line no-console
        console.log('[OpenRouterDebug] requestPayloadFullRedacted', safePayload);
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/chat-proxy`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': anonKey || '',
        },
        body: JSON.stringify({
            ...requestPayload,
            stream: true,
        }),
        signal,
    });

    if (!response.ok) {
        const errBody = await response.text();
        // eslint-disable-next-line no-console
        console.log('[OpenRouterDebug] edgeError', {
            status: response.status,
            statusText: response.statusText,
            bodyHead: errBody.slice(0, 500),
        });
        let errorMsg: string;
        try {
            const parsed = JSON.parse(errBody);
            const details = parsed.details || '';
            errorMsg = parsed.error || `API Error ${response.status}`;
            if (response.status === 401) {
                errorMsg = 'Session expired. Please sign out and sign in again.';
                if (details) {
                    console.warn('[Auth] 401 details:', details);
                }
            }
        } catch {
            errorMsg = response.status === 401
                ? 'Session expired. Please sign out and sign in again.'
                : `API Error ${response.status}`;
        }
        callbacks.onError(errorMsg); 
        return;
    }

    await processStream(response, callbacks);
}

/**
 * Process an SSE stream from the Edge Function.
 */
async function processStream(
    response: Response,
    callbacks: StreamCallbacks
): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
        callbacks.onError('No response stream available');
        return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let wasTruncated = false;

    // Debug tracking: capture last delta route so we can see whether text is
    // arriving via `delta.content` or `delta.reasoning*`.
    let chunkCount = 0;
    let reasoningChunkCount = 0;
    let contentChunkCount = 0;
    let lastDeltaSummary: Record<string, unknown> | null = null;
    let lastReasoningTail: string | null = null;
    let lastContentTail: string | null = null;
    let rawSse = '';
    const reasoningSamples: string[] = [];
    const contentSamples: string[] = [];

    const logStreamSummary = (why: 'done' | 'eof' | 'abort' | 'error') => {
        // eslint-disable-next-line no-console
        console.log('[OpenRouterDebug] streamSummary', {
            why,
            truncated: wasTruncated,
            chunkCount,
            reasoningChunkCount,
            contentChunkCount,
            lastDeltaSummary,
            lastReasoningTail,
            lastContentTail,
            reasoningSamples,
            contentSamples,
        });

        if (OPENROUTER_RAW_DEBUG) {
            // eslint-disable-next-line no-console
            console.log('[OpenRouterDebug] rawSseTail', rawSse);
        }
    };

    function sanitizeAssistantOutput(text: string): string {
        if (!text) return text;

        let t = text;

        // Strip role-label leakage that some models emit (especially after prompt changes).
        // Keep this intentionally conservative: only remove at the start of a chunk/line.
        t = t.replace(/^(?:\s*(?:assistant|system|user)\s*:\s*)+/i, '');

        // If system/template tags leak into output, strip them.
        // (If a user intentionally requests these tags, they can still paste them manually.)
        t = t.replace(/<lucen_system>[\s\S]*?<\/lucen_system>/gi, '');
        t = t.replace(/<active_template>[\s\S]*?<\/active_template>/gi, '');
        t = t.replace(/<template[\s\S]*?<\/template>/gi, '');

        return t;
    }

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;

                const data = trimmed.slice(6);
                if (data === '[DONE]') {
                    callbacks.onDone(wasTruncated);
                    logStreamSummary('done');
                    return;
                }

                try {
                    if (OPENROUTER_RAW_DEBUG) {
                        // Keep raw stream tail bounded.
                        rawSse += `${trimmed}\n`;
                        if (rawSse.length > OPENROUTER_RAW_DEBUG_MAX_CHARS) {
                            rawSse = rawSse.slice(-OPENROUTER_RAW_DEBUG_MAX_CHARS);
                        }
                    }

                    const parsed = JSON.parse(data);
                    const choice = parsed.choices?.[0];
                    if (!choice) continue;

                    // Detect truncation: finish_reason === 'length' means max_tokens was hit
                    if (choice.finish_reason === 'length') {
                        wasTruncated = true;
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

                    // Handle reasoning content (DeepSeek R1, Grok reasoning, etc.)
                    if (delta.reasoning || delta.reasoning_content) {
                        const reasoningChunk = String(delta.reasoning || delta.reasoning_content || '');
                        // Some providers may mistakenly emit artifact blocks in the reasoning channel.
                        // Route those back to normal content so the artifact pipeline can handle them.
                        if (reasoningChunk.includes('<lucen_artifact')) {
                            callbacks.onChunk(sanitizeAssistantOutput(reasoningChunk));
                        } else {
                            callbacks.onReasoning(sanitizeAssistantOutput(reasoningChunk));
                        }
                        reasoningChunkCount++;
                        lastReasoningTail = reasoningChunk.slice(-220);
                        if (OPENROUTER_RAW_DEBUG && reasoningSamples.length < 6 && reasoningChunk.trim()) {
                            reasoningSamples.push(reasoningChunk.slice(0, 400));
                        }
                    }

                    // Handle regular content
                    if (delta.content) {
                        callbacks.onChunk(sanitizeAssistantOutput(String(delta.content)));
                        contentChunkCount++;
                        lastContentTail = String(delta.content).slice(-220);
                        if (OPENROUTER_RAW_DEBUG && contentSamples.length < 6 && String(delta.content).trim()) {
                            contentSamples.push(String(delta.content).slice(0, 400));
                        }
                    }
                } catch {
                    // Skip malformed JSON chunks
                }
            }
        }

        callbacks.onDone(wasTruncated);
        logStreamSummary('eof');
    } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
            callbacks.onDone(false);
            logStreamSummary('abort');
        } else {
            callbacks.onError(err instanceof Error ? err.message : 'Unknown error');
            logStreamSummary('error');
        }
    }
}
