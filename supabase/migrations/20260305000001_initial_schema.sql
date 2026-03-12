-- ============================================
-- Lucen: Initial Database Schema
-- ============================================
-- Tables: conversations, messages, user_credits, user_settings
-- All tables reference auth.uid() for Row Level Security

-- ─── Conversations ───
CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL DEFAULT auth.uid(),
  title       TEXT NOT NULL DEFAULT 'New Chat',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE conversations IS 'Chat conversations owned by users';

-- ─── Messages ───
CREATE TABLE messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content          TEXT NOT NULL DEFAULT '',
  reasoning        TEXT,
  is_truncated     BOOLEAN NOT NULL DEFAULT false,
  attachments      JSONB,  -- Stores attachment metadata (name, type, size) — NOT file content
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE messages IS 'Individual messages within a conversation';

-- ─── Pricing Packages (Single Source of Truth) ───
CREATE TABLE pricing_packages (
  id               TEXT PRIMARY KEY, -- e.g., 'free_tier', 'pro_tier'
  name             TEXT NOT NULL,
  price_usd        NUMERIC NOT NULL,
  credits_provided NUMERIC NOT NULL,
  description      TEXT
);

COMMENT ON TABLE pricing_packages IS 'Tamper-proof backend pricing configuration';

-- ─── User Credits ───
CREATE TABLE user_credits (
  user_id             UUID PRIMARY KEY DEFAULT auth.uid(),
  remaining_credits   DOUBLE PRECISION NOT NULL DEFAULT 500, -- Free tier default
  total_used          DOUBLE PRECISION NOT NULL DEFAULT 0,
  stripe_customer_id  TEXT,
  subscription_status TEXT DEFAULT 'free', -- 'free', 'active', 'past_due'
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_credits IS 'Server-authoritative credit balance and sub status';

-- ─── Usage Logs (Granular Dashboard Tracking) ───
CREATE TABLE usage_logs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id        UUID REFERENCES conversations(id) ON DELETE CASCADE,
  message_id             UUID REFERENCES messages(id) ON DELETE CASCADE,
  prompt_tokens          INTEGER NOT NULL DEFAULT 0,
  completion_tokens      INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens       INTEGER NOT NULL DEFAULT 0,
  image_tokens           INTEGER NOT NULL DEFAULT 0,
  file_tokens            INTEGER NOT NULL DEFAULT 0,
  total_credits_deducted DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE usage_logs IS 'Granular token utilization tracking per request';

-- ─── User Settings ───
CREATE TABLE user_settings (
  user_id       UUID PRIMARY KEY DEFAULT auth.uid(),
  active_theme  TEXT NOT NULL DEFAULT 'lucen',
  settings      JSONB NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_settings IS 'Synced user preferences (theme, model, etc.)';

-- ─── Indexes ───
CREATE INDEX idx_conversations_user      ON conversations(user_id);
CREATE INDEX idx_conversations_updated   ON conversations(user_id, updated_at DESC);
CREATE INDEX idx_messages_conv           ON messages(conversation_id);
CREATE INDEX idx_messages_conv_created   ON messages(conversation_id, created_at ASC);

-- ─── Auto-update `updated_at` trigger ───
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER user_credits_updated_at
  BEFORE UPDATE ON user_credits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
