-- ============================================================
-- Lucen: Artifact Hub — Row Level Security
-- ============================================================

ALTER TABLE artifacts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_votes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_comments  ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════
-- Artifacts
-- ═══════════════════════════════════════════

-- Owner: full CRUD on their own artifacts
CREATE POLICY "artifacts_select_own"
  ON artifacts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "artifacts_insert_own"
  ON artifacts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "artifacts_update_own"
  ON artifacts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "artifacts_delete_own"
  ON artifacts FOR DELETE
  USING (auth.uid() = user_id);

-- Anyone (incl. anon via the public API key) can read public artifacts
CREATE POLICY "artifacts_select_public"
  ON artifacts FOR SELECT
  USING (is_public = true);

-- ═══════════════════════════════════════════
-- Artifact Votes (Sparks)
-- ═══════════════════════════════════════════

-- Everyone can read vote counts (for display)
CREATE POLICY "votes_select_all"
  ON artifact_votes FOR SELECT
  USING (true);

-- Logged-in users can add their own spark
CREATE POLICY "votes_insert_own"
  ON artifact_votes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can remove their own spark
CREATE POLICY "votes_delete_own"
  ON artifact_votes FOR DELETE
  USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════
-- Artifact Comments
-- ═══════════════════════════════════════════

-- Everyone can read comments on public artifacts
CREATE POLICY "comments_select_public"
  ON artifact_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM artifacts
      WHERE artifacts.id = artifact_id AND artifacts.is_public = true
    )
    OR auth.uid() = user_id
    OR auth.uid() = (SELECT user_id FROM artifacts WHERE id = artifact_id)
  );

-- Logged-in users can post comments
CREATE POLICY "comments_insert_own"
  ON artifact_comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Comment author OR artifact owner can delete
CREATE POLICY "comments_delete_own_or_owner"
  ON artifact_comments FOR DELETE
  USING (
    auth.uid() = user_id
    OR auth.uid() = (SELECT user_id FROM artifacts WHERE id = artifact_id)
  );
