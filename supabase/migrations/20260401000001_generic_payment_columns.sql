-- ============================================================
-- Generic Payment Provider columns (Gumroad / Lemon Squeezy agnostic)
-- ============================================================
-- Adds provider-agnostic columns alongside the existing lemon_squeezy_* columns.
-- Old columns are preserved (not dropped) for easy rollback to Lemon Squeezy.
-- The RPC functions are updated to write to the NEW generic columns.

-- ─── New columns ───
ALTER TABLE public.user_credits
  ADD COLUMN IF NOT EXISTS payment_provider TEXT DEFAULT 'lemonsqueezy',
  ADD COLUMN IF NOT EXISTS payment_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_customer_portal_url TEXT;

COMMENT ON COLUMN public.user_credits.payment_provider IS 'Active payment provider: lemonsqueezy | gumroad';
COMMENT ON COLUMN public.user_credits.payment_subscription_id IS 'Subscription ID from the active payment provider';
COMMENT ON COLUMN public.user_credits.payment_customer_portal_url IS 'Customer portal / management URL from the active payment provider';

-- ─── Copy existing Lemon data into new generic columns (one-time backfill) ───
UPDATE public.user_credits
SET payment_subscription_id = lemon_squeezy_subscription_id,
    payment_customer_portal_url = lemon_squeezy_customer_portal_url,
    payment_provider = 'lemonsqueezy'
WHERE lemon_squeezy_subscription_id IS NOT NULL
  AND payment_subscription_id IS NULL;


-- ═══════════════════════════════════════════
--  grant_subscription_credits (updated to use generic columns)
-- ═══════════════════════════════════════════
CREATE OR REPLACE FUNCTION grant_subscription_credits(
    p_user_id          UUID,
    p_credits_to_add   DOUBLE PRECISION,
    p_plan             TEXT             DEFAULT NULL,
    p_subscription_id  TEXT             DEFAULT NULL,
    p_customer_portal_url TEXT          DEFAULT NULL,
    p_renews_at        TIMESTAMPTZ      DEFAULT NULL
)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_balance DOUBLE PRECISION;
BEGIN
    INSERT INTO user_credits (
        user_id, remaining_credits, total_used,
        subscription_status, subscription_plan, billing_cycle_usage
    )
    VALUES (p_user_id, 0, 0, 'free', 'free', 0)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE user_credits
    SET remaining_credits                  = remaining_credits + p_credits_to_add,
        billing_cycle_usage                = 0,
        subscription_status                = 'active',
        subscription_plan                  = COALESCE(p_plan, subscription_plan),
        -- Write to BOTH old and new columns for maximum compatibility
        lemon_squeezy_subscription_id      = COALESCE(p_subscription_id, lemon_squeezy_subscription_id),
        lemon_squeezy_customer_portal_url  = COALESCE(p_customer_portal_url, lemon_squeezy_customer_portal_url),
        payment_subscription_id            = COALESCE(p_subscription_id, payment_subscription_id),
        payment_customer_portal_url        = COALESCE(p_customer_portal_url, payment_customer_portal_url),
        subscription_renews_at             = COALESCE(p_renews_at, subscription_renews_at),
        updated_at                         = now()
    WHERE user_id = p_user_id
    RETURNING remaining_credits INTO v_new_balance;

    RETURN v_new_balance;
END;
$$;


-- ═══════════════════════════════════════════
--  update_subscription_meta (updated to use generic columns)
-- ═══════════════════════════════════════════
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
        -- Write to BOTH old and new columns for maximum compatibility
        lemon_squeezy_subscription_id      = COALESCE(p_subscription_id, lemon_squeezy_subscription_id),
        lemon_squeezy_customer_portal_url  = COALESCE(p_customer_portal_url, lemon_squeezy_customer_portal_url),
        payment_subscription_id            = COALESCE(p_subscription_id, payment_subscription_id),
        payment_customer_portal_url        = COALESCE(p_customer_portal_url, payment_customer_portal_url),
        subscription_renews_at             = COALESCE(p_renews_at, subscription_renews_at),
        updated_at                         = now()
    WHERE user_id = p_user_id;
END;
$$;
