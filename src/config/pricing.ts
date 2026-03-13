// ============================================
// Pricing Configuration (Single Source of Truth)
// ============================================
// Safe to be imported by the frontend UI to display pricing,
// and safe to be imported by the backend Edge Functions.
// Make sure NOT to put secret keys here.

export interface PricingPackage {
    id: string; // The stripe price ID (e.g. price_1Nxy...)
    name: string;
    priceUsd: number;
    creditsProvided: number;
    description: string;
}

export const PACKAGES: Record<string, PricingPackage> = {
    FREE: {
        id: 'free_tier',
        name: 'Starter',
        priceUsd: 0,
        creditsProvided: 500, // $0.50 worth
        description: 'Perfect for testing the waters.',
    },
    PRO: {
        id: import.meta.env.VITE_STRIPE_PRO_PRICE_ID || 'pro_tier',
        name: 'Pro Access',
        priceUsd: 15.00,
        creditsProvided: 10000, // Massive psychological value
        description: '10,000 High-Speed Compute Credits',
    }
};

// Internal Token Cost Mapping
export const TOKEN_COSTS = {
    // 500 Credits ($0.50) per 1 Million Tokens (Input or Output combined as flat rate)
    // Formula for deduction: (tokens / 1,000,000) * COST_PER_MILLION
    COST_PER_MILLION: 500,
};
