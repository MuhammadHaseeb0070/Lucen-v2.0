-- Migration: Add Global Search with Full-Text Search (FTS)

-- 1. Create a generated column for messages to store the tsvector
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS fts_document tsvector GENERATED ALWAYS AS (
  to_tsvector('english', coalesce(content, '') || ' ' || coalesce(reasoning, ''))
) STORED;

-- 2. Create a GIN index on messages to speed up search
CREATE INDEX IF NOT EXISTS idx_messages_fts ON messages USING gin(fts_document);

-- 3. Create a generated column for conversations to store the tsvector for titles
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS fts_document tsvector GENERATED ALWAYS AS (
  to_tsvector('english', coalesce(title, ''))
) STORED;

-- 4. Create a GIN index on conversations to speed up title searches
CREATE INDEX IF NOT EXISTS idx_conversations_fts ON conversations USING gin(fts_document);

-- 5. Create an RPC to perform the search across conversations and messages
CREATE OR REPLACE FUNCTION search_chat_history(search_query text)
RETURNS TABLE (
  conversation_id uuid,
  title text,
  updated_at timestamptz,
  match_excerpt text,
  rank real
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  parsed_query tsquery;
BEGIN
  -- Handle empty query
  IF trim(search_query) = '' THEN
    RETURN;
  END IF;

  -- Parse the query gracefully
  parsed_query := websearch_to_tsquery('english', search_query);

  RETURN QUERY
  WITH matched_messages AS (
    SELECT 
      m.conversation_id,
      m.content,
      ts_rank(m.fts_document, parsed_query) as rank
    FROM messages m
    WHERE m.fts_document @@ parsed_query
  ),
  message_agg AS (
    -- Get the best message match per conversation
    SELECT DISTINCT ON (mm.conversation_id)
      mm.conversation_id,
      ts_headline('english', mm.content, parsed_query, 'StartSel=**, StopSel=**, MaxWords=20, MinWords=5') as match_excerpt,
      mm.rank
    FROM matched_messages mm
    ORDER BY mm.conversation_id, mm.rank DESC
  ),
  matched_conversations AS (
    SELECT 
      c.id as conversation_id,
      ts_rank(c.fts_document, parsed_query) as rank
    FROM conversations c
    WHERE c.fts_document @@ parsed_query
  )
  -- Combine results: A conversation matches if its title matches OR any of its messages match
  SELECT 
    c.id as conversation_id,
    c.title,
    c.updated_at,
    COALESCE(ma.match_excerpt, '') as match_excerpt,
    GREATEST(COALESCE(ma.rank, 0), COALESCE(mc.rank, 0))::real as rank
  FROM conversations c
  LEFT JOIN message_agg ma ON c.id = ma.conversation_id
  LEFT JOIN matched_conversations mc ON c.id = mc.conversation_id
  WHERE (ma.conversation_id IS NOT NULL OR mc.conversation_id IS NOT NULL)
    AND c.user_id = auth.uid() -- RLS equivalent check since it's SECURITY DEFINER
  ORDER BY rank DESC, c.updated_at DESC
  LIMIT 50;
END;
$$;
