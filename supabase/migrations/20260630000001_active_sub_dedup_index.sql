-- ==============================================================================
-- Migration: Active Subscription Dedup Index
-- Date: 2026-06-30
-- ==============================================================================
-- Fixes C5 from the pre-launch audit: the subscription_created handler has a
-- TOCTOU (Time-Of-Check-Time-Of-Use) race where two concurrent webhook
-- deliveries with DIFFERENT event IDs (but the same logical subscription) can
-- both pass the SELECT check and both INSERT credit ledger entries.
--
-- This UNIQUE partial index makes the INSERT inside grant_subscription_credits
-- fail atomically (23505 unique_violation) if there's already an active
-- (remaining_amount > 0) ledger entry for the same subscription + user.
-- ==============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledgers_active_sub
    ON public.credit_ledgers(subscription_id, user_id)
    WHERE remaining_amount > 0 AND subscription_id IS NOT NULL;
