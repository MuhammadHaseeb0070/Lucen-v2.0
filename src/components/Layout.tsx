import React, { useEffect, useState, useCallback } from 'react';
import Navbar from './Navbar';
import Sidebar from './Sidebar';
import ChatArea from './ChatArea';
import ArtifactWorkspace from './ArtifactWorkspace';
import SideChatPanel from './SideChatPanel';
import SettingsScreen from './SettingsScreen';
import CommandPalette from './CommandPalette';
import AuthScreen from './AuthScreen';
import PricingModal from './PricingModal';
import FileLibrary from './FileLibrary';

import OwnerDashboard from './OwnerDashboard';
import { useThemeStore, applyTheme } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import { useUIStore } from '../store/uiStore';
import { useArtifactStore } from '../store/artifactStore';
import { isSupabaseEnabled } from '../lib/supabase';
import { isAdminUser } from '../config/admin';
import { Loader2, AlertCircle } from 'lucide-react';

const Layout: React.FC = () => {
    const { getActiveTheme } = useThemeStore();
    const { user, isLoading, isInitialized, sessionExpired, initialize } = useAuthStore();
    const { setIsAdminView, isAdminView, sidebarCollapsed, toggleSidebar } = useUIStore();
    const activeArtifact = useArtifactStore((s) => s.activeArtifact);
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

    // Initialize auth on mount
    useEffect(() => {
        initialize();
    }, [initialize]);




    // Collapse sidebar on mobile on first load
    useEffect(() => {
        if (window.innerWidth <= 768 && !sidebarCollapsed) {
            toggleSidebar();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Admin Redirect Logic: If user is admin and not in admin view, switch to it automatically
    useEffect(() => {
        if (user && isAdminUser(user.email)) {
            if (!isAdminView) {
                setIsAdminView(true);
            }
        }
    }, [user, isAdminView, setIsAdminView]);

    // Apply theme on mount and when theme changes
    useEffect(() => {
        const theme = getActiveTheme();
        applyTheme(theme);
    });

    // Global Ctrl+K / Cmd+K listener
    const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            setCommandPaletteOpen((prev) => !prev);
        }
    }, []);

    useEffect(() => {
        document.addEventListener('keydown', handleGlobalKeyDown);
        return () => document.removeEventListener('keydown', handleGlobalKeyDown);
    }, [handleGlobalKeyDown]);

    // Loading state while checking session
    if (isLoading && !isInitialized) {
        return (
            <div className="auth-loading">
                <Loader2 size={32} className="auth-spinner" />
                <span>Loading Lucen...</span>
            </div>
        );
    }

    // Intercept layout if session has unexpectedly expired
    if (sessionExpired) {
        return (
            <div className="auth-screen">
                <div className="auth-container" style={{ textAlign: 'center', padding: '48px 32px' }}>
                    <div className="auth-logo" style={{ margin: '0 auto 24px', background: 'var(--danger)', color: 'white' }}>
                        <AlertCircle size={32} />
                    </div>
                    <h2 className="auth-title" style={{ marginBottom: '12px' }}>Session Expired</h2>
                    <p className="auth-subtitle" style={{ marginBottom: '32px' }}>
                        Your authentication session has expired or you signed in from another device. For your security, please sign in again.
                    </p>
                    <button
                        className="auth-submit"
                        style={{ marginTop: 'auto', background: 'var(--accent)', color: 'white' }}
                        onClick={() => window.location.reload()}
                    >
                        Return to Login
                    </button>
                </div>
            </div>
        );
    }


    // If Supabase is configured but no user → show auth screen
    if (isSupabaseEnabled() && !user) {
        return <AuthScreen />;
    }

    // Main app layout
    return (
        <div className="app-layout">
            <Navbar />
            <div className={`app-body ${activeArtifact ? 'app-body--workspace-open' : ''}`}>
                <Sidebar />
                {!sidebarCollapsed && (
                    <div className="sidebar-overlay" onClick={toggleSidebar} />
                )}
                <div className="chat-workspace-container">
                    {isAdminView ? <OwnerDashboard /> : <ChatArea />}
                    <ArtifactWorkspace />
                </div>
            </div>
            <SideChatPanel />
            <SettingsScreen />
            <PricingModal />
            <FileLibrary />
            <CommandPalette
                isOpen={commandPaletteOpen}
                onClose={() => setCommandPaletteOpen(false)}
            />
        </div>
    );
};

export default Layout;
