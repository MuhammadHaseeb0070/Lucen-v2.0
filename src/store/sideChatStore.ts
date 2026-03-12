import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type { Message } from '../types';

interface SideChatStore {
    messages: Message[];
    injectedContext: Message[];
    isContextEnabled: boolean;
    pendingMessage: string | null;

    addMessage: (message: Message) => void;
    updateMessage: (msgId: string, updates: Partial<Message>) => void;
    clearMessages: () => void;
    injectMainChatContext: (messages: Message[]) => void;
    clearContext: () => void;
    toggleContextEnabled: () => void;
    getApiMessages: () => { role: string; content: string }[];
    setPendingMessage: (msg: string) => void;
    clearPendingMessage: () => void;
}

export const useSideChatStore = create<SideChatStore>()(
    persist(
        (set, get) => ({
            messages: [],
            injectedContext: [],
            isContextEnabled: false,
            pendingMessage: null,

            addMessage: (message) => {
                set((state) => ({ messages: [...state.messages, message] }));
            },

            updateMessage: (msgId, updates) => {
                set((state) => ({
                    messages: state.messages.map((m) =>
                        m.id === msgId ? { ...m, ...updates } : m
                    ),
                }));
            },

            clearMessages: () => {
                set({ messages: [], injectedContext: [], isContextEnabled: false });
            },

            injectMainChatContext: (messages) => {
                set({ injectedContext: messages, isContextEnabled: true });
            },

            clearContext: () => {
                set({ injectedContext: [], isContextEnabled: false });
            },

            toggleContextEnabled: () => {
                set((state) => ({ isContextEnabled: !state.isContextEnabled }));
            },

            getApiMessages: () => {
                const state = get();
                const contextMsgs = state.isContextEnabled && state.injectedContext.length > 0
                    ? [
                        {
                            role: 'system' as const,
                            content: `The user has explicitly provided context from their main chat:\n\n${state.injectedContext
                                .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
                                .join('\n\n')}`,
                        },
                    ]
                    : [];

                const chatMsgs = state.messages
                    .filter((m) => !m.isStreaming)
                    .map((m) => ({ role: m.role, content: m.content }));

                return [...contextMsgs, ...chatMsgs];
            },

            setPendingMessage: (msg) => {
                set({ pendingMessage: msg });
            },

            clearPendingMessage: () => {
                set({ pendingMessage: null });
            },
        }),
        {
            name: 'lucen-sidechat-storage',
            partialize: (state) => ({
                ...state,
                // SECURITY: Never persist raw chat messages or context to disk
                messages: [],
                injectedContext: [],
                pendingMessage: null,
            }),
        }
    )
);

// Helper to create a new message
export function createMessage(role: 'user' | 'assistant', content: string): Message {
    return {
        id: uuidv4(),
        role,
        content,
        timestamp: Date.now(),
    };
}
