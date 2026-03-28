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
