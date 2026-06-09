import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { supabase, isSupabaseEnabled } from '../lib/supabase';
import type { AppUser } from '../services/auth';
import { getUser } from '../services/auth';
import * as Sentry from '@sentry/react';

let initPromise: Promise<void> | null = null;
let authSubscription: { unsubscribe: () => void } | null = null;

/** Cleanup function exposed for HMR / external lifecycle use. */
export function disposeAuthStore() {
    if (authSubscription) {
        authSubscription.unsubscribe();
        authSubscription = null;
    }
    initPromise = null;
}

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

export const useAuthStore = create<AuthStore>()(
    subscribeWithSelector((set, get) => ({
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
            try {
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
                    // Unsubscribe previous listener if present (e.g. after HMR)
                    if (authSubscription) {
                        authSubscription.unsubscribe();
                    }
                    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
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
                        } else {
                            set({ user: null });
                        }
                    });
                    authSubscription = subscription;
                }
            } catch (err) {
                Sentry.captureException(err, { tags: { area: 'auth', action: 'initPromise' } });
                console.error('Auth initialization error:', err);
                throw err;
            }
        })();

        try {
            await initPromise;
        } catch (err) {
            initPromise = null;
            Sentry.captureException(err, { tags: { area: 'auth', action: 'initialize' } });
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
        } else {
            // H3 fix: explicitly set isLoading false + error on unexpected response
            set({ isLoading: false, error: 'Unexpected response from server — no session or user returned. Please try again.' });
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
        } else {
            // OTP email sent — caller should navigate to OTP verify screen
            set({ isLoading: false });
        }

        return null;
    },

    verifyOtp: async (email, token, type) => {
        // H4 fix: reset otpVerified at START of every call to prevent sticky flag
        // from allowing access to NewPasswordScreen after a failed re-verification
        set({ error: null, isLoading: true, otpVerified: false });

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

        // M5 fix: wrap signOut in try/catch so user knows if it failed
        try {
            await supabase.auth.signOut({ scope: 'others' });
        } catch (signOutError) {
            const msg = signOutError instanceof Error ? signOutError.message : 'Failed to sign out other sessions';
            set({ isLoading: false, error: msg });
            return msg;
        }

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
})));
