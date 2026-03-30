import React from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowRight,
    Sparkles,
    MessageSquarePlus,
    Trash2,
    Command,
    Code,
    Palette,
    Keyboard,
    Check,
    Search,
    X,
    GripHorizontal,
    Link as LinkIcon,
    Eye,
} from 'lucide-react';
import Logo from './Logo';
import { useAuthStore } from '../store/authStore';
import { useThemeStore, THEME_PRESETS, applyTheme } from '../store/themeStore';
import type { ThemePreset } from '../store/themeStore';

// ─── Inline ThemeCard for Landing Page ───
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

// ─── CSS-Only Chat Mockup (Hero) ───
const HeroChatMockup: React.FC = () => (
    <div className="landing-mockup-chat">
        <div className="lm-topbar">
            <div className="lm-topbar-left">
                <div className="lm-sidebar-mini">
                    <div className="lm-sidebar-item lm-sidebar-item--active" />
                    <div className="lm-sidebar-item" />
                    <div className="lm-sidebar-item" />
                </div>
            </div>
            <div className="lm-topbar-center">
                <Logo size={14} />
                <span>Lucen</span>
            </div>
            <div className="lm-topbar-right">
                <div className="lm-dot" />
                <div className="lm-dot" />
            </div>
        </div>
        <div className="lm-body">
            <div className="lm-msg lm-msg--user">Explain quantum entanglement simply</div>
            <div className="lm-msg lm-msg--ai">
                <div className="lm-ai-icon"><Logo size={10} /></div>
                <div className="lm-ai-text">
                    <div className="lm-line" style={{ width: '90%' }} />
                    <div className="lm-line" style={{ width: '75%' }} />
                    <div className="lm-line" style={{ width: '60%' }} />
                </div>
            </div>
            <div className="lm-msg lm-msg--user">Can you give an analogy?</div>
            <div className="lm-msg lm-msg--ai">
                <div className="lm-ai-icon"><Logo size={10} /></div>
                <div className="lm-ai-text">
                    <div className="lm-line" style={{ width: '85%' }} />
                    <div className="lm-line" style={{ width: '70%' }} />
                </div>
            </div>
        </div>
        <div className="lm-input-bar">
            <span>Ask anything...</span>
        </div>
    </div>
);

// ─── Side Chat Mini Mockup ───
const SideChatMockup: React.FC = () => (
    <div className="lm-feature-mockup lm-sidechat-mockup">
        <div className="lm-sc-header">
            <GripHorizontal size={10} style={{ opacity: 0.4 }} />
            <span>Side Chat</span>
            <div style={{ display: 'flex', gap: '4px', marginLeft: 'auto' }}>
                <LinkIcon size={10} style={{ opacity: 0.5 }} />
                <X size={10} style={{ opacity: 0.5 }} />
            </div>
        </div>
        <div className="lm-sc-context">
            <LinkIcon size={8} />
            <span>3 messages linked</span>
        </div>
        <div className="lm-sc-msgs">
            <div className="lm-sc-user">What's the time complexity?</div>
            <div className="lm-sc-ai">
                <div className="lm-line" style={{ width: '80%' }} />
                <div className="lm-line" style={{ width: '55%' }} />
            </div>
        </div>
        <div className="lm-sc-input">Quick question...</div>
    </div>
);

// ─── Message Deletion Mockup ───
const DeletionMockup: React.FC = () => (
    <div className="lm-feature-mockup lm-deletion-mockup">
        <div className="lm-del-exchange">
            <div className="lm-del-user">What is recursion?</div>
            <div className="lm-del-actions">
                <div className="lm-del-btn lm-del-btn--copy" />
            </div>
        </div>
        <div className="lm-del-exchange lm-del-exchange--danger">
            <div className="lm-del-user lm-del-user--danger">This message went wrong</div>
            <div className="lm-del-actions">
                <Trash2 size={10} className="lm-del-icon" />
            </div>
        </div>
        <div className="lm-del-exchange">
            <div className="lm-del-user">Explain closures in JS</div>
            <div className="lm-del-actions">
                <div className="lm-del-btn lm-del-btn--copy" />
            </div>
        </div>
    </div>
);

// ─── Command Palette Mockup ───
const CommandPaletteMockup: React.FC = () => (
    <div className="lm-feature-mockup lm-cmd-mockup">
        <div className="lm-cmd-header">
            <Command size={10} />
            <span>Type a command...</span>
            <kbd>ESC</kbd>
        </div>
        <div className="lm-cmd-list">
            <div className="lm-cmd-item lm-cmd-item--selected">
                <Search size={10} />
                <span>Search Messages</span>
                <kbd>Ctrl+F</kbd>
            </div>
            <div className="lm-cmd-item">
                <Palette size={10} />
                <span>Switch to Observatory</span>
            </div>
            <div className="lm-cmd-item">
                <MessageSquarePlus size={10} />
                <span>Open Side Chat</span>
            </div>
        </div>
    </div>
);

// ─── Artifacts Mockup ───
const ArtifactsMockup: React.FC = () => (
    <div className="lm-feature-mockup lm-artifact-mockup">
        <div className="lm-art-header">
            <span className="lm-art-badge"><Code size={8} /> HTML</span>
            <span className="lm-art-title">Landing Page</span>
            <div className="lm-art-toggle">
                <span className="lm-art-tab lm-art-tab--active"><Eye size={8} /> Preview</span>
                <span className="lm-art-tab"><Code size={8} /> Code</span>
            </div>
        </div>
        <div className="lm-art-body">
            <div className="lm-art-preview">
                <div className="lm-line" style={{ width: '40%', height: '8px', background: 'var(--accent)', borderRadius: '4px', marginBottom: '6px' }} />
                <div className="lm-line" style={{ width: '80%' }} />
                <div className="lm-line" style={{ width: '60%' }} />
                <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                    <div style={{ width: '40px', height: '14px', borderRadius: '7px', background: 'var(--accent)', opacity: 0.7 }} />
                    <div style={{ width: '40px', height: '14px', borderRadius: '7px', background: 'var(--bg-muted)' }} />
                </div>
            </div>
        </div>
    </div>
);

// ─── Shortcuts Mockup ───
const ShortcutsMockup: React.FC = () => (
    <div className="lm-feature-mockup lm-shortcuts-mockup">
        {[
            ['Command palette', 'Ctrl + K'],
            ['New chat', 'Ctrl + N'],
            ['Toggle sidebar', 'Ctrl + B'],
            ['Send message', 'Enter'],
            ['Halt & Edit', 'Escape'],
        ].map(([action, keys]) => (
            <div key={action} className="lm-shortcut-row">
                <span>{action}</span>
                <kbd>{keys}</kbd>
            </div>
        ))}
    </div>
);

// ─── Feature Card ───
interface FeatureCardProps {
    icon: React.ReactNode;
    title: string;
    description: string;
    mockup: React.ReactNode;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ icon, title, description, mockup }) => (
    <div className="landing-feature-card" id={`feature-${title.toLowerCase().replace(/\s+/g, '-')}`}>
        <div className="landing-feature-icon">{icon}</div>
        <h3>{title}</h3>
        <p>{description}</p>
        <div className="landing-feature-mockup-wrap">
            {mockup}
        </div>
    </div>
);

// ─── Comparison Row ───
interface ComparisonRow {
    feature: string;
    lucen: string | boolean;
    others: string | boolean;
}

const COMPARISON_DATA: ComparisonRow[] = [
    { feature: 'Side Chat for quick questions', lucen: true, others: false },
    { feature: 'Delete any message pair', lucen: true, others: false },
    { feature: 'Import context across chats', lucen: true, others: false },
    { feature: 'Command Palette (Ctrl+K)', lucen: true, others: false },
    { feature: 'Hand-crafted theme library', lucen: '8 themes', others: '1–2 modes' },
    { feature: 'Artifacts with live preview', lucen: true, others: 'Limited' },
    { feature: 'Keyboard-first workflow', lucen: true, others: 'Partial' },
    { feature: 'Text selection quick-actions', lucen: true, others: false },
    { feature: 'Drag & drop file attachments', lucen: true, others: true },
    { feature: 'Resizable floating panels', lucen: true, others: false },
];

// ─────────────────────────────────────────
//  MAIN LANDING PAGE COMPONENT
// ─────────────────────────────────────────
const LandingPage: React.FC = () => {
    const { user, signOut } = useAuthStore();
    const { activeThemeId, setTheme } = useThemeStore();

    const handleThemeSelect = (id: string) => {
        setTheme(id);
        const preset = THEME_PRESETS.find((t) => t.id === id);
        if (preset) applyTheme(preset);
    };

    const showcaseThemes = THEME_PRESETS;

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
                        <Sparkles size={14} /> The AI Workspace You Deserve
                    </div>

                    <h1>
                        Your AI. <span>Your Rules.</span>
                    </h1>

                    <p className="landing-lead">
                        Lucen is an AI workspace built for control and clarity: Side Chat for fast follow-ups,
                        message control (delete exchanges and redo the last response), instant in-chat search,
                        and hand-crafted themes that keep text readable. Generate rich artifacts like HTML, SVG,
                        and Mermaid diagrams with pan/zoom previews, then copy or download what you need.
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
                                    Sign in
                                </Link>
                            </>
                        )}
                    </div>

                    {/* Hero Mockup (CSS-only, fully theme-aware) */}
                    <div className="landing-hero-mockup">
                        <HeroChatMockup />
                    </div>
                </section>

                {/* ─── Features Showcase ─── */}
                <section className="landing-section">
                    <div className="landing-section-header">
                        <h2>AI workspace features built for real workflows</h2>
                        <p>
                            No fluff—just the tools power users need: follow-up chat, message control,
                            searchable highlights, and artifacts you can reuse.
                        </p>
                    </div>

                    <div className="landing-feature-grid">
                        <FeatureCard
                            icon={<MessageSquarePlus size={24} />}
                            title="Side Chat"
                            description="Keep the conversation flowing with Side Chat. Ask targeted follow-ups while automatically reusing context from your main chat—without switching tabs or breaking your train of thought."
                            mockup={<SideChatMockup />}
                        />
                        <FeatureCard
                            icon={<Trash2 size={24} />}
                            title="Message Deletion"
                            description="Delete any exchange (your message + its response) right next to the action buttons. Clean context means fewer distractions and more accurate future answers."
                            mockup={<DeletionMockup />}
                        />
                        <FeatureCard
                            icon={<Command size={24} />}
                            title="Command Palette"
                            description="Press Ctrl+K to search messages, switch themes, jump through your workspace, and trigger powerful actions instantly."
                            mockup={<CommandPaletteMockup />}
                        />
                        <FeatureCard
                            icon={<Code size={24} />}
                            title="Artifacts"
                            description="Preview AI-generated HTML, SVG, and Mermaid diagrams in a dedicated workspace. Pan/zoom vector diagrams smoothly, copy outputs, and download SVGs for perfect reuse."
                            mockup={<ArtifactsMockup />}
                        />
                        <FeatureCard
                            icon={<Palette size={24} />}
                            title="8 Curated Themes"
                            description="Eight hand-crafted themes tuned for readability. Switch instantly between Lucen ✨, Washi 🪷, Amber 🍂, Linen 🪡, Petal 🌸, Studio 💬, Verdigris 🏛️, and Terminal ⚡—each designed to keep text crisp."
                            mockup={null}
                        />
                        <FeatureCard
                            icon={<Keyboard size={24} />}
                            title="Developer Shortcuts"
                            description="Keyboard-first workflow: Ctrl+N (new chat), Ctrl+B (toggle sidebar), Escape (halt-and-edit), Enter (send). Built to move fast without hunting for buttons."
                            mockup={<ShortcutsMockup />}
                        />
                    </div>
                </section>

                {/* ─── Live Theme Showcase ─── */}
                <section className="landing-section">
                    <div className="landing-themes-showcase">
                        <h2>Make it yours.</h2>
                        <p style={{ color: 'var(--text-secondary)', marginTop: '12px', fontSize: '1.1rem' }}>
                            Switch between 8 curated themes instantly: Lucen ✨, Washi 🪷, Amber 🍂, Linen 🪡, Petal 🌸, Studio 💬, Verdigris 🏛️, and Terminal ⚡. Preview the UI and typography live on this page.
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

                {/* ─── Comparison Section ─── */}
                <section className="landing-section">
                    <div className="landing-section-header">
                        <h2>Lucen vs. the rest</h2>
                        <p>
                            Most chatbots optimize for one thing: generating text. Lucen optimizes for your workflow:
                            follow-ups, message control, searchable highlights, and reusable artifacts.
                        </p>
                    </div>

                    <div className="landing-comparison-wrap">
                        <table className="landing-comparison-table">
                            <thead>
                                <tr>
                                    <th>Feature</th>
                                    <th className="landing-comp-lucen">
                                        <Logo size={14} /> Lucen
                                    </th>
                                    <th>Others</th>
                                </tr>
                            </thead>
                            <tbody>
                                {COMPARISON_DATA.map((row) => (
                                    <tr key={row.feature}>
                                        <td>{row.feature}</td>
                                        <td className="landing-comp-lucen">
                                            {row.lucen === true ? (
                                                <Check size={16} className="landing-comp-yes" />
                                            ) : typeof row.lucen === 'string' ? (
                                                <span className="landing-comp-text landing-comp-text--good">{row.lucen}</span>
                                            ) : (
                                                <X size={16} className="landing-comp-no" />
                                            )}
                                        </td>
                                        <td>
                                            {row.others === true ? (
                                                <Check size={16} className="landing-comp-yes" />
                                            ) : row.others === false ? (
                                                <X size={16} className="landing-comp-no" />
                                            ) : (
                                                <span className="landing-comp-text">{row.others}</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* ─── How it works ─── */}
                <section className="landing-section">
                    <div className="landing-section-header">
                        <h2>Built to keep you in flow</h2>
                        <p>
                            Lucen turns AI chatting into an actual workspace: search precisely, control exchanges,
                            and reuse diagrams and snippets without leaving your conversation.
                        </p>
                    </div>

                    <div className="landing-feature-grid">
                        <div className="landing-feature-card">
                            <div className="landing-feature-icon">
                                <Search size={24} />
                            </div>
                            <h3>Search that jumps to the match</h3>
                            <p>
                                Find a specific word or phrase and navigate directly to the highlighted substring—so you
                                don&apos;t have to scroll through long responses.
                            </p>
                        </div>

                        <div className="landing-feature-card">
                            <div className="landing-feature-icon">
                                <Trash2 size={24} />
                            </div>
                            <h3>Control exchanges, not just text</h3>
                            <p>
                                Delete any exchange to keep context clean. If the last answer isn&apos;t right, redo that
                                final response using the same chat context.
                            </p>
                        </div>

                        <div className="landing-feature-card">
                            <div className="landing-feature-icon">
                                <Code size={24} />
                            </div>
                            <h3>Artifacts you can zoom, copy, and download</h3>
                            <p>
                                Preview HTML, SVG, and Mermaid diagrams with pan/zoom controls. Copy code or download SVG
                                output for reuse in your own projects.
                            </p>
                        </div>
                    </div>
                </section>

                {/* ─── FAQ ─── */}
                <section className="landing-section">
                    <div className="landing-section-header">
                        <h2>FAQ</h2>
                        <p>Quick answers about Lucen&apos;s AI workspace features.</p>
                    </div>

                    <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 10px', display: 'grid', gap: 16 }}>
                        <div style={{ padding: 18, border: '1px solid var(--divider)', borderRadius: 16, background: 'var(--bg-surface)' }}>
                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Can I delete an exchange?</h3>
                            <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                Yes. Delete any exchange (your message + the assistant response) directly from the chat actions.
                            </p>
                        </div>

                        <div style={{ padding: 18, border: '1px solid var(--divider)', borderRadius: 16, background: 'var(--bg-surface)' }}>
                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>When can I redo a response?</h3>
                            <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                Redo is available on the very last assistant response only, regenerated with the same context.
                            </p>
                        </div>

                        <div style={{ padding: 18, border: '1px solid var(--divider)', borderRadius: 16, background: 'var(--bg-surface)' }}>
                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Does search highlight and navigate?</h3>
                            <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                Yes. Matches are highlighted and the navigation scrolls to the exact highlighted substring.
                            </p>
                        </div>

                        <div style={{ padding: 18, border: '1px solid var(--divider)', borderRadius: 16, background: 'var(--bg-surface)' }}>
                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>What artifact types are supported?</h3>
                            <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                HTML, SVG, and Mermaid diagrams render in the artifacts workspace.
                            </p>
                        </div>

                        <div style={{ padding: 18, border: '1px solid var(--divider)', borderRadius: 16, background: 'var(--bg-surface)' }}>
                            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Can I zoom and download diagrams?</h3>
                            <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                                Yes. Use the pan/zoom controls in preview, and download SVG output for SVG + Mermaid diagrams.
                            </p>
                        </div>
                    </div>
                </section>

                {/* ─── Final CTA ─── */}
                <section className="landing-footer-cta">
                    <h2>Ready to take control of your AI conversations?</h2>
                    <p>
                        Try Lucen if you want an AI workspace with side chat, redo/delete message control,
                        fast in-chat search, and artifact previews you can copy or download.
                    </p>
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

                {/* ─── Footer ─── */}
                <footer className="landing-footer">
                    <div className="landing-footer-brand">
                        <Logo size={16} />
                        <span>Lucen</span>
                    </div>
                    <p className="landing-footer-tagline">
                        Premium AI workspace, built for focus, designed for you.
                    </p>
                    <p className="landing-footer-copy">
                        © {new Date().getFullYear()} Lucen. All rights reserved.
                    </p>
                </footer>

            </div>
        </div>
    );
};

export default LandingPage;
