import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquarePlus, Settings, LogOut, User, ChevronDown, Menu } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import { useCreditsStore } from '../store/creditsStore';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import Logo from './Logo';
import { planLabel, LC, formatLC } from '../config/subscriptionConfig';

const Navbar: React.FC = () => {
    const { sideChatOpen, toggleSideChat, sidebarCollapsed, toggleSidebar, setBillingOpen } = useUIStore();
    const { remainingCredits, isLoading: creditsLoading, subscriptionPlan } = useCreditsStore();
    const { toggleSettings } = useThemeStore();
    const { user, signOut } = useAuthStore();
    const [profileOpen, setProfileOpen] = useState(false);
    const profileRef = useRef<HTMLDivElement>(null);

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

    const openPlans = () => setBillingOpen(true);

    const balanceText = creditsLoading
        ? '…'
        : formatLC(remainingCredits);

    return (
        <nav className="navbar">
            <div className="navbar-left">
                <button
                    className="mobile-menu-btn"
                    onClick={toggleSidebar}
                    title={sidebarCollapsed ? 'Open menu' : 'Close menu'}
                >
                    <Menu size={20} />
                </button>
                <Link className="navbar-brand" to="/">
                    <span className="navbar-brand-mark">
                        <Logo size={20} className="brand-icon" />
                    </span>
                    <span className="navbar-brand-wordmark">Lucen</span>
                </Link>
            </div>

            <div className="navbar-right">
                {user ? (
                    <button
                        type="button"
                        className="billing-nav-pill"
                        onClick={openPlans}
                        title={`${planLabel(subscriptionPlan)} · ${balanceText} ${LC.unit} (open plans)`}
                    >
                        <Logo size={17} className="billing-nav-pill__logo" aria-hidden />
                        <span className="billing-nav-pill__text">
                            <span className="billing-nav-pill__plan">{planLabel(subscriptionPlan)}</span>
                            <span className="billing-nav-pill__sep" aria-hidden>
                                ·
                            </span>
                            <span className="billing-nav-pill__balance">{balanceText}</span>
                            <span className="billing-nav-pill__unit">{LC.unit}</span>
                        </span>
                    </button>
                ) : (
                    <button type="button" className="billing-nav-pill billing-nav-pill--guest" onClick={openPlans}>
                        <Logo size={17} className="billing-nav-pill__logo" aria-hidden />
                        <span className="billing-nav-pill__text">Plans</span>
                    </button>
                )}

                <button
                    className={`side-chat-toggle ${sideChatOpen ? 'active' : ''}`}
                    onClick={toggleSideChat}
                    title={sideChatOpen ? 'Close side chat' : 'Open side chat'}
                >
                    <MessageSquarePlus size={18} />
                    <span className="toggle-label">Side Chat</span>
                </button>

                <button className="settings-btn" onClick={toggleSettings} title="Settings">
                    <Settings size={18} />
                </button>

                {user && (
                    <div className="navbar-profile" ref={profileRef}>
                        <button
                            className="profile-btn"
                            onClick={() => setProfileOpen(!profileOpen)}
                            title={user.email}
                        >
                            <div className="profile-avatar">{user.name.charAt(0).toUpperCase()}</div>
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
                                <button
                                    type="button"
                                    className="profile-dropdown__item"
                                    onClick={() => {
                                        setProfileOpen(false);
                                        openPlans();
                                    }}
                                >
                                    <Logo size={14} className="profile-dropdown__item-logo" />
                                    Plans & balance
                                </button>
                                <button className="profile-dropdown__item profile-dropdown__signout" onClick={handleSignOut}>
                                    <LogOut size={14} />
                                    Sign out
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
