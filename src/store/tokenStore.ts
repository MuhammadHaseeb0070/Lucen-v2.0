// ============================================
// Token Store
// ============================================
// Manages the background Web Worker for counting tokens.

import { create } from 'zustand';

interface TokenStore {
    worker: Worker | null;
    estimatedTokens: number;
    isCalculating: boolean;
    initializeWorker: () => void;
    calculateTokens: (text: string) => void;
    /** One-shot async count — resolves with exact token count. Does NOT update store state. */
    countAsync: (text: string) => Promise<number>;
}

export const useTokenStore = create<TokenStore>((set, get) => ({
    worker: null,
    estimatedTokens: 0,
    isCalculating: false,

    initializeWorker: () => {
        if (get().worker) return;

        // Create the worker
        const worker = new Worker(new URL('../workers/tokenizer.worker.ts', import.meta.url), {
            type: 'module',
        });

        worker.onmessage = (e: MessageEvent) => {
            if (e.data.error) {
                console.error('[Tokenizer]', e.data.error);
                set({ isCalculating: false });
                return;
            }

            // UI token count (id === 'current')
            if (e.data.id === 'current') {
                set({ estimatedTokens: e.data.tokens, isCalculating: false });
            }
            // Async one-shot counts are resolved via their own listener — no state update needed.
        };

        set({ worker });
    },

    calculateTokens: (text: string) => {
        const { worker } = get();
        if (!worker) return;

        set({ isCalculating: true });

        // Send to background thread
        worker.postMessage({ id: 'current', type: 'count', text });
    },

    countAsync: (text: string): Promise<number> => {
        const { worker } = get();
        if (!worker) {
            // Worker not ready — return a rough character-based approximation (4 chars ≈ 1 token)
            return Promise.resolve(Math.ceil(text.length / 4));
        }

        return new Promise((resolve) => {
            // Unique ID per request so multiple concurrent counts don't collide
            const requestId = `async-${Date.now()}-${Math.random().toString(36).slice(2)}`;

            const handler = (e: MessageEvent) => {
                if (e.data.id !== requestId) return;
                worker.removeEventListener('message', handler);
                resolve(e.data.tokens ?? Math.ceil(text.length / 4));
            };

            worker.addEventListener('message', handler);
            worker.postMessage({ id: requestId, type: 'count', text });
        });
    },
}));
