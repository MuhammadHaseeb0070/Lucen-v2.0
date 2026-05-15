-- ==============================================================================
-- Migration: Set free_credit_granted flag when paid credits are granted
-- ==============================================================================
-- ISSUE 8: When grant_subscription_credits runs for a new subscriber,
-- the free_credit_granted flag on user_credits was never set to TRUE.
-- This created a race window where ensure_user_credits (triggered at
-- login/page-load) could concurrently insert a free ledger bucket for a
-- user who just purchased a paid plan — resulting in a surprise free-tier
-- credit grant on top of the paid credits.
--
-- Fix: Set free_credit_granted = TRUE inside grant_subscription_credits so
-- ensure_user_credits will always skip the free bucket for paid users.
-- ==============================================================================

-- Drop any overloaded signatures to avoid ambiguity errors
DROP FUNCTION IF EXISTS public.grant_subscription_credits(uuid, double precision, text, text, text, timestamp with time zone);
DROP FUNCTION IF EXISTS public.grant_subscription_credits(uuid, numeric, text, text, text, timestamp with time zone);

CREATE OR REPLACE FUNCTION grant_subscription_credits(
    p_user_id          UUID,
    p_credits_to_add   NUMERIC,
    p_plan             TEXT             DEFAULT NULL,
    p_subscription_id  TEXT             DEFAULT NULL,
    p_customer_portal_url TEXT          DEFAULT NULL,
    p_renews_at        TIMESTAMPTZ      DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_balance NUMERIC;
    v_expires_at  TIMESTAMPTZ;
BEGIN
    -- Ensure user_credits row exists (safe, 0-credit insert)
    INSERT INTO user_credits (
        user_id, remaining_credits, total_used,
        subscription_status, subscription_plan, billing_cycle_usage
    )
    VALUES (p_user_id, 0, 0, 'free', 'free', 0)
    ON CONFLICT (user_id) DO NOTHING;

    -- Determine expiration for this credit bucket
    v_expires_at := COALESCE(p_renews_at, NOW() + INTERVAL '1 month');

    -- Insert the paid ledger entry (FIFO credit bucket)
    IF p_credits_to_add > 0 THEN
        INSERT INTO credit_ledgers (
            user_id, initial_amount, remaining_amount,
            valid_from, expires_at, subscription_id, plan_name
        )
        VALUES (
            p_user_id, p_credits_to_add, p_credits_to_add,
            NOW(), v_expires_at, p_subscription_id, COALESCE(p_plan, 'bonus')
        );
    END IF;

    -- Sync overall balance from ALL active ledgers
    SELECT COALESCE(SUM(remaining_amount), 0) INTO v_new_balance
    FROM credit_ledgers
    WHERE user_id = p_user_id AND expires_at > NOW() AND remaining_amount > 0;

    -- Update user_credits — also set free_credit_granted = TRUE so
    -- ensure_user_credits never double-inserts a free bucket for this user.
    UPDATE user_credits
    SET remaining_credits                  = v_new_balance,
        billing_cycle_usage                = 0,
        subscription_status                = 'active',
        subscription_plan                  = COALESCE(p_plan, subscription_plan),
        lemon_squeezy_subscription_id      = COALESCE(p_subscription_id, lemon_squeezy_subscription_id),
        lemon_squeezy_customer_portal_url  = COALESCE(p_customer_portal_url, lemon_squeezy_customer_portal_url),
        subscription_renews_at             = v_expires_at,
        free_credit_granted                = TRUE,   -- ← prevent accidental free-tier grant race
        updated_at                         = now()
    WHERE user_id = p_user_id;

    RETURN v_new_balance;
END;
$$;

-- Backfill: mark all existing paid users as having their free credit granted
-- so they are not accidentally given a free bucket on next login.
UPDATE public.user_credits
SET free_credit_granted = TRUE
WHERE subscription_plan IN ('regular', 'pro')
  AND free_credit_granted = FALSE;
