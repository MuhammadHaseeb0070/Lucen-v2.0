-- ============================================
-- Fix: Ensure missing tables are created
-- ============================================

-- ─── Pricing Packages ───
CREATE TABLE IF NOT EXISTS public.pricing_packages (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  price_usd        NUMERIC NOT NULL,
  credits_provided NUMERIC NOT NULL,
  description      TEXT
);

-- ─── User Credits Updates ───
-- Ensure the columns exist if not already there
ALTER TABLE public.user_credits ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE public.user_credits ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'free';

-- ─── Usage Logs ───
CREATE TABLE IF NOT EXISTS public.usage_logs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id        UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id             UUID REFERENCES public.messages(id) ON DELETE CASCADE,
  prompt_tokens          INTEGER NOT NULL DEFAULT 0,
  completion_tokens      INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens       INTEGER NOT NULL DEFAULT 0,
  image_tokens           INTEGER NOT NULL DEFAULT 0,
  file_tokens            INTEGER NOT NULL DEFAULT 0,
  total_credits_deducted DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── RLS Policies ───
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_packages ENABLE ROW LEVEL SECURITY;

-- Drop existing to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own logs" ON public.usage_logs;
DROP POLICY IF EXISTS "Admins can view all logs" ON public.usage_logs;
DROP POLICY IF EXISTS "Public can view pricing" ON public.pricing_packages;

-- Users can see their own logs
CREATE POLICY "Users can view their own logs" ON public.usage_logs
FOR SELECT USING (auth.uid() = user_id);

-- Pricing is public
CREATE POLICY "Public can view pricing" ON public.pricing_packages
FOR SELECT USING (true);

-- ─── Indexes ───
CREATE INDEX IF NOT EXISTS idx_usage_logs_user ON public.usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON public.usage_logs(created_at DESC);
