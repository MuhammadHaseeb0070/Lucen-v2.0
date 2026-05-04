import React, { useMemo } from 'react';
import {
    useThemeStore,
    THEME_PRESETS,
    THEME_SOLID_COLOR_KEYS,
    THEME_ALPHA_COLOR_KEYS,
    THEME_COLOR_LABELS,
    CHAT_FONT_OPTIONS,
    CHAT_SIZE_STEPS,
    CHAT_SIZE_LABELS,
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
        chatFontId,
        chatSizeStep,
        beginCustomTheme,
        setCustomBasePresetId,
        setCustomColor,
        resetCustomColors,
        setTheme,
        setChatFontId,
        setChatSizeStep,
        getResolvedTheme,
    } = useThemeStore();

    const basePreset = useMemo(
        () => THEME_PRESETS.find((t) => t.id === customBasePresetId) || THEME_PRESETS[0],
        [customBasePresetId]
    );

    const mergedColors = useMemo(() => {
        return { ...basePreset.colors, ...customColors } as ThemeColors;
    }, [basePreset.colors, customColors]);

    const isCustom = themeSource === 'custom';

    return (
        <div className="chat-appearance">
            <div className="chat-appearance__header">
                <SlidersHorizontal size={18} className="chat-appearance__header-icon" />
                <div>
                    <h4 className="chat-appearance__title">Chat look</h4>
                    <p className="chat-appearance__subtitle">
                        Font and text size apply to the main chat and Side Chat only. Custom colors replace the
                        active theme everywhere.
                    </p>
                </div>
            </div>

            <div className="chat-appearance__row chat-appearance__row--typography">
                <div className="chat-appearance__field">
                    <label className="chat-appearance__label" htmlFor="chat-font-select">
                        Chat font
                    </label>
                    <select
                        id="chat-font-select"
                        className="chat-appearance__select"
                        value={chatFontId}
                        onChange={(e) => {
                            setChatFontId(e.target.value as (typeof CHAT_FONT_OPTIONS)[number]['id']);
                        }}
                    >
                        {CHAT_FONT_OPTIONS.map((f) => (
                            <option key={f.id} value={f.id}>
                                {f.label}
                            </option>
                        ))}
                    </select>
                </div>
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
                            }}
                        >
                            <RotateCcw size={14} />
                            Reset to base
                        </button>
                        <button
                            type="button"
                            className="chat-appearance__btn-secondary"
                            onClick={() => {
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
                                            setCustomColor(key, e.target.value);
                                        }}
                                    />
                                    <input
                                        type="text"
                                        className="chat-appearance__hex-input"
                                        value={mergedColors[key]}
                                        onChange={(e) => {
                                            setCustomColor(key, e.target.value);
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
                                        setCustomColor(key, e.target.value);
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
