import type { Message } from '../types';
import {
    getActiveModel,
    STREAM_IDLE_TIMEOUT_MS,
    CONTINUATION_MAX_CHUNKS_ARTIFACT,
    CONTINUATION_MAX_CHUNKS_CHAT,
    ABSOLUTE_OUTPUT_CEILING,
} from '../config/models';
import { formatFileSize } from './fileProcessor';
import { TEMPLATES, BASE_SYSTEM_PROMPT } from '../config/prompts';
import { useUIStore } from '../store/uiStore';
import { supabase, isSupabaseEnabled } from '../lib/supabase';
import { useTokenStore } from '../store/tokenStore';
import { useChatStore } from '../store/chatStore';
import {
    detectResponseMode,
    getPerCallOutput,
    narrowForInput,
    SAFETY_HEADROOM as BUDGET_SAFETY_HEADROOM,
    MIN_PER_CALL_OUTPUT,
    type ResponseMode,
} from './outputBudget';
import { PARTIAL_OPEN_RE, INCOMPLETE_TAG_RE } from '../lib/artifactParser';
import { captureCall } from '../store/debugStore';

function newRequestId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// OpenRouter is only called server-side via chat-proxy; no direct client calls.

const OPENROUTER_RAW_DEBUG = false;
const OPENROUTER_RAW_DEBUG_MAX_CHARS = 250_000; // cap to avoid freezing the browser console

interface StreamCallbacks {
    onChunk: (content: string, isContinuation?: boolean) => void;
    onReasoning: (reasoning: string) => void;
    onDone: (truncated?: boolean) => void;
    onError: (error: string) => void;
    onWebSearchUsed?: (urls?: string[]) => void;
    onClarificationNeeded?: (question: string) => void;
}

interface StreamOptions {
    systemPromptOverride?: string;
    signal?: AbortSignal;
    isSideChat?: boolean;
    webSearchEnabled?: boolean;
    conversationId?: string;
    /**
     * The assistant message id being populated by this call. Threaded into
     * the chat-proxy request so usage_logs rows can be correlated back to a
     * specific chat turn.
     */
    messageId?: string;
    // Manual continuation: resume a truncated assistant reply using the same
    // structured protocol the auto-continue loop uses. `priorAssistantText`
    // should be the partial content already shown to the user.
    continuation?: { priorAssistantText: string };
}

/**
 * Accounting metadata threaded through every chat-proxy call. Populated
 * once per user turn by `streamChat` and then recursed through the
 * continuation wrapper. Each continuation chunk gets its own `requestId`
 * but shares the same `parentRequestId` — that's what links them in the
 * Usage UI.
 */
interface CallAccounting {
    parentRequestId: string;
    messageId?: string;
    conversationId?: string;
    callKind: 'chat' | 'chat_continuation';
    inputCostPer1M: number;
    outputCostPer1M: number;
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
            console.log('[RAG Debug] Supabase error:', response.status);
            return null;
        }
        const data = await response.json();
        finalizeRetrieve({ status: response.status, response: data });
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

// ─── Token-aware context pruning ─────────────────────────────────────────────
// Replaces the naive `slice(-30)` with a budget-aware selection that:
//   1. Always keeps pinned messages (in original order).
//   2. Walks backward from the tail including messages while total token cost
//      stays under the input budget.
//   3. Reports how many older turns were dropped so we can surface a hint.
//
// Uses a fast char-based approximation (4 chars ≈ 1 token) rather than N
// worker round-trips — pruning only needs rough decisions, and the final
// output budget still uses the precise tokenizer in computeOutputBudget.

function approxTokens(text: string): number {
    return Math.ceil((text || '').length / 4);
}

function messageCostApprox(m: Message): number {
    let total = approxTokens(m.content);
    if (m.attachments) {
        for (const a of m.attachments) {
            if (a.textContent) total += approxTokens(a.textContent);
            if (a.aiDescription) total += approxTokens(a.aiDescription);
        }
    }
    // Per-message framing overhead (role tags, delimiters)
    total += 8;
    return total;
}

interface PruneResult {
    pruned: Message[];
    droppedCount: number;
}

function pruneMessagesForContext(
    messages: Message[],
    inputBudgetTokens: number,
): PruneResult {
    if (messages.length === 0) return { pruned: [], droppedCount: 0 };

    // Always-kept messages: pinned + any message that is currently streaming.
    // A streaming assistant message must never be pruned mid-flight — doing so
    // would break mid-stream persistence and orphan the user's visible bubble.
    const pinnedIds = new Set(messages.filter((m) => m.isPinned).map((m) => m.id));
    const streamingIds = new Set(messages.filter((m) => m.isStreaming).map((m) => m.id));
    const alwaysKeptIds = new Set<string>([...pinnedIds, ...streamingIds]);

    let fixedCost = 0;
    for (const m of messages) {
        if (alwaysKeptIds.has(m.id)) fixedCost += messageCostApprox(m);
    }
    const nonPinnedBudget = Math.max(0, inputBudgetTokens - fixedCost);

    const keptNonPinned = new Set<string>();
    let running = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (alwaysKeptIds.has(m.id)) continue;
        const c = messageCostApprox(m);
        if (running + c > nonPinnedBudget) break;
        keptNonPinned.add(m.id);
        running += c;
    }

    // Always keep at least the last 2 non-pinned messages (typically the
    // current user turn + the immediately preceding assistant turn) even if
    // they exceed the budget — otherwise the request is semantically useless.
    if (keptNonPinned.size === 0) {
        for (let i = messages.length - 1, kept = 0; i >= 0 && kept < 2; i--) {
            const m = messages[i];
            if (alwaysKeptIds.has(m.id)) continue;
            keptNonPinned.add(m.id);
            kept++;
        }
    }

    const pruned: Message[] = [];
    let droppedCount = 0;
    for (const m of messages) {
        if (alwaysKeptIds.has(m.id) || keptNonPinned.has(m.id)) {
            pruned.push(m);
        } else {
            droppedCount++;
        }
    }
    return { pruned, droppedCount };
}

/**
 * Build the full API message array with system prompts and conversation history.
 * Does NOT inject the token budget — that's done after counting in streamChat().
 *
 * `omittedTurnsCount` > 0 adds a one-line summary note so the model knows
 * earlier history existed but was trimmed to fit the window.
 */
function buildApiMessages(
    messages: Message[],
    systemPromptOverride?: string,
    ragContext?: string | null,
    opts: { supportsVision?: boolean; omittedTurnsCount?: number } = {},
): Array<Record<string, unknown>> {
    const templateMode = useUIStore.getState().templateMode;
    const supportsVision = opts.supportsVision !== false;
    const omittedTurnsCount = opts.omittedTurnsCount || 0;

    // Pruning happens BEFORE this function is called. We no longer apply a
    // fixed slice(-30); the caller is responsible for budget-aware trimming.
    const recentMessages = messages;

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

    // Earlier-conversation omission note (context pruning signal)
    if (omittedTurnsCount > 0) {
        systemMessages.push({
            role: 'system',
            content: `[Earlier conversation summary: ${omittedTurnsCount} older turn${omittedTurnsCount === 1 ? '' : 's'} were omitted to fit the context window. Pinned messages and the most recent turns are preserved below. Do NOT mention this omission to the user.]`,
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

// Re-export for any callers that imported from here historically.
const SAFETY_HEADROOM = BUDGET_SAFETY_HEADROOM;

/**
 * Compute how many output tokens are safely available for this request.
 *
 * The per-call cap is already a dynamic value derived from the model's
 * real capability + the Supabase wall-clock budget (see
 * `outputBudget.getPerCallOutput`). This function only SHRINKS it further
 * when the input is so large there's not enough context-window headroom
 * for a full call. It never expands beyond `perCallCap`.
 */
async function computeOutputBudget(
    apiMessages: Array<Record<string, unknown>>,
    contextWindow: number,
    perCallCap: number
): Promise<number> {
    try {
        // Serialize text parts for token counting. Image parts are
        // approximated by the safety headroom.
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

        console.debug(
            `[TokenBudget] input=${inputTokens} ctx=${contextWindow} cap=${perCallCap} → budget=${budget}`,
        );
        return budget;
    } catch (err) {
        console.warn('[TokenBudget] Counting failed, using fallback:', err);
        return Math.max(MIN_PER_CALL_OUTPUT, perCallCap);
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

    const describeRequestId = newRequestId();
    const describeEndpoint = `${supabaseUrl}/functions/v1/describe-image`;
    const describeBody = {
        images: needsDescribe.map((a) => ({ dataUrl: a.dataUrl, name: a.name })),
        recent_messages,
        user_text: currentMsg.content,
        request_id: describeRequestId,
    };
    const finalizeDescribe = captureCall({
        id: describeRequestId,
        kind: 'describe_image',
        endpoint: describeEndpoint,
        request: describeBody,
    });

    try {
        const response = await fetch(describeEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
                'apikey': anonKey || '',
            },
            body: JSON.stringify(describeBody),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            finalizeDescribe({ status: response.status, response: errText.slice(0, 4000), error: `HTTP ${response.status}` });
            console.warn('[ensureImageContext] describe-image failed:', response.status);
            return;
        }

        const data = await response.json();
        finalizeDescribe({ status: response.status, response: data });
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
        finalizeDescribe({ error: err instanceof Error ? err.message : 'unknown' });
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

    // ─── Per-request output policy ──────────────────────────────────────────
    // Side chat never produces artifacts, so it always uses chat-mode budget.
    // Manual continuations inherit 'artifact' mode because if the user had to
    // press Continue, the response was clearly long-form — give it the bigger
    // cap so the resume pass actually completes the work.
    const isContinuation = !!options.continuation;
    const mode: ResponseMode = options.isSideChat
        ? 'chat'
        : isContinuation
            ? 'artifact'
            : detectResponseMode(messages);
    // Dynamic per-call cap — depends on the model's throughput, reasoning
    // leak profile, and context window. See outputBudget.ts.
    const perCallCap = getPerCallOutput(mode, model);

    // ─── Token-aware context pruning ────────────────────────────────────────
    // Reserve room for:
    //   - per-call output (perCallCap)
    //   - safety headroom (tokenizer approximation, per-call framing)
    //   - a blanket allowance for system prompts + template + RAG
    const SYSTEM_PROMPT_RESERVE = 5000;
    const conversationBudget = Math.max(
        4096,
        model.contextWindow - perCallCap - SAFETY_HEADROOM - SYSTEM_PROMPT_RESERVE,
    );
    const { pruned: prunedMessages, droppedCount } = pruneMessagesForContext(messages, conversationBudget);

    const apiMessages = buildApiMessages(prunedMessages, options.systemPromptOverride, ragContext, {
        supportsVision: model.supportsVision,
        omittedTurnsCount: droppedCount,
    });

    const outputBudget = await computeOutputBudget(
        apiMessages,
        model.contextWindow,
        perCallCap
    );

    // Manual continuation: build the ChatGPT-style resume payload (prior
    // assistant text as an `assistant` message + short `user` nudge). The
    // auto-continuation path inside streamViaEdgeFunctionWrapper uses the
    // exact same helper.
    // Fresh turn: append a quiet "finish cleanly" note so the model doesn't
    // write "…continued below" or similar meta-commentary.
    const messagesWithBudget: Array<Record<string, unknown>> = isContinuation
        ? buildContinuationMessages(apiMessages, options.continuation!.priorAssistantText)
        : [
            ...apiMessages,
            {
                role: 'system',
                content:
                    "[System Note: Finish what you need to say within this single response. If the full answer truly will not fit, stop at a clean line boundary and the system will auto-continue your reply. Do NOT write phrases like 'continued below', 'I'll continue in the next message', '...', or any meta-commentary about length. Never mention tokens, budgets, limits, or chunking in your response. Just answer naturally.]",
            },
        ];

    const isReasoningEnabled = options.isSideChat ? false : model.supportsReasoning;

    // Accounting: one parent id per user turn. All continuation chunks share
    // this parent so the Usage UI can group them under the original turn.
    const accounting: CallAccounting = {
        parentRequestId: generateRequestId(),
        messageId: options.messageId,
        conversationId: options.conversationId,
        callKind: isContinuation ? 'chat_continuation' : 'chat',
        inputCostPer1M: model.inputCostPer1m || 0,
        outputCostPer1M: model.outputCostPer1m || 0,
    };

    // IMPORTANT: we always stream so the UX stays responsive.
    // If a provider doesn't stream reasoning, `message.reasoning` may be empty.
    //
    // Seed `accumulated` with the prior assistant text on manual continuation
    // so the output-ceiling check and repetition guard see the true running
    // total, not just the chars produced in this pass.
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
}

function generateRequestId(): string {
    // Fast UUID-ish id — good enough for correlation (collisions astronomically
    // unlikely at chat-request scale). Kept dependency-free.
    const c = globalThis.crypto;
    if (c && 'randomUUID' in c) return c.randomUUID();
    return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Structured continuation protocol ────────────────────────────────────────
// When a model hits its per-call output cap (finish_reason === 'length'), we
// automatically issue a follow-up request that tells it to resume mid-sentence
// WITHOUT re-emitting the artifact opening tag or repeating prior content. The
// client concatenates chunks so the user sees one continuous stream.

// ─── Continuation policy constants (env-driven; see src/config/models.ts) ──
// These values are intentionally generous — the real safety net is the
// per-call output cap from outputBudget.ts, which already keeps each call
// under Supabase's 150s idle timeout.
const STALL_MIN_CONTINUATION_CHARS = 8;          // below this, pass is stalled
const REPETITION_WINDOW = 500;                   // chars compared for overlap
// Higher threshold (85%) + minimum overlap length (120 chars) together avoid
// false-positives on deliberately repetitive content like song choruses,
// structured lists, or TOC entries. A natural "common hook phrase" at the
// start of a pass (e.g. "The key points are:") would be ~20-40 chars and
// won't cross the 120-char floor.
const REPETITION_THRESHOLD = 0.85;
const REPETITION_MIN_OVERLAP_CHARS = 120;
const NETWORK_RETRY_DELAYS_MS = [500, 1000, 2000]; // exponential backoff per pass

function getMaxChunksForMode(mode: ResponseMode): number {
    // These are imported as named exports from models.ts and refer to the
    // env-driven ceilings. Artifact mode gets more chunks because long-form
    // content (stories, code files, reports) benefits from multiple passes.
    return mode === 'artifact'
        ? CONTINUATION_MAX_CHUNKS_ARTIFACT
        : CONTINUATION_MAX_CHUNKS_CHAT;
}

/**
 * Detect whether the model is inside an unclosed <lucen_artifact> tag.
 * When true, the continuation must NOT re-emit the opening tag — the
 * content should resume inside the body.
 */
function isInsideArtifact(priorAssistantText: string): boolean {
    if (PARTIAL_OPEN_RE.test(priorAssistantText)) return true;
    if (INCOMPLETE_TAG_RE.test(priorAssistantText)) return true;
    const lastOpen = priorAssistantText.lastIndexOf('<lucen_artifact');
    const lastClose = priorAssistantText.lastIndexOf('</lucen_artifact>');
    return lastOpen > lastClose;
}

/**
 * Repetition guard: if the new pass starts by re-emitting most of the last
 * N characters of the prior response, the model has lost its place. This
 * happens rarely with ChatGPT-style payloads but is a strong signal to
 * stop the loop rather than keep piling on repeated text.
 *
 * Returns `true` when the overlap ratio is above REPETITION_THRESHOLD.
 */
function isRepeatingLastWindow(prior: string, pass: string): boolean {
    if (!prior || !pass) return false;
    const tail = prior.slice(-REPETITION_WINDOW);
    const head = pass.slice(0, REPETITION_WINDOW);
    if (tail.length < REPETITION_MIN_OVERLAP_CHARS || head.length < REPETITION_MIN_OVERLAP_CHARS) return false;

    // Count longest common prefix-ish overlap by sliding window.
    let longestOverlap = 0;
    const maxLen = Math.min(tail.length, head.length);
    for (let n = maxLen; n >= REPETITION_MIN_OVERLAP_CHARS; n--) {
        if (tail.slice(tail.length - n) === head.slice(0, n)) {
            longestOverlap = n;
            break;
        }
    }
    if (longestOverlap < REPETITION_MIN_OVERLAP_CHARS) return false;
    const ratio = longestOverlap / Math.min(tail.length, head.length);
    return ratio >= REPETITION_THRESHOLD;
}

/**
 * Build the message array for a continuation pass.
 *
 * This follows the same pattern ChatGPT's "Continue generating" uses: feed
 * the accumulated assistant output back verbatim as an `assistant` message,
 * then add a brief `user` nudge to continue without repetition. No
 * "system_continuation_protocol" block — it confuses smaller models and
 * isn't needed with modern instruction-tuned LLMs.
 *
 * For artifact mode we add a tiny system note if the model is in the
 * middle of an unclosed <lucen_artifact> tag, since that's app-specific.
 */
export function buildContinuationMessages(
    apiMessages: Array<Record<string, unknown>>,
    priorAssistantText: string,
): Array<Record<string, unknown>> {
    const insideArtifact = isInsideArtifact(priorAssistantText);

    const messages: Array<Record<string, unknown>> = [
        ...apiMessages,
        { role: 'assistant', content: priorAssistantText },
    ];

    if (insideArtifact) {
        messages.push({
            role: 'system',
            content:
                'You are mid-stream inside an unclosed <lucen_artifact> tag. Do NOT re-emit the opening tag. Continue the artifact body exactly where it left off. Emit </lucen_artifact> once the content is complete.',
        });
    }

    messages.push({
        role: 'user',
        content:
            'Continue from exactly where you stopped. Do not repeat anything, do not add any preamble, do not acknowledge the cut, do not summarize.',
    });

    return messages;
}

/**
 * Wrapper for streamViaEdgeFunction that implements robust auto-continuation.
 *
 * Triggers retry on ANY of:
 *   - `finish_reason === 'length'` (per-call cap hit)
 *   - `finish_reason === 'error'` or top-level stream error
 *   - EOF without `[DONE]` and no natural finish
 *   - Watchdog timeout (STREAM_IDLE_TIMEOUT_MS of silence)
 *
 * Stops on:
 *   - `finish_reason === 'stop'` + `[DONE]` (happy path)
 *   - User abort (signal.aborted === true with no watchdog)
 *   - `continuationCount >= maxChunks` (ceiling reached — surface truncated)
 *   - Pass produced < STALL_MIN_CONTINUATION_CHARS (model stalled)
 *   - Repetition guard (>70% overlap — model is stuck, surface truncated)
 *   - Accumulated output >= ABSOLUTE_OUTPUT_CEILING (safety cap)
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
    mode: ResponseMode = 'chat',
    continuationCount = 0,
    accumulated = '',
    accounting?: CallAccounting,
): Promise<void> {
    let passChars = 0;
    let passText = '';
    let fullResponse = accumulated;
    const maxChunks = getMaxChunksForMode(mode);

    const innerCallbacks: StreamCallbacks = {
        ...callbacks,
        onChunk: (chunk, isContinuation) => {
            passChars += chunk.length;
            passText += chunk;
            fullResponse += chunk;
            callbacks.onChunk(chunk, isContinuation || continuationCount > 0);
        },
        onDone: async (truncated) => {
            const userAborted = signal?.aborted === true;
            const hitChunkCeiling = continuationCount >= maxChunks;
            const stalled = passChars < STALL_MIN_CONTINUATION_CHARS;
            const hitOutputCeiling = fullResponse.length >= ABSOLUTE_OUTPUT_CEILING * 8; // ~8 chars/token
            const repeating =
                continuationCount > 0 &&
                isRepeatingLastWindow(accumulated, passText);

            const shouldContinue =
                truncated === true
                && !userAborted
                && !hitChunkCeiling
                && !stalled
                && !repeating
                && !hitOutputCeiling;

            if (!shouldContinue) {
                // Surface truncated=true to the UI whenever the model ran into
                // a ceiling (chunk cap, stall, repetition, output cap). This
                // exposes the manual "Continue generating" button.
                const surfaceTruncated =
                    truncated === true &&
                    (hitChunkCeiling || stalled || repeating || hitOutputCeiling);
                if (repeating) {
                    console.warn('[Continuation] repetition detected — stopping loop');
                } else if (stalled && truncated) {
                    console.warn('[Continuation] pass produced too few chars — stalled');
                } else if (hitChunkCeiling) {
                    console.info(`[Continuation] max chunks reached (${maxChunks}) — stopping`);
                } else if (hitOutputCeiling) {
                    console.info('[Continuation] absolute output ceiling reached — stopping');
                }
                callbacks.onDone(surfaceTruncated);
                return;
            }

            console.info(
                `[Continuation] truncated → auto-continue (${continuationCount + 1}/${maxChunks})`,
            );
            const continuationMessages = buildContinuationMessages(apiMessages, fullResponse);

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
                accounting
                    ? { ...accounting, callKind: 'chat_continuation' }
                    : undefined,
            );
        },
    };

    // ─── Network-retry with exponential backoff ──────────────────────────
    // streamViaEdgeFunction can throw on transient network failures before
    // any SSE bytes arrive (DNS, TLS, 5xx from edge). Retry up to 3 times
    // with backoff before propagating the error to the caller's onError.
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
            return; // success path handled inside innerCallbacks.onDone
        } catch (err) {
            lastErr = err;
            if (signal?.aborted) {
                callbacks.onDone(false);
                return;
            }
            const delay = NETWORK_RETRY_DELAYS_MS[attempt];
            if (delay === undefined) break;
            console.warn(
                `[Continuation] network error on attempt ${attempt + 1} — retrying in ${delay}ms`,
                err,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    callbacks.onError(
        lastErr instanceof Error ? lastErr.message : 'Streaming failed after retries',
    );
}

/**
 * Thin wrapper over streamViaEdgeFunction that re-throws network-level
 * errors (fetch failures, non-ok status) so the continuation wrapper can
 * retry them with exponential backoff. Protocol-level errors that arrive
 * through the SSE stream itself are still delivered via callbacks.onDone.
 */
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
    // We wrap onError so we can distinguish: transient network vs. stream
    // content error. Transient errors throw so the retry loop can catch them.
    let networkError: Error | null = null;
    const wrappedCallbacks: StreamCallbacks = {
        ...innerCallbacks,
        onError: (msg) => {
            // Retry-worthy if the message suggests infrastructure failure.
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

    // If the underlying function captured a retry-worthy error without
    // throwing, re-throw here so the continuation wrapper's backoff loop
    // picks it up.
    if (networkError) {
        throw networkError;
    }
}

/**
 * Stream via Supabase Edge Function (chat-proxy).
 */
async function resolveWebSearchContext(
    apiMessages: Array<Record<string, unknown>>,
    parentRequestId?: string,
): Promise<{ shouldSearch: boolean; searchHint: string | null; urls: string[]; clarificationNeeded?: string | null; searchResults?: string | null; searchUrls?: string[] }> {
    const noSearch = { shouldSearch: false, searchHint: null, urls: [], clarificationNeeded: null, searchResults: null, searchUrls: [] };

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
    if (!session?.access_token) return { shouldSearch: false, searchHint: null, urls, clarificationNeeded: null, searchResults: null, searchUrls: [] };

    const intentRequestId = newRequestId();
    const intentEndpoint = `${supabaseUrl}/functions/v1/classify-intent`;
    const intentBody = {
        messages: contextMessages,
        request_id: intentRequestId,
        parent_request_id: parentRequestId ?? null,
    };
    const finalizeIntent = captureCall({
        id: intentRequestId,
        parentId: parentRequestId,
        kind: 'classify_intent',
        endpoint: intentEndpoint,
        request: intentBody,
    });

    try {
        const intentResponse = await fetch(intentEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
                'apikey': anonKey || '',
            },
            body: JSON.stringify(intentBody),
        });

        if (!intentResponse.ok) {
            const text = await intentResponse.text().catch(() => '');
            finalizeIntent({ status: intentResponse.status, response: text, error: `HTTP ${intentResponse.status}` });
            return { shouldSearch: false, searchHint: null, urls, clarificationNeeded: null, searchResults: null, searchUrls: [] };
        }

        const result = await intentResponse.json();
        finalizeIntent({ status: intentResponse.status, response: result });
        console.log('[classify-intent] result:', JSON.stringify(result));

        if (result.state === 'skip') return noSearch;

        if (result.state === 'clarify' && result.question) {
            return { shouldSearch: false, searchHint: null, urls, clarificationNeeded: result.question, searchResults: null, searchUrls: [] };
        }

        if (result.state === 'search') {
            // Format search results into clean context block. If Tavily gave us
            // nothing usable (no answerBox, no knowledge graph, no organic
            // results) we still inject a short note so the main model knows a
            // search was attempted and can respond honestly instead of
            // hallucinating.
            let searchResultsText: string | null = null;
            const clean = (v: unknown, max: number): string => {
                const s = String(v ?? '').replace(/\s+/g, ' ').trim();
                if (!s) return '';
                return s.length > max ? `${s.slice(0, max)}...` : s;
            };

            const hasAnswer = !!result.results?.answerBox;
            const hasKnowledge = !!result.results?.knowledgeGraph?.description;
            const organicCount = Array.isArray(result.results?.organic) ? result.results.organic.length : 0;
            const anyResults = hasAnswer || hasKnowledge || organicCount > 0;

            if (result.results && anyResults) {
                const parts: string[] = [`Web search results for: "${result.query}"\n`];

                if (result.results.answerBox) {
                    const ab = result.results.answerBox;
                    parts.push(`DIRECT ANSWER: ${clean(ab.answer || ab.snippet || '', 420)}`);
                }
                if (result.results.knowledgeGraph?.description) {
                    parts.push(`KNOWLEDGE: ${clean(result.results.knowledgeGraph.description, 420)}`);
                }
                if (organicCount > 0) {
                    parts.push('SEARCH RESULTS:');
                    // Keep only top few concise hits to avoid flooding the main
                    // model with noisy listicle HTML/alt-text that can derail
                    // style and cause meta/planning leakage.
                    for (const r of result.results.organic.slice(0, 3)) {
                        const title = clean(r.title, 160);
                        const snippet = clean(r.snippet, 360);
                        const link = clean(r.link, 220);
                        parts.push(`- ${title}\n  ${snippet}\n  ${link}`);
                    }
                }
                searchResultsText = parts.join('\n');
            } else if (result.results) {
                // Search ran but produced no usable results.
                searchResultsText =
                    `Web search was performed for "${result.query}" but returned no usable results. ` +
                    `Answer the user honestly from your training knowledge, and mention that the live search came back empty if relevance of real-time data matters.`;
            }

            return {
                shouldSearch: true,
                searchHint: result.query || lastUserText,
                urls,
                clarificationNeeded: null,
                searchResults: searchResultsText,
                searchUrls: Array.isArray(result.results?.organic) ? result.results.organic.map((r: any) => r.link).filter(Boolean) : [],
            };
        }

        return { shouldSearch: false, searchHint: null, urls, clarificationNeeded: null, searchResults: null, searchUrls: [] };

    } catch (err) {
        console.error('[classify-intent] FAILED:', err);
        finalizeIntent({ error: err instanceof Error ? err.message : 'unknown' });
        return { shouldSearch: false, searchHint: null, urls, clarificationNeeded: null, searchResults: null, searchUrls: [] };
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
    signal?: AbortSignal,
    mode: ResponseMode = 'chat',
    accounting?: CallAccounting,
): Promise<void> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const templateMode = useUIStore.getState().templateMode;
    const isReasoning = isReasoningEnabled;

    if (!anonKey) {
        console.error('[OpenRouter] VITE_SUPABASE_ANON_KEY is missing. Edge Function call will likely fail.');
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

    // ── Web search (Tavily via classify-intent) ─────────────────────────
    // Flow:
    //   1. classify-intent (cheap model) decides search vs skip vs clarify.
    //   2. If search: classify-intent runs Tavily and returns results.
    //   3. We inject those results as a system message and the MAIN model
    //      (MiniMax / whatever is in VITE_MAIN_CHAT_MODEL) answers.
    //
    // We NEVER forward OpenRouter's `plugins` to chat-proxy; that would
    // swap the model to OPENROUTER_ONLINE_MODEL and run Tavily a second
    // time. The server-side fallback to the online model only kicks in
    // when we signal `web_search_fallback_requested=true`, which happens
    // only if classify-intent itself crashed while the user was asking
    // for a search.
    let webSearchFallbackRequested = false;
    let webSearchUsed = false;
    if (webSearchEnabled) {
        let ctx: Awaited<ReturnType<typeof resolveWebSearchContext>>;
        try {
            ctx = await resolveWebSearchContext(apiMessages, perCallRequestId);
        } catch (err) {
            console.warn('[webSearch] classify-intent threw, will request server-side fallback:', err);
            ctx = { shouldSearch: false, searchHint: null, urls: [], clarificationNeeded: null, searchResults: null, searchUrls: [] };
            webSearchFallbackRequested = true;
        }

        const { shouldSearch, urls, clarificationNeeded, searchResults, searchUrls } = ctx;

        if (clarificationNeeded) {
            callbacks.onClarificationNeeded?.(clarificationNeeded);
            return;
        }

        if (shouldSearch && searchResults) {
            // Extract links from organic results to display in the UI
            callbacks.onWebSearchUsed?.(searchUrls);
            webSearchUsed = true;
            // Inject real search results directly — NO `plugins` field.
            // By appending directly to the user's message, we ensure the model sees
            // the results BEFORE it decides to trigger its own internal search tool.
            const msgs = requestPayload.messages as Array<Record<string, unknown>>;
            let lastUserIdx = -1;
            for (let i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i].role === 'user') {
                    lastUserIdx = i;
                    break;
                }
            }

            const searchInjection = `\n\n[SYSTEM INJECTION: WEB SEARCH ALREADY COMPLETED]\n${searchResults}\n\nCRITICAL INSTRUCTION: The web search requested above has ALREADY been executed automatically by the system. The results are provided above. You MUST NOT attempt to invoke any search tools, output search queries, or generate internal tool blocks. You must immediately synthesize these results into a highly detailed, comprehensive, and tailored natural language response to the user's original request. Do not ask the user to find information themselves.`;
            const urlInjection = urls.length > 0 ? `\n\n[User referenced these URLs: ${urls.join(', ')}. Retrieve and use their content.]` : '';
            const finalInjection = searchInjection + urlInjection;

            if (lastUserIdx !== -1) {
                const currentContent = msgs[lastUserIdx].content;
                if (typeof currentContent === 'string') {
                    msgs[lastUserIdx].content = currentContent + finalInjection;
                } else if (Array.isArray(currentContent)) {
                    currentContent.push({ type: 'text', text: finalInjection });
                }
            } else {
                msgs.push({
                    role: 'system',
                    content: finalInjection.trim()
                });
            }
        } else if (webSearchEnabled && !clarificationNeeded && !webSearchUsed) {
            // Classify-intent did not produce usable results (either skip or
            // search-failure). If the user explicitly asked for search AND
            // classify-intent crashed, fall back to the server-side online
            // model as a last resort.
            if (webSearchFallbackRequested) {
                console.warn('[webSearch] falling back to server-side online model');
            }
        }
    }

    // Signal to chat-proxy what actually happened client-side:
    //   web_search_enabled   — user turned the toggle on
    //   web_search_used      — classify-intent ran Tavily successfully
    //   web_search_fallback  — classify-intent failed; server may swap to
    //                          OPENROUTER_ONLINE_MODEL as last-resort
    (requestPayload as any).web_search_enabled = !!webSearchEnabled;
    (requestPayload as any).web_search_used = webSearchUsed;
    (requestPayload as any).web_search_fallback_requested = webSearchFallbackRequested;

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

    const chatEndpoint = `${supabaseUrl}/functions/v1/chat-proxy`;
    const finalizeChat = captureCall({
        id: perCallRequestId,
        parentId: accounting?.parentRequestId,
        kind: (accounting?.callKind === 'chat_continuation' ? 'chat' : 'chat') as 'chat',
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

    await processStream(response, callbacks, signal, (summary) => {
        finalizeChat({
            status: response.status,
            response: summary,
        });
    });
}

/**
 * Process an SSE stream from the Edge Function.
 *
 * The stream finishes in one of four ways:
 *
 *  1. `[DONE]` sentinel received (happy path).
 *  2. Natural EOF without `[DONE]` but after a `finish_reason` (also happy path).
 *  3. EOF without any `finish_reason` → treated as truncated (socket was cut).
 *  4. Watchdog timeout (>STREAM_IDLE_TIMEOUT_MS of silence) → treated as truncated
 *     so the continuation loop resumes from the last saved character.
 *  5. User abort (via `signal`) → `onDone(false)`, no resume.
 */
interface StreamFinalizeSummary {
    endedWith: 'done' | 'eof' | 'abort' | 'error' | 'watchdog';
    truncated: boolean;
    sawNaturalFinish: boolean;
    watchdogFired: boolean;
    chunkCount: number;
    reasoningChunkCount: number;
    contentChunkCount: number;
    content: string;   // accumulated content (capped)
    reasoning: string; // accumulated reasoning (capped)
    error?: string;
}

async function processStream(
    response: Response,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
    onFinalize?: (summary: StreamFinalizeSummary) => void,
): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
        callbacks.onError('No response stream available');
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

    const decoder = new TextDecoder();
    let buffer = '';
    let wasTruncated = false;
    let sawNaturalFinish = false;
    let watchdogFired = false;
    let lastDataAt = Date.now();

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

    const logStreamSummary = (why: 'done' | 'eof' | 'abort' | 'error' | 'watchdog') => {
        // eslint-disable-next-line no-console
        console.log('[OpenRouterDebug] streamSummary', {
            why,
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
        });

        if (OPENROUTER_RAW_DEBUG) {
            // eslint-disable-next-line no-console
            console.log('[OpenRouterDebug] rawSseTail', rawSse);
        }
    };

    // ─── Idle watchdog ───────────────────────────────────────────────────
    // If the upstream goes silent (no SSE line, not even keepalive) for
    // STREAM_IDLE_TIMEOUT_MS, cancel the reader so the outer loop exits.
    // We flip `watchdogFired` first so the catch branch can tell this apart
    // from a user-triggered abort and resume via the continuation loop.
    const watchdogTimer = setInterval(() => {
        if (Date.now() - lastDataAt <= STREAM_IDLE_TIMEOUT_MS) return;
        watchdogFired = true;
        try {
            // Cause the pending reader.read() to reject, unwinding the loop.
            reader.cancel('watchdog-idle-timeout').catch(() => {});
        } catch {
            // ignore
        }
    }, Math.max(1000, Math.floor(STREAM_IDLE_TIMEOUT_MS / 4)));

    // ─── User-abort listener ─────────────────────────────────────────────
    // The fetch() call already observes `signal`, but once the response body
    // is being read we need to explicitly cancel the reader when the signal
    // aborts — otherwise reader.read() just hangs forever.
    const onAbort = () => {
        try {
            reader.cancel('user-abort').catch(() => {});
        } catch {
            // ignore
        }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

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

        // Guard against split-tag leakage across chunk boundaries for known
        // internal tags. If a chunk ends with a dangling start fragment, drop
        // that fragment and let the next chunk carry semantic content.
        t = t.replace(/<(?:lucen_system|runtime_context|assistant_vision_notice|image_perception)[^>\n]{0,80}$/gi, '');

        return t;
    }

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Any bytes received — even keepalive comments — reset the
            // watchdog timer. This is what keeps a slow-but-alive stream
            // from being killed prematurely.
            lastDataAt = Date.now();

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
                    } else if (
                        choice.finish_reason === 'stop' ||
                        choice.finish_reason === 'content_filter' ||
                        choice.finish_reason === 'tool_calls' ||
                        choice.finish_reason === 'end_turn'
                    ) {
                        sawNaturalFinish = true;
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
                        if (accReasoning.length < FINALIZE_CONTENT_CAP) {
                            accReasoning += reasoningChunk;
                        }
                        if (OPENROUTER_RAW_DEBUG && reasoningSamples.length < 6 && reasoningChunk.trim()) {
                            reasoningSamples.push(reasoningChunk.slice(0, 400));
                        }
                    }

                    // Handle regular content
                    if (delta.content) {
                        callbacks.onChunk(sanitizeAssistantOutput(String(delta.content)));
                        contentChunkCount++;
                        lastContentTail = String(delta.content).slice(-220);
                        if (accContent.length < FINALIZE_CONTENT_CAP) {
                            accContent += String(delta.content);
                        }
                        if (OPENROUTER_RAW_DEBUG && contentSamples.length < 6 && String(delta.content).trim()) {
                            contentSamples.push(String(delta.content).slice(0, 400));
                        }
                    }
                } catch {
                    // Skip malformed JSON chunks
                }
            }
        }

        // If we reached EOF without [DONE] AND without any natural-finish
        // signal, the socket was almost certainly cut mid-response. Surface
        // this as "truncated" so the continuation loop resumes instead of
        // silently stopping with a half-finished artifact and a stuck UI.
        const sawAnyUsefulOutput = contentChunkCount > 0 || reasoningChunkCount > 0;
        const eofTruncated = wasTruncated || (!sawNaturalFinish && sawAnyUsefulOutput);
        if (!wasTruncated && eofTruncated) {
            // eslint-disable-next-line no-console
            console.log('[OpenRouterDebug] eofWithoutFinishReason — treating as truncated', {
                contentChunkCount,
                reasoningChunkCount,
            });
        }
        callbacks.onDone(eofTruncated);
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
            console.log('[OpenRouterDebug] watchdog fired — treating as truncated', {
                contentChunkCount,
                idleMs: Date.now() - lastDataAt,
            });
            callbacks.onDone(true);
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
            callbacks.onDone(false);
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
            const msg = err instanceof Error ? err.message : 'Unknown error';
            callbacks.onError(msg);
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
    }
}
