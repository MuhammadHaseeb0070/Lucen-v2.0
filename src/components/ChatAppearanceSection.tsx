import React, { useState, useEffect, useRef } from 'react';
import {
    useThemeStore,
    THEME_PRESETS,
    THEME_SOLID_COLOR_KEYS,
    THEME_ALPHA_COLOR_KEYS,
    THEME_COLOR_LABELS,
    CHAT_SIZE_STEPS,
    CHAT_SIZE_LABELS,
    type ThemeColors,
} from '../store/themeStore';
import { SlidersHorizontal, Plus, Trash2 } from 'lucide-react';

function hexForColorInput(css: string): string {
    const s = css.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s;
    if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
        const r = s[1]; const g = s[2]; const b = s[3];
        return `#${r}${r}${g}${g}${b}${b}`;
    }
    return '#888888';
}

function sanitizeColorValue(val: any): string | null {
    if (typeof val !== 'string') return null;
    const s = val.trim();
    if (s.toLowerCase().includes('url(') || s.includes(';') || s.includes('}') || s.includes('{') || s.includes('var(') || s.includes('expression(')) {
        return null;
    }
    return s;
}

const ThemeSwatch: React.FC<{ colors: ThemeColors, name: string, isActive: boolean, onClick: () => void, onDelete?: () => void }> = ({ colors, name, isActive, onClick, onDelete }) => (
    <div className={`theme-swatch ${isActive ? 'theme-swatch--active' : ''}`} onClick={onClick}>
        <div className="theme-swatch__preview" style={{ backgroundColor: colors.bgBase, borderColor: colors.divider }}>
            <div className="theme-swatch__bubble theme-swatch__bubble--ai" style={{ backgroundColor: colors.aiBubbleBg, borderColor: colors.aiBubbleBorder }}></div>
            <div className="theme-swatch__bubble theme-swatch__bubble--user" style={{ backgroundColor: colors.userBubbleBg, color: colors.userBubbleText }}></div>
        </div>
        <div className="theme-swatch__info">
            <span className="theme-swatch__name">{name}</span>
            {onDelete && (
                <button className="theme-swatch__delete" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
                    <Trash2 size={14} />
                </button>
            )}
        </div>
    </div>
);

const ChatAppearanceSection: React.FC = () => {
    const {
        activeThemeId,
        chatSizeStep,
        savedThemes,
        setTheme,
        createCustomTheme,
        updateCustomTheme,
        deleteSavedTheme,
        getResolvedTheme,
        setChatSizeStep,
    } = useThemeStore();

    const editorRef = useRef<HTMLDivElement>(null);
    const resolvedTheme = getResolvedTheme();
    const isCustom = activeThemeId.startsWith('user_theme_');

    const [jsonInput, setJsonInput] = useState('');
    const [jsonError, setJsonError] = useState<string | null>(null);

    // Sync JSON input when the active theme changes (but only if we aren't focused in it)
    const jsonTextareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (document.activeElement !== jsonTextareaRef.current) {
            setJsonInput(JSON.stringify(resolvedTheme.colors, null, 2));
            setJsonError(null);
        }
    }, [resolvedTheme.colors, activeThemeId]);

    const handleJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setJsonInput(val);
        setJsonError(null);

        if (!isCustom) return;

        try {
            const parsed = JSON.parse(val);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                setJsonError("Invalid format: Must be a JSON object.");
                return;
            }

            const patch: Partial<ThemeColors> = {};
            const allKeys = [...THEME_SOLID_COLOR_KEYS, ...THEME_ALPHA_COLOR_KEYS];
            for (const key of allKeys) {
                if (key in parsed) {
                    const cleanVal = sanitizeColorValue(parsed[key]);
                    if (cleanVal) patch[key] = cleanVal;
                }
            }
            
            if (Object.keys(patch).length > 0) {
                updateCustomTheme(activeThemeId, patch);
            }
        } catch (err) {
            setJsonError("Invalid JSON syntax.");
        }
    };

    const handleCreateTheme = () => {
        const id = createCustomTheme();
        if (id) {
            setTimeout(() => {
                editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    };

    return (
        <div className="chat-appearance">
            <div className="chat-appearance__header">
                <SlidersHorizontal size={18} className="chat-appearance__header-icon" />
                <div>
                    <h4 className="chat-appearance__title">Appearance</h4>
                    <p className="chat-appearance__subtitle">
                        Customize your workspace aesthetics and chat size.
                    </p>
                </div>
            </div>

            <div className="chat-appearance__row chat-appearance__row--typography">
                <div className="chat-appearance__field chat-appearance__field--grow">
                    <span className="chat-appearance__label">Text size</span>
                    <div className="chat-appearance__stepper" role="group" aria-label="Chat text size">
                        {CHAT_SIZE_STEPS.map((_, i) => (
                            <button
                                key={i}
                                type="button"
                                className={`chat-appearance__step-btn ${chatSizeStep === i ? 'chat-appearance__step-btn--active' : ''}`}
                                onClick={() => setChatSizeStep(i)}
                            >
                                {CHAT_SIZE_LABELS[i]}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="chat-appearance__section-title" style={{ marginTop: '24px', fontWeight: 600, color: 'var(--text-primary)' }}>Premade Themes</div>
            <div className="chat-appearance__themes-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', marginTop: '12px' }}>
                {THEME_PRESETS.map((p) => (
                    <ThemeSwatch 
                        key={p.id} 
                        colors={p.colors} 
                        name={p.name} 
                        isActive={activeThemeId === p.id}
                        onClick={() => setTheme(p.id)}
                    />
                ))}
            </div>

            <div className="chat-appearance__section-title" style={{ marginTop: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontWeight: 600, color: 'var(--text-primary)' }}>
                <div>
                    Your Custom Themes
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 400, marginTop: '4px', maxWidth: '400px', lineHeight: 1.4 }}>
                        You can create up to 3 custom themes. Either create from scratch or pick any premade theme and click edit to create a new version of it without replacing the original.
                    </p>
                </div>
                <button 
                    className="chat-appearance__btn-secondary" 
                    onClick={handleCreateTheme}
                    disabled={savedThemes.length >= 3}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                >
                    <Plus size={14} /> Create New ({savedThemes.length}/3)
                </button>
            </div>
            
            {savedThemes.length === 0 ? (
                <div className="chat-appearance__empty-state" style={{ marginTop: '12px', padding: '24px', textAlign: 'center', backgroundColor: 'var(--bg-inset)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                    You haven't created any custom themes yet.
                </div>
            ) : (
                <div className="chat-appearance__themes-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', marginTop: '12px' }}>
                    {savedThemes.map((p) => (
                        <ThemeSwatch 
                            key={p.id} 
                            colors={p.colors as unknown as ThemeColors} 
                            name={p.name} 
                            isActive={activeThemeId === p.id}
                            onClick={() => setTheme(p.id)}
                            onDelete={() => deleteSavedTheme(p.id)}
                        />
                    ))}
                </div>
            )}

            <div ref={editorRef} className={`chat-appearance__editor-section ${!isCustom ? 'chat-appearance__editor-section--disabled' : ''}`} style={{ marginTop: '48px', position: 'relative' }}>
                {!isCustom && (
                    <div className="chat-appearance__editor-overlay" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(var(--bg-base-rgb), 0.7)', backdropFilter: 'blur(4px)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '12px' }}>
                        <div style={{ backgroundColor: 'var(--bg-surface)', padding: '16px 24px', borderRadius: '8px', border: '1px solid var(--divider)', textAlign: 'center', boxShadow: 'var(--shadow-color) 0 8px 24px' }}>
                            <h4 style={{ margin: '0 0 8px 0', color: 'var(--text-primary)' }}>Read Only</h4>
                            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px' }}>Select or create a custom theme to edit colors.</p>
                        </div>
                    </div>
                )}
                
                <h4 className="chat-appearance__custom-title">Color Editor</h4>
                <div className="chat-appearance__color-grid">
                    {THEME_SOLID_COLOR_KEYS.map((key) => (
                        <div key={key} className="chat-appearance__color-row">
                            <span className="chat-appearance__color-label">{THEME_COLOR_LABELS[key]}</span>
                            <div className="chat-appearance__color-controls">
                                <input
                                    type="color"
                                    className="chat-appearance__color-wheel"
                                    value={hexForColorInput(resolvedTheme.colors[key])}
                                    onChange={(e) => {
                                        if (isCustom) updateCustomTheme(activeThemeId, { [key]: e.target.value });
                                    }}
                                    disabled={!isCustom}
                                />
                                <input
                                    type="text"
                                    className="chat-appearance__hex-input"
                                    value={resolvedTheme.colors[key]}
                                    onChange={(e) => {
                                        if (isCustom) updateCustomTheme(activeThemeId, { [key]: e.target.value });
                                    }}
                                    disabled={!isCustom}
                                    spellCheck={false}
                                />
                            </div>
                        </div>
                    ))}
                    {THEME_ALPHA_COLOR_KEYS.map((key) => (
                        <div key={key} className="chat-appearance__color-row chat-appearance__color-row--full">
                            <span className="chat-appearance__color-label">{THEME_COLOR_LABELS[key]}</span>
                            <input
                                type="text"
                                className="chat-appearance__hex-input chat-appearance__hex-input--wide"
                                value={resolvedTheme.colors[key]}
                                onChange={(e) => {
                                    if (isCustom) updateCustomTheme(activeThemeId, { [key]: e.target.value });
                                }}
                                disabled={!isCustom}
                                spellCheck={false}
                            />
                        </div>
                    ))}
                </div>

                <div className="chat-appearance__json-section" style={{ marginTop: '32px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <h4 className="chat-appearance__color-label" style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)' }}>Advanced: JSON Editor</h4>
                    <p className="chat-appearance__subtitle" style={{ margin: 0 }}>
                        Edits sync automatically. Paste a generated theme here.
                    </p>
                    {jsonError && <div style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '4px' }}>{jsonError}</div>}
                    <textarea
                        ref={jsonTextareaRef}
                        value={jsonInput}
                        onChange={handleJsonChange}
                        disabled={!isCustom}
                        className="chat-appearance__hex-input"
                        style={{ width: '100%', height: '280px', resize: 'vertical', fontFamily: 'monospace', padding: '12px', whiteSpace: 'pre', borderRadius: '8px', lineHeight: '1.4' }}
                        spellCheck={false}
                    />
                </div>
            </div>
        </div>
    );
};

export default ChatAppearanceSection;
