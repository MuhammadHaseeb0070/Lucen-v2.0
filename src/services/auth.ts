// ============================================
// Supabase Auth — Real Implementation
// ============================================
// Wires up Supabase Auth for sign-in, sign-up, sign-out, and session management.
// Falls back to a local stub user if Supabase is not configured.

import { supabase, isSupabaseEnabled } from '../lib/supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';

export interface AppUser {
    id: string;
    email: string;
    name: string;
}

interface AuthResponse {
    user: AppUser | null;
    error: string | null;
}

// ─── Stub user for local-only mode ───
const STUB_USER: AppUser = {
    id: 'local-user',
    email: 'user@lucen.app',
    name: 'Lucen User',
};

/** Convert Supabase user to our AppUser format */
function toAppUser(su: SupabaseUser): AppUser {
    return {
        id: su.id,
        email: su.email || '',
        name: su.user_metadata?.full_name || su.email?.split('@')[0] || 'User',
    };
}

// ═══════════════════════════════════════════
//  AUTH METHODS
// ═══════════════════════════════════════════

export async function signIn(email: string, password: string): Promise<AuthResponse> {
    if (!isSupabaseEnabled() || !supabase) {
        return { user: STUB_USER, error: null };
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { user: null, error: error.message };
    if (!data.user) return { user: null, error: 'Sign in failed' };
    return { user: toAppUser(data.user), error: null };
}

export async function signUp(email: string, password: string): Promise<AuthResponse> {
    if (!isSupabaseEnabled() || !supabase) {
        return { user: STUB_USER, error: null };
    }

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { user: null, error: error.message };
    if (!data.user) return { user: null, error: 'Sign up failed' };
    return { user: toAppUser(data.user), error: null };
}

export async function signOut(): Promise<void> {
    if (!isSupabaseEnabled() || !supabase) return;
    await supabase.auth.signOut();
}

export async function getUser(): Promise<AppUser | null> {
    if (!isSupabaseEnabled() || !supabase) return STUB_USER;

    const { data: { user } } = await supabase.auth.getUser();
    return user ? toAppUser(user) : null;
}

export async function getSession(): Promise<string | null> {
    if (!isSupabaseEnabled() || !supabase) return null;

    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
}

/** Listen for auth state changes (login, logout, token refresh) */
export function onAuthStateChange(
    callback: (user: AppUser | null) => void
): (() => void) | undefined {
    if (!isSupabaseEnabled() || !supabase) return undefined;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        callback(session?.user ? toAppUser(session.user) : null);
    });

    return () => subscription.unsubscribe();
}
