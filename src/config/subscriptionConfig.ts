// ============================================================
// Lucen Subscription Config — SINGLE SOURCE OF TRUTH
// ============================================================
// Change values HERE → reflected everywhere in the app.
//
// ⚠️  FRONTEND-SAFE: No API keys or secrets.
//     Server-side credit costs live in chat-proxy (edge fn).
//     This file controls UI display, plan metadata, and FAQ.
// ============================================================

// ─── LC (LucenCredits) Branding ─────────────────────────────
export const LC = {
  /** Full name shown once on the subscription page */
  fullName: 'LucenCredits',
  /** Short unit used everywhere else (navbar, usage, etc.) */
  unit: 'LC',
  /** One-liner explaining LC to the user */
  description:
    'LucenCredits (LC) are the universal currency inside Lucen. Every action — chatting, web searches, image analysis — costs LC. Your subscription refills them monthly.',
} as const;

// ─── Plan Definitions ───────────────────────────────────────
export type PlanId = 'free' | 'regular' | 'pro';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** Lemon Squeezy variant ID — loaded from env vars */
  variantId?: string;
  priceUsd: number;
  /** LC granted each billing cycle */
  creditsProvided: number;
  tagline: string;
  /** Highlighted badge text on the card */
  badge?: string;
  /** Short features shown as bullet points */
  features: string[];
  /** Extra callout text (e.g. bonus LC note) */
  highlight?: string;
  /** Is this the recommended/"best value" plan? */
  recommended?: boolean;
}

export const PLANS: Record<Uppercase<PlanId>, PlanDefinition> = {
  FREE: {
    id: 'free',
    name: 'Free',
    priceUsd: 0,
    creditsProvided: 100,
    tagline: 'Try Lucen risk-free before you subscribe.',
    badge: '100 LC',
    features: [
      '100 LC to explore the full experience',
      'All core features: Side Chat, themes, shortcuts',
      'Web search limited to 3 requests',
      'Perfect for evaluating Lucen before upgrading',
    ],
  },
  REGULAR: {
    id: 'regular',
    name: 'Regular',
    variantId: import.meta.env.VITE_LS_VARIANT_REGULAR,
    priceUsd: 10,
    creditsProvided: 4_000,
    tagline: 'For daily power users who need consistent capacity.',
    badge: '4,000 LC',
    features: [
      '4,000 LC refreshed every billing cycle',
      'Unlimited web searches (each costs LC)',
      'Unlimited image analysis (each costs LC)',
      'Side Chat, message deletion, all themes',
      'Reasoning mode enabled',
      'Quick actions & keyboard shortcuts',
    ],
  },
  PRO: {
    id: 'pro',
    name: 'Pro',
    variantId: import.meta.env.VITE_LS_VARIANT_PRO,
    priceUsd: 20,
    creditsProvided: 10_000,
    tagline: 'Maximum capacity for professionals and heavy workflows.',
    badge: '10,000 LC',
    features: [
      '10,000 LC refreshed every billing cycle',
      'Includes 2,000 bonus LC vs proportional Regular',
      'Unlimited web searches (each costs LC)',
      'Unlimited image analysis (each costs LC)',
      'Everything in Regular, at industrial scale',
      'Priority support via email',
    ],
    highlight: '+2,000 bonus LC included',
    recommended: true,
  },
} as const;

/** Ordered array for iteration in UI */
export const PLAN_LIST: PlanDefinition[] = [
  PLANS.FREE,
  PLANS.REGULAR,
  PLANS.PRO,
];

// ─── Credit Cost Rules (display only — server enforces) ─────
// These mirror the server values for UI estimation / display.
// Actual deduction always happens server-side in chat-proxy.
export const CREDIT_COSTS = {
  /** LC per 1,000 tokens (input + output + reasoning combined) */
  PER_1K_TOKENS: 1,
  /** LC per image analyzed */
  PER_IMAGE: 2,
  /** LC per web search triggered */
  PER_WEB_SEARCH: 8,
  /** Max free-tier web searches before upgrade required */
  FREE_TIER_MAX_SEARCHES: 3,
} as const;

// ─── Free Tier Defaults ─────────────────────────────────────
export const FREE_CREDITS = 100;

// ─── Feature Flags by Tier ──────────────────────────────────
export const TIER_FEATURES = {
  free: {
    sideChatAccess: true,
    messageDeletion: true,
    quickActions: true,
    multipleThemes: true,
    reasoningEnabled: true,
    quickResponses: true,
    unlimitedImages: false,
    unlimitedWebSearch: false,
  },
  regular: {
    sideChatAccess: true,
    messageDeletion: true,
    quickActions: true,
    multipleThemes: true,
    reasoningEnabled: true,
    quickResponses: true,
    unlimitedImages: true,
    unlimitedWebSearch: true,
  },
  pro: {
    sideChatAccess: true,
    messageDeletion: true,
    quickActions: true,
    multipleThemes: true,
    reasoningEnabled: true,
    quickResponses: true,
    unlimitedImages: true,
    unlimitedWebSearch: true,
  },
} as const;

// ─── FAQ Content ────────────────────────────────────────────
export interface FaqItem {
  question: string;
  answer: string;
}

export const SUBSCRIPTION_FAQ: FaqItem[] = [
  {
    question: 'What are LucenCredits (LC)?',
    answer:
      'LC is the single currency for everything in Lucen. Chatting, web searches, image analysis — every action costs a small amount of LC. Your subscription refills your balance each billing cycle.',
  },
  {
    question: 'How are LC deducted?',
    answer:
      'LC are deducted automatically based on your actual usage. Text conversations cost 1 LC per 1,000 tokens processed. Image analysis costs 2 LC per image. Web searches cost 10 LC each. The deduction happens on the server in real-time — you always see your true balance.',
  },
  {
    question: 'What happens when I run out of LC?',
    answer:
      'If your LC balance reaches zero, you will not be able to send new messages until your next billing cycle refills your balance, or you upgrade to a higher plan. Your conversations and data remain safe.',
  },
  {
    question: 'Can I upgrade mid-subscription?',
    answer:
      'Yes! When you upgrade (e.g. Regular → Pro), your remaining LC carry over and the new plan\'s LC are added on top. You will use the older credits first. When the previous billing period ends, any unused old credits expire and only the new plan\'s credits remain.',
  },
  {
    question: 'What happens if I cancel my subscription?',
    answer:
      'Your remaining LC stay usable until your current billing period ends. After that, your account reverts to the Free tier with 100 LC. Your conversations and history are never deleted.',
  },
  {
    question: 'Do unused LC roll over?',
    answer:
      'Within an active subscription, your balance accumulates if you don\'t use everything. If you cancel or downgrade, credits from the previous plan expire at the end of that billing period.',
  },
  {
    question: 'How is the Pro plan\'s bonus calculated?',
    answer:
      'Regular costs $10 for 4,000 LC. Proportionally, $20 would give 8,000 LC. Pro gives 10,000 LC — that\'s 2,000 bonus LC, making Pro the best value per LC.',
  },
  {
    question: 'Is my payment secure?',
    answer:
      'All payments are handled by Lemon Squeezy, a trusted payment processor. Lucen never sees or stores your card details. You can manage your billing, update payment methods, or cancel directly from Lemon Squeezy\'s customer portal.',
  },
  {
    question: 'Can I get a refund?',
    answer:
      'Since LC are consumed in real-time, refunds are handled on a case-by-case basis. Contact support if you believe there was an error with your billing.',
  },
  {
    question: 'What features are included in the Free tier?',
    answer:
      'Free users get full access to all features: Side Chat, message deletion, quick actions, all themes, reasoning mode, and keyboard shortcuts. The only limits are fewer LC (100) and web searches (3 max). It\'s designed to let you fully test Lucen before subscribing.',
  },
];

// ─── Helper Functions ───────────────────────────────────────

/** Human-readable plan label */
export function planLabel(plan: string | undefined): string {
  const p = (plan || 'free').toLowerCase();
  if (p === 'pro') return 'Pro';
  if (p === 'regular') return 'Regular';
  return 'Free';
}

/** Format a credit number for display */
export function formatLC(credits: number): string {
  return credits.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Get plan definition by id */
export function getPlanById(id: PlanId): PlanDefinition {
  return PLAN_LIST.find((p) => p.id === id) ?? PLANS.FREE;
}
