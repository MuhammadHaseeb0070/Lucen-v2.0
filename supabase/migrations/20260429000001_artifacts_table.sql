-- ============================================================
-- Lucen: Artifact Hub — DB Schema
-- Tables: artifacts, artifact_votes, artifact_comments
-- ============================================================

-- ─── Artifacts ───
CREATE TABLE artifacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  message_id      TEXT,           -- client UUID (not FK — avoids cascade complexity)
  type            TEXT NOT NULL CHECK (type IN ('html', 'svg', 'mermaid', 'file')),
  title           TEXT NOT NULL DEFAULT 'Untitled Artifact',
  content         TEXT NOT NULL DEFAULT '',
  is_public       BOOLEAN NOT NULL DEFAULT false,
  slug            TEXT UNIQUE,    -- set only when is_public=true; globally unique friendly ID
  description     TEXT DEFAULT '', -- user-written blurb shown in the Hub
  tags            TEXT[] NOT NULL DEFAULT '{}',
  author_name     TEXT DEFAULT '', -- denormalized at publish time (avoids PII join)
  spark_count     INTEGER NOT NULL DEFAULT 0, -- "Sparks" = Lucen's upvote brand
  view_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE artifacts IS 'User-created artifacts; private by default, optionally published to the Hub';
COMMENT ON COLUMN artifacts.spark_count IS 'Lucen brand upvotes — called Sparks';
COMMENT ON COLUMN artifacts.slug IS 'Globally unique friendly ID chosen by user at publish time';

-- Slug format: lowercase alphanumeric + hyphens, 3–60 chars
ALTER TABLE artifacts
  ADD CONSTRAINT artifacts_slug_format
  CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$');

-- Full-text search vector (stored, auto-updated via trigger)
ALTER TABLE artifacts ADD COLUMN fts_vector TSVECTOR;

CREATE OR REPLACE FUNCTION artifacts_fts_update()
RETURNS trigger AS $$
BEGIN
  NEW.fts_vector := to_tsvector('english',
    coalesce(NEW.title, '') || ' ' ||
    coalesce(NEW.description, '') || ' ' ||
    coalesce(array_to_string(NEW.tags, ' '), '')
  );
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_artifacts_fts_update
  BEFORE INSERT OR UPDATE ON artifacts
  FOR EACH ROW EXECUTE FUNCTION artifacts_fts_update();

-- ─── Indexes ───
CREATE INDEX idx_artifacts_user         ON artifacts(user_id);
CREATE INDEX idx_artifacts_public       ON artifacts(is_public) WHERE is_public = true;
CREATE INDEX idx_artifacts_tags         ON artifacts USING GIN(tags);
CREATE INDEX idx_artifacts_fts          ON artifacts USING GIN(fts_vector);
CREATE INDEX idx_artifacts_sparks       ON artifacts(spark_count DESC) WHERE is_public = true;
CREATE INDEX idx_artifacts_created      ON artifacts(created_at DESC) WHERE is_public = true;
CREATE INDEX idx_artifacts_slug         ON artifacts(slug) WHERE slug IS NOT NULL;

-- ─── Spark Votes ───
-- Composite PK prevents duplicate votes (one spark per user per artifact)
CREATE TABLE artifact_votes (
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (artifact_id, user_id)
);

COMMENT ON TABLE artifact_votes IS 'One row per user-artifact spark. Composite PK is the uniqueness guard.';

-- ─── Comments ───
CREATE TABLE artifact_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name TEXT DEFAULT '',   -- denormalized at insert time
  content     TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 1000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE artifact_comments IS 'Comments left on public artifacts in the Hub';
CREATE INDEX idx_comments_artifact ON artifact_comments(artifact_id, created_at DESC);

-- ─── Auto-update updated_at ───
CREATE TRIGGER artifacts_updated_at
  BEFORE UPDATE ON artifacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Atomic Spark Toggle ───
-- Mirrors the deduct_user_credits RPC pattern — prevents race conditions.
-- Returns new spark_count and whether the user now has a spark on this artifact.
CREATE OR REPLACE FUNCTION toggle_artifact_spark(
  p_artifact_id UUID,
  p_user_id     UUID
)
RETURNS TABLE(new_spark_count INTEGER, user_sparked BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM artifact_votes
    WHERE artifact_id = p_artifact_id AND user_id = p_user_id
  ) INTO v_exists;

  IF v_exists THEN
    -- Remove spark
    DELETE FROM artifact_votes
      WHERE artifact_id = p_artifact_id AND user_id = p_user_id;
    UPDATE artifacts
      SET spark_count = GREATEST(0, spark_count - 1)
      WHERE id = p_artifact_id;
    RETURN QUERY
      SELECT (SELECT spark_count FROM artifacts WHERE id = p_artifact_id)::INTEGER, false;
  ELSE
    -- Add spark
    INSERT INTO artifact_votes(artifact_id, user_id)
      VALUES (p_artifact_id, p_user_id)
      ON CONFLICT DO NOTHING;
    UPDATE artifacts
      SET spark_count = spark_count + 1
      WHERE id = p_artifact_id;
    RETURN QUERY
      SELECT (SELECT spark_count FROM artifacts WHERE id = p_artifact_id)::INTEGER, true;
  END IF;
END;
$$;

-- ─── Atomic View Count Increment ───
CREATE OR REPLACE FUNCTION increment_artifact_views(p_artifact_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE artifacts SET view_count = view_count + 1 WHERE id = p_artifact_id AND is_public = true;
END;
$$;
