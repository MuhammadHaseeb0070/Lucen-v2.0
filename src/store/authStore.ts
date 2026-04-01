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
    /** Set to true after a successful OTP verify for type='recovery' — allows access to NewPasswordScreen */
    otpVerified: boolean;
    sessionExpired: boolean;
    error: string | null;

    initialize: () => Promise<void>;
    signIn: (email: string, password: string) => Promise<string | null>;
    signUp: (email: string, password: string) => Promise<string | null>;
    signOut: () => Promise<void>;
    /** Verify a 6-digit OTP code. type='signup' logs the user in. type='recovery' sets otpVerified=true. */
    verifyOtp: (email: string, token: string, type: 'signup' | 'recovery') => Promise<string | null>;
    /** Resend a 6-digit OTP code for either signup or password recovery */
    resendOtp: (email: string, type: 'signup' | 'recovery') => Promise<string | null>;
    resetPasswordForEmail: (email: string) => Promise<string | null>;
    updatePassword: (password: string) => Promise<string | null>;
    /** Sign out all other devices/sessions, keeping the current one active. */
    signOutOthers: () => Promise<string | null>;
    clearError: () => void;
    clearOtpVerified: () => void;
}

export const useAuthStore = create<AuthStore>()((set, get) => ({
    user: null,
    isLoading: true,
    isInitialized: false,
    otpVerified: false,
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

        // Note: No emailRedirectTo — we use OTP code, not magic links.
        // Supabase will email a 6-digit code automatically when email confirmations are enabled.
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
        });

        if (error) {
            set({ isLoading: false, error: error.message });
            return error.message;
        }

        if (data.session && data.user) {
            // Email confirmation is disabled — user is immediately logged in (shouldn't happen with OTP ON)
            const appUser: AppUser = {
                id: data.user.id,
                email: data.user.email || '',
                name: data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'User',
            };
            set({ user: appUser, isLoading: false });
            syncDataOnLogin();
        } else {
            // OTP email sent — caller should navigate to OTP verify screen
            set({ isLoading: false });
        }

        return null;
    },

    verifyOtp: async (email, token, type) => {
        set({ error: null, isLoading: true });

        if (!isSupabaseEnabled() || !supabase) {
            set({ isLoading: false, error: 'Supabase not configured' });
            return 'Supabase not configured';
        }

        const { data, error } = await supabase.auth.verifyOtp({ email, token, type });

        if (error) {
            set({ isLoading: false, error: error.message });
            return error.message;
        }

        if (type === 'recovery') {
            // For password recovery: session is established, set flag so NewPasswordScreen unlocks
            set({ isLoading: false, otpVerified: true });
            if (data.user) {
                const appUser: AppUser = {
                    id: data.user.id,
                    email: data.user.email || '',
                    name: data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'User',
                };
                set({ user: appUser });
            }
        } else {
            // type === 'signup': account confirmed, user is now logged in
            if (data.session && data.user) {
                const appUser: AppUser = {
                    id: data.user.id,
                    email: data.user.email || '',
                    name: data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'User',
                };
                set({ user: appUser, isLoading: false });
                syncDataOnLogin();
            } else {
                set({ isLoading: false });
            }
        }

        return null;
    },

    resendOtp: async (email, type) => {
        set({ error: null, isLoading: true });

        if (!isSupabaseEnabled() || !supabase) {
            set({ isLoading: false, error: 'Supabase not configured' });
            return 'Supabase not configured';
        }

        if (type === 'recovery') {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/auth/reset-password`,
            });
            if (error) {
                set({ isLoading: false, error: error.message });
                return error.message;
            }
        } else {
            const { error } = await supabase.auth.resend({
                type: 'signup',
                email,
            });
            if (error) {
                set({ isLoading: false, error: error.message });
                return error.message;
            }
        }

        set({ isLoading: false });
        return null;
    },

    signOut: async () => {
        if (!isSupabaseEnabled() || !supabase) return;

        // Clear user preemptively so SIGNED_OUT event doesn't trigger sessionExpired flag
        set({ user: null, sessionExpired: false, otpVerified: false });
        await supabase.auth.signOut();
        useChatStore.getState().clearChats();
    },

    resetPasswordForEmail: async (email) => {
        set({ error: null, isLoading: true });

        if (!isSupabaseEnabled() || !supabase) {
            set({ isLoading: false, error: 'Supabase not configured' });
            return 'Supabase not configured';
        }

        // redirectTo only used as a fallback for magic-link flow — OTP is the primary path now.
        // We still include it so if the user somehow gets a link, they land on the right page.
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/auth/reset-password`,
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

        // After password change, invalidate all other sessions for security
        await supabase.auth.signOut({ scope: 'others' });

        set({ isLoading: false, otpVerified: false });
        return null;
    },

    signOutOthers: async () => {
        set({ error: null, isLoading: true });

        if (!isSupabaseEnabled() || !supabase) {
            set({ isLoading: false, error: 'Supabase not configured' });
            return 'Supabase not configured';
        }

        const { error } = await supabase.auth.signOut({ scope: 'others' });

        if (error) {
            set({ isLoading: false, error: error.message });
            return error.message;
        }

        set({ isLoading: false });
        return null;
    },

    clearError: () => set({ error: null }),
    clearOtpVerified: () => set({ otpVerified: false }),
}));

/**
 * Sync local stores with Supabase after successful login.
 * Loads conversations and credits from the server.
 */
function syncDataOnLogin() {
    // Small delay to ensure auth state is propagated to session cache
    setTimeout(() => {
        useChatStore.getState().loadFromSupabase();

        // Detect post-checkout redirect (payment provider sends user back with this param).
        const url = new URL(window.location.href);
        const isPostCheckout = url.searchParams.has('subscription_updated');

        if (isPostCheckout) {
            // Clean up the URL parameter so it doesn't persist on refresh.
            url.searchParams.delete('subscription_updated');
            window.history.replaceState({}, '', url.toString());
            // Graduated retry: webhooks may still be processing when the user lands.
            useCreditsStore.getState().syncWithRetry();
        } else {
            useCreditsStore.getState().syncFromServer();
        }
    }, 500);
}
