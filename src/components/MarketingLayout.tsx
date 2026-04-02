import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Logo from './Logo';
import { useAuthStore } from '../store/authStore';

const MarketingLayout: React.FC = () => {
    const { user, signOut } = useAuthStore();
    const location = useLocation();

    const handleLogout = async () => {
        await signOut();
    };

    const isAuthPage = location.pathname.startsWith('/login') || location.pathname.startsWith('/signup');

    return (
        <div className="landing-page">
            <div className="landing-container">
                <header className="landing-header">
                    <Link className="landing-brand" to="/">
                        <div className="landing-brand-mark"><Logo size={20} /></div>
                        <span>Lucen</span>
                    </Link>

                    {!isAuthPage && (
                        <nav className="landing-nav" style={{ flex: 1, justifyContent: 'center', display: 'flex', gap: '2rem' }}>
                            <Link to="/about" className="landing-nav-link">About</Link>
                            <Link to="/packages" className="landing-nav-link">Packages</Link>
                            <Link to="/contact" className="landing-nav-link">Contact Us</Link>
                        </nav>
                    )}

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
                                {!isAuthPage && (
                                    <>
                                        <Link className="landing-nav-link" to="/login">Log in</Link>
                                        <Link className="landing-btn landing-btn--primary" to="/signup">
                                            Sign Up
                                        </Link>
                                    </>
                                )}
                            </>
                        )}
                    </nav>
                </header>

                <main style={{ minHeight: 'calc(100vh - 160px)' }}>
                    <Outlet />
                </main>

                {!isAuthPage && (
                    <footer className="landing-footer" style={{ paddingBottom: '3rem' }}>
                        <div className="landing-footer-brand">
                            <Logo size={16} />
                            <span>Lucen</span>
                        </div>
                        <p className="landing-footer-tagline">
                            Premium AI workspace, built for focus, designed for you.
                        </p>
                        <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center', marginTop: '1.5rem', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                            <Link to="/terms" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Terms of Service</Link>
                            <Link to="/privacy" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Privacy Policy</Link>
                            <Link to="/refund" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Refund Policy</Link>
                        </div>
                        <p className="landing-footer-copy">
                            © {new Date().getFullYear()} Lucen. All rights reserved.
                        </p>
                    </footer>
                )}
            </div>
        </div>
    );
};

export default MarketingLayout;
