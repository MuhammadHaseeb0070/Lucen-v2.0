-- ============================================
-- Lucen: Database Repair Script
-- ============================================
-- Run this in Supabase SQL Editor when tables were manually deleted
-- but migration history still thinks they exist (so "db push" does nothing).
--
-- This resets migration history and recreates all tables.
-- WARNING: This will DELETE any existing data in these tables.
-- ============================================

-- 1. Clear migration history (so "supabase db push" will re-run migrations)
TRUNCATE supabase_migrations.schema_migrations;

-- 2. Drop tables in reverse dependency order
DROP TABLE IF EXISTS public.usage_logs CASCADE;
DROP TABLE IF EXISTS public.messages CASCADE;
DROP TABLE IF EXISTS public.conversations CASCADE;
DROP TABLE IF EXISTS public.user_credits CASCADE;
DROP TABLE IF EXISTS public.user_settings CASCADE;
DROP TABLE IF EXISTS public.pricing_packages CASCADE;

-- 3. Drop functions
DROP TRIGGER IF EXISTS conversations_updated_at ON public.conversations;
DROP TRIGGER IF EXISTS user_credits_updated_at ON public.user_credits;
DROP TRIGGER IF EXISTS user_settings_updated_at ON public.user_settings;
DROP FUNCTION IF EXISTS update_updated_at();

-- 4. Recreate tables (from initial_schema + rls + fix)
CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  title       TEXT NOT NULL DEFAULT 'New Chat',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content          TEXT NOT NULL DEFAULT '',
  reasoning        TEXT,
  is_truncated     BOOLEAN NOT NULL DEFAULT false,
  attachments      JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pricing_packages (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  price_usd        NUMERIC NOT NULL,
  credits_provided NUMERIC NOT NULL,
  description      TEXT
);

CREATE TABLE user_credits (
  user_id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  remaining_credits   DOUBLE PRECISION NOT NULL DEFAULT 500,
  total_used          DOUBLE PRECISION NOT NULL DEFAULT 0,
  stripe_customer_id  TEXT,
  subscription_status TEXT DEFAULT 'free',
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE TABLE user_settings (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active_theme  TEXT NOT NULL DEFAULT 'lucen',
  settings      JSONB NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_updated ON conversations(user_id, updated_at DESC);
CREATE INDEX idx_messages_conv ON messages(conversation_id);
CREATE INDEX idx_messages_conv_created ON messages(conversation_id, created_at ASC);
CREATE INDEX idx_usage_logs_user ON usage_logs(user_id);

-- Triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER user_credits_updated_at BEFORE UPDATE ON user_credits FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER user_settings_updated_at BEFORE UPDATE ON user_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

-- Policies (conversations, messages, user_credits, user_settings, usage_logs, pricing_packages)
CREATE POLICY "conversations_select_own" ON conversations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "conversations_insert_own" ON conversations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "conversations_update_own" ON conversations FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "conversations_delete_own" ON conversations FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "messages_select_own" ON messages FOR SELECT USING (conversation_id IN (SELECT id FROM conversations WHERE user_id = auth.uid()));
CREATE POLICY "messages_insert_own" ON messages FOR INSERT WITH CHECK (conversation_id IN (SELECT id FROM conversations WHERE user_id = auth.uid()));
CREATE POLICY "messages_update_own" ON messages FOR UPDATE USING (conversation_id IN (SELECT id FROM conversations WHERE user_id = auth.uid()));
CREATE POLICY "messages_delete_own" ON messages FOR DELETE USING (conversation_id IN (SELECT id FROM conversations WHERE user_id = auth.uid()));

CREATE POLICY "credits_select_own" ON user_credits FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "settings_select_own" ON user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "settings_insert_own" ON user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "settings_update_own" ON user_settings FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "packages_select_all" ON pricing_packages FOR SELECT USING (true);

CREATE POLICY "usage_logs_select_own" ON usage_logs FOR SELECT USING (auth.uid() = user_id);
