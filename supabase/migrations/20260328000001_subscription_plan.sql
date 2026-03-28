-- Distinct paid tier for UI (Regular vs Pro). Webhook sets this from Lemon variant ids.
ALTER TABLE public.user_credits
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'free';

COMMENT ON COLUMN public.user_credits.subscription_plan IS 'free | regular | pro (display; Lemon is source of truth for billing)';

UPDATE public.user_credits
SET subscription_plan = 'free'
WHERE subscription_plan IS NULL;
