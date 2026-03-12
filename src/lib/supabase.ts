// ============================================
// Supabase Client — Singleton
// ============================================
// Single instance used across the app.
// Reads URL and anon key from environment variables.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
        '[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env. ' +
        'Supabase features will be disabled. The app will fall back to local-only mode.'
    );
}

export const supabase = supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

/** Check if Supabase is configured and available */
export function isSupabaseEnabled(): boolean {
    return supabase !== null;
}

/**
 * Check if there is an active authenticated session.
 * All database operations should use this instead of just isSupabaseEnabled()
 * to avoid 401/RLS errors when no user is logged in.
 */
let _cachedSession: boolean = false;

export async function hasActiveSession(): Promise<boolean> {
    if (!supabase) return false;
    const { data: { session } } = await supabase.auth.getSession();
    _cachedSession = !!session;
    return _cachedSession;
}

/** Synchronous check using cached session state (fast, for use in sync code) */
export function hasActiveSessionSync(): boolean {
    return supabase !== null && _cachedSession;
}

// Initialize session cache on load
if (supabase) {
    supabase.auth.getSession().then(({ data: { session } }) => {
        _cachedSession = !!session;
    });
    supabase.auth.onAuthStateChange((_event, session) => {
        _cachedSession = !!session;
    });
}
