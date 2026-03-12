import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { FREE_CREDITS, CREDITS_PER_MESSAGE, CREDITS_PER_REASONING_MESSAGE, formatCredits } from '../config/credits';
import { hasActiveSessionSync } from '../lib/supabase';
import * as db from '../services/database';

interface CreditsStore {
    remainingCredits: number;
    totalUsed: number;
    isSynced: boolean;
    isLoading: boolean;

    deductCredits: (isReasoning?: boolean) => boolean;
    addCredits: (amount: number) => void;
    resetCredits: () => void;
    getFormattedCredits: () => string;
    hasEnoughCredits: (isReasoning?: boolean) => boolean;
    syncFromServer: () => Promise<void>;
}

export const useCreditsStore = create<CreditsStore>()(
    persist(
        (set, get) => ({
            remainingCredits: FREE_CREDITS,
            totalUsed: 0,
            isSynced: false,
            isLoading: false,

            deductCredits: (isReasoning = false) => {
                const cost = isReasoning ? CREDITS_PER_REASONING_MESSAGE : CREDITS_PER_MESSAGE;
                const state = get();
                if (state.remainingCredits < cost) return false;

                // Optimistic local update
                set({
                    remainingCredits: state.remainingCredits - cost,
                    totalUsed: state.totalUsed + cost,
                });

                // Server-authoritative deduction (fire-and-forget, but update local on response)
                if (hasActiveSessionSync()) {
                    db.deductCredits(cost).then((result) => {
                        if (result) {
                            // Sync with server truth
                            set({
                                remainingCredits: result.remaining,
                                totalUsed: result.used,
                            });
                        }
                    }).catch(console.error);
                }

                return true;
            },

            addCredits: (amount) => {
                set((state) => ({ remainingCredits: state.remainingCredits + amount }));
            },

            resetCredits: () => {
                set({ remainingCredits: FREE_CREDITS, totalUsed: 0 });
            },

            getFormattedCredits: () => {
                return formatCredits(get().remainingCredits);
            },

            hasEnoughCredits: (isReasoning = false) => {
                const cost = isReasoning ? CREDITS_PER_REASONING_MESSAGE : CREDITS_PER_MESSAGE;
                return get().remainingCredits >= cost;
            },

            syncFromServer: async () => {
                if (!hasActiveSessionSync()) return;

                set({ isLoading: true });
                const result = await db.fetchCredits();
                if (result) {
                    set({
                        remainingCredits: result.remaining,
                        totalUsed: result.used,
                        isSynced: true,
                    });
                }
                set({ isLoading: false });
            },
        }),
        {
            name: 'lucen-credits-storage',
            partialize: (state) => ({
                ...state,
                isSynced: false, // Don't persist sync flag
            }),
        }
    )
);
