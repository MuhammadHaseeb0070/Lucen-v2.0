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

    // Message actions
    addMessage: (convId: string, message: Message) => void;
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
                const id = uuidv4();
                const now = Date.now();
                const newConv: Conversation = {
                    id,
                    title: 'New Chat',
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
                        c.id === id ? { ...c, title, updatedAt: Date.now() } : c
                    ),
                }));

                // Sync to Supabase
                if (hasActiveSessionSync()) {
                    db.renameConversation(id, title).catch(console.error);
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
                        // Auto-title from first user message
                        const title =
                            isFirst && message.role === 'user'
                                ? message.content.slice(0, 40) + (message.content.length > 40 ? '...' : '')
                                : c.title;

                        return { ...c, messages, title, updatedAt: Date.now() };
                    }),
                }));

                // Save message to Supabase. For streaming assistant placeholders
                // we still persist the row (empty content) so a page refresh
                // during generation can resume from the DB — matches the
                // behavior of ChatGPT / Claude / Gemini.
                if (hasActiveSessionSync()) {
                    const syncToDb = async () => {
                        try {
                            // If this is the absolute first message, ensure the conversation row exists first
                            if (isFirstMessage) {
                                // Find the title the store just generated
                                const conv = get().conversations.find((c) => c.id === convId);
                                const currentTitle = conv?.title || 'New Chat';

                                // Await creation/UPSERT of the conversation with the correct auto-title
                                await db.createConversation(convId, currentTitle);
                            }

                            // Now safe to save the message. Streaming placeholders
                            // go through upsertStreamingMessage so subsequent
                            // throttled writes can find the row via ON CONFLICT.
                            if (message.isStreaming) {
                                await db.upsertStreamingMessage(convId, message);
                                return;
                            }
                            await db.saveMessage(convId, message);

                            // --- NEW RAG LOGIC: Vectorize files ONLY after message is saved ---
                            if (message.attachments && message.attachments.length > 0) {
                                const { data: { session } } = await supabase!.auth.getSession();
                                if (session?.access_token) {
                                    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
                                    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

                                    for (const att of message.attachments) {
                                        // Embed either the raw text (PDF/Code) or the AI Image Description
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

                                            // Fire and forget so we don't slow down the chat UI
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
                            // -----------------------------------------------------------------

                        } catch (err) {
                            console.error('[Sync] Error saving message to Supabase:', err);
                        }
                    };

                    syncToDb();
                }
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

                set((state) => ({
                    conversations: state.conversations.map((c) => {
                        if (c.id !== convId) return c;
                        return {
                            ...c,
                            messages: c.messages.filter((m) => !idsToDelete.includes(m.id)),
                            updatedAt: Date.now(),
                        };
                    }),
                }));

                // Sync to Supabase
                if (hasActiveSessionSync()) {
                    db.deleteMessagePair(convId, userMsgId || msgId, assistantMsgId).catch(console.error);
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
