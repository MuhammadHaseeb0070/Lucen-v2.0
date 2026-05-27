-- ============================================
-- Fix: Add missing columns dropped/forgotten in previous commits
-- ============================================

-- Add title_auto to conversations (default true so auto-title generator works on old chats)
ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS title_auto BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN conversations.title_auto IS
    'true while the title is still auto-generated; set to false when the user renames the chat so the generator never overrides a human edit.';

-- Add is_pinned to messages
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN messages.is_pinned IS
    'true if the user has pinned this message in the conversation.';
