-- ============================================
-- Add Web Search metadata to messages
-- ============================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS web_search JSONB;

COMMENT ON COLUMN public.messages.web_search IS 'Stores web search results and link metadata (used, links: {title, url}[])';
