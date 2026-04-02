import React from 'react';
import { Check, Star, Zap, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PLAN_LIST } from '../config/subscriptionConfig';

const PackagesPage: React.FC = () => {
    return (
        <section className="landing-section">
            <div className="landing-section-header">
                <h1>Simple, Transparent Pricing</h1>
                <p>Choose the plan that fits your workflow. Upgrade or downgrade at any time.</p>
            </div>

            <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center', marginTop: '4rem', flexWrap: 'wrap' }}>
                {PLAN_LIST.map((plan) => {
                    const isPaid = plan.id === 'regular' || plan.id === 'pro';
                    const isFeatured = plan.recommended;

                    return (
                        <div key={plan.id} style={{ 
                            background: 'var(--bg-surface)', 
                            border: isFeatured ? '2px solid var(--accent)' : '1px solid var(--divider)', 
                            borderRadius: '24px', 
                            padding: '2.5rem', 
                            width: '350px',
                            display: 'flex',
                            flexDirection: 'column',
                            position: 'relative'
                        }}>
                            {isFeatured && (
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
                                    letterSpacing: '0.5px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}>
                                    <Star size={12} fill="currentColor" /> BEST VALUE
                                </div>
                            )}

                            {plan.highlight && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    color: 'var(--accent)',
                                    fontSize: '0.85rem',
                                    fontWeight: 600,
                                    marginBottom: '1rem',
                                    background: 'var(--user-bubble-bg)',
                                    padding: '4px 10px',
                                    borderRadius: '12px',
                                    width: 'fit-content'
                                }}>
                                    <Zap size={14} />
                                    <span>{plan.highlight}</span>
                                </div>
                            )}

                            <h3 style={{ fontSize: '1.5rem', margin: '0 0 0.5rem 0' }}>{plan.name}</h3>
                            <p style={{ color: 'var(--text-secondary)', margin: '0 0 2rem 0', minHeight: '40px' }}>{plan.tagline}</p>
                            
                            <div style={{ marginBottom: '2rem' }}>
                                {plan.priceUsd === 0 ? (
                                    <span style={{ fontSize: '3rem', fontWeight: 800 }}>Free</span>
                                ) : (
                                    <>
                                        <span style={{ fontSize: '3rem', fontWeight: 800 }}>${plan.priceUsd}</span>
                                        <span style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>/mo</span>
                                    </>
                                )}
                            </div>

                            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 2rem 0', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {plan.features.map((feat, i) => (
                                    <li key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                                        <div style={{ marginTop: '3px' }}>
                                            <Check size={16} color="var(--accent)" strokeWidth={2.5} />
                                        </div>
                                        <span style={{ lineHeight: 1.4 }}>{feat}</span>
                                    </li>
                                ))}
                            </ul>

                            {isPaid ? (
                                <Link className={`landing-btn ${isFeatured ? 'landing-btn--primary' : 'landing-btn--secondary'}`} to="/signup" style={{ textAlign: 'center', justifyContent: 'center', width: '100%' }}>
                                    Get {plan.name}
                                </Link>
                            ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', padding: '12px', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                                    <Shield size={16} />
                                    <span>Included free forever</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            
            <div style={{ textAlign: 'center', marginTop: '4rem', color: 'var(--text-secondary)' }}>
                <p>Are you a team? <Link to="/contact" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Contact us</Link> for customized plans.</p>
            </div>
        </section>
    );
};

export default PackagesPage;
