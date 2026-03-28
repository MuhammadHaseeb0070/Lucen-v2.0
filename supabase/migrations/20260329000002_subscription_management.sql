-- 20260329000002_subscription_management.sql
-- Adds columns and updates RPC to support Lemon Squeezy Customer Portal, renewal tracking, and billing cycle usage.

ALTER TABLE user_credits
ADD COLUMN IF NOT EXISTS lemon_squeezy_customer_portal_url TEXT,
ADD COLUMN IF NOT EXISTS subscription_renews_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS billing_cycle_usage NUMERIC NOT NULL DEFAULT 0;

-- Drop the old function first if we are returning a different structure or just use CREATE OR REPLACE
-- Wait, we can just CREATE OR REPLACE because the signature is the same.
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
    v_new_balance NUMERIC;
    v_actual_deduction NUMERIC;
BEGIN
    -- Only proceed if the user has a positive balance (strictly > 0).
    -- Deduct up to what they have; GREATEST(0, ...) prevents negative balances.
    
    -- Calculate exactly how much is being deducted
    SELECT LEAST(p_amount, remaining_credits) INTO v_actual_deduction
    FROM user_credits
    WHERE user_id = p_user_id;

    IF v_actual_deduction IS NULL THEN
        -- User either doesn't exist
        RETURN -1;
    END IF;

    UPDATE user_credits
    SET remaining_credits = GREATEST(0, remaining_credits - p_amount),
        total_used = total_used + v_actual_deduction,
        billing_cycle_usage = billing_cycle_usage + v_actual_deduction,
        updated_at = now()
    WHERE user_id = p_user_id
      AND remaining_credits > 0
    RETURNING remaining_credits INTO v_new_balance;

    IF NOT FOUND THEN
        -- User is already at 0
        RETURN -1;
    END IF;

    RETURN v_new_balance;
END;
$$;
