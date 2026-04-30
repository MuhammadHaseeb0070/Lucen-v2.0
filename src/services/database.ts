// ============================================
// Database Service — Supabase Data Access Layer
// ============================================
// Wraps all Supabase queries for conversations, messages, and credits.
// Each function checks if Supabase is enabled; if not, returns null
// so callers can fall back to localStorage.

import { supabase, hasActiveSessionSync, ensureFreshSession } from '../lib/supabase';
import type { Conversation, Message } from '../types';

// ═══════════════════════════════════════════
//  CONVERSATIONS
// ═══════════════════════════════════════════

export interface DbConversation {
    id: string;
    user_id: string;
    title: string;
    title_auto?: boolean;
    created_at: string;
    updated_at: string;
}

/** Fetch all conversations for the current user, newest first */
export async function fetchConversations(): Promise<Conversation[] | null> {
    if (!hasActiveSessionSync() || !supabase) return null;

    const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('[DB] fetchConversations error:', error);
        return null;
    }

    return (data as DbConversation[]).map(dbToConversation);
}

/** Create a new conversation and return its ID */
export async function createConversation(id: string, title: string): Promise<boolean> {
    if (!hasActiveSessionSync() || !supabase) return false;

    const { error } = await supabase
        .from('conversations')
        .upsert({ id, title, title_auto: true });

    if (error) {
        console.error('[DB] createConversation error:', error);
        return false;
    }
    return true;
}

/** Delete a conversation (cascade deletes its messages) */
export async function deleteConversation(id: string): Promise<boolean> {
    if (!hasActiveSessionSync() || !supabase) return false;

    const { error } = await supabase
        .from('conversations')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('[DB] deleteConversation error:', error);
        return false;
    }
    return true;
}

/**
 * Rename a conversation. When `manual` is true (default) we also flip
 * `title_auto` to false so the AI title generator stops overriding a
 * human-picked title. Pass `manual: false` from the title generator itself
 * so it can update the title without locking out future improvements
 * (the server-side generate-title function also guards on title_auto=true).
 */
export async function renameConversation(id: string, title: string, manual: boolean = true): Promise<boolean> {
    if (!hasActiveSessionSync() || !supabase) return false;

    const update: Record<string, unknown> = { title };
    if (manual) update.title_auto = false;

    const { error } = await supabase
        .from('conversations')
        .update(update)
        .eq('id', id);

    if (error) {
        console.error('[DB] renameConversation error:', error);
        return false;
    }
    return true;
}

// ═══════════════════════════════════════════
//  MESSAGES
// ═══════════════════════════════════════════

export interface DbMessage {
    id: string;
    conversation_id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    reasoning?: string;
    is_truncated: boolean;
    is_pinned: boolean;
    attachments?: Record<string, unknown>[];
    created_at: string;
}

/** Fetch all messages for a conversation, ordered by creation time */
export async function fetchMessages(conversationId: string): Promise<Message[] | null> {
    if (!hasActiveSessionSync() || !supabase) return null;

    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('[DB] fetchMessages error:', error);
        return null;
    }

    const messages = (data as DbMessage[]).map(dbToMessage);

    // Stable order: `created_at` + tie-break (user before assistant) — fixes
    // same-ms inserts. Also corrects the historical race where the assistant
    // streaming row was committed before the user row (inverted first pair).
    messages.sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        const rank = (r: string) => (r === 'user' ? 0 : r === 'assistant' ? 1 : 2);
        return rank(a.role) - rank(b.role);
    });
    if (
        messages.length >= 2
        && messages[0].role === 'assistant'
        && messages[1].role === 'user'
        && messages[1].timestamp - messages[0].timestamp < 5 * 60_000
    ) {
        [messages[0], messages[1]] = [messages[1], messages[0]];
    }

    // ─── PART 3: Restore file context from file_attachments table ───
    const { data: attachmentData, error: attachmentError } = await supabase
        .from('file_attachments')
        .select('*')
        .eq('conversation_id', conversationId);

    if (attachmentError) {
        console.error('[DB] fetchMessages file_attachments error:', attachmentError);
        return messages;
    }

    if (attachmentData && attachmentData.length > 0) {
        // Group by message_id
        const attachmentMap: Record<string, any[]> = {};
        for (const row of attachmentData) {
            if (!attachmentMap[row.message_id]) attachmentMap[row.message_id] = [];
            attachmentMap[row.message_id].push(row);
        }

        // Merge back into messages
        for (const msg of messages) {
            const rowAttachments = attachmentMap[msg.id];
            if (rowAttachments && msg.attachments) {
                // Map stored text back to existing attachment objects (matched by name)
                msg.attachments = msg.attachments.map((existing) => {
                    const matched = rowAttachments.find((a) => a.file_name === existing.name);
                    if (matched) {
                        return {
                            ...existing,
                            textContent: matched.extracted_text || matched.ai_description || undefined,
                            // ─── Task 3: Restore Source from Storage ───
                            // If a storage path exists, generate its public URL and use it as dataUrl.
                            // This ensures the UI can render historical images correctly.
                            storagePath: matched.storage_path || null,
                            dataUrl: matched.storage_path && supabase ? 
                                supabase.storage.from('attachments').getPublicUrl(matched.storage_path).data.publicUrl : undefined,
                            aiDescription: matched.ai_description || null,
                            tokenEstimate: matched.token_estimate || null,
                        };
                    }
                    return existing;
                });
            }
        }
    }

    return messages;
}

/** Save a single message to the database */
export async function saveMessage(
    conversationId: string,
    message: Message
): Promise<boolean> {
    if (!hasActiveSessionSync() || !supabase) return false;

    const { error } = await supabase
        .from('messages')
        .insert({
            id: message.id,
            conversation_id: conversationId,
            role: message.role,
            content: message.content,
            reasoning: message.reasoning || null,
            is_truncated: message.isTruncated || false,
            is_pinned: message.isPinned || false,
            is_streaming: message.isStreaming || false,
            // Save attachment metadata only (no file content)
            attachments: message.attachments?.map(({ textContent: _t, dataUrl: _d, ...rest }) => rest) || null,
        });

    if (error) {
        console.error('[DB] saveMessage error:', error);
        return false;
    }

    // ─── PART 3: Save individual attachments to file_attachments table ───
    if (message.attachments && message.attachments.length > 0) {
        const attachmentRows = message.attachments.map((a) => ({
            message_id: message.id,
            conversation_id: conversationId,
            file_name: a.name,
            file_type: a.type,
            storage_path: a.storagePath || null,
            extracted_text: a.textContent || null,
            ai_description: a.aiDescription || null,
            token_estimate: a.tokenEstimate || (a.textContent || a.aiDescription ? Math.ceil(((a.textContent || a.aiDescription)?.length || 0) / 4) : null),
        }));

        const { error: attachError } = await supabase
            .from('file_attachments')
            .insert(attachmentRows);

        if (attachError) {
            console.error('[DB] saveMessage file_attachments error:', attachError);
            // We don't return false because the main message was saved
        }
    }

    // Update conversation updated_at
    const { error: convError } = await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);

    if (convError) {
        console.error('[DB] saveMessage update conversation updated_at error:', convError);
    }

    return true;
}

/** Update an existing message (e.g., after streaming completes) */
export async function updateMessageInDb(
    messageId: string,
    updates: Partial<Pick<Message, 'content' | 'reasoning' | 'isTruncated' | 'isStreaming'>>
): Promise<boolean> {
    if (!hasActiveSessionSync() || !supabase) return false;

    const dbUpdates: Record<string, unknown> = {};
    if (updates.content !== undefined) dbUpdates.content = updates.content;
    if (updates.reasoning !== undefined) dbUpdates.reasoning = updates.reasoning;
    if (updates.isTruncated !== undefined) dbUpdates.is_truncated = updates.isTruncated;
    if (updates.isStreaming !== undefined) dbUpdates.is_streaming = updates.isStreaming;

    const { error } = await supabase
        .from('messages')
        .update(dbUpdates)
        .eq('id', messageId);

    if (error) {
        console.error('[DB] updateMessage error:', error);
        return false;
    }
    return true;
}

/**
 * Upsert a streaming assistant message.
 *
 * Used during mid-stream persistence (every MIDSTREAM_PERSIST_MS). The first
 * call inserts the row (so it survives a page reload) and subsequent calls
 * update it in place. Safe to call in a throttled loop — the trigger on
 * `messages` takes care of `updated_at`.
 */
export async function upsertStreamingMessage(
    conversationId: string,
    message: Message,
): Promise<boolean> {
    if (!hasActiveSessionSync() || !supabase) return false;

    const { error } = await supabase
        .from('messages')
        .upsert(
            {
                id: message.id,
                conversation_id: conversationId,
                role: message.role,
                content: message.content,
                reasoning: message.reasoning || null,
                is_truncated: message.isTruncated || false,
                is_pinned: message.isPinned || false,
                is_streaming: message.isStreaming === true,
                attachments:
                    message.attachments?.map(({ textContent: _t, dataUrl: _d, ...rest }) => rest) ||
                    null,
            },
            { onConflict: 'id' },
        );

    if (error) {
        console.error('[DB] upsertStreamingMessage error:', error);
        return false;
    }
    return true;
}

/** Delete a user message and its following assistant response */
export async function deleteMessagePair(
    conversationId: string,
    userMessageId: string,
    assistantMessageId?: string
): Promise<boolean> {
    if (!hasActiveSessionSync() || !supabase) return false;

    const idsToDelete = [userMessageId];
    if (assistantMessageId) idsToDelete.push(assistantMessageId);

    const { error } = await supabase
        .from('messages')
        .delete()
        .eq('conversation_id', conversationId)
        .in('id', idsToDelete);

    if (error) {
        console.error('[DB] deleteMessagePair error:', error);
        return false;
    }
    return true;
}

/** Toggle pinning state for a message */
export async function updateMessagePin(
    messageId: string,
    isPinned: boolean
): Promise<boolean> {
    if (!hasActiveSessionSync() || !supabase) return false;

    const { error } = await supabase
        .from('messages')
        .update({ is_pinned: isPinned })
        .eq('id', messageId);

    if (error) {
        console.error('[DB] updateMessagePin error:', error);
        return false;
    }
    return true;
}

// ═══════════════════════════════════════════
//  CREDITS
// ═══════════════════════════════════════════

export interface ActiveLedger {
    id: string;
    subscription_id: string | null;
    plan_name: string;
    initial_amount: number;
    remaining_amount: number;
    valid_from: string;
    expires_at: string;
}

/** Fetch credit balance and subscription fields from server */
export async function fetchCredits(): Promise<{
    remaining: number;
    used: number;
    billingCycleUsage: number;
    subscriptionStatus: string;
    subscriptionPlan: 'free' | 'regular' | 'pro';
    customerPortalUrl: string | null;
    renewsAt: string | null;
    ledgers: ActiveLedger[];
} | null> {
    if (!hasActiveSessionSync() || !supabase) return null;
    if (!(await ensureFreshSession())) return null;

    const { data, error } = await supabase.functions.invoke('deduct-credits', {
        body: { action: 'get-balance' },
    });

    if (error) {
        console.error('[DB] fetchCredits error:', error);
        return null;
    }
    if (!data || data.remaining_credits == null) return null;

    const rawPlan = String((data as { subscription_plan?: string }).subscription_plan || 'free').toLowerCase();
    const subscriptionPlan =
        rawPlan === 'pro' || rawPlan === 'regular' ? rawPlan : 'free';

    return {
        remaining: data.remaining_credits,
        used: data.total_used ?? 0,
        billingCycleUsage: data.billing_cycle_usage ?? 0,
        subscriptionStatus: String((data as { subscription_status?: string }).subscription_status || 'free'),
        subscriptionPlan,
        customerPortalUrl: (data as { lemon_squeezy_customer_portal_url?: string }).lemon_squeezy_customer_portal_url || null,
        renewsAt: (data as { subscription_renews_at?: string }).subscription_renews_at || null,
        ledgers: (data as any).ledgers || [],
    };
}

/** Deduct credits via Edge Function (server-authoritative) */
export async function deductCredits(amount: number): Promise<{ remaining: number; used: number } | null> {
    if (!hasActiveSessionSync() || !supabase) return null;
    if (!(await ensureFreshSession())) return null;

    const { data, error } = await supabase.functions.invoke('deduct-credits', {
        body: { action: 'deduct', amount },
    });

    if (error) {
        console.error('[DB] deductCredits error:', error);
        return null;
    }
    if (!data || data.remaining_credits == null) return null;

    return {
        remaining: data.remaining_credits,
        used: data.total_used ?? 0,
    };
}

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

function dbToConversation(row: DbConversation): Conversation {
    return {
        id: row.id,
        title: row.title,
        // Default to true if the column is missing (pre-migration rows) so the
        // title generator can still improve the title on the next exchange.
        titleAuto: row.title_auto !== false,
        messages: [], // Messages loaded separately on demand
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
    };
}

function dbToMessage(row: DbMessage): Message {
    return {
        id: row.id,
        role: row.role,
        content: row.content,
        reasoning: row.reasoning,
        timestamp: new Date(row.created_at).getTime(),
        isTruncated: row.is_truncated,
        isPinned: row.is_pinned,
        // Restore attachment metadata (no file content — that's transient)
        attachments: row.attachments?.map((a: Record<string, unknown>) => ({
            id: a.id as string,
            name: a.name as string,
            type: a.type as 'image' | 'pdf' | 'csv' | 'text',
            mimeType: a.mimeType as string,
            size: a.size as number,
        })),
    };
}

// ═══════════════════════════════════════════
//  SEARCH
// ═══════════════════════════════════════════

export interface SearchResult {
    conversationId: string;
    title: string;
    updatedAt: number;
    matchExcerpt: string;
}

/** Search conversations and messages using Full-Text Search */
export async function searchConversations(query: string): Promise<SearchResult[] | null> {
    if (!hasActiveSessionSync() || !supabase) return null;
    if (!query || query.trim() === '') return [];

    try {
        const { data, error } = await supabase.rpc('search_chat_history', {
            search_query: query,
        });

        if (error) {
            console.error('[DB] searchConversations error:', error);
            // Return null so the UI can gracefully show a fallback instead of crashing
            return null;
        }

        return (data || []).map((row: any) => ({
            conversationId: row.conversation_id,
            title: row.title,
            updatedAt: new Date(row.updated_at).getTime(),
            matchExcerpt: row.match_excerpt || '',
        }));
    } catch (err) {
        console.error('[DB] searchConversations exception:', err);
        return null;
    }
}
