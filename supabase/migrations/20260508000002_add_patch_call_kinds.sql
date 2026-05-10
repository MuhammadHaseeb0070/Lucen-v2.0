-- ============================================================================
-- Add patch call_kinds and internal_error status to usage_logs
--
-- The client sends 'patch', 'patch_retry', 'patch_continuation' as
-- call_kind values for artifact update flows, but those weren't in the
-- original CHECK constraint. This caused all patch usage rows to be
-- silently dropped (recordUsage swallows insert errors).
-- ============================================================================

-- Drop and recreate call_kind check to include patch variants.
ALTER TABLE public.usage_logs DROP CONSTRAINT IF EXISTS usage_logs_call_kind_check;
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
        'title_gen',
        'patch',
        'patch_retry',
        'patch_continuation'
    ));

-- Drop and recreate status check to include internal_error.
ALTER TABLE public.usage_logs DROP CONSTRAINT IF EXISTS usage_logs_status_check;
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
        'client_error',
        'internal_error'
    ));
