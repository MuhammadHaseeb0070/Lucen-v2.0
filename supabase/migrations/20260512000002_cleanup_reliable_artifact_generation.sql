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

ALTER TABLE IF EXISTS public.usage_logs
  DROP CONSTRAINT IF EXISTS usage_logs_artifact_job_id_fkey;

ALTER TABLE IF EXISTS public.usage_logs
  DROP COLUMN IF EXISTS finish_reason,
  DROP COLUMN IF EXISTS provider_attempts,
  DROP COLUMN IF EXISTS artifact_job_id;

DROP TABLE IF EXISTS public.artifact_generation_jobs;

-- Historical rows may still have experimental call_kind values (e.g. artifact_plan).
-- Normalize them before re-adding the CHECK, or ADD CONSTRAINT fails (23514).
ALTER TABLE IF EXISTS public.usage_logs DROP CONSTRAINT IF EXISTS usage_logs_call_kind_check;

UPDATE public.usage_logs
SET call_kind = 'chat'
WHERE call_kind IS NULL
   OR call_kind NOT IN (
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
   );

DO $$
BEGIN
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

