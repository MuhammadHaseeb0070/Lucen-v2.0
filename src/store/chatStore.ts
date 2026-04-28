import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { Conversation, Message } from '../types';
import { hasActiveSessionSync, supabase } from '../lib/supabase';
import * as db from '../services/database';
import { MIDSTREAM_PERSIST_MS } from '../config/models';
import { captureCall } from './debugStore';

// ─── Mid-stream persistence throttler ────────────────────────────────────
// During streaming we don't want to hit the DB on every token. This module-
// level map tracks, per message id, the last time we flushed content and
// whether a trailing write is pending. Entries are removed when the stream
// completes (isStreaming flips to false) so the map stays small.
const midstreamState = new Map<string, { lastFlushAt: number; pendingTimer: number | null }>();

function scheduleMidstreamFlush(
    convId: string,
    msgId: string,
    getMessage: () => Message | undefined,
): void {
    if (!hasActiveSessionSync()) return;
    const now = Date.now();
    const state = midstreamState.get(msgId) ?? { lastFlushAt: 0, pendingTimer: null };

    const elapsed = now - state.lastFlushAt;

    const flush = () => {
        state.pendingTimer = null;
        state.lastFlushAt = Date.now();
        midstreamState.set(msgId, state);
        const msg = getMessage();
        if (!msg || msg.role !== 'assistant') return;
        db.upsertStreamingMessage(convId, msg).catch((err) =>
            console.warn('[Midstream] flush failed (will retry on next tick):', err),
        );
    };

    if (elapsed >= MIDSTREAM_PERSIST_MS) {
        flush();
        return;
    }

    // A pending timer is already covering this window — no-op.
    if (state.pendingTimer !== null) {
        midstreamState.set(msgId, state);
        return;
    }

    state.pendingTimer = window.setTimeout(flush, MIDSTREAM_PERSIST_MS - elapsed);
    midstreamState.set(msgId, state);
}

function cancelMidstreamFlush(msgId: string): void {
    const state = midstreamState.get(msgId);
    if (state?.pendingTimer !== null && state?.pendingTimer !== undefined) {
        clearTimeout(state.pendingTimer);
    }
    midstreamState.delete(msgId);
}

// ─── AI Chat Title Generator ─────────────────────────────────────────────
// Fires once per conversation right after the FIRST assistant reply lands.
// The edge function is fully instrumented (logged to usage_logs with
// call_kind='title_gen') and persists the new title server-side, so the
// only thing we do here is optimistically reflect it in local state.
const titleGenInFlight = new Set<string>();

async function maybeGenerateTitle(
    convId: string,
    userMessage: string,
    assistantMessage: string,
    applyTitle: (title: string) => void,
): Promise<void> {
    if (!hasActiveSessionSync() || !supabase) return;
    if (!userMessage.trim()) return;
    if (titleGenInFlight.has(convId)) return;
    titleGenInFlight.add(convId);

    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
        if (!supabaseUrl || !anonKey) return;

        const requestId = (crypto as Crypto & { randomUUID?: () => string }).randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`;

        const requestBody = {
            conversation_id: convId,
            request_id: requestId,
            user_message: userMessage,
            assistant_message: assistantMessage,
        };

        const endpoint = `${supabaseUrl}/functions/v1/generate-title`;
        const finalize = captureCall({
            id: requestId,
            kind: 'title_gen',
            endpoint,
            request: requestBody,
        });

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'apikey': anonKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                finalize({ status: res.status, response: errText.slice(0, 1000), error: `HTTP ${res.status}` });
                return;
            }

            const data = (await res.json().catch(() => null)) as { title?: string | null } | null;
            finalize({ status: res.status, response: data });
            const title = data?.title?.trim();
            if (title && title !== 'New Chat') {
                applyTitle(title);
                // Server usually persists; this keeps the row in sync if the edge update raced or failed.
                if (hasActiveSessionSync()) {
                    db.renameConversation(convId, title, false).catch(() => {});
                }
            }
        } catch (err) {
            finalize({ error: err instanceof Error ? err.message : 'unknown' });
            throw err;
        }
    } catch (err) {
        console.warn('[chat-title] generation failed (non-fatal):', err);
    } finally {
        titleGenInFlight.delete(convId);
    }
}

interface ChatStore {
    conversations: Conversation[];
    activeConversationId: string | null;
    isLoading: boolean;
    isMessageLoading: boolean;
    isSynced: boolean;
    drafts: Record<string, string>;

    // Conversation actions
    createConversation: (templateId?: string) => string;
    deleteConversation: (id: string) => void;
    renameConversation: (id: string, title: string) => void;
    setActiveConversation: (id: string | null) => void;
    clearChats: () => void;
    updateAttachmentDescription: (dataUrl: string, description: string, generatedAt?: number) => void;
    forkConversation: (convId: string, messageId: string) => Promise<string | null>;

    // Message actions
    /** Resolves when the message row is persisted (or no-op if offline). Await the user turn before queuing the assistant to preserve DB `created_at` order. */
    addMessage: (convId: string, message: Message) => Promise<void>;
    updateMessage: (convId: string, msgId: string, updates: Partial<Message>) => void;
    deleteMessagePair: (convId: string, userMsgId: string) => void;
    getActiveConversation: () => Conversation | undefined;
    togglePinMessage: (convId: string, msgId: string) => void;
    getContextMessages: (convId: string) => Message[];
    setDraft: (convId: string, draft: string) => void;
    getDraft: (convId: string) => string;
    updateConversationTemplate: (convId: string, templateId: string) => void;

    // Supabase sync
    loadFromSupabase: () => Promise<void>;
    loadMessages: (convId: string) => Promise<void>;
}

export const useChatStore = create<ChatStore>()(
    persist(
        (set, get) => ({
            conversations: [],
            activeConversationId: null,
            isLoading: false,
            isMessageLoading: false,
            isSynced: false,
            drafts: {},

            createConversation: (templateId?: string) => {
                const state = get();
                const existingEmpty = state.conversations.find((c) => c.messages.length === 0);
                if (existingEmpty) {
                    set({ activeConversationId: existingEmpty.id });
                    return existingEmpty.id;
                }

                const id = uuidv4();
                const now = Date.now();
                const newConv: Conversation = {
                    id,
                    title: 'New Chat',
                    titleAuto: true,
                    messages: [],
                    createdAt: now,
                    updatedAt: now,
                    templateId: templateId || 'General',
                };
                set((state) => ({
                    conversations: [newConv, ...state.conversations],
                    activeConversationId: id,
                }));

                // Sync to Supabase in the background
                if (hasActiveSessionSync()) {
                    db.createConversation(id, 'New Chat').catch(console.error);
                }

                return id;
            },

            deleteConversation: (id) => {
                set((state) => {
                    const filtered = state.conversations.filter((c) => c.id !== id);
                    const newActive =
                        state.activeConversationId === id
                            ? filtered[0]?.id || null
                            : state.activeConversationId;

                    // Clean up draft
                    const newDrafts = { ...state.drafts };
                    delete newDrafts[id];

                    return { conversations: filtered, activeConversationId: newActive, drafts: newDrafts };
                });

                // Sync to Supabase
                if (hasActiveSessionSync()) {
                    db.deleteConversation(id).catch(console.error);
                }

                // If we deleted the last conversation, spawn a new one automatically
                if (get().conversations.length === 0) {
                    get().createConversation();
                }
            },

            renameConversation: (id, title) => {
                set((state) => ({
                    conversations: state.conversations.map((c) =>
                        c.id === id
                            ? { ...c, title, titleAuto: false, updatedAt: Date.now() }
                            : c
                    ),
                }));

                // Sync to Supabase — manual rename flips title_auto=false so
                // the AI generator can never override this edit.
                if (hasActiveSessionSync()) {
                    db.renameConversation(id, title, true).catch(console.error);
                }
            },

            setActiveConversation: (id) => {
                set({ activeConversationId: id });

                // Load messages from Supabase if needed
                if (id && hasActiveSessionSync()) {
                    const conv = get().conversations.find((c) => c.id === id);
                    if (conv && conv.messages.length === 0) {
                        get().loadMessages(id);
                    }
                }
            },

            clearChats: () => {
                set({ conversations: [], activeConversationId: null, drafts: {} });
            },

            updateAttachmentDescription: (dataUrl, description, generatedAt) => {
                const stamp = generatedAt ?? Date.now();
                set((state) => ({
                    conversations: state.conversations.map((c) => ({
                        ...c,
                        messages: c.messages.map((m) => {
                            if (!m.attachments?.some((a) => a.dataUrl === dataUrl)) return m;
                            return {
                                ...m,
                                attachments: m.attachments.map((a) =>
                                    a.dataUrl === dataUrl
                                        ? { ...a, aiDescription: description, descriptionGeneratedAt: stamp }
                                        : a
                                ),
                            };
                        }),
                    })),
                }));

                const state = get();
                const c = state.conversations.find((conv) => conv.messages.some((msg) => msg.attachments?.some((att) => att.dataUrl === dataUrl)));
                if (c && supabase) {
                    const msg = c.messages.find((m) => m.attachments?.some((a) => a.dataUrl === dataUrl));
                    if (msg) {
                        const att = msg.attachments?.find((a) => a.dataUrl === dataUrl);
                        if (att?.name) {
                            supabase.from('file_attachments')
                                .update({ ai_description: description })
                                .eq('message_id', msg.id)
                                .eq('file_name', att.name)
                                .then();
                        }
                    }
                }
            },

            addMessage: (convId, message) => {
                let isFirstMessage = false;

                set((state) => ({
                    conversations: state.conversations.map((c) => {
                        if (c.id !== convId) return c;

                        const isFirst = c.messages.length === 0;
                        if (isFirst) {
                            isFirstMessage = true;
                        }

                        const messages = [...c.messages, message];
                        // Leave the title as 'New Chat' for now — the AI title
                        // generator will produce a proper 1-3 word title after
                        // the first assistant reply completes. If it fails we
                        // still keep 'New Chat' (safer than a truncated prompt).
                        return { ...c, messages, updatedAt: Date.now() };
                    }),
                }));

                if (!hasActiveSessionSync()) {
                    return Promise.resolve();
                }

                // IMPORTANT: this promise must be awaited for the *user* message before
                // adding a streaming *assistant* row. If both run in parallel, the
                // assistant upsert can commit first with an earlier `created_at`,
                // so after refresh ORDER BY created_at shows the reply above the
                // request (inverted bubble order).
                return (async () => {
                    try {
                        if (isFirstMessage) {
                            const conv = get().conversations.find((c) => c.id === convId);
                            const currentTitle = conv?.title || 'New Chat';
                            await db.createConversation(convId, currentTitle);
                        }

                        if (message.isStreaming) {
                            await db.upsertStreamingMessage(convId, message);
                            return;
                        }
                        await db.saveMessage(convId, message);

                        // RAG embeds: fire-and-forget (do not block the returned promise)
                        if (message.attachments && message.attachments.length > 0) {
                            const { data: { session } } = await supabase!.auth.getSession();
                            if (session?.access_token) {
                                const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
                                const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

                                for (const att of message.attachments) {
                                    const contentToEmbed = att.textContent || att.aiDescription;

                                    if (contentToEmbed && contentToEmbed.length > 200) {
                                        const embedRequestId =
                                            typeof crypto !== 'undefined' && 'randomUUID' in crypto
                                                ? crypto.randomUUID()
                                                : `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                                        const embedEndpoint = `${supabaseUrl}/functions/v1/embed`;
                                        const embedBody = {
                                            text: contentToEmbed,
                                            file_name: att.name,
                                            message_id: message.id,
                                            conversation_id: convId,
                                            request_id: embedRequestId,
                                        };
                                        const finalizeEmbed = captureCall({
                                            id: embedRequestId,
                                            kind: 'embed',
                                            endpoint: embedEndpoint,
                                            request: embedBody,
                                        });

                                        fetch(embedEndpoint, {
                                            method: 'POST',
                                            headers: {
                                                'Content-Type': 'application/json',
                                                'Authorization': `Bearer ${session.access_token}`,
                                                'apikey': anonKey || '',
                                            },
                                            body: JSON.stringify(embedBody),
                                        })
                                            .then(async (r) => {
                                                const text = await r.text().catch(() => '');
                                                finalizeEmbed({
                                                    status: r.status,
                                                    response: text.slice(0, 4000),
                                                    error: r.ok ? undefined : `HTTP ${r.status}`,
                                                });
                                            })
                                            .catch((err) => {
                                                console.error('[RAG Embed] Failed:', err);
                                                finalizeEmbed({
                                                    error: err instanceof Error ? err.message : 'unknown',
                                                });
                                            });
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        console.error('[Sync] Error saving message to Supabase:', err);
                    }
                })();
            },

            updateMessage: (convId, msgId, updates) => {
                set((state) => ({
                    conversations: state.conversations.map((c) => {
                        if (c.id !== convId) return c;
                        return {
                            ...c,
                            messages: c.messages.map((m) =>
                                m.id === msgId ? { ...m, ...updates } : m
                            ),
                            updatedAt: Date.now(),
                        };
                    }),
                }));

                if (!hasActiveSessionSync()) return;

                // Stream finished → cancel any pending mid-stream flush, then
                // write the final content authoritatively.
                if (updates.isStreaming === false) {
                    cancelMidstreamFlush(msgId);
                    const conv = get().conversations.find((c) => c.id === convId);
                    const msg = conv?.messages.find((m) => m.id === msgId);
                    if (msg) {
                        db.updateMessageInDb(msgId, {
                            content: updates.content ?? msg.content,
                            reasoning: updates.reasoning ?? msg.reasoning,
                            isTruncated: updates.isTruncated ?? msg.isTruncated,
                            isStreaming: false,
                        }).catch(() => {
                            // Row didn't exist yet — insert it.
                            db.saveMessage(convId, {
                                ...msg,
                                ...updates,
                                isStreaming: false,
                            }).catch(console.error);
                        });
                    }

                    // Fire the AI title generator exactly once — right after the
                    // first assistant reply lands in a fresh conversation.
                    // Conditions:
                    //   - this finalized message is an assistant message
                    //   - conversation has exactly one user + one assistant message
                    //   - titleAuto is still true (user hasn't manually renamed)
                    if (conv && msg?.role === 'assistant' && conv.titleAuto !== false) {
                        const assistantCount = conv.messages.filter((m) => m.role === 'assistant').length;
                        const userMsg = conv.messages.find((m) => m.role === 'user');
                        const assistantContent = updates.content ?? msg.content;
                        if (assistantCount === 1 && userMsg && assistantContent.trim().length > 0) {
                            maybeGenerateTitle(
                                convId,
                                userMsg.content,
                                assistantContent,
                                (newTitle) => {
                                    set((state) => ({
                                        conversations: state.conversations.map((c) =>
                                            c.id === convId
                                                ? { ...c, title: newTitle, titleAuto: false, updatedAt: Date.now() }
                                                : c,
                                        ),
                                    }));
                                },
                            );
                        }
                    }
                    return;
                }

                // Mid-stream write: only content/reasoning changes are worth
                // persisting. Throttle to MIDSTREAM_PERSIST_MS so we don't
                // hammer the DB on every token.
                const isContentTouch =
                    updates.content !== undefined || updates.reasoning !== undefined;
                if (isContentTouch) {
                    scheduleMidstreamFlush(convId, msgId, () => {
                        const conv = get().conversations.find((c) => c.id === convId);
                        return conv?.messages.find((m) => m.id === msgId);
                    });
                }
            },

            deleteMessagePair: (convId, msgId) => {
                const conv = get().conversations.find((c) => c.id === convId);
                const idx = conv?.messages.findIndex((m) => m.id === msgId) ?? -1;
                if (!conv || idx === -1) return;

                const msg = conv.messages[idx];
                let idsToDelete = [msgId];
                let userMsgId = msg.role === 'user' ? msg.id : undefined;
                let assistantMsgId = msg.role === 'assistant' ? msg.id : undefined;

                if (msg.role === 'user') {
                    // Delete next assistant message if it exists
                    if (idx + 1 < conv.messages.length && conv.messages[idx + 1].role === 'assistant') {
                        assistantMsgId = conv.messages[idx + 1].id;
                        idsToDelete.push(assistantMsgId);
                    }
                } else if (msg.role === 'assistant') {
                    // Delete previous user message if it exists
                    if (idx - 1 >= 0 && conv.messages[idx - 1].role === 'user') {
                        userMsgId = conv.messages[idx - 1].id;
                        idsToDelete.push(userMsgId);
                    }
                }

                const newConversations = state.conversations.map((c) => {
                        if (c.id !== convId) return c;
                        return {
                            ...c,
                            messages: c.messages.filter((m) => !idsToDelete.includes(m.id)),
                            updatedAt: Date.now(),
                        };
                    });
                
                const updatedConv = newConversations.find((c) => c.id === convId);

                // Sync to Supabase
                if (hasActiveSessionSync()) {
                    db.deleteMessagePair(convId, userMsgId || msgId, assistantMsgId).catch(console.error);
                }

                if (updatedConv && updatedConv.messages.length === 0) {
                    // Prevent state update from the filter map and let deleteConversation handle it.
                    // But deleteConversation needs to happen on the next tick to avoid zustand issues during render/dispatch
                    setTimeout(() => {
                        get().deleteConversation(convId);
                    }, 0);
                } else {
                    set({ conversations: newConversations });
                }
            },

            togglePinMessage: (convId, msgId) => {
                const conv = get().conversations.find((c) => c.id === convId);
                const idx = conv?.messages.findIndex((m) => m.id === msgId) ?? -1;
                if (!conv || idx === -1) return;

                const msg = conv.messages[idx];
                const newPinnedState = !msg.isPinned;
                let idsToToggle = [msgId];

                if (msg.role === 'user') {
                    if (idx + 1 < conv.messages.length && conv.messages[idx + 1].role === 'assistant') {
                        idsToToggle.push(conv.messages[idx + 1].id);
                    }
                } else if (msg.role === 'assistant') {
                    if (idx - 1 >= 0 && conv.messages[idx - 1].role === 'user') {
                        idsToToggle.push(conv.messages[idx - 1].id);
                    }
                }

                set((state) => ({
                    conversations: state.conversations.map((c) => {
                        if (c.id !== convId) return c;
                        return {
                            ...c,
                            messages: c.messages.map((m) =>
                                idsToToggle.includes(m.id) ? { ...m, isPinned: newPinnedState } : m
                            ),
                            updatedAt: Date.now(),
                        };
                    }),
                }));

                if (hasActiveSessionSync()) {
                    idsToToggle.forEach((id) => {
                        db.updateMessagePin(id, newPinnedState).catch(console.error);
                    });
                }
            },

            getActiveConversation: () => {
                const state = get();
                return state.conversations.find((c) => c.id === state.activeConversationId);
            },

            getContextMessages: (convId) => {
                const conv = get().conversations.find((c) => c.id === convId);
                if (!conv) return [];
                // Return messages without streaming flags for API calls
                return conv.messages
                    .filter((m) => !m.isStreaming)
                    .map(({ id: _id, timestamp: _ts, isStreaming: _s, isReasoningStreaming: _rs, ...rest }) => rest as Message);
            },

            setDraft: (convId, draft) => {
                set((state) => ({
                    drafts: { ...state.drafts, [convId]: draft },
                }));
            },

            getDraft: (convId) => {
                return get().drafts[convId] || '';
            },

            updateConversationTemplate: (convId, templateId) => {
                set((state) => ({
                    conversations: state.conversations.map((c) =>
                        c.id === convId ? { ...c, templateId } : c
                    ),
                }));
            },

            forkConversation: async (convId, messageId) => {
                const conv = get().conversations.find((c) => c.id === convId);
                if (!conv) return null;
                const msgIndex = conv.messages.findIndex(m => m.id === messageId);
                if (msgIndex === -1) return null;

                const slicedMessages = conv.messages.slice(0, msgIndex + 1);
                const newConvId = uuidv4();
                const now = Date.now();
                const newTitle = conv.title.startsWith('(Forked)') ? conv.title : `(Forked) ${conv.title}`;
                
                const oldToNewMap = new Map<string, string>();
                slicedMessages.forEach(m => oldToNewMap.set(m.id, uuidv4()));

                const newMessages: Message[] = slicedMessages.map(m => {
                    const newId = oldToNewMap.get(m.id)!;
                    return {
                        ...m,
                        id: newId,
                        attachments: m.attachments?.map(a => ({ ...a })),
                    };
                });

                const newConv: Conversation = {
                    id: newConvId,
                    title: newTitle,
                    titleAuto: false,
                    messages: newMessages,
                    createdAt: now,
                    updatedAt: now,
                    templateId: conv.templateId,
                };

                set((state) => ({
                    conversations: [newConv, ...state.conversations],
                }));

                if (hasActiveSessionSync()) {
                    await db.createConversation(newConvId, newTitle);
                    await db.renameConversation(newConvId, newTitle, true);
                    
                    // Duplicate messages in db sequentially to maintain order and avoid race conditions
                    for (const msg of newMessages) {
                        await db.saveMessage(newConvId, msg);
                    }
                }

                return newConvId;
            },

            // ═══════════════════════════════════════════
            //  SUPABASE SYNC
            // ═══════════════════════════════════════════

            loadFromSupabase: async () => {
                if (!hasActiveSessionSync()) return;

                set({ isLoading: true });
                const conversations = await db.fetchConversations();

                if (conversations) {
                    set({
                        conversations: conversations,
                        isSynced: true,
                        isLoading: false,
                    });
                } else {
                    set({ isLoading: false });
                }
            },

            loadMessages: async (convId) => {
                if (!hasActiveSessionSync()) return;

                set({ isMessageLoading: true });
                const messages = await db.fetchMessages(convId);
                if (messages && messages.length > 0) {
                    set((state) => ({
                        conversations: state.conversations.map((c) =>
                            c.id === convId ? { ...c, messages } : c
                        ),
                    }));
                }
                set({ isMessageLoading: false });
            },
        }),
        {
            name: 'lucen-chat-storage',
            // Strip heavy file content from persisted state to prevent OOM.
            // Only metadata (name, type, size) is saved; file content is transient.
            partialize: (state) => ({
                ...state,
                // Don't persist loading/sync flags
                isLoading: false,
                isMessageLoading: false,
                isSynced: false,
                // Do not cache conversations locally to force full-stack sync 
                // from Supabase
                conversations: [],
                activeConversationId: null,
            }),
        }
    )
);
