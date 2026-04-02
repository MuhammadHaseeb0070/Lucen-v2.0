import React from 'react';
import { Mail, MessageSquare } from 'lucide-react';

const ContactPage: React.FC = () => {
    return (
        <section className="landing-section">
            <div className="landing-section-header">
                <h1>Get in Touch</h1>
                <p>Have questions, feedback, or need support? We&apos;d love to hear from you.</p>
            </div>

            <div style={{ maxWidth: '600px', margin: '3rem auto', background: 'var(--bg-surface)', border: '1px solid var(--divider)', borderRadius: '16px', padding: '2rem' }}>
                <form 
                    style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }} 
                    onSubmit={(e) => { e.preventDefault(); alert("Thanks for your message! This is a demo form."); }}
                >
                    <div style={{ display: 'flex', gap: '1.5rem' }}>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>First Name</label>
                            <input 
                                type="text" 
                                placeholder="Jane"
                                style={{ background: 'var(--bg-base)', border: '1px solid var(--divider)', padding: '12px', borderRadius: '8px', color: 'var(--text-primary)' }}
                                required
                            />
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Last Name</label>
                            <input 
                                type="text" 
                                placeholder="Doe"
                                style={{ background: 'var(--bg-base)', border: '1px solid var(--divider)', padding: '12px', borderRadius: '8px', color: 'var(--text-primary)' }}
                                required
                            />
                        </div>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Email</label>
                        <input 
                            type="email" 
                            placeholder="jane@example.com"
                            style={{ background: 'var(--bg-base)', border: '1px solid var(--divider)', padding: '12px', borderRadius: '8px', color: 'var(--text-primary)' }}
                            required
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Message</label>
                        <textarea 
                            rows={5}
                            placeholder="How can we help you?"
                            style={{ background: 'var(--bg-base)', border: '1px solid var(--divider)', padding: '12px', borderRadius: '8px', color: 'var(--text-primary)', resize: 'vertical' }}
                            required
                        />
                    </div>

                    <button type="submit" className="landing-btn landing-btn--primary" style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}>
                        Send Message
                    </button>
                    <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-tertiary)', marginTop: '0.5rem' }}>
                        Please note: Email support directly for faster responses.
                    </p>
                </form>
            </div>

            <div className="landing-feature-grid" style={{ marginTop: '4rem' }}>
                <div className="landing-feature-card" style={{ textAlign: 'center' }}>
                    <div className="landing-feature-icon" style={{ margin: '0 auto' }}><Mail size={24} /></div>
                    <h3>Email Support</h3>
                    <p>support@lucen.space</p>
                </div>
                <div className="landing-feature-card" style={{ textAlign: 'center' }}>
                    <div className="landing-feature-icon" style={{ margin: '0 auto' }}><MessageSquare size={24} /></div>
                    <h3>Community</h3>
                    <p>Join our Discord to chat with other power users.</p>
                </div>
            </div>
        </section>
    );
};

export default ContactPage;
