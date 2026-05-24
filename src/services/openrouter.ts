import type { Message } from '../types';
import {
    getActiveModel,
    STREAM_IDLE_TIMEOUT_MS,
    CONTINUATION_MAX_CHUNKS_ARTIFACT,
    CONTINUATION_MAX_CHUNKS_CHAT,
    ABSOLUTE_OUTPUT_CEILING,
} from '../config/models';
import { TEMPLATES, BASE_SYSTEM_PROMPT } from '../config/prompts';
import { useUIStore } from '../store/uiStore';
import { supabase, isSupabaseEnabled } from '../lib/supabase';
import { useTokenStore } from '../store/tokenStore';
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
    onToolActivity?: (event: { id: string; tool: string; status: 'running' | 'completed' | 'failed'; label: string; args?: any; durationMs?: number }) => void;
    onUsageReceipt?: (receipt: { tools_used: any[]; prompt_tokens: number; completion_tokens: number; reasoning_tokens: number; total_credits: number; search_credits: number }) => void;
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
): string {
    if (!msg.attachments || msg.attachments.length === 0) {
        return msg.content;
    }
    const markers = msg.attachments.map((a) => {
        return a.type === 'image' ? `[Attached Image: ${a.id}]` : `[Attached File: ${a.id}]`;
    }).join('\n');
    return `${markers}\n\n${msg.content}`;
}

async function retrieveRelevantChunks(
    messages: Message[],
    conversationId: string | null
): Promise<string | null> {
    console.debug('[RAG] Starting check. ConvID:', conversationId);

    if (!conversationId) {
        return null;
    }

    // Only retrieve if conversation has file attachments
    const hasFiles = messages.some(m =>
        m.attachments?.some(a => a.type !== 'image')
    );
    if (!hasFiles) {
        return null;
    }

    // Use last user message as query (Lowered limit from 10 to 2)
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser || !lastUser.content || lastUser.content.length < 2) {
        return null;
    }

    console.debug('[RAG] Requirements met, calling Supabase...');

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    try {
        const { data: { session } } = await supabase!.auth.getSession();
        if (!session?.access_token) {
            console.debug('[RAG] Aborted: No active auth session.');
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
            console.debug('[RAG] Supabase error:', response.status);
            return null;
        }
        const data = await response.json();
        finalizeRetrieve({ status: response.status, response: data });
        const chunks = data.chunks as Array<{ file_name: string; content: string; similarity: number }>;

        if (!chunks || chunks.length === 0) {
            console.debug('[RAG] No chunks returned from search.');
            return null;
        }

        // Only use chunks with decent similarity
        const relevant = chunks.filter(c => c.similarity > 0.5);
        if (relevant.length === 0) {
            console.debug('[RAG] No chunks met similarity threshold (> 0.5).');
            return null;
        }

        const parts = relevant.map(c =>
            `── From: ${c.file_name} (relevance: ${Math.round(c.similarity * 100)}%) ──\n${c.content}`
        );

        console.debug(`[RAG] Success! Injected ${relevant.length} chunks.`);
        return `[Relevant file context retrieved for this query]\n${parts.join('\n\n')}`;

    } catch (err) {
        console.error('[RAG] Final Catch Error:', err);
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
    if (m.toolSteps) {
        for (const step of m.toolSteps) {
            if (step.output) {
                total += approxTokens(step.output.slice(0, 300));
            }
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
    opts: {
        supportsVision?: boolean;
        omittedTurnsCount?: number;
        segmentSummary?: string | null;
    } = {},
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
        const summaryText = opts.segmentSummary
            ? `Summary of omitted turns:\n${opts.segmentSummary}`
            : `${omittedTurnsCount} older turn${omittedTurnsCount === 1 ? '' : 's'} were omitted to fit the context window.`;
        systemMessages.push({
            role: 'system',
            content: `[Earlier conversation summary: ${summaryText} Pinned messages and the most recent turns are preserved below. Do NOT mention this omission to the user.]`,
        });
    }

function buildToolContextSummary(toolSteps: NonNullable<Message['toolSteps']>): string {
    const lines: string[] = [];
    for (const step of toolSteps) {
        if (step.status === 'completed' && step.output) {
            let toolName = step.tool;
            if (step.tool === 'analyze_image') toolName = 'Image analysis';
            else if (step.tool === 'process_file') toolName = 'File extraction';
            else if (step.tool === 'web_search') toolName = 'Web search';

            const sliced = step.output.slice(0, 300);
            const ellipsis = step.output.length > 300 ? '...' : '';
            lines.push(`${toolName}: ${sliced}${ellipsis}`);
        }
    }
    return lines.join('\n');
}

// Assemble the API payload: System messages MUST come before the conversation history
    const apiHistory: Array<Record<string, unknown>> = [];
    for (const m of recentMessages) {
        if (m.role !== 'user' && m.role !== 'assistant') continue;

        apiHistory.push({
            role: m.role,
            content: buildMessageContent(m),
        });

        if (m.role === 'assistant' && m.toolSteps && m.toolSteps.length > 0) {
            const summary = buildToolContextSummary(m.toolSteps);
            if (summary) {
                apiHistory.push({
                    role: 'system',
                    content: `[Tool context from this turn:\n${summary}]`,
                });
            }
        }
    }

    return [
        ...systemMessages,
        ...ragMessages,
        ...apiHistory,
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

    // Vision processing is now handled autonomously server-side via tools

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
            console.warn('[streamChat] failed to generate segment summary:', err);
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
                    "[System Note: You have a large but STRICT token budget for this response. Plan your answer so it naturally finishes in this budget—pick depth and breadth you can carry to a clear ending (no mid-sentence cutoffs). If the ask is too large for one pass, deliver one complete useful slice and state that scope in plain language. Answer the user's real need directly. For artifacts: build a COMPLETE, working version — choose a scope you can finish, not one you'll have to truncate. Do not create an artifact unless they explicitly want a renderable or downloadable deliverable. Never mention tokens, budgets, limits, or chunking.]",
            },
        ];

    const isReasoningEnabled = options.isSideChat ? false : model.supportsReasoning;

    // Accounting: one parent id per user turn. All continuation chunks share
    // this parent so the Usage UI can group them under the original turn.
    const rootRequestId = generateRequestId();
    const baseKind = 'chat';

    const accounting: CallAccounting = {
        parentRequestId: rootRequestId,
        messageId: options.messageId,
        conversationId: options.conversationId,
        callKind: isContinuation ? 'chat_continuation' : baseKind,
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
const STALL_MIN_CONTINUATION_CHARS = 200;        // below this, pass is stalled (model produced near-nothing)
const REPETITION_WINDOW = 500;                   // chars compared for overlap
const REPETITION_THRESHOLD = 0.85;
const REPETITION_MIN_OVERLAP_CHARS = 120;
const NETWORK_RETRY_DELAYS_MS = [500, 1000, 2000]; // exponential backoff per pass

// Per-turn total output budget (characters). Prevents ghost loops from
// burning unlimited tokens across many continuation passes. Roughly maps
// to ~50k tokens at ~4 chars/token.
const PER_TURN_OUTPUT_CHAR_BUDGET = 200_000;

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
 * Entropy check: detects low-entropy (repetitive/garbage) output by
 * counting unique character bigrams in the last N chars of the pass.
 * Normal code/prose has 80+ unique bigrams per 500 chars; repetitive
 * garbage (e.g. repeated console.log, infinite CSS blocks) has <20.
 */
function isLowEntropy(text: string, windowSize = 500, threshold = 20): boolean {
    if (text.length < windowSize) return false;
    const tail = text.slice(-windowSize);
    const bigrams = new Set<string>();
    for (let i = 0; i < tail.length - 1; i++) {
        bigrams.add(tail[i] + tail[i + 1]);
    }
    return bigrams.size < threshold;
}

/**
 * Structural validation: checks whether unclosed HTML tags are growing
 * without progress (a sign the model is looping). Returns true when the
 * output looks structurally unhealthy and continuation should stop.
 */
function hasStructuralRegression(text: string): boolean {
    if (text.length < 2000) return false;
    const tail = text.slice(-1500);
    // If the last 1500 chars have >10 unclosed <script or <style tags,
    // the model is likely stuck in a generation loop.
    const scriptOpens = (tail.match(/<script[\s>]/gi) || []).length;
    const scriptCloses = (tail.match(/<\/script>/gi) || []).length;
    const styleOpens = (tail.match(/<style[\s>]/gi) || []).length;
    const styleCloses = (tail.match(/<\/style>/gi) || []).length;
    const unbalanced = (scriptOpens - scriptCloses) + (styleOpens - styleCloses);
    return unbalanced > 5;
}

// Maximum chars of prior assistant text to include verbatim in a
// continuation. Beyond this, we use a tail-anchor: a structural summary
// of the truncated head + the verbatim tail. This prevents the context
// window from filling up on long artifacts and leaving no room for new
// generation.
const CONTINUATION_FULL_TEXT_LIMIT = 12_000;
const CONTINUATION_TAIL_CHARS = 4_000;

/**
 * Build a structural summary of HTML-like content for the truncated head.
 * Extracts tag structure and key milestones (e.g. "opened <html><head>
 * <style>... 240 lines of CSS ... <body>...") so the model knows what
 * it already generated without seeing every character.
 */
function buildStructuralSummary(text: string, maxLen = 600): string {
    const lines = text.split('\n');
    const totalChars = text.length;
    const totalLines = lines.length;
    const parts: string[] = [];
    parts.push(`[Prior output: ${totalChars} chars, ${totalLines} lines]`);

    // Find key structural milestones
    const tagRe = /<(\/?)(\w+)[\s>]/g;
    const openStack: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(text)) !== null) {
        if (m[1]) {
            const idx = openStack.lastIndexOf(m[2]);
            if (idx >= 0) openStack.splice(idx, 1);
        } else {
            openStack.push(m[2]);
        }
    }
    if (openStack.length > 0) {
        parts.push(`Currently open tags: ${openStack.slice(-8).join(' > ')}`);
    }
    return parts.join('\n').slice(0, maxLen);
}

/**
 * Build the message array for a continuation pass.
 *
 * For short accumulated text (< CONTINUATION_FULL_TEXT_LIMIT), includes
 * the full text verbatim. For long accumulated text, uses a tail-anchor
 * strategy: structural summary + last CONTINUATION_TAIL_CHARS chars.
 * This reduces input token cost by 80-90% on large artifacts.
 */
export function buildContinuationMessages(
    apiMessages: Array<Record<string, unknown>>,
    priorAssistantText: string,
): Array<Record<string, unknown>> {
    const insideArtifact = isInsideArtifact(priorAssistantText);

    // Tail-anchor: for long outputs, only send summary + tail to save tokens.
    let assistantContent: string;
    if (priorAssistantText.length <= CONTINUATION_FULL_TEXT_LIMIT) {
        assistantContent = priorAssistantText;
    } else {
        const summary = buildStructuralSummary(
            priorAssistantText.slice(0, priorAssistantText.length - CONTINUATION_TAIL_CHARS),
        );
        const tail = priorAssistantText.slice(-CONTINUATION_TAIL_CHARS);
        assistantContent = `${summary}\n\n[...truncated for context window...]\n\n${tail}`;
    }

    const messages: Array<Record<string, unknown>> = [
        ...apiMessages,
        { role: 'assistant', content: assistantContent },
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
            const hitTurnBudget = fullResponse.length >= PER_TURN_OUTPUT_CHAR_BUDGET;
            const repeating =
                continuationCount > 0 &&
                isRepeatingLastWindow(accumulated, passText);
            const lowEntropy = continuationCount > 0 && isLowEntropy(passText);
            const structuralIssue = continuationCount > 0 && hasStructuralRegression(fullResponse);

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
                    console.warn('[Continuation] low entropy detected (repetitive output) — stopping loop');
                } else if (structuralIssue) {
                    console.warn('[Continuation] structural regression detected — stopping loop');
                } else if (repeating) {
                    console.warn('[Continuation] repetition detected — stopping loop');
                } else if (stalled && truncated) {
                    console.warn('[Continuation] pass produced too few chars — stalled');
                } else if (hitTurnBudget) {
                    console.info('[Continuation] per-turn output budget reached — stopping');
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
                accounting ? { ...accounting, callKind: 'chat_continuation' } : undefined,
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

    // Web search and processing is now handled autonomously server-side via tools
    (requestPayload as any).web_search_enabled = !!webSearchEnabled;
    (requestPayload as any).web_search_used = false;
    (requestPayload as any).web_search_fallback_requested = false;

    // Debug: confirm this code path executed before we hit the Edge function.
    // eslint-disable-next-line no-console
    console.debug('[OpenRouter] sendingRequest', {
        model: model.id,
        is_reasoning: isReasoning,
        template_mode: templateMode,
    });

    if (OPENROUTER_RAW_DEBUG) {
        // eslint-disable-next-line no-console
        console.debug('[OpenRouter] requestHeadersRedacted', {
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
        console.debug('[OpenRouter] requestPayloadFullRedacted', safePayload);
    }

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
        console.debug('[OpenRouter] edgeError', {
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
        console.debug('[OpenRouter] streamSummary', {
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
            console.debug('[OpenRouter] rawSseTail', rawSse);
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

            let currentEvent: string | null = null;
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

                if (currentEvent === 'tool_activity') {
                    try {
                        const eventData = JSON.parse(data);
                        callbacks.onToolActivity?.(eventData);
                    } catch { /* ignore */ }
                    currentEvent = null;
                    continue;
                }
                if (currentEvent === 'usage_receipt') {
                    try {
                        const eventData = JSON.parse(data);
                        callbacks.onUsageReceipt?.(eventData);
                    } catch { /* ignore */ }
                    currentEvent = null;
                    continue;
                }
                currentEvent = null;

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
            console.debug('[OpenRouter] eofWithoutFinishReason — treating as truncated', {
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
            console.debug('[OpenRouter] watchdog fired — treating as truncated', {
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
