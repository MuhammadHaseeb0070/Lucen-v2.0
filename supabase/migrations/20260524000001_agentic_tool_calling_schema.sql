-- ============================================================================
-- Agentic Tool-Calling Schema Migration (Idempotent)
-- ============================================================================

-- 1. Add tools_used to messages table
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS tools_used JSONB;

-- 2. Add question_hash to file_attachments table and create an index
ALTER TABLE public.file_attachments
  ADD COLUMN IF NOT EXISTS question_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_file_attachments_question_hash
  ON public.file_attachments(question_hash);

-- 3. Enable pgvector extension and create document_chunks table
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.document_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL DEFAULT auth.uid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_name       TEXT NOT NULL,
  chunk_index     INTEGER NOT NULL,
  content         TEXT NOT NULL,
  token_estimate  INTEGER,
  embedding       vector(768),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on document_chunks
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

-- Create policy for user access to document_chunks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'document_chunks'
      AND policyname = 'Users manage own document chunks'
  ) THEN
    CREATE POLICY "Users manage own document chunks"
      ON public.document_chunks
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_document_chunks_conversation
  ON public.document_chunks(conversation_id);

CREATE INDEX IF NOT EXISTS idx_document_chunks_message
  ON public.document_chunks(message_id);

-- 4. Create match_document_chunks RPC
DROP FUNCTION IF EXISTS public.match_document_chunks(vector, uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.match_document_chunks(vector(768), uuid, uuid, integer);
CREATE OR REPLACE FUNCTION public.match_document_chunks(
  p_query_embedding vector(768),
  p_conversation_id uuid,
  p_user_id uuid,
  p_top_k integer
)
RETURNS TABLE (
  id uuid,
  file_name text,
  content text,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.file_name,
    dc.content,
    (1 - (dc.embedding <=> p_query_embedding))::double precision AS similarity
  FROM public.document_chunks dc
  WHERE dc.conversation_id = p_conversation_id
    AND dc.user_id = p_user_id
  ORDER BY dc.embedding <=> p_query_embedding
  LIMIT p_top_k;
END;
$$;
