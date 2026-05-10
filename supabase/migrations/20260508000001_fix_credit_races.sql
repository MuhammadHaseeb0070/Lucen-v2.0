-- ============================================================================
-- Fix credit race conditions
--
-- 1. Rewrite ensure_user_credits to use a flag instead of COUNT(*) to
--    prevent concurrent free-tier double-grants.
-- 2. Add a unique partial index on credit_ledgers to prevent duplicate
--    paid subscription grants.
-- ============================================================================

-- Add a flag to track whether the free credit bucket was already granted.
-- This replaces the racy COUNT(*) check in ensure_user_credits.
ALTER TABLE public.user_credits
    ADD COLUMN IF NOT EXISTS free_credit_granted BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: if the user already has any ledger rows, mark them as granted.
UPDATE public.user_credits uc
SET free_credit_granted = TRUE
WHERE EXISTS (
    SELECT 1 FROM public.credit_ledgers cl
    WHERE cl.user_id = uc.user_id
);

-- Rewrite ensure_user_credits to use the flag atomically.
CREATE OR REPLACE FUNCTION ensure_user_credits(p_user_id UUID, p_initial_credits NUMERIC DEFAULT 100)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_balance NUMERIC;
    v_was_granted BOOLEAN;
BEGIN
    -- Upsert user_credits row.
    INSERT INTO user_credits (user_id, remaining_credits, total_used)
    VALUES (p_user_id, p_initial_credits, 0)
    ON CONFLICT (user_id) DO NOTHING;

    -- Atomically check and set the free_credit_granted flag.
    -- FOR UPDATE locks the row so concurrent calls serialize here.
    SELECT free_credit_granted INTO v_was_granted
    FROM user_credits
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT v_was_granted AND p_initial_credits > 0 THEN
        UPDATE user_credits
        SET free_credit_granted = TRUE
        WHERE user_id = p_user_id;

        INSERT INTO credit_ledgers (user_id, initial_amount, remaining_amount, valid_from, expires_at)
        VALUES (p_user_id, p_initial_credits, p_initial_credits, NOW(), NOW() + INTERVAL '10 years');
    END IF;

    -- Sync the cache from active ledgers.
    SELECT COALESCE(SUM(remaining_amount), 0) INTO v_balance
    FROM credit_ledgers
    WHERE user_id = p_user_id AND expires_at > NOW();

    UPDATE user_credits
    SET remaining_credits = v_balance
    WHERE user_id = p_user_id;

    RETURN v_balance;
END;
$$;

-- Prevent duplicate paid subscription grants: only one active ledger per
-- subscription_id at a time. This catches duplicate webhook deliveries
-- that slip past the idempotency check.
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledgers_subscription_dedup_idx
    ON public.credit_ledgers (user_id, subscription_id, valid_from)
    WHERE subscription_id IS NOT NULL;
