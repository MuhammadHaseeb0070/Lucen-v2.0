// ============================================
// Pricing Configuration (Single Source of Truth)
// ============================================
// Safe to be imported by the frontend UI to display pricing,
// and safe to be imported by the backend Edge Functions.
// Make sure NOT to put secret keys here.

export interface PricingPackage {
    /** Internal stable ID for UI + analytics. */
    id: 'free' | 'regular' | 'pro';
    /** Lemon Squeezy Variant ID (required for paid tiers). */
    variantId?: string;
    name: string;
    priceUsd: number;
    creditsProvided: number;
    description: string;
}

export const PACKAGES: Record<string, PricingPackage> = {
    FREE: {
        id: 'free',
        name: 'Free',
        priceUsd: 0,
        creditsProvided: 100,
        description: '100k tokens, 3 Web Searches, standard image processing',
    },
    REGULAR: {
        id: 'regular',
        variantId: import.meta.env.VITE_LS_VARIANT_REGULAR,
        name: 'Regular',
        priceUsd: 10.00,
        creditsProvided: 4000,
        description: '4 Million Tokens, unlimited high-res vision, unlimited search',
    },
    PRO: {
        id: 'pro',
        variantId: import.meta.env.VITE_LS_VARIANT_PRO,
        name: 'Pro',
        priceUsd: 20.00,
        creditsProvided: 10000,
        description: '10 Million Tokens, volume discount, pure freedom',
    },
};

/** Lucen Credit system constants (display-only; server is authoritative). */
export const CREDIT_RULES = {
    TOKENS_PER_CREDIT: 1000,
    IMAGE_CREDITS: 2,
    WEB_SEARCH_CREDITS: 10,
    FREE_TIER_MAX_SEARCHES: 3,
} as const;
