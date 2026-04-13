import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { Conversation, Message } from '../types';
import { hasActiveSessionSync, supabase } from '../lib/supabase';
import * as db from '../services/database';

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
    updateAttachmentDescription: (dataUrl: string, description: string) => void;

    // Message actions
    addMessage: (convId: string, message: Message) => void;
    updateMessage: (convId: string, msgId: string, updates: Partial<Message>) => void;
    deleteMessagePair: (convId: string, userMsgId: string) => void;
    getActiveConversation: () => Conversation | undefined;
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

            updateAttachmentDescription: (dataUrl, description) => {
                set((state) => ({
                    conversations: state.conversations.map((c) => ({
                        ...c,
                        messages: c.messages.map((m) => {
                            if (!m.attachments?.some((a) => a.dataUrl === dataUrl)) return m;
                            return {
                                ...m,
                                attachments: m.attachments.map((a) =>
                                    a.dataUrl === dataUrl ? { ...a, aiDescription: description } : a
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

                // Save message to Supabase (skip streaming placeholders)
                if (hasActiveSessionSync() && !message.isStreaming) {
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

                            // Now safe to save the message
                            await db.saveMessage(convId, message);
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

                // Sync final message content to Supabase when streaming completes
                if (hasActiveSessionSync() && updates.isStreaming === false) {
                    const conv = get().conversations.find((c) => c.id === convId);
                    const msg = conv?.messages.find((m) => m.id === msgId);
                    if (msg) {
                        // Save the full message if it's brand new, or update if it already exists
                        db.saveMessage(convId, { ...msg, ...updates }).catch(() => {
                            // If insert fails (duplicate), try update
                            db.updateMessageInDb(msgId, {
                                content: updates.content ?? msg.content,
                                reasoning: updates.reasoning ?? msg.reasoning,
                                isTruncated: updates.isTruncated ?? msg.isTruncated,
                            }).catch(console.error);
                        });
                    }
                }
            },

            deleteMessagePair: (convId, userMsgId) => {
                const conv = get().conversations.find((c) => c.id === convId);
                const idx = conv?.messages.findIndex((m) => m.id === userMsgId) ?? -1;
                let assistantMsgId: string | undefined;

                if (conv && idx !== -1 && idx + 1 < conv.messages.length && conv.messages[idx + 1].role === 'assistant') {
                    assistantMsgId = conv.messages[idx + 1].id;
                }

                set((state) => ({
                    conversations: state.conversations.map((c) => {
                        if (c.id !== convId) return c;
                        const msgIdx = c.messages.findIndex((m) => m.id === userMsgId);
                        if (msgIdx === -1) return c;

                        const newMessages = [...c.messages];
                        const deleteCount =
                            msgIdx + 1 < newMessages.length && newMessages[msgIdx + 1].role === 'assistant'
                                ? 2
                                : 1;
                        newMessages.splice(msgIdx, deleteCount);

                        return { ...c, messages: newMessages, updatedAt: Date.now() };
                    }),
                }));

                // Sync to Supabase
                if (hasActiveSessionSync()) {
                    db.deleteMessagePair(convId, userMsgId, assistantMsgId).catch(console.error);
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
