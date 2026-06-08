// ===== Zustand Store Orchestration =====
// Handles cross-store side effects and event subscriptions to decouple
// state stores from direct dependencies on each other.

import { useAuthStore } from './authStore';
import { useChatStore } from './chatStore';
import { useThemeStore, clearThemeSyncTimer } from './themeStore';
import { useCreditsStore } from './creditsStore';
import { useWorkspaceSessionStore } from './workspaceSessionStore';
import { useArtifactStore } from './artifactStore';
import { initializeModelConfig } from '../config/models';
import { fetchUserSettingsRow } from '../services/userSettings';
import { resetParseWorker } from '../workers/artifactParseWorkerClient';

let syncInFlight: Promise<void> | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Sync local stores with Supabase after successful login.
 * Loads conversations and credits from the server.
 */
function syncDataOnLogin() {
    // H2 fix: deduplicate — only one sync at a time
    if (syncInFlight) return;

    // Cancel any previously pending timer
    if (syncTimer !== null) {
        clearTimeout(syncTimer);
        syncTimer = null;
    }

    syncInFlight = new Promise<void>((resolve) => {
        // Small delay to ensure auth state is propagated to session cache
        syncTimer = setTimeout(async () => {
            syncTimer = null;
            try {
                // Trigger chat store to load conversations
                await useChatStore.getState().loadFromSupabase();
                initializeModelConfig();

                // Hydrate theme settings
                const row = await fetchUserSettingsRow();
                if (row) {
                    useThemeStore.getState().hydrateFromServerRow(row);
                }

                // Detect post-checkout redirect (payment provider sends user back with this param).
                const url = new URL(window.location.href);
                const isPostCheckout = url.searchParams.has('subscription_updated');

                if (isPostCheckout) {
                    // Clean up the URL parameter so it doesn't persist on refresh.
                    url.searchParams.delete('subscription_updated');
                    window.history.replaceState({}, '', url.toString());
                    // Graduated retry: webhooks may still be processing when the user lands.
                    await useCreditsStore.getState().syncWithRetry();
                } else {
                    await useCreditsStore.getState().syncFromServer();
                }
            } catch (err) {
                console.error('[Orchestration] syncDataOnLogin failed:', err);
            } finally {
                syncInFlight = null;
                resolve();
            }
        }, 500);
    });
}

// 1. Subscribe to auth store changes
let prevUser: any = null;

useAuthStore.subscribe(
    (state) => state.user,
    (user) => {
        if (user && (!prevUser || prevUser.id !== user.id)) {
            // User logged in / session restored or user changed
            syncDataOnLogin();
        } else if (!user && prevUser) {
            // User signed out, clean up local data
            useChatStore.getState().clearChats();
            clearThemeSyncTimer();
            // Cancel any pending login sync timer
            if (syncTimer !== null) {
                clearTimeout(syncTimer);
                syncTimer = null;
            }
            syncInFlight = null;
        }
        prevUser = user;
    }
);

// 2. Subscribe to artifact store changes (BUG-10: Reset worker and log state on focus change)
useArtifactStore.subscribe(
    (state) => state.activeArtifact?.id,
    (activeId, prevId) => {
        if (activeId !== prevId) {
            // Terminate any running workers
            resetParseWorker();
            // Clear logs and execution status
            useWorkspaceSessionStore.getState().resetWorkspaceSession();
        }
    }
);

// Export a dummy initializer to force module evaluation on startup
export function initOrchestrator() {
    // Module evaluation sets up the subscribers above
}
