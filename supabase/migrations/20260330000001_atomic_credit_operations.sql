-- ============================================================
-- Atomic RPC functions for webhook credit & subscription operations
-- ============================================================
-- These functions eliminate race conditions between concurrently-firing
-- Lemon Squeezy webhooks (subscription_created and subscription_payment_success).
--
-- Key invariants:
--   1. remaining_credits is ONLY ever modified by grant_subscription_credits
--      (via atomic INCREMENT, never read-then-write).
--   2. update_subscription_meta NEVER touches remaining_credits.
--   3. Both functions ensure the row exists first (INSERT ON CONFLICT DO NOTHING
--      with 0 credits — never the free-tier default of 100).
-- ============================================================

-- ═══════════════════════════════════════════
--  grant_subscription_credits
-- ═══════════════════════════════════════════
-- Called by ls-webhook on subscription_payment_success.
-- Atomically: ensures row → increments credits → sets plan metadata.
-- Self-sufficient: even if subscription_created webhook is delayed or lost,
-- this single call leaves the user in a fully correct state.

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
    -- Step 1: Guarantee the row exists.
    -- Uses 0 credits so a concurrent INSERT never accidentally grants the
    -- free-tier default (100). The real credits come from Step 2.
    INSERT INTO user_credits (
        user_id, remaining_credits, total_used,
        subscription_status, subscription_plan, billing_cycle_usage
    )
    VALUES (p_user_id, 0, 0, 'free', 'free', 0)
    ON CONFLICT (user_id) DO NOTHING;

    -- Step 2: Single atomic UPDATE.
    --   • remaining_credits += p_credits_to_add  (never a full overwrite)
    --   • billing_cycle_usage reset to 0 (new billing period)
    --   • COALESCE keeps existing metadata when the caller passes NULL
    UPDATE user_credits
    SET remaining_credits                  = remaining_credits + p_credits_to_add,
        billing_cycle_usage                = 0,
        subscription_status                = 'active',
        subscription_plan                  = COALESCE(p_plan, subscription_plan),
        lemon_squeezy_subscription_id      = COALESCE(p_subscription_id, lemon_squeezy_subscription_id),
        lemon_squeezy_customer_portal_url  = COALESCE(p_customer_portal_url, lemon_squeezy_customer_portal_url),
        subscription_renews_at             = COALESCE(p_renews_at, subscription_renews_at),
        updated_at                         = now()
    WHERE user_id = p_user_id
    RETURNING remaining_credits INTO v_new_balance;

    RETURN v_new_balance;
END;
$$;


-- ═══════════════════════════════════════════
--  update_subscription_meta
-- ═══════════════════════════════════════════
-- Called by ls-webhook on subscription_created / subscription_updated.
-- Updates ONLY metadata columns. remaining_credits is NEVER modified.
-- Safe for concurrent execution with grant_subscription_credits.

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
    -- Step 1: Guarantee the row exists (same safe INSERT as grant_subscription_credits).
    INSERT INTO user_credits (
        user_id, remaining_credits, total_used,
        subscription_status, subscription_plan, billing_cycle_usage
    )
    VALUES (p_user_id, 0, 0, 'free', 'free', 0)
    ON CONFLICT (user_id) DO NOTHING;

    -- Step 2: Update metadata ONLY. remaining_credits is deliberately absent.
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
