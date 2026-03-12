-- ============================================
-- Lucen: Row Level Security Policies
-- ============================================
-- Every user can only see, create, update, and delete their own data.
-- Credits can only be modified via service_role (Edge Functions).

-- ─── Enable RLS on all tables ───
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credits   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings  ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════
-- Conversations
-- ═══════════════════════════════════════════

CREATE POLICY "conversations_select_own"
  ON conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "conversations_insert_own"
  ON conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "conversations_update_own"
  ON conversations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "conversations_delete_own"
  ON conversations FOR DELETE
  USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════
-- Messages
-- ═══════════════════════════════════════════

CREATE POLICY "messages_select_own"
  ON messages FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "messages_insert_own"
  ON messages FOR INSERT
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM conversations WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "messages_update_own"
  ON messages FOR UPDATE
  USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "messages_delete_own"
  ON messages FOR DELETE
  USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE user_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════
-- User Credits
-- ═══════════════════════════════════════════
-- SELECT allowed for the user (so they can see their balance)
-- INSERT/UPDATE/DELETE only via service_role (Edge Functions)

CREATE POLICY "credits_select_own"
  ON user_credits FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policies for anon/authenticated.
-- Only Edge Functions using service_role key can modify credits.

-- ═══════════════════════════════════════════
-- User Settings
-- ═══════════════════════════════════════════

CREATE POLICY "settings_select_own"
  ON user_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "settings_insert_own"
  ON user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "settings_update_own"
  ON user_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ═══════════════════════════════════════════
-- Pricing Packages
-- ═══════════════════════════════════════════

ALTER TABLE pricing_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "packages_select_all"
  ON pricing_packages FOR SELECT
  USING (true); -- Anyone can see packages (even unauthenticated, if needed for marketing)

-- ═══════════════════════════════════════════
-- Usage Logs
-- ═══════════════════════════════════════════

ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_logs_select_own"
  ON usage_logs FOR SELECT
  USING (auth.uid() = user_id);

-- Insert handled securely via Edge Function Service Role. Users shouldn't insert their own logs manually.
-- Deletes cascade from user/conversation/message deletions.
