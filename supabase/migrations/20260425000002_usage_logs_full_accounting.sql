-- ============================================================================
-- usage_logs — full accounting
--
-- Adds the columns needed to record EVERY AI API call the app makes, even
-- ones that never produced tokens (auth errors, insufficient credits, upstream
-- 5xx, mid-stream aborts). This is what lets the Usage tab in the UI show a
-- complete record of what was attempted, what it cost, and why it succeeded
-- or failed.
--
-- Column summary:
--
--   status             Lifecycle outcome of the call. One of:
--                        completed             — finished with finish_reason=stop + [DONE]
--                        truncated             — finish_reason=length, continuation exhausted
--                        aborted               — user clicked Stop
--                        upstream_error        — OpenRouter or provider returned error
--                        timeout               — watchdog or Supabase wall-clock cut
--                        auth_error            — session expired / not signed in
--                        insufficient_credits  — blocked before hitting upstream
--                        client_error          — malformed request body, etc.
--
--   status_reason      Free-form detail (optional). e.g. `finish_reason=length`
--                      or `HTTP 429 — rate limited`.
--
--   call_kind          Which subsystem made the call. One of:
--                        chat                  — main conversation stream
--                        chat_continuation     — auto-continuation pass
--                        classify_intent       — web search routing decision
--                        embed                 — file RAG embedding
--                        retrieve               — file RAG retrieval query
--                        describe_image        — vision helper describing an image
--                        web_search            — Tavily / online plugin
--                        title_gen             — side-chat title generation
--
--   request_id         Client-generated UUID for this attempt. Unique per
--                      call (not per user turn). Lets us correlate client
--                      logs with server rows.
--
--   parent_request_id  For auto-continuation chunks, the request_id of the
--                      ORIGINAL user-triggered call. NULL for fresh turns.
--                      Used by the Usage UI to group chunks under their
--                      parent.
--
--   provider           Resolved provider slug (from model id's first segment).
--                      e.g. `openai`, `anthropic`, `google`, `minimaxai`.
--
--   duration_ms        Wall-clock time from request hit to final log write.
--
--   usd_cost           Real provider dollar cost, computed server-side from
--                      prompt/completion/reasoning tokens times the per-1M
--                      rates the client sends in the request body (from env).
--                      Separate from `total_credits_deducted` which is our
--                      own LC economics.
--
--   error_message      Short human-readable error string (null on success).
-- ============================================================================

ALTER TABLE public.usage_logs
    ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'completed',
    ADD COLUMN IF NOT EXISTS status_reason       TEXT,
    ADD COLUMN IF NOT EXISTS call_kind           TEXT NOT NULL DEFAULT 'chat',
    ADD COLUMN IF NOT EXISTS request_id          UUID,
    ADD COLUMN IF NOT EXISTS parent_request_id   UUID,
    ADD COLUMN IF NOT EXISTS provider            TEXT,
    ADD COLUMN IF NOT EXISTS duration_ms         INTEGER,
    ADD COLUMN IF NOT EXISTS usd_cost            DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS error_message       TEXT;

-- Enumerate valid statuses so typos in edge-function code fail loudly.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'usage_logs_status_check'
    ) THEN
        ALTER TABLE public.usage_logs
            ADD CONSTRAINT usage_logs_status_check
            CHECK (status IN (
                'completed',
                'truncated',
                'aborted',
                'upstream_error',
                'timeout',
                'auth_error',
                'insufficient_credits',
                'client_error'
            ));
    END IF;
END $$;

-- Enumerate valid call_kinds.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'usage_logs_call_kind_check'
    ) THEN
        ALTER TABLE public.usage_logs
            ADD CONSTRAINT usage_logs_call_kind_check
            CHECK (call_kind IN (
                'chat',
                'chat_continuation',
                'classify_intent',
                'embed',
                'retrieve',
                'describe_image',
                'web_search',
                'title_gen'
            ));
    END IF;
END $$;

-- ─── Indexes ─────────────────────────────────────────────────────────────
-- Primary read path (UserUsageTab loads last N rows for the current user).
CREATE INDEX IF NOT EXISTS usage_logs_user_created_idx
    ON public.usage_logs (user_id, created_at DESC);

-- Group continuation chunks under their parent in the Usage UI.
CREATE INDEX IF NOT EXISTS usage_logs_parent_request_idx
    ON public.usage_logs (parent_request_id)
    WHERE parent_request_id IS NOT NULL;

-- Filter chips on the Usage tab hit status + call_kind.
CREATE INDEX IF NOT EXISTS usage_logs_status_kind_idx
    ON public.usage_logs (user_id, status, call_kind, created_at DESC);
