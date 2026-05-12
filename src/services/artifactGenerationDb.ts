import { hasActiveSessionSync, supabase } from '../lib/supabase';
import type {
  ArtifactGenerationJob,
  ArtifactGenerationPlan,
  ArtifactGenerationSection,
  ArtifactJobStatus,
} from '../types';

function rowToJob(row: any): ArtifactGenerationJob {
  return {
    id: row.id,
    conversationId: row.conversation_id ?? null,
    messageId: row.message_id ?? null,
    status: row.status,
    plan: row.plan ?? null,
    sections: row.sections ?? [],
    currentSection: row.current_section ?? 0,
    assembledContent: row.assembled_content ?? '',
    validationErrors: row.validation_errors ?? [],
    retryCount: row.retry_count ?? 0,
    finalArtifactId: row.final_artifact_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createArtifactJob(params: {
  id: string;
  conversationId: string | null;
  messageId: string | null;
}): Promise<ArtifactGenerationJob | null> {
  if (!hasActiveSessionSync() || !supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const { data, error } = await supabase
    .from('artifact_generation_jobs')
    .insert({
      id: params.id,
      user_id: session.user.id,
      conversation_id: params.conversationId,
      message_id: params.messageId,
      status: 'planning',
      sections: [],
      validation_errors: [],
    })
    .select('*')
    .single();

  if (error) {
    console.warn('[ArtifactJobDb] createArtifactJob error:', error);
    return null;
  }
  return rowToJob(data);
}

export async function updateArtifactJob(
  id: string,
  patch: {
    status?: ArtifactJobStatus;
    plan?: ArtifactGenerationPlan | null;
    sections?: ArtifactGenerationSection[];
    currentSection?: number;
    assembledContent?: string;
    validationErrors?: string[];
    retryCount?: number;
    finalArtifactId?: string | null;
  },
): Promise<boolean> {
  if (!hasActiveSessionSync() || !supabase) return false;

  const dbPatch: Record<string, unknown> = {};
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.plan !== undefined) dbPatch.plan = patch.plan;
  if (patch.sections !== undefined) dbPatch.sections = patch.sections;
  if (patch.currentSection !== undefined) dbPatch.current_section = patch.currentSection;
  if (patch.assembledContent !== undefined) dbPatch.assembled_content = patch.assembledContent;
  if (patch.validationErrors !== undefined) dbPatch.validation_errors = patch.validationErrors;
  if (patch.retryCount !== undefined) dbPatch.retry_count = patch.retryCount;
  if (patch.finalArtifactId !== undefined) dbPatch.final_artifact_id = patch.finalArtifactId;

  const { error } = await supabase
    .from('artifact_generation_jobs')
    .update(dbPatch)
    .eq('id', id);

  if (error) {
    console.warn('[ArtifactJobDb] updateArtifactJob error:', error);
    return false;
  }
  return true;
}

export async function fetchArtifactJob(id: string): Promise<ArtifactGenerationJob | null> {
  if (!hasActiveSessionSync() || !supabase) return null;
  const { data, error } = await supabase
    .from('artifact_generation_jobs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return rowToJob(data);
}
