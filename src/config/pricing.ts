// ============================================
// Pricing — Re-exports from subscriptionConfig
// ============================================
// Kept for backward compatibility. All values
// now live in subscriptionConfig.ts.

export {
  PLANS as PACKAGES,
  PLAN_LIST,
  CREDIT_COSTS as CREDIT_RULES,
  planLabel,
  formatLC,
  type PlanDefinition as PricingPackage,
  type PlanId,
} from './subscriptionConfig';
