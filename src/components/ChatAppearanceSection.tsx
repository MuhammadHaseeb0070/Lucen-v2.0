import React, { useMemo, useCallback, useState, useEffect, useRef, useLayoutEffect } from 'react';
import {
    useThemeStore,
    THEME_PRESETS,
    THEME_SOLID_COLOR_KEYS,
    THEME_ALPHA_COLOR_KEYS,
    THEME_COLOR_LABELS,
    CHAT_SIZE_STEPS,
    CHAT_SIZE_LABELS,
    applyTheme,
    type ThemeColors,
} from '../store/themeStore';
import { SlidersHorizontal, RotateCcw } from 'lucide-react';

function hexForColorInput(css: string): string {
    const s = css.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s;
    if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
        const r = s[1];
        const g = s[2];
        const b = s[3];
        return `#${r}${r}${g}${g}${b}${b}`;
    }
    return '#888888';
}

function sanitizeColorValue(val: any): string | null {
    if (typeof val !== 'string') return null;
    const s = val.trim();
    // Strict blocklist for CSS vulnerabilities
    if (s.toLowerCase().includes('url(') || s.includes(';') || s.includes('}') || s.includes('{') || s.includes('var(') || s.includes('expression(')) {
        return null;
    }
    return s;
}

const ChatAppearanceSection: React.FC = () => {
    const {
        themeSource,
        customBasePresetId,
        customColors,
        chatSizeStep,
        beginCustomTheme,
        setCustomBasePresetId,
        patchCustomColors,
        resetCustomColors,
        setTheme,
        setChatSizeStep,
        getResolvedTheme,
        savedThemes,
        saveCustomTheme,
    } = useThemeStore();

    const settingsOpen = useThemeStore((s) => s.settingsOpen);

    /** Local overlay so color drag does not write Zustand (and localStorage persist) on every pointer move. */
    const [draftOverlay, setDraftOverlay] = useState<Partial<ThemeColors>>({});
    const prevSettingsOpenRef = useRef(settingsOpen);

    const [jsonInput, setJsonInput] = useState('');
    const [jsonError, setJsonError] = useState<string | null>(null);
    const [jsonSuccess, setJsonSuccess] = useState(false);
    const jsonTextareaRef = useRef<HTMLTextAreaElement>(null);

    const basePreset = useMemo(
        () => THEME_PRESETS.find((t) => t.id === customBasePresetId) || THEME_PRESETS[0],
        [customBasePresetId]
    );

    const mergedColors = useMemo(() => {
        return { ...basePreset.colors, ...customColors, ...draftOverlay } as ThemeColors;
    }, [basePreset.colors, customColors, draftOverlay]);

    const isCustom = themeSource === 'custom';

    const flushDraftToStore = useCallback(() => {
        const keys = Object.keys(draftOverlay) as (keyof ThemeColors)[];
        if (keys.length === 0) return;
        patchCustomColors(draftOverlay);
        setDraftOverlay({});
    }, [draftOverlay, patchCustomColors]);

    useEffect(() => {
        if (prevSettingsOpenRef.current && !settingsOpen) {
            flushDraftToStore();
        }
        prevSettingsOpenRef.current = settingsOpen;
    }, [settingsOpen, flushDraftToStore]);

    useEffect(() => {
        if (document.activeElement !== jsonTextareaRef.current) {
            setJsonInput(JSON.stringify(mergedColors, null, 2));
            setJsonError(null);
        }
    }, [mergedColors]);

    const handleApplyJson = useCallback(() => {
        setJsonError(null);
        setJsonSuccess(false);
        try {
            const parsed = JSON.parse(jsonInput);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                setJsonError("Invalid format: Must be a JSON object.");
                return;
            }

            const patch: Partial<ThemeColors> = {};
            const allKeys = [...THEME_SOLID_COLOR_KEYS, ...THEME_ALPHA_COLOR_KEYS];

            let foundValidKeys = 0;
            for (const key of allKeys) {
                if (key in parsed) {
                    const cleanVal = sanitizeColorValue(parsed[key]);
                    if (cleanVal) {
                        patch[key] = cleanVal;
                        foundValidKeys++;
                    }
                }
            }

            if (foundValidKeys === 0) {
                setJsonError("No valid color keys found in JSON.");
                return;
            }

            // Apply to store
            patchCustomColors(patch);
            // Also clear draft overlay in case it overrides
            setDraftOverlay({});
            
            setJsonSuccess(true);
            setTimeout(() => setJsonSuccess(false), 2000);
            
            // Sync back formatted version
            setJsonInput(JSON.stringify({ ...mergedColors, ...patch }, null, 2));
        } catch (e) {
            setJsonError("Invalid JSON syntax.");
        }
    }, [jsonInput, patchCustomColors, mergedColors]);

    /** Live preview while dragging (no Zustand persist until pointerup / blur). */
    useLayoutEffect(() => {
        if (Object.keys(draftOverlay).length === 0) return;
        const preset = useThemeStore.getState().getResolvedTheme();
        const previewColors = { ...preset.colors, ...draftOverlay };
        applyTheme({ ...preset, colors: previewColors });
    }, [draftOverlay]);

    return (
        <div className="chat-appearance">
            <div className="chat-appearance__header">
                <SlidersHorizontal size={18} className="chat-appearance__header-icon" />
                <div>
                    <h4 className="chat-appearance__title">Chat look</h4>
                    <p className="chat-appearance__subtitle">
                        Text size applies to the main chat and Side Chat only (app font unchanged). Custom colors
                        replace the active theme everywhere.
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
                                onClick={() => {
                                    setChatSizeStep(i);
                                }}
                            >
                                {CHAT_SIZE_LABELS[i]}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="chat-appearance__custom-head">
                <h4 className="chat-appearance__custom-title">Theme colors</h4>
                {!isCustom ? (
                    <button type="button" className="chat-appearance__btn-secondary" onClick={beginCustomTheme}>
                        Customize colors
                    </button>
                ) : (
                    <div className="chat-appearance__custom-actions">
                        <button
                            type="button"
                            className="chat-appearance__btn-ghost"
                            onClick={() => {
                                resetCustomColors();
                                setDraftOverlay({});
                            }}
                        >
                            <RotateCcw size={14} />
                            Reset to base
                        </button>
                        <button
                            type="button"
                            className="chat-appearance__btn-secondary"
                            onClick={() => {
                                flushDraftToStore();
                                setTheme(customBasePresetId);
                            }}
                        >
                            Use preset only
                        </button>
                        <button
                            type="button"
                            className="chat-appearance__btn-secondary"
                            disabled={savedThemes.length >= 3}
                            title={savedThemes.length >= 3 ? "Max 3 saved themes reached" : "Save as new theme"}
                            onClick={() => {
                                const name = window.prompt("Enter a name for your saved theme (max 30 chars):");
                                if (name && name.trim()) {
                                    flushDraftToStore();
                                    saveCustomTheme(name.trim());
                                }
                            }}
                        >
                            Save as new theme
                        </button>
                    </div>
                )}
            </div>

            {isCustom && (
                <>
                    <div className="chat-appearance__field">
                        <label className="chat-appearance__label" htmlFor="custom-base-preset">
                            Base preset
                        </label>
                        <select
                            id="custom-base-preset"
                            className="chat-appearance__select"
                            value={customBasePresetId}
                            onChange={(e) => {
                                flushDraftToStore();
                                setCustomBasePresetId(e.target.value);
                            }}
                        >
                            {THEME_PRESETS.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.emoji} {p.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="chat-appearance__color-grid">
                        {THEME_SOLID_COLOR_KEYS.map((key) => (
                            <div key={key} className="chat-appearance__color-row">
                                <span className="chat-appearance__color-label">{THEME_COLOR_LABELS[key]}</span>
                                <div className="chat-appearance__color-controls">
                                    <input
                                        type="color"
                                        className="chat-appearance__color-wheel"
                                        value={hexForColorInput(mergedColors[key])}
                                        aria-label={THEME_COLOR_LABELS[key]}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setDraftOverlay((d) => ({ ...d, [key]: v }));
                                        }}
                                        onPointerUp={(e) => {
                                            const v = (e.currentTarget as HTMLInputElement).value;
                                            patchCustomColors({ [key]: v } as Partial<ThemeColors>);
                                            setDraftOverlay((d) => {
                                                const next = { ...d };
                                                delete next[key];
                                                return next;
                                            });
                                        }}
                                    />
                                    <input
                                        type="text"
                                        className="chat-appearance__hex-input"
                                        value={mergedColors[key]}
                                        onChange={(e) => {
                                            setDraftOverlay((d) => ({ ...d, [key]: e.target.value }));
                                        }}
                                        onBlur={() => {
                                            const v = mergedColors[key];
                                            patchCustomColors({ [key]: v } as Partial<ThemeColors>);
                                            setDraftOverlay((d) => {
                                                const next = { ...d };
                                                delete next[key];
                                                return next;
                                            });
                                        }}
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
                                    value={mergedColors[key]}
                                    onChange={(e) => {
                                        setDraftOverlay((d) => ({ ...d, [key]: e.target.value }));
                                    }}
                                    onBlur={() => {
                                        const v = mergedColors[key];
                                        patchCustomColors({ [key]: v } as Partial<ThemeColors>);
                                        setDraftOverlay((d) => {
                                            const next = { ...d };
                                            delete next[key];
                                            return next;
                                        });
                                    }}
                                    spellCheck={false}
                                    placeholder="rgba(0,0,0,0.06)"
                                />
                            </div>
                        ))}
                    </div>

                    <div className="chat-appearance__json-section" style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h4 className="chat-appearance__color-label" style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)' }}>Advanced: Import/Export JSON</h4>
                            <button 
                                type="button" 
                                className="chat-appearance__btn-secondary"
                                onClick={handleApplyJson}
                            >
                                Apply JSON
                            </button>
                        </div>
                        <p className="chat-appearance__subtitle" style={{ margin: 0 }}>
                            Copy this JSON to ask an AI for a new theme, or paste an AI-generated theme here to apply it.
                        </p>
                        {jsonError && <div style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '4px' }}>{jsonError}</div>}
                        {jsonSuccess && <div style={{ color: 'var(--success)', fontSize: '13px', marginTop: '4px' }}>Successfully applied colors!</div>}
                        <textarea
                            ref={jsonTextareaRef}
                            value={jsonInput}
                            onChange={(e) => {
                                setJsonInput(e.target.value);
                                setJsonError(null);
                            }}
                            className="chat-appearance__hex-input"
                            style={{ width: '100%', height: '280px', resize: 'vertical', fontFamily: 'monospace', padding: '12px', whiteSpace: 'pre', borderRadius: '8px', lineHeight: '1.4' }}
                            spellCheck={false}
                        />
                    </div>
                </>
            )}

            {!isCustom && (
                <p className="chat-appearance__hint">
                    Preview: <strong>{getResolvedTheme().name}</strong> — open Customize to edit individual colors.
                </p>
            )}
        </div>
    );
};

export default ChatAppearanceSection;
