import type { Message } from '../types';
import { getActiveModel } from '../config/models';
import { formatFileSize } from './fileProcessor';
import { TEMPLATES, BASE_SYSTEM_PROMPT } from '../config/prompts';
import { useUIStore } from '../store/uiStore';
import { supabase, isSupabaseEnabled } from '../lib/supabase';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface StreamCallbacks {
    onChunk: (content: string) => void;
    onReasoning: (reasoning: string) => void;
    onDone: (truncated?: boolean) => void;
    onError: (error: string) => void;
}

interface StreamOptions {
    systemPromptOverride?: string;
    signal?: AbortSignal;
    isSideChat?: boolean;
}

/**
 * Build the `content` field for the API.
 * - No attachments → simple string (most efficient)
 * - With attachments → array of content parts (multimodal)
 */
function buildMessageContent(msg: Message): string | Array<Record<string, unknown>> {
    if (!msg.attachments || msg.attachments.length === 0) {
        return msg.content;
    }

    // Build multimodal content array
    const parts: Array<Record<string, unknown>> = [];

    // Add text file context blocks first
    const textAttachments = msg.attachments.filter((a) => a.textContent);
    if (textAttachments.length > 0) {
        const contextBlock = textAttachments
            .map((a) => `── File: ${a.name} (${formatFileSize(a.size)}) ──\n${a.textContent}`)
            .join('\n\n');
        parts.push({ type: 'text', text: contextBlock + '\n\n' });
    }

    // Add the user's message text
    if (msg.content) {
        parts.push({ type: 'text', text: msg.content });
    }

    // Add image attachments
    const imageAttachments = msg.attachments.filter((a) => a.type === 'image' && a.dataUrl);
    for (const img of imageAttachments) {
        parts.push({
            type: 'image_url',
            image_url: { url: img.dataUrl },
        });
    }

    return parts;
}

/**
 * Build the full API message array with system prompts and conversation history.
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
            .map((m) => ({
                role: m.role,
                content: buildMessageContent(m),
            })),
    ];
}

/**
 * Stream chat via Edge Function proxy (secure — API key stays server-side).
 * Falls back to direct OpenRouter call if Supabase is not configured.
 */
export async function streamChat(
    messages: Message[],
    callbacks: StreamCallbacks,
    options: StreamOptions = {}
): Promise<void> {
    const model = getActiveModel(options.isSideChat);
    const apiMessages = buildApiMessages(messages, options.systemPromptOverride);

    // ─── Route 1: Supabase Edge Function (secure) ───
    if (isSupabaseEnabled() && supabase) {
        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
            try {
                await streamViaEdgeFunction(
                    apiMessages,
                    model,
                    session.access_token,
                    callbacks,
                    options.systemPromptOverride,
                    options.signal
                );
                return;
            } catch (err) {
                console.warn('[OpenRouter] Edge Function failed, falling back to direct call:', err);
                // Fall through to direct call
            }
        }
    }

    // ─── Route 2: Direct OpenRouter call (dev/fallback) ───
    const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
    if (!apiKey) {
        callbacks.onError(
            'No API key available. Either configure Supabase (recommended) or add VITE_OPENROUTER_API_KEY to your .env file.'
        );
        return;
    }

    await streamDirect(apiMessages, model, apiKey, callbacks, options.signal);
}

/**
 * Stream via Supabase Edge Function (chat-proxy).
 */
async function streamViaEdgeFunction(
    apiMessages: Array<Record<string, unknown>>,
    model: ReturnType<typeof getActiveModel>,
    accessToken: string,
    callbacks: StreamCallbacks,
    systemPromptOverride?: string,
    signal?: AbortSignal
): Promise<void> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const templateMode = useUIStore.getState().templateMode;
    const isReasoning = model.supportsReasoning;

    if (!anonKey) {
        console.error('[OpenRouter] VITE_SUPABASE_ANON_KEY is missing. Edge Function call will likely fail.');
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/chat-proxy`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': anonKey || '',
        },
        body: JSON.stringify({
            messages: apiMessages,
            model: model.id,
            max_tokens: model.maxTokens,
            is_reasoning: isReasoning,
            template_mode: systemPromptOverride ? 'None' : templateMode,
        }),
        signal,
    });

    if (!response.ok) {
        const errBody = await response.text();
        let errorMsg = `API Error ${response.status}`;
        try {
            const parsed = JSON.parse(errBody);
            errorMsg = parsed.error || errorMsg;
        } catch {
            errorMsg += `: ${errBody}`;
        }
        callbacks.onError(errorMsg);
        return;
    }

    await processStream(response, callbacks, signal);
}

/**
 * Stream directly to OpenRouter (dev mode / fallback).
 */
async function streamDirect(
    apiMessages: Array<Record<string, unknown>>,
    model: ReturnType<typeof getActiveModel>,
    apiKey: string,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
): Promise<void> {
    const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': window.location.origin,
            'X-Title': import.meta.env.VITE_APP_NAME || 'Lucen',
        },
        body: JSON.stringify({
            model: model.id,
            messages: apiMessages,
            stream: true,
            max_tokens: model.maxTokens,
            plugins: []
        }),
        signal,
    });

    if (!response.ok) {
        const errBody = await response.text();
        callbacks.onError(`API Error ${response.status}: ${errBody}`);
        return;
    }

    await processStream(response, callbacks, signal);
}

/**
 * Process an SSE stream from either the Edge Function or direct OpenRouter call.
 */
async function processStream(
    response: Response,
    callbacks: StreamCallbacks,
    _signal?: AbortSignal
): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
        callbacks.onError('No response stream available');
        return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let wasTruncated = false;

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
                    return;
                }

                try {
                    const parsed = JSON.parse(data);
                    const choice = parsed.choices?.[0];
                    if (!choice) continue;

                    // Detect truncation: finish_reason === 'length' means max_tokens hit
                    if (choice.finish_reason === 'length') {
                        wasTruncated = true;
                    }

                    const delta = choice.delta;
                    if (!delta) continue;

                    // Handle reasoning content (DeepSeek R1, etc.)
                    if (delta.reasoning || delta.reasoning_content) {
                        callbacks.onReasoning(delta.reasoning || delta.reasoning_content);
                    }

                    // Handle regular content
                    if (delta.content) {
                        callbacks.onChunk(delta.content);
                    }
                } catch {
                    // Skip malformed JSON chunks
                }
            }
        }

        callbacks.onDone(wasTruncated);
    } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
            callbacks.onDone(false);
        } else {
            callbacks.onError(err instanceof Error ? err.message : 'Unknown error');
        }
    }
}
