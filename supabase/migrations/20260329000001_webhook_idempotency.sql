-- ============================================
-- Webhook Idempotency + Subscription Tracking
-- ============================================
-- Prevents duplicate credit grants from webhook retries.
-- Tracks subscription period for credit expiry logic.

-- Table to track processed webhook events
CREATE TABLE IF NOT EXISTS public.webhook_events (
  event_id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  variant_id TEXT,
  credits_granted NUMERIC DEFAULT 0,
  processed_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS (service role only — users never query this)
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- Index for cleanup of old events
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at
  ON public.webhook_events(processed_at);
