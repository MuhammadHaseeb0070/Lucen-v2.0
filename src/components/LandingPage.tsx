import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    ArrowRight,
    Sparkles,
    Zap,
    Shield,
    Palette
} from 'lucide-react';
import Logo from './Logo';
import { useAuthStore } from '../store/authStore';
import { useThemeStore, THEME_PRESETS, applyTheme } from '../store/themeStore';
import type { ThemePreset } from '../store/themeStore';
import { Check } from 'lucide-react';

// Isolated inline ThemeCard for the Landing Page to avoid cyclic dependencies or SettingsScreen imports
const LandingThemeCard: React.FC<{ preset: ThemePreset; isActive: boolean; onClick: () => void }> = ({
    preset,
    isActive,
    onClick,
}) => {
    const c = preset.colors;
    return (
        <button
            className={`theme-card ${isActive ? 'theme-card--active' : ''}`}
            onClick={onClick}
            style={{ 
                all: 'unset', 
                boxSizing: 'border-box',
                display: 'flex', 
                flexDirection: 'column', 
                gap: '8px',
                padding: '12px',
                background: 'var(--bg-surface)',
                border: isActive ? `2px solid var(--accent)` : `1px solid var(--divider)`,
                borderRadius: '16px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                position: 'relative',
                width: '100%'
            }}
        >
            <div style={{ background: c.bgBase, borderRadius: '8px', overflow: 'hidden', border: `1px solid var(--divider)` }}>
                <div style={{ background: c.bgSurface, borderBottom: `1px solid ${c.divider}`, padding: '6px', display: 'flex', gap: '4px' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.accent }} />
                    <span style={{ flex: 1, height: 6, borderRadius: 2, background: c.textTertiary }} />
                </div>
                <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ width: '65%', height: 8, borderRadius: 4, alignSelf: 'flex-end', background: c.userBubbleBg }} />
                    <div style={{ width: '75%', height: 12, borderRadius: 4, background: c.aiBubbleBg, border: `1px solid ${c.aiBubbleBorder}` }} />
                </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', fontSize: '0.9rem', fontWeight: 600 }}>
                <span>{preset.emoji} {preset.name}</span>
                {isActive && <Check size={14} color="var(--accent)" />}
            </div>
        </button>
    );
};

const LandingPage: React.FC = () => {
    const { user, signOut } = useAuthStore();
    const { activeThemeId, setTheme } = useThemeStore();
    const navigate = useNavigate();

    const handleThemeSelect = (id: string) => {
        setTheme(id);
        const preset = THEME_PRESETS.find((t) => t.id === id);
        if (preset) applyTheme(preset);
    };

    const showcaseThemes = THEME_PRESETS.slice(0, 4); // Show top 4 themes

    const handleLogout = async () => {
        await signOut();
    };

    return (
        <div className="landing-page">
            <div className="landing-container">
                
                {/* ─── Header ─── */}
                <header className="landing-header">
                    <Link className="landing-brand" to="/">
                        <div className="landing-brand-mark"><Logo size={20} /></div>
                        <span>Lucen</span>
                    </Link>

                    <nav className="landing-nav">
                        {user ? (
                            <>
                                <button className="landing-nav-link" onClick={handleLogout} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                                    Log out
                                </button>
                                <Link className="landing-btn landing-btn--primary" to="/chat">
                                    Go to Chat <ArrowRight size={16} />
                                </Link>
                            </>
                        ) : (
                            <>
                                <Link className="landing-nav-link" to="/chat?mode=signin">Log in</Link>
                                <Link className="landing-btn landing-btn--primary" to="/chat?mode=signup">
                                    Sign Up
                                </Link>
                            </>
                        )}
                    </nav>
                </header>

                {/* ─── Hero Section ─── */}
                <section className="landing-hero">
                    <div className="landing-badge">
                        <Sparkles size={14} /> The Next Generation AI Workspace
                    </div>
                    
                    <h1>
                        Clean, Focused, and <span>Intelligent</span>
                    </h1>
                    
                    <p className="landing-lead">
                        Lucen is a premium chatbot workspace designed for deep focus. 
                        Experience lightning-fast responses, personalized themes, and a distraction-free interface.
                    </p>

                    <div className="landing-hero-actions">
                        {user ? (
                            <Link className="landing-btn landing-btn--primary" to="/chat">
                                Resume Chatting <ArrowRight size={18} />
                            </Link>
                        ) : (
                            <>
                                <Link className="landing-btn landing-btn--primary" to="/chat?mode=signup">
                                    Start for free <ArrowRight size={18} />
                                </Link>
                                <Link className="landing-btn landing-btn--secondary" to="/chat?mode=signin">
                                    View Demo
                                </Link>
                            </>
                        )}
                    </div>

                    {/* HERO MOCKUP PLACEHOLDER */}
                    <div className="landing-hero-mockup">
                        <div className="landing-image-placeholder">
                            {/* USER SHOULD ADD MAIN CHAT SCREENSHOT HERE */}
                            {/* <img src="/images/hero-screenshot.png" alt="Lucen App Interface" /> */}
                        </div>
                    </div>
                </section>

                {/* ─── Features Showcase ─── */}
                <section className="landing-section">
                    <div className="landing-section-header">
                        <h2>Built for velocity</h2>
                        <p>Everything you need to work faster and smarter, wrapped in a beautiful interface.</p>
                    </div>

                    <div className="landing-feature-grid">
                        <div className="landing-feature-card">
                            <div className="landing-feature-icon"><Zap size={24} /></div>
                            <h3>Lightning Fast</h3>
                            <p>Powered by edge functions and optimized rendering. Real-time streaming so you never wait.</p>
                            <div className="landing-feature-image landing-image-placeholder">
                                {/* USER SHOULD ADD FEATURE SCREENSHOT HERE */}
                                {/* <img src="/images/feature-fast.png" alt="Fast Streaming" /> */}
                            </div>
                        </div>

                        <div className="landing-feature-card">
                            <div className="landing-feature-icon"><Shield size={24} /></div>
                            <h3>Secure by Design</h3>
                            <p>Military-grade authentication, OTP verification, and strict session management.</p>
                            <div className="landing-feature-image landing-image-placeholder">
                                {/* USER SHOULD ADD FEATURE SCREENSHOT HERE */}
                                {/* <img src="/images/feature-security.png" alt="Security" /> */}
                            </div>
                        </div>

                        <div className="landing-feature-card">
                            <div className="landing-feature-icon"><Palette size={24} /></div>
                            <h3>Beautifully Crafted</h3>
                            <p>Meticulously designed typography, layouts, and micro-interactions that feel premium.</p>
                            <div className="landing-feature-image landing-image-placeholder">
                                {/* USER SHOULD ADD FEATURE SCREENSHOT HERE */}
                                {/* <img src="/images/feature-design.png" alt="Design" /> */}
                            </div>
                        </div>
                    </div>
                </section>

                {/* ─── Live Theme Showcase ─── */}
                <section className="landing-section">
                    <div className="landing-themes-showcase">
                        <h2>Make it yours.</h2>
                        <p style={{ color: 'var(--text-secondary)', marginTop: '12px', fontSize: '1.1rem' }}>
                            Click below to experience live theme switching directly on the landing page.
                        </p>
                        
                        <div className="landing-themes-grid">
                            {showcaseThemes.map(preset => (
                                <LandingThemeCard 
                                    key={preset.id} 
                                    preset={preset} 
                                    isActive={activeThemeId === preset.id} 
                                    onClick={() => handleThemeSelect(preset.id)} 
                                />
                            ))}
                        </div>
                    </div>
                </section>

                {/* ─── Final CTA ─── */}
                <section className="landing-footer-cta">
                    <h2>Ready to elevate your workflow?</h2>
                    <p>Join Lucen today and experience the difference of a truly premium AI workspace.</p>
                    {user ? (
                        <Link className="landing-btn landing-btn--primary" to="/chat" style={{ padding: '16px 32px', fontSize: '1.1rem' }}>
                            Go to your Workspace <ArrowRight size={20} />
                        </Link>
                    ) : (
                        <Link className="landing-btn landing-btn--primary" to="/chat?mode=signup" style={{ padding: '16px 32px', fontSize: '1.1rem' }}>
                            Try Lucen free <ArrowRight size={20} />
                        </Link>
                    )}
                </section>
                
            </div>
        </div>
    );
};

export default LandingPage;
