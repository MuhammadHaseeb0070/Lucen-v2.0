-- ============================================
-- Fix: Add is_patch column to messages
-- ============================================

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS is_patch BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN messages.is_patch IS
    'true if this message is a surgical code patch applied to an artifact.';
