-- ============================================
-- File Attachments System Migration
-- ============================================

CREATE TABLE file_attachments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id        UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL DEFAULT auth.uid(),
  file_name         TEXT NOT NULL,
  file_type         TEXT NOT NULL, -- 'image' | 'pdf' | 'text' | 'code' | 'spreadsheet' etc
  storage_path      TEXT,          -- Supabase Storage path (optional, for re-download)
  extracted_text    TEXT,          -- raw text for docs/code/pdf
  ai_description    TEXT,          -- AI's description (images only)
  token_estimate    INTEGER,       -- rough token count of extracted_text or ai_description
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE file_attachments ENABLE ROW LEVEL SECURITY;

-- Users manage their own attachments
CREATE POLICY "Users manage own attachments" ON file_attachments
  FOR ALL USING (auth.uid() = user_id);

-- Performance Indexes
CREATE INDEX idx_file_attachments_message ON file_attachments(message_id);
CREATE INDEX idx_file_attachments_conversation ON file_attachments(conversation_id);
