// ============================================
// Credits — Re-exports from subscriptionConfig
// ============================================
// Kept for backward compatibility. All values
// now live in subscriptionConfig.ts.

export { FREE_CREDITS, formatLC as formatCredits, CREDIT_COSTS } from './subscriptionConfig';

/** Maximum messages kept in context window */
export const MAX_CONTEXT_MESSAGES = 50;

/** Maximum characters per user message */
export const MAX_MESSAGE_LENGTH = 12000;

/** Maximum characters for side chat messages */
export const MAX_SIDE_CHAT_MESSAGE_LENGTH = 4000;
