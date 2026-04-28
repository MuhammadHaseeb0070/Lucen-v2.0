// ============================================================
// Artifact Hub — Supabase Data Access Layer
// All DB operations for artifacts, sparks (votes), and comments.
// Mirrors the patterns in services/database.ts.
// ============================================================

import { supabase, hasActiveSessionSync } from '../lib/supabase';
import type { ArtifactType } from '../types';

// ─── Types ───────────────────────────────────────────────────

export interface DbArtifact {
  id: string;
  user_id: string;
  conversation_id: string | null;
  message_id: string | null;
  type: ArtifactType;
  title: string;
  content: string;
  is_public: boolean;
  slug: string | null;
  description: string;
  tags: string[];
  author_name: string;
  spark_count: number;
  view_count: number;
  created_at: string;
  updated_at: string;
  // Joined from artifact_votes for current user
  user_sparked?: boolean;
}

export interface DbComment {
  id: string;
  artifact_id: string;
  user_id: string;
  author_name: string;
  content: string;
  created_at: string;
}

// ─── Artifact CRUD ───────────────────────────────────────────

/**
 * Save a new artifact to DB (private by default).
 * Called once when streaming completes. Returns the DB UUID or null on failure.
 */
export async function saveArtifact(params: {
  clientId: string;
  conversationId: string | null;
  messageId: string | null;
  type: ArtifactType;
  title: string;
  content: string;
}): Promise<string | null> {
  if (!hasActiveSessionSync() || !supabase) return null;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const { data, error } = await supabase
    .from('artifacts')
    .insert({
      user_id: session.user.id,
      conversation_id: params.conversationId,
      message_id: params.messageId,
      type: params.type,
      title: params.title,
      content: params.content,
      is_public: false,
    })
    .select('id')
    .single();

  if (error) {
    console.warn('[ArtifactDb] saveArtifact error:', error);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Update artifact content after streaming completes (final write).
 */
export async function updateArtifactContent(dbId: string, content: string, title: string): Promise<boolean> {
  if (!hasActiveSessionSync() || !supabase) return false;

  const { error } = await supabase
    .from('artifacts')
    .update({ content, title })
    .eq('id', dbId);

  if (error) {
    console.warn('[ArtifactDb] updateArtifactContent error:', error);
    return false;
  }
  return true;
}

/**
 * Fetch all artifacts owned by the current user (private + public).
 */
export async function fetchMyArtifacts(): Promise<DbArtifact[]> {
  if (!hasActiveSessionSync() || !supabase) return [];

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return [];

  const { data, error } = await supabase
    .from('artifacts')
    .select('*')
    .eq('user_id', session.user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn('[ArtifactDb] fetchMyArtifacts error:', error);
    return [];
  }
  return (data || []) as DbArtifact[];
}

/**
 * Fetch public artifacts for the Hub.
 * Supports full-text search, tag filtering, and sorting.
 */
export async function fetchPublicArtifacts(opts: {
  search?: string;
  tags?: string[];
  sortBy?: 'sparks' | 'newest' | 'views';
  limit?: number;
  offset?: number;
}): Promise<DbArtifact[]> {
  if (!supabase) return [];

  const { search, tags, sortBy = 'sparks', limit = 20, offset = 0 } = opts;

  let query = supabase
    .from('artifacts')
    .select('*')
    .eq('is_public', true);

  if (search && search.trim().length > 0) {
    const s = search.trim();
    query = query.or(`title.ilike.%${s}%,description.ilike.%${s}%,tags.cs.{${s}}`);
  }

  if (tags && tags.length > 0) {
    query = query.overlaps('tags', tags);
  }

  if (sortBy === 'sparks') {
    query = query.order('spark_count', { ascending: false });
  } else if (sortBy === 'newest') {
    query = query.order('created_at', { ascending: false });
  } else if (sortBy === 'views') {
    query = query.order('view_count', { ascending: false });
  }

  query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) {
    console.warn('[ArtifactDb] fetchPublicArtifacts error:', error);
    return [];
  }
  return (data || []) as DbArtifact[];
}

/**
 * Fetch a single artifact by DB ID (used for preview in Hub).
 */
export async function fetchArtifactById(id: string): Promise<DbArtifact | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('artifacts')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data as DbArtifact;
}

/**
 * Publish an artifact: set is_public=true, slug, description, tags, author_name.
 */
export async function publishArtifact(params: {
  dbId: string;
  slug: string;
  description: string;
  tags: string[];
  authorName: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!hasActiveSessionSync() || !supabase) return { ok: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('artifacts')
    .update({
      is_public: true,
      slug: params.slug,
      description: params.description,
      tags: params.tags,
      author_name: params.authorName,
    })
    .eq('id', params.dbId);

  if (error) {
    // Unique constraint violation → slug taken
    if (error.code === '23505') return { ok: false, error: 'slug_taken' };
    console.warn('[ArtifactDb] publishArtifact error:', error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Unpublish (make private again). Clears slug so it can be reused.
 */
export async function unpublishArtifact(dbId: string): Promise<boolean> {
  if (!hasActiveSessionSync() || !supabase) return false;

  const { error } = await supabase
    .from('artifacts')
    .update({ is_public: false, slug: null })
    .eq('id', dbId);

  if (error) {
    console.warn('[ArtifactDb] unpublishArtifact error:', error);
    return false;
  }
  return true;
}

/**
 * Update artifact description/tags (for published artifacts without re-publishing).
 */
export async function updateArtifactMeta(dbId: string, params: {
  description: string;
  tags: string[];
}): Promise<boolean> {
  if (!hasActiveSessionSync() || !supabase) return false;

  const { error } = await supabase
    .from('artifacts')
    .update({ description: params.description, tags: params.tags })
    .eq('id', dbId);

  if (error) {
    console.warn('[ArtifactDb] updateArtifactMeta error:', error);
    return false;
  }
  return true;
}

/**
 * Delete an artifact from DB entirely (owner-only via RLS).
 */
export async function deleteArtifact(dbId: string): Promise<boolean> {
  if (!hasActiveSessionSync() || !supabase) return false;

  const { error } = await supabase
    .from('artifacts')
    .delete()
    .eq('id', dbId);

  if (error) {
    console.warn('[ArtifactDb] deleteArtifact error:', error);
    return false;
  }
  return true;
}

/**
 * Check if a slug is available (client-side pre-flight; DB UNIQUE is authoritative).
 */
export async function checkSlugAvailable(slug: string): Promise<boolean> {
  if (!supabase) return false;

  const { data, error } = await supabase
    .from('artifacts')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (error) return true; // assume available on error
  return data === null;
}

// ─── Sparks (Votes) ──────────────────────────────────────────

/**
 * Toggle a spark on an artifact. Uses the atomic PG function to prevent races.
 * Returns { sparkCount, userSparked } or null on failure.
 */
export async function toggleSpark(artifactId: string): Promise<{ sparkCount: number; userSparked: boolean } | null> {
  if (!hasActiveSessionSync() || !supabase) return null;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const { data, error } = await supabase.rpc('toggle_artifact_spark', {
    p_artifact_id: artifactId,
    p_user_id: session.user.id,
  });

  if (error) {
    console.warn('[ArtifactDb] toggleSpark error:', error);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    sparkCount: row?.new_spark_count ?? 0,
    userSparked: row?.user_sparked ?? false,
  };
}

/**
 * Fetch which artifact IDs the current user has sparked.
 * Used to hydrate the Hub UI on load.
 */
export async function fetchUserSparks(artifactIds: string[]): Promise<Set<string>> {
  if (!hasActiveSessionSync() || !supabase || artifactIds.length === 0) return new Set();

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return new Set();

  const { data, error } = await supabase
    .from('artifact_votes')
    .select('artifact_id')
    .eq('user_id', session.user.id)
    .in('artifact_id', artifactIds);

  if (error) return new Set();
  return new Set((data || []).map((r: { artifact_id: string }) => r.artifact_id));
}

/**
 * Increment view count for a public artifact (fire-and-forget).
 */
export async function incrementViews(artifactId: string): Promise<void> {
  if (!supabase) return;
  supabase.rpc('increment_artifact_views', { p_artifact_id: artifactId }).then();
}

// ─── Comments ────────────────────────────────────────────────

export async function fetchComments(artifactId: string): Promise<DbComment[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('artifact_comments')
    .select('*')
    .eq('artifact_id', artifactId)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('[ArtifactDb] fetchComments error:', error);
    return [];
  }
  return (data || []) as DbComment[];
}

export async function addComment(params: {
  artifactId: string;
  content: string;
  authorName: string;
}): Promise<DbComment | null> {
  if (!hasActiveSessionSync() || !supabase) return null;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const { data, error } = await supabase
    .from('artifact_comments')
    .insert({
      artifact_id: params.artifactId,
      user_id: session.user.id,
      author_name: params.authorName,
      content: params.content.trim(),
    })
    .select('*')
    .single();

  if (error) {
    console.warn('[ArtifactDb] addComment error:', error);
    return null;
  }
  return data as DbComment;
}

export async function deleteComment(commentId: string): Promise<boolean> {
  if (!hasActiveSessionSync() || !supabase) return false;

  const { error } = await supabase
    .from('artifact_comments')
    .delete()
    .eq('id', commentId);

  if (error) {
    console.warn('[ArtifactDb] deleteComment error:', error);
    return false;
  }
  return true;
}
