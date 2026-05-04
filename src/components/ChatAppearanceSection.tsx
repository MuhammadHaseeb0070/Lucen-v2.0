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
    } = useThemeStore();

    const settingsOpen = useThemeStore((s) => s.settingsOpen);

    /** Local overlay so color drag does not write Zustand (and localStorage persist) on every pointer move. */
    const [draftOverlay, setDraftOverlay] = useState<Partial<ThemeColors>>({});
    const prevSettingsOpenRef = useRef(settingsOpen);

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
