import React from 'react';
import { Sparkles, Terminal, Cpu } from 'lucide-react';

const AboutPage: React.FC = () => {
    return (
        <section className="landing-section" style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="landing-section-header">
                <div className="landing-badge" style={{ margin: '0 auto 1rem auto' }}>
                    <Sparkles size={14} /> Our Mission
                </div>
                <h1>Beyond the Chatbot</h1>
                <p style={{ maxWidth: '700px', margin: '0 auto', fontSize: '1.2rem', lineHeight: 1.6 }}>
                    We built Lucen because we were tired of wrestling with generic LLM interfaces. 
                    We wanted a workspace that felt like an IDE for thought—a place where context is managed predictably, 
                    code is a first-class citizen, and every interaction feels snappy and deliberate.
                </p>
            </div>

            <div className="landing-feature-grid" style={{ marginTop: '4rem' }}>
                <div className="landing-feature-card">
                    <div className="landing-feature-icon"><Terminal size={24} /></div>
                    <h3>Built for Power Users</h3>
                    <p>Designed with keyboard shortcuts, command palettes, and developer-first workflows from day one.</p>
                </div>
                <div className="landing-feature-card">
                    <div className="landing-feature-icon"><Cpu size={24} /></div>
                    <h3>Uncompromising UI</h3>
                    <p>No more janky scrolling or unreadable text. Our themes are hand-crafted for extended reading and coding sessions.</p>
                </div>
                <div className="landing-feature-card">
                    <div className="landing-feature-icon"><Sparkles size={24} /></div>
                    <h3>The Future of Work</h3>
                    <p>We are constantly exploring how to bridge the gap between thinking and executing with AI.</p>
                </div>
            </div>
        </section>
    );
};

export default AboutPage;
