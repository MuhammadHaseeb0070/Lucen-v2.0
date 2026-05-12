-- ============================================================================
-- Reliable artifact generation state
-- ============================================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS generation_status TEXT,
  ADD COLUMN IF NOT EXISTS generation_status_detail TEXT,
  ADD COLUMN IF NOT EXISTS artifact_job_id UUID,
  ADD COLUMN IF NOT EXISTS artifact_validation JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_generation_status_check'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_generation_status_check
      CHECK (
        generation_status IS NULL OR generation_status IN (
          'idle',
          'streaming',
          'continuing',
          'planning',
          'generating',
          'validating',
          'repairing',
          'complete',
          'partial_saved',
          'failed_recoverable'
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.artifact_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id TEXT,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (
    status IN (
      'planning',
      'generating',
      'validating',
      'repairing',
      'complete',
      'partial_saved',
      'failed_recoverable'
    )
  ),
  plan JSONB,
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_section INTEGER NOT NULL DEFAULT 0,
  assembled_content TEXT NOT NULL DEFAULT '',
  validation_errors TEXT[] NOT NULL DEFAULT '{}',
  retry_count INTEGER NOT NULL DEFAULT 0,
  final_artifact_id UUID REFERENCES public.artifacts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.artifact_generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "artifact_generation_jobs_select_own"
  ON public.artifact_generation_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "artifact_generation_jobs_insert_own"
  ON public.artifact_generation_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "artifact_generation_jobs_update_own"
  ON public.artifact_generation_jobs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "artifact_generation_jobs_delete_own"
  ON public.artifact_generation_jobs FOR DELETE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS artifact_generation_jobs_updated_at ON public.artifact_generation_jobs;
CREATE TRIGGER artifact_generation_jobs_updated_at
  BEFORE UPDATE ON public.artifact_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_messages_updated_at();

CREATE INDEX IF NOT EXISTS artifact_generation_jobs_user_updated_idx
  ON public.artifact_generation_jobs (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS artifact_generation_jobs_message_idx
  ON public.artifact_generation_jobs (message_id)
  WHERE message_id IS NOT NULL;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_artifact_job_id_fkey;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_artifact_job_id_fkey
  FOREIGN KEY (artifact_job_id)
  REFERENCES public.artifact_generation_jobs(id)
  ON DELETE SET NULL;

ALTER TABLE public.usage_logs
  ADD COLUMN IF NOT EXISTS finish_reason TEXT,
  ADD COLUMN IF NOT EXISTS provider_attempts JSONB,
  ADD COLUMN IF NOT EXISTS artifact_job_id UUID REFERENCES public.artifact_generation_jobs(id) ON DELETE SET NULL;

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
      'patch_continuation',
      'artifact_plan',
      'artifact_section',
      'artifact_repair'
    ));
END $$;
