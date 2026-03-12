// ============================================
// Token Store
// ============================================
// Manages the background Web Worker for counting tokens.

import { create } from 'zustand';

interface TokenRequest {
    id: string;
    text: string;
}

interface TokenStore {
    worker: Worker | null;
    estimatedTokens: number;
    isCalculating: boolean;
    initializeWorker: () => void;
    calculateTokens: (text: string) => void;
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

            // We only care about the latest requested calculation (id 'current')
            if (e.data.id === 'current') {
                set({ estimatedTokens: e.data.tokens, isCalculating: false });
            }
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
}));
