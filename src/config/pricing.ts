// ============================================
// Pricing Configuration (Single Source of Truth)
// ============================================
// Safe for the frontend. No secret keys here.
// Server deducts credits; balance in the app is from the database.

export interface PricingPackage {
    id: 'free' | 'regular' | 'pro';
    variantId?: string;
    name: string;
    priceUsd: number;
    creditsProvided: number;
    tagline: string;
    features: string[];
    proExtra?: string;
}

export const PACKAGES: Record<string, PricingPackage> = {
    FREE: {
        id: 'free',
        name: 'Free',
        priceUsd: 0,
        creditsProvided: 100,
        tagline: 'Try Lucen with a small monthly allowance.',
        features: [
            '100 credits on the house (usage is metered in the app)',
            'Roughly 100k tokens of chat if you only use text at 1 credit per 1k tokens',
            'Web search is limited on free; paid tiers remove that cap',
            'Good for testing before you subscribe',
        ],
    },
    REGULAR: {
        id: 'regular',
        variantId: import.meta.env.VITE_LS_VARIANT_REGULAR,
        name: 'Regular',
        priceUsd: 10.0,
        creditsProvided: 4000,
        tagline: 'Enough for steady daily use.',
        features: [
            'Each successful subscription activation adds 4,000 credits to your balance (via Lemon)',
            'Usage still draws from that balance: text, images, and search cost credits per server rules',
            'Unlimited web search in app while subscribed (proxy side)',
            'Renewals or extra purchases can add credits again, so your total balance can be higher than one grant',
        ],
    },
    PRO: {
        id: 'pro',
        variantId: import.meta.env.VITE_LS_VARIANT_PRO,
        name: 'Pro',
        priceUsd: 20.0,
        creditsProvided: 10000,
        tagline: 'Largest monthly grant for heavy use.',
        features: [
            'Each successful subscription activation adds 10,000 credits (via Lemon)',
            'Same app limits and search behavior as Regular, bigger pool of credits',
            'If you tested in Lemon test mode and bought again live, grants can stack until you use them',
            'Best fit if you run long threads, big files, or lots of vision',
        ],
        proExtra:
            'Versus Regular: 10,000 credits per grant vs 4,000. If your balance looks like double a single grant, check for test plus live checkouts or a renewal in Lemon.',
    },
};

export const CREDIT_RULES = {
    TOKENS_PER_CREDIT: 1000,
    IMAGE_CREDITS: 2,
    WEB_SEARCH_CREDITS: 10,
    FREE_TIER_MAX_SEARCHES: 3,
} as const;

export function planLabel(plan: string | undefined): string {
    const p = (plan || 'free').toLowerCase();
    if (p === 'pro') return 'Pro';
    if (p === 'regular') return 'Regular';
    return 'Free';
}
