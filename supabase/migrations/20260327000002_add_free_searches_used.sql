-- ============================================
-- Phase 3: Track free-tier web searches used
-- ============================================
-- Free tier (subscription_status='free') is limited to 3 total web searches.

ALTER TABLE public.user_credits
  ADD COLUMN IF NOT EXISTS free_searches_used INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_user_credits_free_searches_used
  ON public.user_credits(user_id, free_searches_used);

