-- ============================================
-- Conversation auto-title tracking
-- ============================================
-- Adds a flag so we can stop overwriting the title once the user has
-- manually renamed the chat. Default TRUE for existing rows so the
-- generator can improve old 'New Chat'/'first-40-char' titles too.

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS title_auto BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN conversations.title_auto IS
    'true while the title is still auto-generated; set to false when the user renames the chat so the generator never overrides a human edit.';
