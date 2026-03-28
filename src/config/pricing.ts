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
    /** Short line under the title. */
    tagline: string;
    /** Bullet points for the card (no fake em dashes; keep lines short). */
    features: string[];
    /** Extra callout for Pro (e.g. token volume vs Regular). */
    proExtra?: string;
}

export const PACKAGES: Record<string, PricingPackage> = {
    FREE: {
        id: 'free',
        name: 'Free',
        priceUsd: 0,
        creditsProvided: 100,
        tagline: 'Start creating with Lucen at no cost.',
        features: [
            '100 credits to explore Lucen (about 100k tokens at 1 credit per 1k tokens)',
            'Up to 3 web searches on the free tier, then upgrade for unlimited search',
            'Vision uses efficient image detail so your credits last longer',
            'Upgrade anytime without losing your chats',
        ],
    },
    REGULAR: {
        id: 'regular',
        variantId: import.meta.env.VITE_LS_VARIANT_REGULAR,
        name: 'Regular',
        priceUsd: 10.0,
        creditsProvided: 4000,
        tagline: 'Solid allowance for daily work and side projects.',
        features: [
            '4,000 credits per month, about 4M tokens at typical usage',
            'High resolution vision on uploads when your model allows it',
            'Unlimited web search in chat while your plan is active',
            'Priority email if you ever need help with billing',
        ],
    },
    PRO: {
        id: 'pro',
        variantId: import.meta.env.VITE_LS_VARIANT_PRO,
        name: 'Pro',
        priceUsd: 20.0,
        creditsProvided: 10000,
        tagline: 'Maximum headroom for power users and heavy workflows.',
        features: [
            '10,000 credits per month, about 10M tokens at typical usage',
            'Same unlimited search and premium vision as Regular',
            'Best per credit value when you live in Lucen all day',
            'Room for long documents, big threads, and image heavy chats',
        ],
        proExtra:
            'Pro includes 6,000 more monthly credits than Regular. That is two and a half times the token budget for only double the price.',
    },
};

/** Lucen Credit system constants (display-only; server is authoritative). */
export const CREDIT_RULES = {
    TOKENS_PER_CREDIT: 1000,
    IMAGE_CREDITS: 2,
    WEB_SEARCH_CREDITS: 10,
    FREE_TIER_MAX_SEARCHES: 3,
} as const;

/** Maps server `subscription_plan` to display label. */
export function planLabel(plan: string | undefined): string {
    const p = (plan || 'free').toLowerCase();
    if (p === 'pro') return 'Pro';
    if (p === 'regular') return 'Regular';
    return 'Free';
}
