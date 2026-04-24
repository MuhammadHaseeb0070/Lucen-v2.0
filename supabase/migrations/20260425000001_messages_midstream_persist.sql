-- ============================================================================
-- Mid-stream persistence for messages (Claude / Gemini style)
--
-- Adds two columns used to safely resume assistant generations after a page
-- refresh, socket drop, or Supabase timeout:
--
--   is_streaming   TRUE while the assistant message is still being generated.
--                  Set to FALSE when the stream completes (either naturally,
--                  via abort, or via error). Lets the client distinguish a
--                  resume-able in-progress message from a completed one.
--
--   updated_at     Touched by every mid-stream write so the client can check
--                  how recently the stream was active. Messages with
--                  is_streaming=TRUE and updated_at older than 5 minutes are
--                  considered stale (the browser tab likely died) and the
--                  user is offered a one-tap resume.
--
-- Existing rows default to is_streaming=FALSE and updated_at=created_at so the
-- change is backwards compatible with pre-existing conversations.
-- ============================================================================

ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS is_streaming BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT now();

-- Touch updated_at on every UPDATE (keeps mid-stream writes honest without
-- making client code compute timestamps).
CREATE OR REPLACE FUNCTION public.touch_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS messages_touch_updated_at ON public.messages;
CREATE TRIGGER messages_touch_updated_at
    BEFORE UPDATE ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_messages_updated_at();

-- Index to find in-progress messages on app mount without a full table scan.
CREATE INDEX IF NOT EXISTS messages_streaming_idx
    ON public.messages (conversation_id, is_streaming)
    WHERE is_streaming = TRUE;
