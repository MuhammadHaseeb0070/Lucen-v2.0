import React from 'react';
import { X, Palette, Info, Keyboard, Check, Activity } from 'lucide-react';
import { useThemeStore, THEME_PRESETS, applyTheme } from '../store/themeStore';
import type { ThemePreset } from '../store/themeStore';
import UserUsageTab from './UserUsageTab';

const CATEGORIES = [
    { id: 'curated', label: 'Curated' },
    { id: 'warm', label: 'Warm' },
    { id: 'cool', label: 'Cool' },
    { id: 'focus', label: 'Focus' },
] as const;

const TABS = [
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
    { id: 'usage', label: 'Usage', icon: Activity },
    { id: 'about', label: 'About', icon: Info },
] as const;

// ─── Theme Card ───
const ThemeCard: React.FC<{ preset: ThemePreset; isActive: boolean; onClick: () => void }> = ({
    preset,
    isActive,
    onClick,
}) => {
    const c = preset.colors;
    return (
        <button
            className={`theme-card ${isActive ? 'theme-card--active' : ''}`}
            onClick={onClick}
        >
            <div className="theme-card__preview" style={{ background: c.bgBase }}>
                <div className="theme-card__bar" style={{ background: c.bgSurface, borderBottom: `1px solid ${c.divider}` }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.accent }} />
                    <span style={{ width: 18, height: 3, borderRadius: 2, background: c.textTertiary }} />
                </div>
                <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ width: '65%', height: 7, borderRadius: 4, alignSelf: 'flex-end', background: c.userBubbleBg }} />
                    <div style={{ width: '75%', height: 10, borderRadius: 4, background: c.aiBubbleBg, border: `1px solid ${c.aiBubbleBorder}` }} />
                    <div style={{ width: '55%', height: 7, borderRadius: 4, alignSelf: 'flex-end', background: c.userBubbleBg }} />
                </div>
            </div>
            <div className="theme-card__label">
                <span className="theme-card__emoji">{preset.emoji}</span>
                <span className="theme-card__name">{preset.name}</span>
                {isActive && <Check size={14} className="theme-card__check" />}
            </div>
        </button>
    );
};

// ─── Appearance Tab ───
const AppearanceTab: React.FC = () => {
    const { activeThemeId, setTheme } = useThemeStore();

    const handleSelect = (id: string) => {
        setTheme(id);
        const preset = THEME_PRESETS.find((t) => t.id === id);
        if (preset) applyTheme(preset);
    };

    return (
        <div className="settings-tab-body">
            <p className="settings-desc">Pick a theme that feels right for you.</p>
            {CATEGORIES.map((cat) => {
                const themes = THEME_PRESETS.filter((t) => t.category === cat.id);
                if (!themes.length) return null;
                return (
                    <div key={cat.id} className="theme-section">
                        <h4 className="theme-section__title">{cat.label}</h4>
                        <div className="theme-grid">
                            {themes.map((p) => (
                                <ThemeCard key={p.id} preset={p} isActive={activeThemeId === p.id} onClick={() => handleSelect(p.id)} />
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// ─── Shortcuts Tab ───
const ShortcutsTab: React.FC = () => (
    <div className="settings-tab-body">
        <p className="settings-desc">Keyboard shortcuts to speed up your workflow.</p>
        <div className="shortcut-list">
            {[
                ['Command palette', 'Ctrl + K'],
                ['Send message', 'Enter'],
                ['New line', 'Shift + Enter'],
                ['New chat', 'Ctrl + N'],
                ['Toggle sidebar', 'Ctrl + B'],
                ['Halt & Edit (while streaming)', 'Escape'],
                ['Stop generating', 'Click Stop'],
            ].map(([action, keys]) => (
                <div key={action} className="shortcut-row">
                    <span className="shortcut-action">{action}</span>
                    <kbd className="shortcut-key">{keys}</kbd>
                </div>
            ))}
        </div>
    </div>
);

// ─── About Tab ───
const AboutTab: React.FC = () => (
    <div className="settings-tab-body">
        <div className="about-block">
            <h3 className="about-title">Lucen</h3>
            <p className="about-version">Version 1.0.0</p>
            <p className="about-text">
                An AI assistant designed for comfortable, extended use.
            </p>
        </div>
    </div>
);

// ─── Main Settings Component ───
const SettingsScreen: React.FC = () => {
    const { settingsOpen, setSettingsOpen, settingsTab, setSettingsTab } = useThemeStore();

    if (!settingsOpen) return null;

    const renderTab = () => {
        switch (settingsTab) {
            case 'appearance': return <AppearanceTab />;
            case 'shortcuts': return <ShortcutsTab />;
            case 'usage': return <UserUsageTab />;
            case 'about': return <AboutTab />;
            default: return <AppearanceTab />;
        }
    };

    return (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
            <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
                {/* Sidebar tabs */}
                <div className="settings-nav">
                    <h2 className="settings-nav__title">Settings</h2>
                    <div className="settings-nav__tabs">
                        {TABS.map((tab) => {
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.id}
                                    className={`settings-nav__tab ${settingsTab === tab.id ? 'settings-nav__tab--active' : ''}`}
                                    onClick={() => setSettingsTab(tab.id)}
                                >
                                    <Icon size={16} />
                                    <span>{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Content area */}
                <div className="settings-content">
                    <div className="settings-content__header">
                        <h3>{TABS.find((t) => t.id === settingsTab)?.label}</h3>
                        <button className="settings-close" onClick={() => setSettingsOpen(false)}>
                            <X size={18} />
                        </button>
                    </div>
                    {renderTab()}
                </div>
            </div>
        </div>
    );
};

export default SettingsScreen;
