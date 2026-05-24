-- ==============================================================================
-- Migration: Payment System Hardening
-- Date: 2026-05-23
-- ==============================================================================
-- Fixes multiple payment bugs identified in the audit:
--   1. update_subscription_meta no longer forces subscription_status = 'active'
--   2. Dedup index fixed to use monthly bucketing instead of exact timestamp
--   3. expire_subscription_ledgers now zeroes remaining_amount
--   4. webhook_events gets a payload column for audit logging
--   5. Drop unused pricing_packages table
-- ==============================================================================

-- ─── 1. Fix update_subscription_meta: Don't force status to 'active' ───
-- Previously this function unconditionally set subscription_status = 'active',
-- which could silently un-cancel or un-pause a subscription on metadata updates.
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

    -- Metadata-only update: subscription_status is deliberately NOT changed.
    -- This prevents metadata events (address changes, payment method updates)
    -- from silently flipping a cancelled/past_due user back to 'active'.
    UPDATE user_credits
    SET subscription_plan                  = COALESCE(p_plan, subscription_plan),
        lemon_squeezy_subscription_id      = COALESCE(p_subscription_id, lemon_squeezy_subscription_id),
        lemon_squeezy_customer_portal_url  = COALESCE(p_customer_portal_url, lemon_squeezy_customer_portal_url),
        subscription_renews_at             = COALESCE(p_renews_at, subscription_renews_at),
        updated_at                         = now()
    WHERE user_id = p_user_id;
END;
$$;


-- ─── 2. Fix dedup index: use monthly bucketing instead of exact timestamp ───
-- The old index on (user_id, subscription_id, valid_from) never caught duplicates
-- because valid_from = NOW() produces a unique timestamp on every call.
DROP INDEX IF EXISTS credit_ledgers_subscription_dedup_idx;

-- Create an IMMUTABLE wrapper function to get the UTC-based start of the month for a timestamptz.
-- This is required because date_trunc on timestamptz is STABLE (timezone-dependent) by default.
CREATE OR REPLACE FUNCTION date_trunc_month_immutable(val TIMESTAMPTZ)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT date_trunc('month', val AT TIME ZONE 'UTC')::date;
$$;

-- Functional index: only one grant per subscription per calendar month.
-- Uses the IMMUTABLE date_trunc_month_immutable wrapper to bucket grants into monthly periods
-- so two grants in the same month for the same subscription are correctly deduplicated.
CREATE UNIQUE INDEX credit_ledgers_subscription_month_idx
    ON public.credit_ledgers (
        user_id,
        subscription_id,
        (date_trunc_month_immutable(valid_from))
    )
    WHERE subscription_id IS NOT NULL;


-- ─── 3. Fix expire_subscription_ledgers: also zero remaining_amount ───
-- Previously only set expires_at = NOW() without zeroing remaining_amount,
-- creating a microsecond race where the balance sync could still count them.
DROP FUNCTION IF EXISTS expire_subscription_ledgers(UUID, TEXT);

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
    -- Expire AND zero-out in one shot to close the microsecond race window.
    -- Setting expires_at to 1 second in the past guarantees no subsequent
    -- query with expires_at > NOW() can pick up these entries.
    UPDATE credit_ledgers
    SET expires_at = NOW() - INTERVAL '1 second',
        remaining_amount = 0
    WHERE user_id = p_user_id
      AND subscription_id = p_subscription_id
      AND expires_at > NOW();

    -- Recalculate remaining total balance from all OTHER active ledgers
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


-- ─── 4. Add payload column to webhook_events for audit logging ───
-- Storing the full LS payload makes debugging credit issues possible
-- without needing to reproduce the exact sequence of events.
ALTER TABLE public.webhook_events
    ADD COLUMN IF NOT EXISTS payload JSONB;


-- ─── 5. Drop unused pricing_packages table ───
-- This table was created in the initial schema but is never read from
-- or written to by any code. All pricing is defined in subscriptionConfig.ts.
DROP TABLE IF EXISTS public.pricing_packages;
