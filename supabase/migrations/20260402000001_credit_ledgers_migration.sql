-- ==============================================================================
-- Migration: Credit Ledgers for Rollover & Expiration
-- ==============================================================================
-- This migration replaces the single 'remaining_credits' integer strategy with
-- a ledger-based strategy (First-In, First-Out).
-- Existing credits are placed into a generated ledger bucket to preserve balances.

-- 1. Create Ledger Table
CREATE TABLE IF NOT EXISTS public.credit_ledgers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    initial_amount NUMERIC NOT NULL,
    remaining_amount NUMERIC NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. RLS Policies
ALTER TABLE public.credit_ledgers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own ledgers" ON public.credit_ledgers;
CREATE POLICY "Users can view own ledgers" 
    ON public.credit_ledgers FOR SELECT 
    USING (auth.uid() = user_id);

-- 3. Data Migration (Protect existing user balances)
-- For every user who currently has an active balance > 0, we create an initial bucket.
-- If they have subscription_renews_at, we expire it then. Otherwise, give them 1 year (likely Free tier or manual credits).
INSERT INTO public.credit_ledgers (user_id, initial_amount, remaining_amount, valid_from, expires_at)
SELECT 
    user_id, 
    remaining_credits, 
    remaining_credits, 
    NOW(), 
    COALESCE(subscription_renews_at, NOW() + INTERVAL '1 year')
FROM public.user_credits
WHERE remaining_credits > 0;


-- 4. Update ensure_user_credits to synchronize the ledger 
CREATE OR REPLACE FUNCTION ensure_user_credits(p_user_id UUID, p_initial_credits NUMERIC DEFAULT 100)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_balance NUMERIC;
    v_ledger_count INT;
BEGIN
    INSERT INTO user_credits (user_id, remaining_credits, total_used)
    VALUES (p_user_id, p_initial_credits, 0)
    ON CONFLICT (user_id) DO NOTHING;
    
    -- Check if user has ANY ledgers. If zero, grant them the initial free credits (valid for 10 years).
    SELECT COUNT(*) INTO v_ledger_count FROM credit_ledgers WHERE user_id = p_user_id;

    IF v_ledger_count = 0 AND p_initial_credits > 0 THEN
        INSERT INTO credit_ledgers (user_id, initial_amount, remaining_amount, valid_from, expires_at)
        VALUES (p_user_id, p_initial_credits, p_initial_credits, NOW(), NOW() + INTERVAL '10 years');
    END IF;

    -- Sync the cache from active ledgers
    SELECT COALESCE(SUM(remaining_amount), 0) INTO v_balance
    FROM credit_ledgers 
    WHERE user_id = p_user_id AND expires_at > NOW();

    UPDATE user_credits 
    SET remaining_credits = v_balance 
    WHERE user_id = p_user_id;

    RETURN v_balance;
END;
$$;


-- 5. Update grant_subscription_credits to create ledgers
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
    -- Ensure row exists
    INSERT INTO user_credits (
        user_id, remaining_credits, total_used,
        subscription_status, subscription_plan, billing_cycle_usage
    )
    VALUES (p_user_id, 0, 0, 'free', 'free', 0)
    ON CONFLICT (user_id) DO NOTHING;

    -- Determine expiration (1 month from now)
    v_expires_at := COALESCE(p_renews_at, NOW() + INTERVAL '1 month');

    -- Insert into ledgers
    IF p_credits_to_add > 0 THEN
        INSERT INTO credit_ledgers (user_id, initial_amount, remaining_amount, valid_from, expires_at)
        VALUES (p_user_id, p_credits_to_add, p_credits_to_add, NOW(), v_expires_at);
    END IF;

    -- Sync total
    SELECT COALESCE(SUM(remaining_amount), 0) INTO v_new_balance
    FROM credit_ledgers 
    WHERE user_id = p_user_id AND expires_at > NOW();

    UPDATE user_credits
    SET remaining_credits                  = v_new_balance,
        billing_cycle_usage                = 0,
        subscription_status                = 'active',
        subscription_plan                  = COALESCE(p_plan, subscription_plan),
        lemon_squeezy_subscription_id      = COALESCE(p_subscription_id, lemon_squeezy_subscription_id),
        lemon_squeezy_customer_portal_url  = COALESCE(p_customer_portal_url, lemon_squeezy_customer_portal_url),
        payment_subscription_id            = COALESCE(p_subscription_id, payment_subscription_id),
        payment_customer_portal_url        = COALESCE(p_customer_portal_url, payment_customer_portal_url),
        subscription_renews_at             = v_expires_at,
        updated_at                         = now()
    WHERE user_id = p_user_id;

    RETURN v_new_balance;
END;
$$;


-- 6. Update deduct_user_credits to consume oldest ledgers first
CREATE OR REPLACE FUNCTION deduct_user_credits(
    p_user_id UUID,
    p_amount NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actual_deduction NUMERIC := 0;
    v_new_balance NUMERIC := 0;
    v_amount_left NUMERIC := p_amount;
    v_ledger RECORD;
BEGIN
    -- Sequential deduction from active ledgers
    FOR v_ledger IN 
        SELECT id, remaining_amount
        FROM credit_ledgers
        WHERE user_id = p_user_id AND expires_at > NOW() AND remaining_amount > 0
        ORDER BY expires_at ASC
        FOR UPDATE
    LOOP
        IF v_amount_left <= 0 THEN
            EXIT;
        END IF;

        IF v_ledger.remaining_amount >= v_amount_left THEN
            -- Ledger covers remainder
            UPDATE credit_ledgers SET remaining_amount = remaining_amount - v_amount_left WHERE id = v_ledger.id;
            v_actual_deduction := v_actual_deduction + v_amount_left;
            v_amount_left := 0;
        ELSE
            -- Ledger exhausted
            UPDATE credit_ledgers SET remaining_amount = 0 WHERE id = v_ledger.id;
            v_actual_deduction := v_actual_deduction + v_ledger.remaining_amount;
            v_amount_left := v_amount_left - v_ledger.remaining_amount;
        END IF;
    END LOOP;

    -- Sync user_credits
    SELECT COALESCE(SUM(remaining_amount), 0) INTO v_new_balance
    FROM credit_ledgers
    WHERE user_id = p_user_id AND expires_at > NOW();

    UPDATE user_credits
    SET remaining_credits = v_new_balance,
        total_used = total_used + v_actual_deduction,
        billing_cycle_usage = billing_cycle_usage + v_actual_deduction,
        updated_at = now()
    WHERE user_id = p_user_id;

    -- If no deduction was made AND they attempted to spend, they had 0 active balance
    IF v_actual_deduction = 0 AND p_amount > 0 THEN
        RETURN -1;
    END IF;

    RETURN v_new_balance;
END;
$$;


-- 7. Invalidate ledgers (For Refunds)
CREATE OR REPLACE FUNCTION invalidate_user_ledgers(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE credit_ledgers
    SET expires_at = NOW() - INTERVAL '1 minute',
        remaining_amount = 0
    WHERE user_id = p_user_id;

    -- Force sync
    PERFORM ensure_user_credits(p_user_id, 0);
END;
$$;
