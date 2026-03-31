-- ============================================
-- Web Search + Cost Breakdown in usage_logs
-- ============================================

ALTER TABLE public.usage_logs
  ADD COLUMN IF NOT EXISTS model_id TEXT,
  ADD COLUMN IF NOT EXISTS web_search_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS web_search_engine TEXT,
  ADD COLUMN IF NOT EXISTS web_search_max_results INTEGER,
  ADD COLUMN IF NOT EXISTS web_search_results_billed INTEGER,
  ADD COLUMN IF NOT EXISTS text_credits DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS image_credits DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS web_search_credits DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_usage_logs_user_created
  ON public.usage_logs(user_id, created_at DESC);

