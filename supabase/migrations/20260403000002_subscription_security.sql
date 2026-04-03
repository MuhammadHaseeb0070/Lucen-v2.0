-- ==============================================================================
-- Migration: Multi-Subscription FIFO Ledger Segregation
-- ==============================================================================
-- Enhances credit_ledgers to attribute each stack of credits to the exact 
-- subscription and plan that purchased it. 
-- Allows users to buy multiple concurrent subscriptions and tracks/expires 
-- them totally independently.
-- ==============================================================================

-- 1. Add tracking columns to the ledger
ALTER TABLE public.credit_ledgers
  ADD COLUMN IF NOT EXISTS subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS plan_name TEXT;

-- 2. Update grant_subscription_credits to record the new fields.
-- Remember to DROP first to avoid overloaded parameter bugs!
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
    v_expires_at TIMESTAMPTZ;
BEGIN
    -- Ensure user_credits row exists tracking the LATEST interaction
    INSERT INTO user_credits (
        user_id, remaining_credits, total_used,
        subscription_status, subscription_plan, billing_cycle_usage
    )
    VALUES (p_user_id, 0, 0, 'free', 'free', 0)
    ON CONFLICT (user_id) DO NOTHING;

    -- Determine expiration for this specific bucket
    v_expires_at := COALESCE(p_renews_at, NOW() + INTERVAL '1 month');

    -- Insert ledger entry (FIFO credit bucket with isolated tracking!)
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

    -- Sync overall global balance from ALL active ledgers
    SELECT COALESCE(SUM(remaining_amount), 0) INTO v_new_balance
    FROM credit_ledgers
    WHERE user_id = p_user_id AND expires_at > NOW() AND remaining_amount > 0;

    -- Update the generic user_credits row 
    UPDATE user_credits
    SET remaining_credits                  = v_new_balance,
        billing_cycle_usage                = 0,
        subscription_status                = 'active',
        subscription_plan                  = COALESCE(p_plan, subscription_plan),
        lemon_squeezy_subscription_id      = COALESCE(p_subscription_id, lemon_squeezy_subscription_id),
        lemon_squeezy_customer_portal_url  = COALESCE(p_customer_portal_url, lemon_squeezy_customer_portal_url),
        subscription_renews_at             = v_expires_at,
        updated_at                         = now()
    WHERE user_id = p_user_id;

    RETURN v_new_balance;
END;
$$;

-- 3. Create expire_subscription_ledgers
-- Securely zeroes out any remaining credits strictly tied to a specific subscription
-- This is fired when a subscription is fully REMOVED (refunded/expired immediately).
CREATE OR REPLACE FUNCTION expire_subscription_ledgers(
    p_user_id          UUID,
    p_subscription_id  TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_balance NUMERIC;
BEGIN
    -- Expire ONLY the ledgers for this specific subscription ID
    UPDATE credit_ledgers
    SET expires_at = NOW()
    WHERE user_id = p_user_id 
      AND subscription_id = p_subscription_id
      AND expires_at > NOW();

    -- Recalculate remaining total balance
    SELECT COALESCE(SUM(remaining_amount), 0) INTO v_new_balance
    FROM credit_ledgers
    WHERE user_id = p_user_id AND expires_at > NOW() AND remaining_amount > 0;

    UPDATE user_credits
    SET remaining_credits = v_new_balance,
        updated_at        = now()
    WHERE user_id = p_user_id;

    RETURN v_new_balance;
END;
$$;
