import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { FREE_CREDITS, formatLC } from '../config/subscriptionConfig';
import type { PlanId } from '../config/subscriptionConfig';
import { hasActiveSessionSync } from '../lib/supabase';
import * as db from '../services/database';

interface CreditsStore {
    remainingCredits: number;
    totalUsed: number;
    /** Server: free, active, past_due, etc. */
    subscriptionStatus: string;
    /** free | regular | pro (for UI; webhook maintains). */
    subscriptionPlan: PlanId;
    customerPortalUrl: string | null;
    renewsAt: string | null;
    billingCycleUsage: number;
    isSynced: boolean;
    isLoading: boolean;

    getFormattedCredits: () => string;
    hasEnoughCredits: () => boolean;
    syncFromServer: () => Promise<void>;
    /** Graduated retry sync for post-checkout — polls multiple times to cover webhook delays. */
    syncWithRetry: () => Promise<void>;
}

export const useCreditsStore = create<CreditsStore>()(
    persist(
        (set, get) => ({
            remainingCredits: FREE_CREDITS,
            totalUsed: 0,
            subscriptionStatus: 'free',
            subscriptionPlan: 'free',
            customerPortalUrl: null,
            renewsAt: null,
            billingCycleUsage: 0,
            isSynced: false,
            isLoading: false,

            getFormattedCredits: () => {
                return formatLC(get().remainingCredits);
            },

            hasEnoughCredits: () => {
                // Credits > 0 means at least one more request is allowed.
                // Server-side deduction uses actual token cost, so we just
                // check for a positive balance here.
                return get().remainingCredits > 0;
            },

            syncFromServer: async () => {
                if (!hasActiveSessionSync()) return;

                set({ isLoading: true });
                const result = await db.fetchCredits();
                if (result) {
                    set({
                        remainingCredits: result.remaining,
                        totalUsed: result.used,
                        billingCycleUsage: result.billingCycleUsage,
                        subscriptionStatus: result.subscriptionStatus,
                        subscriptionPlan: result.subscriptionPlan,
                        customerPortalUrl: result.customerPortalUrl,
                        renewsAt: result.renewsAt,
                        isSynced: true,
                    });
                }
                set({ isLoading: false });
            },

            syncWithRetry: async () => {
                if (!hasActiveSessionSync()) return;

                // Graduated delays cover webhook processing latency.
                // Lemon Squeezy webhooks can take several seconds to arrive and be processed.
                // We sync immediately, then retry at 2.5s, 5s, and 10s.
                const delays = [0, 2500, 5000, 10000];

                for (let i = 0; i < delays.length; i++) {
                    if (delays[i] > 0) {
                        await new Promise(r => setTimeout(r, delays[i]));
                    }

                    set({ isLoading: true });
                    const result = await db.fetchCredits();
                    if (result) {
                        set({
                            remainingCredits: result.remaining,
                            totalUsed: result.used,
                            billingCycleUsage: result.billingCycleUsage,
                            subscriptionStatus: result.subscriptionStatus,
                            subscriptionPlan: result.subscriptionPlan,
                            customerPortalUrl: result.customerPortalUrl,
                            renewsAt: result.renewsAt,
                            isSynced: true,
                        });

                        // Once we see an active paid subscription AND the credits > free tier amount, credits are confirmed.
                        // Stop polling early — no need to waste network requests.
                        if (result.subscriptionStatus === 'active' &&
                            (result.subscriptionPlan === 'regular' || result.subscriptionPlan === 'pro') &&
                            result.remaining > 100) {
                            set({ isLoading: false });
                            return;
                        }
                    }
                    set({ isLoading: false });
                }
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
