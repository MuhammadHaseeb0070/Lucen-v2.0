-- ==============================================================================
-- Migration: Refund User Credits RPC (for Pre-Auth / Deposit-Refund flows)
-- Date: 2026-06-30
-- ==============================================================================
-- To prevent TOCTOU overspend races (where 100 concurrent streams bypass the
-- >0 balance check before any of them finish and deduct), we must deduct a 
-- "deposit" upfront, then refund the unused difference.
--
-- This function finds the most recently active (or currently active) credit
-- ledger for the user and adds the credits back to it, while also decrementing
-- the usage counters.
-- ==============================================================================

CREATE OR REPLACE FUNCTION refund_user_credits(
    p_user_id UUID,
    p_amount NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ledger RECORD;
    v_new_balance NUMERIC;
BEGIN
    IF p_amount <= 0 THEN
        RETURN;
    END IF;

    -- Find the ledger that expires furthest in the future (the "newest" active ledger)
    -- to refund the credits to.
    SELECT id, remaining_amount
    INTO v_ledger
    FROM credit_ledgers
    WHERE user_id = p_user_id AND expires_at > NOW()
    ORDER BY expires_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_ledger.id IS NOT NULL THEN
        -- Add credits back to the ledger
        UPDATE credit_ledgers 
        SET remaining_amount = remaining_amount + p_amount 
        WHERE id = v_ledger.id;
    ELSE
        -- If no active ledger exists (very rare, e.g., expired perfectly during generation),
        -- we could technically revive the most recently expired one, or just create a 
        -- micro-ledger. For now, revive the most recently expired one temporarily.
        SELECT id
        INTO v_ledger
        FROM credit_ledgers
        WHERE user_id = p_user_id
        ORDER BY expires_at DESC
        LIMIT 1
        FOR UPDATE;

        IF v_ledger.id IS NOT NULL THEN
            UPDATE credit_ledgers 
            SET remaining_amount = remaining_amount + p_amount 
            WHERE id = v_ledger.id;
        END IF;
    END IF;

    -- Recalculate total balance
    SELECT COALESCE(SUM(remaining_amount), 0) INTO v_new_balance
    FROM credit_ledgers
    WHERE user_id = p_user_id AND expires_at > NOW();

    -- Sync user_credits (decrement usage, set new balance)
    UPDATE user_credits
    SET remaining_credits = v_new_balance,
        -- Prevent total_used/billing_cycle_usage from dropping below 0
        total_used = GREATEST(0, total_used - p_amount),
        billing_cycle_usage = GREATEST(0, billing_cycle_usage - p_amount),
        updated_at = now()
    WHERE user_id = p_user_id;

END;
$$;
