-- ============================================================================
-- Cleanup for the abandoned artifact-generation job experiment.
--
-- Safe on databases where 20260512000001 was only a tombstone/no-op, and also
-- safe on databases where the experimental schema was actually applied.
-- ============================================================================

ALTER TABLE IF EXISTS public.messages
  DROP CONSTRAINT IF EXISTS messages_artifact_job_id_fkey;

ALTER TABLE IF EXISTS public.messages
  DROP CONSTRAINT IF EXISTS messages_generation_status_check;

ALTER TABLE IF EXISTS public.messages
  DROP COLUMN IF EXISTS generation_status,
  DROP COLUMN IF EXISTS generation_status_detail,
  DROP COLUMN IF EXISTS artifact_job_id,
  DROP COLUMN IF EXISTS artifact_validation;

DROP TABLE IF EXISTS public.artifact_generation_jobs;

ALTER TABLE IF EXISTS public.usage_logs
  DROP COLUMN IF EXISTS finish_reason,
  DROP COLUMN IF EXISTS provider_attempts,
  DROP COLUMN IF EXISTS artifact_job_id;

DO $$
BEGIN
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
END $$;

