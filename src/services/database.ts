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
        .upsert({ id, title });

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

/** Rename a conversation */
export async function renameConversation(id: string, title: string): Promise<boolean> {
    if (!hasActiveSessionSync() || !supabase) return false;

    const { error } = await supabase
        .from('conversations')
        .update({ title })
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

    return (data as DbMessage[]).map(dbToMessage);
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
            // Save attachment metadata only (no file content)
            attachments: message.attachments?.map(({ textContent: _t, dataUrl: _d, ...rest }) => rest) || null,
        });

    if (error) {
        console.error('[DB] saveMessage error:', error);
        return false;
    }
    return true;
}

/** Update an existing message (e.g., after streaming completes) */
export async function updateMessageInDb(
    messageId: string,
    updates: Partial<Pick<Message, 'content' | 'reasoning' | 'isTruncated'>>
): Promise<boolean> {
    if (!hasActiveSessionSync() || !supabase) return false;

    const dbUpdates: Record<string, unknown> = {};
    if (updates.content !== undefined) dbUpdates.content = updates.content;
    if (updates.reasoning !== undefined) dbUpdates.reasoning = updates.reasoning;
    if (updates.isTruncated !== undefined) dbUpdates.is_truncated = updates.isTruncated;

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
