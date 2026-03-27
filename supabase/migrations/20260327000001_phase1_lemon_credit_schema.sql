-- ============================================
-- Phase 1: Lemon Squeezy + Unified Credits baseline
-- ============================================
-- Goals:
--   1) Remove Stripe-specific columns from user_credits
--   2) Add Lemon Squeezy identifiers
--   3) Force free-tier initialization defaults to exactly 100 credits
--      at both schema and RPC levels

-- ─── user_credits table shape updates ───
ALTER TABLE public.user_credits
  DROP COLUMN IF EXISTS stripe_customer_id;

ALTER TABLE public.user_credits
  ADD COLUMN IF NOT EXISTS lemon_squeezy_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS lemon_squeezy_subscription_id TEXT;

-- Ensure new rows always initialize at exactly 100 credits by schema default.
ALTER TABLE public.user_credits
  ALTER COLUMN remaining_credits SET DEFAULT 100;

-- ─── RPC alignment: ensure_user_credits default stays 100 ───
-- Recreate function to keep migration source-of-truth explicit and prevent drift.
CREATE OR REPLACE FUNCTION ensure_user_credits(
  p_user_id UUID,
  p_initial_credits NUMERIC DEFAULT 100
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  INSERT INTO user_credits (user_id, remaining_credits, total_used)
  VALUES (p_user_id, p_initial_credits, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT remaining_credits
  INTO v_balance
  FROM user_credits
  WHERE user_id = p_user_id;

  RETURN v_balance;
END;
$$;
