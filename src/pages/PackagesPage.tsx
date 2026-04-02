import React from 'react';
import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';

const PackagesPage: React.FC = () => {
    return (
        <section className="landing-section">
            <div className="landing-section-header">
                <h1>Simple, Transparent Pricing</h1>
                <p>Choose the plan that fits your workflow. Upgrade or downgrade at any time.</p>
            </div>

            <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center', marginTop: '4rem', flexWrap: 'wrap' }}>
                {/* Basic Plan */}
                <div style={{ 
                    background: 'var(--bg-surface)', 
                    border: '1px solid var(--divider)', 
                    borderRadius: '24px', 
                    padding: '2.5rem', 
                    width: '350px',
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    <h3 style={{ fontSize: '1.5rem', margin: '0 0 0.5rem 0' }}>Hobby</h3>
                    <p style={{ color: 'var(--text-secondary)', margin: '0 0 2rem 0' }}>Perfect for occasional questions and casual use.</p>
                    
                    <div style={{ marginBottom: '2rem' }}>
                        <span style={{ fontSize: '3rem', fontWeight: 800 }}>Free</span>
                    </div>

                    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 2rem 0', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <li style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <Check size={18} color="var(--accent)" />
                            <span>15 Credits per day (Basic Models)</span>
                        </li>
                        <li style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <Check size={18} color="var(--accent)" />
                            <span>Side Chat & Search</span>
                        </li>
                        <li style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <Check size={18} color="var(--accent)" />
                            <span>Basic Artifacts (HTML/Mermaid)</span>
                        </li>
                        <li style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <Check size={18} color="var(--text-tertiary)" />
                            <span style={{ color: 'var(--text-secondary)' }}>Standard Support</span>
                        </li>
                    </ul>

                    <Link className="landing-btn landing-btn--secondary" to="/signup" style={{ textAlign: 'center', justifyContent: 'center', width: '100%' }}>
                        Get Started
                    </Link>
                </div>

                {/* Pro Plan */}
                <div style={{ 
                    background: 'var(--bg-surface)', 
                    border: '2px solid var(--accent)', 
                    borderRadius: '24px', 
                    padding: '2.5rem', 
                    width: '350px',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative'
                }}>
                    <div style={{
                        position: 'absolute',
                        top: '-15px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'var(--accent)',
                        color: 'white',
                        padding: '4px 16px',
                        borderRadius: '20px',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        letterSpacing: '0.5px'
                    }}>
                        MOST POPULAR
                    </div>

                    <h3 style={{ fontSize: '1.5rem', margin: '0 0 0.5rem 0' }}>Pro</h3>
                    <p style={{ color: 'var(--text-secondary)', margin: '0 0 2rem 0' }}>For professionals who rely on AI daily.</p>
                    
                    <div style={{ marginBottom: '2rem' }}>
                        <span style={{ fontSize: '3rem', fontWeight: 800 }}>$15</span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>/mo</span>
                    </div>

                    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 2rem 0', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <li style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <Check size={18} color="var(--accent)" />
                            <span>1500 Credits per month</span>
                        </li>
                        <li style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <Check size={18} color="var(--accent)" />
                            <span>Access to GPT-4, Claude 3 Opus</span>
                        </li>
                        <li style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <Check size={18} color="var(--accent)" />
                            <span>Premium Themes Library</span>
                        </li>
                        <li style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <Check size={18} color="var(--accent)" />
                            <span>Priority Support</span>
                        </li>
                    </ul>

                    <Link className="landing-btn landing-btn--primary" to="/signup" style={{ textAlign: 'center', justifyContent: 'center', width: '100%' }}>
                        Upgrade to Pro
                    </Link>
                </div>
            </div>
            
            <div style={{ textAlign: 'center', marginTop: '4rem', color: 'var(--text-secondary)' }}>
                <p>Are you a team? <Link to="/contact" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Contact us</Link> for customized plans.</p>
            </div>
        </section>
    );
};

export default PackagesPage;
