import { create } from 'zustand';
import { supabase, isSupabaseEnabled } from '../lib/supabase';
import type { AppUser } from '../services/auth';
import { getUser } from '../services/auth';
import { useChatStore } from './chatStore';
import { useCreditsStore } from './creditsStore';

let initPromise: Promise<void> | null = null;

interface AuthStore {
    user: AppUser | null;
    isLoading: boolean;
    isInitialized: boolean;
    isPasswordRecovery: boolean;
    sessionExpired: boolean;
    error: string | null;

    initialize: () => Promise<void>;
    signIn: (email: string, password: string) => Promise<string | null>;
    signUp: (email: string, password: string) => Promise<string | null>;
    signOut: () => Promise<void>;
    resetPasswordForEmail: (email: string) => Promise<string | null>;
    updatePassword: (password: string) => Promise<string | null>;
    clearError: () => void;
}

export const useAuthStore = create<AuthStore>()((set, get) => ({
    user: null,
    isLoading: true,
    isInitialized: false,
    isPasswordRecovery: false,
    sessionExpired: false,
    error: null,

    initialize: async () => {
        if (get().isInitialized) return;

        if (initPromise) {
            await initPromise;
            return;
        }

        initPromise = (async () => {
            if (!isSupabaseEnabled()) {
                // No Supabase = local-only mode, use stub user
                const user = await getUser();
                set({ user, isLoading: false, isInitialized: true });
                return;
            }

            // Check for existing session
            const user = await getUser();
            set({ user, isLoading: false, isInitialized: true });

            // Listen for auth changes (login/logout/token refresh/recovery)
            if (supabase) {
                supabase.auth.onAuthStateChange((event, session) => {
                    const prevUser = get().user;

                    if (event === 'PASSWORD_RECOVERY') {
                        set({ isPasswordRecovery: true });
                    }

                    if (event === 'SIGNED_OUT') {
                        if (prevUser) {
                            set({ sessionExpired: true });
                        }
                    }

                    if (session?.user) {
                        const appUser: AppUser = {
                            id: session.user.id,
                            email: session.user.email || '',
                            name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User',
                        };
                        set({ user: appUser });

                        // If user just logged in or this is the initial session restore on refresh
                        if (!prevUser || event === 'INITIAL_SESSION') {
                            syncDataOnLogin();
                        }
                    } else {
                        set({ user: null });
                    }
                });
            }
        })();

        try {
            await initPromise;
        } catch (err) {
            initPromise = null;
            throw err;
        }
    },

    signIn: async (email, password) => {
        set({ error: null, isLoading: true });

        if (!isSupabaseEnabled() || !supabase) {
            set({ isLoading: false, error: 'Supabase not configured' });
            return 'Supabase not configured';
        }

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            set({ isLoading: false, error: error.message });
            return error.message;
        }

        if (data.session && data.user) {
            const appUser: AppUser = {
                id: data.user.id,
                email: data.user.email || '',
                name: data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'User',
            };
            set({ user: appUser, isLoading: false });
            syncDataOnLogin();
        } else {
            // If email confirmation is enabled, signUp returns a user but NO session.
            // We must NOT log them in yet.
            set({ isLoading: false });
        }

        return null;
    },

    signUp: async (email, password) => {
        set({ error: null, isLoading: true });

        if (!isSupabaseEnabled() || !supabase) {
            set({ isLoading: false, error: 'Supabase not configured' });
            return 'Supabase not configured';
        }

        const { data, error } = await supabase.auth.signUp({ email, password });

        if (error) {
            set({ isLoading: false, error: error.message });
            return error.message;
        }

        if (data.session && data.user) {
            const appUser: AppUser = {
                id: data.user.id,
                email: data.user.email || '',
                name: data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'User',
            };
            set({ user: appUser, isLoading: false });
            syncDataOnLogin();
        } else {
            // If email confirmation is enabled, signUp returns a user but NO session.
            // We must NOT log them in yet.
            set({ isLoading: false });
        }

        return null;
    },

    signOut: async () => {
        if (!isSupabaseEnabled() || !supabase) return;

        // Clear user preemptively so SIGNED_OUT event doesn't trigger sessionExpired flag
        set({ user: null, sessionExpired: false });
        await supabase.auth.signOut();
        useChatStore.getState().clearChats();
    },

    resetPasswordForEmail: async (email) => {
        set({ error: null, isLoading: true });

        if (!isSupabaseEnabled() || !supabase) {
            set({ isLoading: false, error: 'Supabase not configured' });
            return 'Supabase not configured';
        }

        // Supabase will automatically send an email with the redirect link
        // which will trigger the PASSWORD_RECOVERY event when clicked
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin,
        });

        if (error) {
            set({ isLoading: false, error: error.message });
            return error.message;
        }

        set({ isLoading: false });
        return null;
    },

    updatePassword: async (password) => {
        set({ error: null, isLoading: true });

        if (!isSupabaseEnabled() || !supabase) {
            set({ isLoading: false, error: 'Supabase not configured' });
            return 'Supabase not configured';
        }

        const { error } = await supabase.auth.updateUser({ password });

        if (error) {
            set({ isLoading: false, error: error.message });
            return error.message;
        }

        set({ isLoading: false, isPasswordRecovery: false });
        return null;
    },

    clearError: () => set({ error: null }),
}));

/**
 * Sync local stores with Supabase after successful login.
 * Loads conversations and credits from the server.
 */
function syncDataOnLogin() {
    // Small delay to ensure auth state is propagated to session cache
    setTimeout(() => {
        useChatStore.getState().loadFromSupabase();
        useCreditsStore.getState().syncFromServer();
    }, 500);
}
