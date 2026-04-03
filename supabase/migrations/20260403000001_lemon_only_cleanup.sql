-- ==============================================================================
-- Migration: Lemon Squeezy Only — Drop Gumroad/Generic Payment Columns
-- ==============================================================================
-- After removing Gumroad support, we no longer need:
--   - payment_provider (was "gumroad" or "lemonsqueezy" toggle)
--   - payment_subscription_id (generic duplicate of lemon_squeezy_subscription_id)
--   - payment_customer_portal_url (generic duplicate of lemon_squeezy_customer_portal_url)
--   - lemon_squeezy_customer_id (never actually used by any webhook)
--
-- The lemon_squeezy_subscription_id and lemon_squeezy_customer_portal_url columns
-- remain as the SINGLE source of truth for subscription data.
-- ==============================================================================

-- ─── 1. Drop redundant columns ───
ALTER TABLE public.user_credits
  DROP COLUMN IF EXISTS payment_provider,
  DROP COLUMN IF EXISTS payment_subscription_id,
  DROP COLUMN IF EXISTS payment_customer_portal_url,
  DROP COLUMN IF EXISTS lemon_squeezy_customer_id;


-- ─── 2. Recreate grant_subscription_credits (Lemon-only, ledger-based) ───
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

    -- Determine expiration for the new ledger bucket
    v_expires_at := COALESCE(p_renews_at, NOW() + INTERVAL '1 month');

    -- Insert ledger entry (FIFO credit bucket)
    IF p_credits_to_add > 0 THEN
        INSERT INTO credit_ledgers (user_id, initial_amount, remaining_amount, valid_from, expires_at)
        VALUES (p_user_id, p_credits_to_add, p_credits_to_add, NOW(), v_expires_at);
    END IF;

    -- Sync balance from active ledgers
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
        subscription_renews_at             = v_expires_at,
        updated_at                         = now()
    WHERE user_id = p_user_id;

    RETURN v_new_balance;
END;
$$;


-- ─── 3. Recreate update_subscription_meta (Lemon-only) ───
CREATE OR REPLACE FUNCTION update_subscription_meta(
    p_user_id              UUID,
    p_plan                 TEXT,
    p_subscription_id      TEXT        DEFAULT NULL,
    p_customer_portal_url  TEXT        DEFAULT NULL,
    p_renews_at            TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO user_credits (
        user_id, remaining_credits, total_used,
        subscription_status, subscription_plan, billing_cycle_usage
    )
    VALUES (p_user_id, 0, 0, 'free', 'free', 0)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE user_credits
    SET subscription_status                = 'active',
        subscription_plan                  = p_plan,
        lemon_squeezy_subscription_id      = COALESCE(p_subscription_id, lemon_squeezy_subscription_id),
        lemon_squeezy_customer_portal_url  = COALESCE(p_customer_portal_url, lemon_squeezy_customer_portal_url),
        subscription_renews_at             = COALESCE(p_renews_at, subscription_renews_at),
        updated_at                         = now()
    WHERE user_id = p_user_id;
END;
$$;


-- ─── 4. Ensure deduct_user_credits uses ledgers (from previous migration, just confirm) ───
-- Already ledger-based from 20260402000001. No changes needed.


-- ─── 5. Add index for ledger performance ───
CREATE INDEX IF NOT EXISTS idx_credit_ledgers_user_active
ON public.credit_ledgers (user_id, expires_at)
WHERE remaining_amount > 0;
