// ============================================================
// Artifact Versioning — DB layer for the patching engine
//
// This module sits next to `artifactDb.ts` and is used exclusively by
// the patching pipeline. The legacy `saveArtifact` / `updateArtifactContent`
// helpers in artifactDb.ts continue to work for non-versioned flows
// (initial artifact creation on stream completion). Once a lineage is
// formed (V1 saved), every subsequent change should go through
// `createPatchedVersion` here so the lineage chain stays intact.
// ============================================================

import { supabase, hasActiveSessionSync } from '../lib/supabase';
import type { ArtifactType, ArtifactVersion } from '../types';

// ─── Row shape ───────────────────────────────────────────────
// Mirrors the artifacts table after the 20260504000001_artifacts_versioning
// migration runs. We only `select` the columns we actually need so a future
// schema change doesn't silently break this module.

interface DbVersionRow {
  id: string;
  lineage_id: string;
  parent_id: string | null;
  version_no: number;
  is_head: boolean;
  type: ArtifactType;
  title: string;
  content: string;
  message_id: string | null;
  conversation_id: string | null;
  created_at: string;
}

const SELECT_VERSION_COLS =
  'id, lineage_id, parent_id, version_no, is_head, type, title, content, message_id, conversation_id, created_at';

function rowToVersion(row: DbVersionRow): ArtifactVersion {
  return {
    dbId: row.id,
    lineageId: row.lineage_id,
    parentDbId: row.parent_id ?? undefined,
    versionNo: row.version_no,
    content: row.content,
    title: row.title,
    type: row.type,
    messageId: row.message_id,
    createdAt: new Date(row.created_at).getTime(),
  };
}

// ─── Reads ────────────────────────────────────────────────────

/**
 * Fetch the full ordered version chain for a lineage. Newest version last.
 *
 * RLS guarantees the caller can only see lineages they own.
 */
export async function getLineage(lineageId: string): Promise<ArtifactVersion[]> {
  if (!hasActiveSessionSync() || !supabase) return [];

  const { data, error } = await supabase
    .from('artifacts')
    .select(SELECT_VERSION_COLS)
    .eq('lineage_id', lineageId)
    .order('version_no', { ascending: true });

  if (error) {
    console.warn('[artifactVersionDb] getLineage error:', error);
    return [];
  }
  return (data || []).map((r) => rowToVersion(r as DbVersionRow));
}

/**
 * Fetch only the head (current) version of a lineage. Slightly cheaper
 * than getLineage when the caller doesn't need history.
 */
export async function getHead(lineageId: string): Promise<ArtifactVersion | null> {
  if (!hasActiveSessionSync() || !supabase) return null;

  const { data, error } = await supabase
    .from('artifacts')
    .select(SELECT_VERSION_COLS)
    .eq('lineage_id', lineageId)
    .eq('is_head', true)
    .maybeSingle();

  if (error) {
    console.warn('[artifactVersionDb] getHead error:', error);
    return null;
  }
  if (!data) return null;
  return rowToVersion(data as DbVersionRow);
}

/**
 * Convenience: given an arbitrary artifact id (any version in the chain),
 * return the lineage it belongs to. Used by the version selector when the
 * caller only knows a specific version's id, not the lineage_id.
 */
export async function getLineageByArtifactId(
  artifactId: string,
): Promise<ArtifactVersion[]> {
  if (!hasActiveSessionSync() || !supabase) return [];

  const { data, error } = await supabase
    .from('artifacts')
    .select('lineage_id')
    .eq('id', artifactId)
    .maybeSingle();

  if (error || !data?.lineage_id) {
    if (error) console.warn('[artifactVersionDb] getLineageByArtifactId error:', error);
    return [];
  }
  return getLineage(data.lineage_id as string);
}

// ─── Writes ───────────────────────────────────────────────────

/**
 * Atomically create a new patched version of an existing artifact. Calls
 * the SECURITY DEFINER PG function so the head-flip + insert happen in
 * one transaction (concurrency-safe via the unique partial index on
 * lineage_id WHERE is_head=true).
 *
 * Returns the new version's ArtifactVersion shape, or null on failure.
 */
export async function createPatchedVersion(params: {
  /** The lineage this patch belongs to. Use the existing artifact's lineageId. */
  lineageId: string;
  /** The previous head's dbId (becomes parent_id of the new row). */
  parentDbId: string;
  conversationId: string | null;
  /** The chat message id of the patching turn (NOT the original artifact-creation turn). */
  messageId: string | null;
  type: ArtifactType;
  title: string;
  content: string;
}): Promise<ArtifactVersion | null> {
  if (!hasActiveSessionSync() || !supabase) return null;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const { data, error } = await supabase.rpc('create_patched_artifact_version', {
    p_lineage_id: params.lineageId,
    p_parent_id: params.parentDbId,
    p_user_id: session.user.id,
    p_conversation_id: params.conversationId,
    p_message_id: params.messageId,
    p_type: params.type,
    p_title: params.title,
    p_content: params.content,
  });

  if (error) {
    console.warn('[artifactVersionDb] createPatchedVersion error:', error);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.new_id) {
    console.warn('[artifactVersionDb] createPatchedVersion: no row returned');
    return null;
  }

  return {
    dbId: row.new_id as string,
    lineageId: row.lineage_id as string,
    parentDbId: params.parentDbId,
    versionNo: row.new_version_no as number,
    content: params.content,
    title: params.title,
    type: params.type,
    messageId: params.messageId,
    createdAt: Date.now(),
  };
}

/**
 * Move the head pointer of a lineage to a specific historical version
 * (revert UX). Atomic via the same partial-index guard as createPatchedVersion.
 *
 * Returns the new head's dbId, or null on failure.
 */
export async function revertTo(params: {
  lineageId: string;
  targetVersionNo: number;
}): Promise<string | null> {
  if (!hasActiveSessionSync() || !supabase) return null;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const { data, error } = await supabase.rpc('revert_artifact_to_version', {
    p_lineage_id: params.lineageId,
    p_target_version: params.targetVersionNo,
    p_user_id: session.user.id,
  });

  if (error) {
    console.warn('[artifactVersionDb] revertTo error:', error);
    return null;
  }

  return (typeof data === 'string' ? data : null);
}

/**
 * Backfill helper: when an existing artifact (created BEFORE the version
 * migration ran, or via the legacy saveArtifact path) is about to be
 * patched, ensure its row has a lineage_id assigned so the patch chain
 * can hang off of it. The migration's UPDATE backfilled rows already
 * present at the time, but rows inserted by older client code paths
 * after the migration could still arrive without a lineage_id if the
 * INSERT didn't set it (the column has no DEFAULT). This helper is a
 * defensive no-op when the row already has a lineage_id.
 *
 * Returns the lineage_id (existing or newly assigned), or null on failure.
 */
export async function ensureLineageId(dbId: string): Promise<string | null> {
  if (!hasActiveSessionSync() || !supabase) return null;

  const { data, error } = await supabase
    .from('artifacts')
    .select('lineage_id')
    .eq('id', dbId)
    .maybeSingle();

  if (error) {
    console.warn('[artifactVersionDb] ensureLineageId read error:', error);
    return null;
  }

  if (data?.lineage_id) return data.lineage_id as string;

  // Self-reference backfill: lineage_id := id, parent_id := null, version_no := 1.
  const { data: updated, error: updateErr } = await supabase
    .from('artifacts')
    .update({ lineage_id: dbId, parent_id: null, version_no: 1, is_head: true })
    .eq('id', dbId)
    .select('lineage_id')
    .maybeSingle();

  if (updateErr) {
    console.warn('[artifactVersionDb] ensureLineageId backfill error:', updateErr);
    return null;
  }
  return (updated?.lineage_id as string) ?? null;
}
