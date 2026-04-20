import type { Message } from '../types';
import { getActiveModel } from '../config/models';
import { formatFileSize } from './fileProcessor';
import { TEMPLATES, BASE_SYSTEM_PROMPT } from '../config/prompts';
import { useUIStore } from '../store/uiStore';
import { supabase, isSupabaseEnabled } from '../lib/supabase';
import { useTokenStore } from '../store/tokenStore';
import { useChatStore } from '../store/chatStore';
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
    conversationId?: string;
}

/**
 * Build the `content` field for the API.
 * - No attachments → simple string (most efficient)
 * - With attachments → array of content parts (multimodal)
 * Puts text first (as recommended by OpenRouter), then images.
 *
 * When `supportsVision` is false, `image_url` parts are NEVER emitted. Instead
 * images are represented by their first-person `aiDescription` so the main
 * model can respond naturally as if it saw them itself.
 */
function buildMessageContent(
    msg: Message,
    includeImages: boolean = true,
    includeFileText: boolean = true,
    supportsVision: boolean = true,
): string | Array<Record<string, unknown>> {
    if (!msg.attachments || msg.attachments.length === 0) {
        return msg.content;
    }

    const parts: Array<Record<string, unknown>> = [];
    const textAttachments = msg.attachments.filter((a) => a.textContent);
    const imageAttachments = msg.attachments.filter((a) => a.type === 'image' && (a.dataUrl || a.aiDescription));

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
        ? 'The user shared the image(s) above.'
        : '');
    if (userText) {
        parts.push({ type: 'text', text: userText });
    }

    // 4. Image content
    //   - If the main model supports vision AND this is a recent enough message,
    //     emit native image_url parts (raw base64) for direct perception.
    //   - Otherwise emit first-person description text so the main model can
    //     respond as if it personally saw the image.
    if (imageAttachments.length > 0) {
        const canSendRawImages = includeImages && supportsVision;

        if (canSendRawImages) {
            for (const img of imageAttachments) {
                if (img.dataUrl) {
                    parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
                } else if (img.aiDescription) {
                    parts.push({ type: 'text', text: `[Image: ${img.name}]\nI see: ${img.aiDescription}` });
                }
            }
        } else {
            // Text-fallback path (used always for text-only main models).
            // If all images share the exact same aiDescription (batched vision
            // call), emit it once to avoid duplicating hundreds of tokens.
            const distinct = Array.from(new Set(
                imageAttachments.map((a) => a.aiDescription || '').filter(Boolean),
            ));

            if (distinct.length === 1 && imageAttachments.length > 1) {
                const names = imageAttachments.map((a) => a.name).join(', ');
                parts.push({
                    type: 'text',
                    text: `[Images: ${names}]\nI see: ${distinct[0]}`,
                });
            } else {
                for (const img of imageAttachments) {
                    if (img.aiDescription) {
                        parts.push({ type: 'text', text: `[Image: ${img.name}]\nI see: ${img.aiDescription}` });
                    } else {
                        parts.push({
                            type: 'text',
                            text: `[Image: ${img.name}]\n(I wasn't able to get a clear look at this image right now.)`,
                        });
                    }
                }
            }
        }
    }

    return parts;
}

async function retrieveRelevantChunks(
    messages: Message[],
    conversationId: string | null
): Promise<string | null> {
    console.log('[RAG Debug] Starting check. ConvID:', conversationId);

    if (!conversationId) {
        console.log('[RAG Debug] Aborted: No conversation ID provided by the UI.');
        return null;
    }

    // Only retrieve if conversation has file attachments
    const hasFiles = messages.some(m =>
        m.attachments?.some(a => a.type !== 'image')
    );
    if (!hasFiles) {
        console.log('[RAG Debug] Aborted: No files found in this chat history.');
        return null;
    }

    // Use last user message as query (Lowered limit from 10 to 2)
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser || !lastUser.content || lastUser.content.length < 2) {
        console.log('[RAG Debug] Aborted: User message too short.');
        return null;
    }

    console.log('[RAG Debug] Requirements met, calling Supabase...');

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    try {
        const { data: { session } } = await supabase!.auth.getSession();
        if (!session?.access_token) {
            console.log('[RAG Debug] Aborted: No active auth session.');
            return null;
        }

        const response = await fetch(`${supabaseUrl}/functions/v1/retrieve-chunks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
                'apikey': anonKey || '',
            },
            body: JSON.stringify({
                query: lastUser.content,
                conversation_id: conversationId,
                top_k: 5,
            }),
        });

        if (!response.ok) {
            console.log('[RAG Debug] Supabase error:', response.status);
            return null;
        }
        const data = await response.json();
        const chunks = data.chunks as Array<{ file_name: string; content: string; similarity: number }>;

        if (!chunks || chunks.length === 0) {
            console.log('[RAG Debug] No chunks returned from search.');
            return null;
        }

        // Only use chunks with decent similarity
        const relevant = chunks.filter(c => c.similarity > 0.5);
        if (relevant.length === 0) {
            console.log('[RAG Debug] No chunks met similarity threshold (> 0.5).');
            return null;
        }

        const parts = relevant.map(c =>
            `── From: ${c.file_name} (relevance: ${Math.round(c.similarity * 100)}%) ──\n${c.content}`
        );

        console.log(`[RAG Debug] Success! Injected ${relevant.length} chunks.`);
        return `[Relevant file context retrieved for this query]\n${parts.join('\n\n')}`;

    } catch (err) {
        console.error('[RAG Debug] Final Catch Error:', err);
        return null;
    }
}

// A silent, always-on notice that tells the main model to treat any first-person
// "I see …" blocks it sees on user messages as its own direct perception.
// This keeps the assistant from ever mentioning helpers/tools/descriptions.
const ASSISTANT_VISION_NOTICE = `<assistant_vision_notice>
When the user attaches images in this conversation, each image will appear inside their message as "[Image: <name>]" followed by a first-person description starting with "I see:". Treat those descriptions as your own direct perception of the image — respond as if you personally looked at it. Never mention any description, tool, helper, model, process, or that you received information from elsewhere. Never say things like "based on the description", "from what I can see in the description", or "I was told". Just speak naturally about what you see, as if the image were right in front of you.
</assistant_vision_notice>`;

function buildRuntimeContext(): string {
    const now = new Date();
    const localStr = now.toLocaleString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
    const iso = now.toISOString();
    return `<runtime_context>\nCurrent date/time: ${localStr} (UTC ${iso}).\nUse this as your authoritative "now" when the user asks about today, dates, days of the week, or recency — do not claim uncertainty about the current date.\n</runtime_context>`;
}

/**
 * Build the full API message array with system prompts and conversation history.
 * Does NOT inject the token budget — that's done after counting in streamChat().
 */
function buildApiMessages(
    messages: Message[],
    systemPromptOverride?: string,
    ragContext?: string | null,
    opts: { supportsVision?: boolean } = {},
): Array<Record<string, unknown>> {
    const templateMode = useUIStore.getState().templateMode;
    const supportsVision = opts.supportsVision !== false;

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

    // Always inject current date/time so the main model can answer date-sensitive
    // questions without needing web search.
    systemMessages.push({ role: 'system', content: buildRuntimeContext() });

    // If the main model can't natively see images AND this conversation has
    // any image attachments, give the assistant the "treat descriptions as
    // your own eyes" notice so it never leaks helper/tool existence.
    if (!supportsVision) {
        const hasAnyImage = recentMessages.some((m) => m.attachments?.some((a) => a.type === 'image'));
        if (hasAnyImage) {
            systemMessages.push({ role: 'system', content: ASSISTANT_VISION_NOTICE });
        }
    }

    // Inject RAG context if available
    const ragMessages: Array<Record<string, unknown>> = [];
    if (ragContext) {
        ragMessages.push({
            role: 'system',
            content: ragContext,
        });
    }

    // Assemble the API payload: System messages MUST come before the conversation history
    return [
        ...systemMessages,
        ...ragMessages,
        ...recentMessages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m, index) => ({
                role: m.role,
                // OPTIMIZATION: For vision-capable main models, only include raw
                // image base64 for the last 2 messages. Older messages rely on
                // the stored first-person description. For text-only main
                // models, raw images are never emitted (see buildMessageContent).
                content: buildMessageContent(
                    m,
                    index >= recentMessages.length - 2,
                    index >= recentMessages.length - 3,
                    supportsVision,
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
        const TIMEOUT_SAFE_CAP = 16384;
        const budget = Math.max(MIN_OUTPUT_BUDGET, Math.min(TIMEOUT_SAFE_CAP, maxOutputTokens, remaining));

        console.debug(`[TokenBudget] input=${inputTokens} ctx=${contextWindow} maxOut=${maxOutputTokens} → budget=${budget}`);
        return budget;
    } catch (err) {
        // If token counting fails for any reason, fall back to a conservative default
        console.warn('[TokenBudget] Counting failed, using fallback:', err);
        return Math.min(maxOutputTokens, 16384);
    }
}

// ─── Vision context orchestration ────────────────────────────────────────────
// When the main model can't natively see images, run the vision helper once
// per turn that contains NEW images. Descriptions are written back to the
// attachments so they persist in message history and are reused on follow-ups
// without any extra API calls.
//
// Staleness policy: if an image is still referenced in the active window
// (last 3 user turns) but its description was generated more than 3 user turns
// ago, we re-describe it with the current context so the assistant stays
// accurate. Otherwise cached descriptions are reused.
const MAX_VISION_CONTEXT_EXCHANGES = 10; // last 5 user/assistant exchanges
const STALE_AFTER_USER_TURNS = 3;

function countUserMessagesAfter(messages: Message[], timestamp: number): number {
    let count = 0;
    for (const m of messages) {
        if (m.role === 'user' && m.timestamp > timestamp) count++;
    }
    return count;
}

async function ensureImageContext(messages: Message[]): Promise<void> {
    // Find the current (most recent) user message — this is the turn being sent.
    let currentIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') { currentIdx = i; break; }
    }
    if (currentIdx === -1) return;

    const currentMsg = messages[currentIdx];
    const currentImages = (currentMsg.attachments || []).filter(
        (a) => a.type === 'image' && a.dataUrl,
    );
    if (currentImages.length === 0) return;

    // Decide which of the current turn's images actually need a (re)description.
    //   • No aiDescription at all         → needs description.
    //   • Has description but it's stale  → refresh with current context.
    const needsDescribe = currentImages.filter((att) => {
        if (!att.aiDescription) return true;
        const stamp = att.descriptionGeneratedAt;
        if (!stamp) return true;
        const turnsSince = countUserMessagesAfter(messages, stamp);
        return turnsSince > STALE_AFTER_USER_TURNS;
    });

    if (needsDescribe.length === 0) return; // All fresh — reuse silently.

    if (!isSupabaseEnabled() || !supabase) return;

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    // Build recent conversation context (excluding the current turn). Include
    // prior images' descriptions as plain text so the vision helper can
    // understand references like "the second chart we looked at".
    const priorMessages = messages.slice(Math.max(0, currentIdx - MAX_VISION_CONTEXT_EXCHANGES), currentIdx);
    const recent_messages = priorMessages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => {
            const imageHints = (m.attachments || [])
                .filter((a) => a.type === 'image')
                .map((a) => a.aiDescription ? `[Image ${a.name}] ${a.aiDescription}` : `[Image ${a.name}]`)
                .join(' ');
            const content = [m.content, imageHints].filter(Boolean).join('\n');
            return { role: m.role, content };
        });

    try {
        const response = await fetch(`${supabaseUrl}/functions/v1/describe-image`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
                'apikey': anonKey || '',
            },
            body: JSON.stringify({
                images: needsDescribe.map((a) => ({ dataUrl: a.dataUrl, name: a.name })),
                recent_messages,
                user_text: currentMsg.content,
            }),
        });

        if (!response.ok) {
            console.warn('[ensureImageContext] describe-image failed:', response.status);
            return;
        }

        const data = await response.json();
        const description: string = typeof data?.description === 'string' ? data.description.trim() : '';
        if (!description) return;

        // Persist the same batched description on every image that was part of
        // this call so buildMessageContent can emit it exactly once.
        const now = Date.now();
        const { updateAttachmentDescription } = useChatStore.getState();
        for (const att of needsDescribe) {
            if (!att.dataUrl) continue;
            // Optimistic local update with a generated-at timestamp.
            updateAttachmentDescription(att.dataUrl, description, now);
        }
    } catch (err) {
        console.warn('[ensureImageContext] exception:', err);
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

    // Retrieve relevant file chunks via RAG before building context
    const ragContext = await retrieveRelevantChunks(
        messages,
        options.conversationId || null
    );

    // If the main model can't see images directly, run the silent vision helper
    // once for any images in the current turn (batched). No effect on turns
    // without new images.
    if (!model.supportsVision) {
        await ensureImageContext(messages);
        // Refresh messages from the store so the freshly-written aiDescription
        // is picked up by buildApiMessages.
        if (options.conversationId) {
            const conv = useChatStore.getState().conversations.find((c) => c.id === options.conversationId);
            if (conv) {
                const refreshed = conv.messages.filter((m) => !m.isStreaming);
                messages = refreshed as Message[];
            }
        }
    }

    const apiMessages = buildApiMessages(messages, options.systemPromptOverride, ragContext, {
        supportsVision: model.supportsVision,
    });

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
            // NOTE: Post-reply background description has been removed.
            // Image understanding now happens via ensureImageContext() BEFORE the main
            // model call, so a single vision call per turn is enough. Leaving
            // generateImageDescriptionsInBackground defined for backwards compatibility
            // in case a caller still invokes it elsewhere.

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
): Promise<{ shouldSearch: boolean; searchHint: string | null; urls: string[]; clarificationNeeded?: string | null; searchResults?: string | null }> {
    const noSearch = { shouldSearch: false, searchHint: null, urls: [], clarificationNeeded: null, searchResults: null };

    const contextMessages = apiMessages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-6);

    if (contextMessages.length === 0) return noSearch;

    const extractText = (content: unknown): string => {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) return (content as Array<Record<string, unknown>>).filter((p) => p.type === 'text').map((p) => p.text as string).join(' ');
        return '';
    };

    const lastUser = [...contextMessages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return noSearch;
    const lastUserText = extractText(lastUser.content).trim();

    if (lastUserText.length < 3) return noSearch;
    const trivial = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|great|cool|perfect|lol|haha|done|stop|wait|go ahead|continue|agreed|nice|awesome)[\s!.?]*$/i;
    if (trivial.test(lastUserText)) return noSearch;

    const urlRegex = /https?:\/\/[^\s"'<>]+/g;
    const urls = lastUserText.match(urlRegex) || [];

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const { data: { session } } = await supabase!.auth.getSession();
    if (!session?.access_token) return { shouldSearch: false, searchHint: null, urls, clarificationNeeded: null, searchResults: null };

    try {
        const intentResponse = await fetch(`${supabaseUrl}/functions/v1/classify-intent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
                'apikey': anonKey || '',
            },
            body: JSON.stringify({ messages: contextMessages }),
        });

        if (!intentResponse.ok) return { shouldSearch: false, searchHint: null, urls, clarificationNeeded: null, searchResults: null };

        const result = await intentResponse.json();
        console.log('[classify-intent] result:', JSON.stringify(result));

        if (result.state === 'skip') return noSearch;

        if (result.state === 'clarify' && result.question) {
            return { shouldSearch: false, searchHint: null, urls, clarificationNeeded: result.question, searchResults: null };
        }

        if (result.state === 'search') {
            // Format search results into clean context block
            let searchResultsText: string | null = null;

            if (result.results) {
                const parts: string[] = [`Web search results for: "${result.query}"\n`];

                if (result.results.answerBox) {
                    const ab = result.results.answerBox;
                    parts.push(`DIRECT ANSWER: ${ab.answer || ab.snippet || ''}`);
                }
                if (result.results.knowledgeGraph?.description) {
                    parts.push(`KNOWLEDGE: ${result.results.knowledgeGraph.description}`);
                }
                if (result.results.organic?.length > 0) {
                    parts.push('SEARCH RESULTS:');
                    for (const r of result.results.organic) {
                        parts.push(`- ${r.title}\n  ${r.snippet}\n  ${r.link}`);
                    }
                }
                searchResultsText = parts.join('\n');
            }

            return {
                shouldSearch: true,
                searchHint: result.query || lastUserText,
                urls,
                clarificationNeeded: null,
                searchResults: searchResultsText,
            };
        }

        return { shouldSearch: false, searchHint: null, urls, clarificationNeeded: null, searchResults: null };

    } catch (err) {
        console.error('[classify-intent] FAILED:', err);
        return { shouldSearch: false, searchHint: null, urls, clarificationNeeded: null, searchResults: null };
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
        const { shouldSearch, urls, clarificationNeeded, searchResults } = await resolveWebSearchContext(apiMessages);

        if (clarificationNeeded) {
            callbacks.onClarificationNeeded?.(clarificationNeeded);
            return;
        }

        if (shouldSearch && searchResults) {
            callbacks.onWebSearchUsed?.();
            (requestPayload as any).plugins = [{ id: 'web', engine: 'tavily', max_results: 5 }];
            // Inject real search results directly — no Exa plugin needed
            requestPayload.messages = [
                ...(requestPayload.messages as Array<Record<string, unknown>>),
                {
                    role: 'system',
                    content: `[Web Search Results Injected]\n${searchResults}\n\nINSTRUCTIONS: Use these results to answer the user directly. Do not ask the user to find information themselves. Do not ask about timezone or competition unless the user hasn't mentioned it at all in the entire conversation. Make reasonable assumptions. If results lack detail, say so briefly and use your training knowledge to supplement.`,
                },
            ];
            // URLs mentioned by user
            if (urls.length > 0) {
                requestPayload.messages = [
                    ...(requestPayload.messages as Array<Record<string, unknown>>),
                    {
                        role: 'system',
                        content: `[User referenced these URLs: ${urls.join(', ')}. Retrieve and use their content.]`,
                    },
                ];
            }
        }
        // No Exa plugin at all — Serper handles search in classify-intent
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
        // Internal vision / runtime notices must never surface to the user.
        t = t.replace(/<assistant_vision_notice>[\s\S]*?<\/assistant_vision_notice>/gi, '');
        t = t.replace(/<runtime_context>[\s\S]*?<\/runtime_context>/gi, '');
        t = t.replace(/<image_perception>[\s\S]*?<\/image_perception>/gi, '');

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
                if (!trimmed || trimmed.startsWith(':')) continue;
                if (!trimmed.startsWith('data: ')) continue;

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
