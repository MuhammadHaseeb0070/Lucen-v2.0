import type { CreditPackage } from '../types';

// ============================================
// SINGLE SOURCE OF TRUTH — All business values
// Change values here → reflected everywhere
// ============================================

/** Free credits given to new users */
export const FREE_CREDITS = 100;

/** Credits consumed per message sent */
export const CREDITS_PER_MESSAGE = 1;

/** Credits consumed per reasoning-model message */
export const CREDITS_PER_REASONING_MESSAGE = 3;

/** Maximum messages kept in context window */
export const MAX_CONTEXT_MESSAGES = 50;

/** Maximum characters per user message */
export const MAX_MESSAGE_LENGTH = 12000;

/** Maximum characters for side chat messages */
export const MAX_SIDE_CHAT_MESSAGE_LENGTH = 4000;

/** Credit packages available for purchase */
export const CREDIT_PACKAGES: CreditPackage[] = [
    { id: 'starter', name: 'Starter', credits: 100, price: 4.99 },
    { id: 'pro', name: 'Pro', credits: 500, price: 19.99, popular: true },
    { id: 'enterprise', name: 'Enterprise', credits: 2000, price: 59.99 },
];

// ============================================
// Helper functions
// ============================================

export function calculateCost(messageCount: number, isReasoning: boolean): number {
    const rate = isReasoning ? CREDITS_PER_REASONING_MESSAGE : CREDITS_PER_MESSAGE;
    return messageCount * rate;
}

export function getPackageById(id: string): CreditPackage | undefined {
    return CREDIT_PACKAGES.find((p) => p.id === id);
}

export function formatCredits(credits: number): string {
    return credits.toLocaleString();
}
