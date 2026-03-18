import React from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowRight,
    BadgeCheck,
    Blocks,
    Bot,
    Brain,
    CheckCircle2,
    LayoutDashboard,
    LockKeyhole,
    Sparkles,
    ShieldCheck,
} from 'lucide-react';
import Logo from './Logo';

const featureCards = [
    {
        icon: Bot,
        title: 'Chat-first experience',
        description: 'A focused AI workspace built around fast prompts, clean responses, and fewer distractions.',
    },
    {
        icon: ShieldCheck,
        title: 'Secure by design',
        description: 'Supabase auth, session handling, and server-side guards keep access tight and predictable.',
    },
    {
        icon: LayoutDashboard,
        title: 'Workspace tools',
        description: 'Artifacts, side panels, and settings help you go from idea to useful output without switching apps.',
    },
    {
        icon: Blocks,
        title: 'Built to scale',
        description: 'One origin, one session, and one app structure that stays easy to deploy on Vercel.',
    },
];

const proofPoints = [
    'Public landing page on `/`',
    'Protected chat at `/chat`',
    'Login, signup, and password reset flow back into chat',
];

const stats = [
    { label: 'Route split', value: 'Public + protected' },
    { label: 'Auth', value: 'Supabase sessions' },
    { label: 'Deployment', value: 'Vercel ready' },
];

const steps = [
    {
        title: 'Explore the landing page',
        text: 'Visitors learn what Lucen does before they ever hit auth.',
    },
    {
        title: 'Choose login or signup',
        text: 'Buttons take users into `/chat` with the right auth mode preselected.',
    },
    {
        title: 'Enter the workspace',
        text: 'Once authenticated, they land directly inside the chatbot shell.',
    },
];

const LandingPage: React.FC = () => {
    return (
        <div className="landing-page">
            <header className="landing-header">
                <Link className="landing-brand" to="/">
                    <span className="landing-brand-mark">
                        <Logo size={18} />
                    </span>
                    <span className="landing-brand-text">Lucen</span>
                </Link>

                <nav className="landing-nav">
                    <Link className="landing-nav-link" to="/chat?mode=signin">
                        Login
                    </Link>
                    <Link className="landing-nav-link" to="/chat?mode=signup">
                        Sign up
                    </Link>
                    <Link className="landing-nav-cta" to="/chat">
                        Try Lucen
                    </Link>
                </nav>
            </header>

            <main className="landing-shell">
                <section className="landing-hero">
                    <div className="landing-hero-copy">
                        <div className="landing-eyebrow">
                            <Sparkles size={14} />
                            <span>ChatGPT-style simplicity, Lucen-style focus</span>
                        </div>

                        <h1>
                            A polished landing page for Lucen, then a protected chat app underneath.
                        </h1>

                        <p className="landing-lead">
                            Lucen gives visitors a clean public entry point and sends them into a secure
                            chatbot workspace only when they are ready to log in or sign up.
                        </p>

                        <div className="landing-cta-row">
                            <Link className="landing-button landing-button--primary" to="/chat?mode=signup">
                                Get started
                                <ArrowRight size={16} />
                            </Link>
                            <Link className="landing-button landing-button--secondary" to="/chat?mode=signin">
                                Login
                            </Link>
                        </div>

                        <div className="landing-proof">
                            {proofPoints.map((point) => (
                                <div className="landing-proof-item" key={point}>
                                    <CheckCircle2 size={16} />
                                    <span>{point}</span>
                                </div>
                            ))}
                        </div>

                        <div className="landing-stats">
                            {stats.map((stat) => (
                                <div className="landing-stat" key={stat.label}>
                                    <span className="landing-stat-label">{stat.label}</span>
                                    <span className="landing-stat-value">{stat.value}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="landing-hero-visual">
                        <div className="landing-preview-card landing-preview-card--main">
                            <div className="landing-preview-top">
                                <span className="landing-preview-pill">
                                    <LockKeyhole size={14} />
                                    Protected chat
                                </span>
                                <span className="landing-preview-meta">
                                    <BadgeCheck size={14} />
                                    Session aware
                                </span>
                            </div>

                            <div className="landing-chat-stream">
                                <div className="landing-chat-bubble landing-chat-bubble--ai">
                                    Build me a landing page that feels premium and converts visitors into users.
                                </div>
                                <div className="landing-chat-bubble landing-chat-bubble--user">
                                    Keep it clean, secure, and easy to deploy on Vercel.
                                </div>
                                <div className="landing-chat-bubble landing-chat-bubble--ai">
                                    Lucen can handle that. Public entry on the front, gated chat behind `/chat`.
                                </div>
                            </div>
                        </div>

                        <div className="landing-preview-grid">
                            <div className="landing-preview-card">
                                <Brain size={18} />
                                <strong>Focused AI workflows</strong>
                                <span>Built for quick prompts, deeper work, and fewer distractions.</span>
                            </div>
                            <div className="landing-preview-card">
                                <ShieldCheck size={18} />
                                <strong>Safer session flow</strong>
                                <span>Same-origin routing keeps auth predictable and easy to maintain.</span>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="landing-section">
                    <div className="landing-section-heading">
                        <p>What Lucen does</p>
                        <h2>A real product page for a real AI workspace</h2>
                    </div>

                    <div className="landing-feature-grid">
                        {featureCards.map((feature) => {
                            const Icon = feature.icon;
                            return (
                                <article className="landing-feature-card" key={feature.title}>
                                    <div className="landing-feature-icon">
                                        <Icon size={18} />
                                    </div>
                                    <h3>{feature.title}</h3>
                                    <p>{feature.description}</p>
                                </article>
                            );
                        })}
                    </div>
                </section>

                <section className="landing-section landing-section--soft">
                    <div className="landing-section-heading">
                        <p>How it works</p>
                        <h2>Simple public entry, clean protected app</h2>
                    </div>

                    <div className="landing-steps">
                        {steps.map((step, index) => (
                            <article className="landing-step" key={step.title}>
                                <div className="landing-step-index">{index + 1}</div>
                                <h3>{step.title}</h3>
                                <p>{step.text}</p>
                            </article>
                        ))}
                    </div>
                </section>

                <section className="landing-final-cta">
                    <div>
                        <p className="landing-final-kicker">Ready to launch</p>
                        <h2>Send users to a beautiful home page first, then open chat when they are ready.</h2>
                    </div>
                    <div className="landing-cta-row">
                        <Link className="landing-button landing-button--primary" to="/chat?mode=signup">
                            Create account
                            <ArrowRight size={16} />
                        </Link>
                        <Link className="landing-button landing-button--secondary" to="/chat?mode=signin">
                            Log in
                        </Link>
                    </div>
                </section>
            </main>
        </div>
    );
};

export default LandingPage;
