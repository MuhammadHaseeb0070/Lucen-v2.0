import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquarePlus, Coins, Settings, LogOut, User, ChevronDown, Menu } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { useCreditsStore } from '../store/creditsStore';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import Logo from './Logo';

const Navbar: React.FC = () => {
    const { sideChatOpen, toggleSideChat, sidebarCollapsed, toggleSidebar } = useUIStore();
    const { getFormattedCredits } = useCreditsStore();
    const { toggleSettings } = useThemeStore();
    const { user, signOut } = useAuthStore();
    const [profileOpen, setProfileOpen] = useState(false);
    const profileRef = useRef<HTMLDivElement>(null);

    // Close profile dropdown on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
                setProfileOpen(false);
            }
        };
        if (profileOpen) document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [profileOpen]);

    const handleSignOut = async () => {
        setProfileOpen(false);
        await signOut();
    };

    return (
        <nav className="navbar">
            <div className="navbar-left">
                <button
                    className="mobile-menu-btn"
                    onClick={toggleSidebar}
                    title={sidebarCollapsed ? "Open menu" : "Close menu"}
                >
                    <Menu size={20} />
                </button>
                <Link className="navbar-brand" to="/">
                    <Logo size={20} className="brand-icon" />
                    Lucen
                </Link>
            </div>


            <div className="navbar-right">
                <div className="credits-display" title="Remaining credits">
                    <Coins size={16} />
                    <span>{getFormattedCredits()}</span>
                </div>

                <button
                    className={`side-chat-toggle ${sideChatOpen ? 'active' : ''}`}
                    onClick={toggleSideChat}
                    title={sideChatOpen ? 'Close side chat' : 'Open side chat'}
                >
                    <MessageSquarePlus size={18} />
                    <span className="toggle-label">Side Chat</span>
                </button>

                <button
                    className="settings-btn"
                    onClick={toggleSettings}
                    title="Settings"
                >
                    <Settings size={18} />
                </button>

                {/* User profile */}
                {user && (
                    <div className="navbar-profile" ref={profileRef}>
                        <button
                            className="profile-btn"
                            onClick={() => setProfileOpen(!profileOpen)}
                            title={user.email}
                        >
                            <div className="profile-avatar">
                                {user.name.charAt(0).toUpperCase()}
                            </div>
                            <ChevronDown size={12} className={`profile-chevron ${profileOpen ? 'open' : ''}`} />
                        </button>

                        {profileOpen && (
                            <div className="profile-dropdown">
                                <div className="profile-dropdown__header">
                                    <User size={14} />
                                    <div>
                                        <div className="profile-dropdown__name">{user.name}</div>
                                        <div className="profile-dropdown__email">{user.email}</div>
                                    </div>
                                </div>
                                <div className="profile-dropdown__divider" />
                                <button className="profile-dropdown__item profile-dropdown__signout" onClick={handleSignOut}>
                                    <LogOut size={14} />
                                    Sign Out
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </nav>
    );
};

export default Navbar;
