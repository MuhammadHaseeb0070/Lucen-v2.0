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

-- Atomically deduct credits. Returns new balance or -1 if insufficient.
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
    UPDATE user_credits
    SET remaining_credits = remaining_credits - p_amount,
        total_used = total_used + p_amount,
        updated_at = now()
    WHERE user_id = p_user_id
      AND remaining_credits >= p_amount
    RETURNING remaining_credits INTO v_new_balance;

    IF NOT FOUND THEN
        RETURN -1;
    END IF;

    RETURN v_new_balance;
END;
$$;
