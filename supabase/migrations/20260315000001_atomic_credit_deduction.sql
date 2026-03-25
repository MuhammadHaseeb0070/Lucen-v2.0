-- Atomic credit operations to prevent race conditions.
-- Called from Edge Functions via supabaseAdmin.rpc().

-- Ensure a user_credits row exists; returns remaining balance.
CREATE OR REPLACE FUNCTION ensure_user_credits(p_user_id UUID, p_initial_credits NUMERIC DEFAULT 100)
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

    SELECT remaining_credits INTO v_balance
    FROM user_credits
    WHERE user_id = p_user_id;

    RETURN v_balance;
END;
$$;

-- Atomically deduct credits.
-- Updated behaviour (March 2026):
--   • If the user has ANY credits > 0, allow the request and deduct up to
--     what they have — balance floors at 0, never goes negative.
--   • Returns new balance (>= 0), or -1 if the user has no credits at all.
--
-- This satisfies the "last request" rule: a user with 0.5 credits can make
-- a request that costs 0.7 — the balance becomes 0 and the request is served.
-- The next request with balance = 0 will return -1 and be blocked.
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
BEGIN
    -- Only proceed if the user has a positive balance (strictly > 0).
    -- Deduct up to what they have; GREATEST(0, ...) prevents negative balances.
    UPDATE user_credits
    SET remaining_credits = GREATEST(0, remaining_credits - p_amount),
        total_used = total_used + LEAST(p_amount, remaining_credits),
        updated_at = now()
    WHERE user_id = p_user_id
      AND remaining_credits > 0
    RETURNING remaining_credits INTO v_new_balance;

    IF NOT FOUND THEN
        -- User either doesn't exist or is already at 0
        RETURN -1;
    END IF;

    RETURN v_new_balance;
END;
$$;
