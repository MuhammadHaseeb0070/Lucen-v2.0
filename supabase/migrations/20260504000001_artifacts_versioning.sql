-- ============================================================
-- Lucen: Artifact Versioning — patching engine lineage support
-- ============================================================
--
-- Adds version-history columns to the existing `artifacts` table so the
-- agentic patching engine can track an artifact through successive
-- patches (V1 -> V2 -> V3 ...) while keeping every prior state queryable.
--
-- Lineage model:
--   - Every artifact row belongs to a `lineage_id`. The first version
--     of a chain has `parent_id = NULL` and `version_no = 1`. Each
--     successive patch creates a NEW row with `parent_id` pointing to
--     the previous head and `version_no` incremented.
--   - At most ONE row per `lineage_id` has `is_head = true`. The head
--     is what the UI renders by default. Reverting flips heads.
--   - Existing artifacts (pre-migration) are backfilled with a fresh
--     `lineage_id` equal to their own `id`, `version_no = 1`, and
--     `is_head = true`. This keeps every existing flow correct as if
--     the artifact had always been a single-version chain.
--
-- Hub publishing notes:
--   - Only the `is_head = true` row of a lineage may be public. The
--     publishing flow already targets a single artifact id; we keep it
--     that way. If a user publishes V2 and then patches to V3, the V2
--     row stays public until they re-publish; that mirrors current UX
--     and avoids surprise URL changes for hub viewers.
-- ============================================================

ALTER TABLE artifacts
  ADD COLUMN lineage_id  UUID,
  ADD COLUMN parent_id   UUID REFERENCES artifacts(id) ON DELETE SET NULL,
  ADD COLUMN version_no  INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN is_head     BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN artifacts.lineage_id IS
  'Stable id shared by every version in a patch chain. The first version''s id == lineage_id.';
COMMENT ON COLUMN artifacts.parent_id IS
  'Previous version in the lineage chain (NULL for V1). Points back at the artifact this row was patched FROM.';
COMMENT ON COLUMN artifacts.version_no IS
  'Sequential 1-based version number within a lineage. Auto-incremented by createPatchedVersion.';
COMMENT ON COLUMN artifacts.is_head IS
  'True iff this row is the current head (latest visible) of its lineage. Exactly ONE head per lineage_id.';

-- Backfill existing rows:
--   1. Each existing artifact starts a fresh chain — lineage_id = its own id.
--   2. version_no defaults to 1, is_head defaults to true (already set).
UPDATE artifacts SET lineage_id = id WHERE lineage_id IS NULL;

ALTER TABLE artifacts
  ALTER COLUMN lineage_id SET NOT NULL;

-- Sanity guard: version_no >= 1
ALTER TABLE artifacts
  ADD CONSTRAINT artifacts_version_no_positive CHECK (version_no >= 1);

-- ─── Indexes ────────────────────────────────────────────────────────────
-- Fast lookup: "give me the head of lineage X"
CREATE UNIQUE INDEX idx_artifacts_lineage_head
  ON artifacts(lineage_id)
  WHERE is_head = true;

-- Fast lookup: "give me the full ordered history of lineage X"
CREATE INDEX idx_artifacts_lineage_chain
  ON artifacts(lineage_id, version_no);

-- Fast lookup: "what's the parent of this row"
CREATE INDEX idx_artifacts_parent
  ON artifacts(parent_id)
  WHERE parent_id IS NOT NULL;

-- ─── Atomic patch-version creation ─────────────────────────────────────
-- Inserts a new row in the lineage AND demotes the previous head in a
-- single transaction. Returns the new row's id, lineage, and version.
--
-- Concurrency: the unique partial index on (lineage_id) WHERE is_head=true
-- enforces "exactly one head per lineage". If two callers race to patch
-- the same lineage, one of them gets a unique violation and must retry
-- against the new head — exactly the semantics we want.
-- ============================================================
CREATE OR REPLACE FUNCTION create_patched_artifact_version(
  p_lineage_id      UUID,
  p_parent_id       UUID,
  p_user_id         UUID,
  p_conversation_id UUID,
  p_message_id      TEXT,
  p_type            TEXT,
  p_title           TEXT,
  p_content         TEXT
)
RETURNS TABLE(
  new_id          UUID,
  new_version_no  INTEGER,
  lineage_id      UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_prev_version  INTEGER;
  v_new_id        UUID;
  v_new_version   INTEGER;
BEGIN
  -- Lock the lineage so concurrent patches serialise.
  SELECT MAX(version_no) INTO v_prev_version
    FROM artifacts
    WHERE artifacts.lineage_id = p_lineage_id
      AND artifacts.user_id = p_user_id
    FOR UPDATE;

  IF v_prev_version IS NULL THEN
    RAISE EXCEPTION 'Lineage % not found for user %', p_lineage_id, p_user_id;
  END IF;

  v_new_version := v_prev_version + 1;

  -- Demote the previous head atomically.
  UPDATE artifacts
    SET is_head = false
    WHERE artifacts.lineage_id = p_lineage_id
      AND artifacts.user_id = p_user_id
      AND artifacts.is_head = true;

  -- Insert the new head version.
  INSERT INTO artifacts(
    user_id, conversation_id, message_id,
    type, title, content,
    lineage_id, parent_id, version_no, is_head
  )
  VALUES (
    p_user_id, p_conversation_id, p_message_id,
    p_type, p_title, p_content,
    p_lineage_id, p_parent_id, v_new_version, true
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, v_new_version, p_lineage_id;
END;
$$;

COMMENT ON FUNCTION create_patched_artifact_version IS
  'Atomically demote the current head of a lineage and insert a new patched version as the new head. Concurrency-safe via the unique partial index on (lineage_id) WHERE is_head=true.';

-- ─── Atomic head revert ────────────────────────────────────────────────
-- Sets the head pointer to a specific historical version within a
-- lineage. Used by the version selector's "revert to V2" UI.
-- ============================================================
CREATE OR REPLACE FUNCTION revert_artifact_to_version(
  p_lineage_id      UUID,
  p_target_version  INTEGER,
  p_user_id         UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target_id UUID;
BEGIN
  SELECT id INTO v_target_id
    FROM artifacts
    WHERE artifacts.lineage_id = p_lineage_id
      AND artifacts.version_no = p_target_version
      AND artifacts.user_id = p_user_id
    FOR UPDATE;

  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'Version % not found in lineage % for user %',
      p_target_version, p_lineage_id, p_user_id;
  END IF;

  UPDATE artifacts
    SET is_head = false
    WHERE artifacts.lineage_id = p_lineage_id
      AND artifacts.user_id = p_user_id
      AND artifacts.is_head = true
      AND artifacts.id <> v_target_id;

  UPDATE artifacts
    SET is_head = true
    WHERE id = v_target_id;

  RETURN v_target_id;
END;
$$;

COMMENT ON FUNCTION revert_artifact_to_version IS
  'Atomically move the head pointer of a lineage to a specific historical version. Used by the version selector UI.';
