import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { schedulePersistUserSettings, parseAppearanceFromSettings } from '../services/userSettings';

export interface ThemeColors {
    bgBase: string;
    bgSurface: string;
    bgSurfaceHover: string;
    bgMuted: string;
    bgInset: string;
    textPrimary: string;
    textSecondary: string;
    textTertiary: string;
    accent: string;
    accentSoft: string;
    accentText: string;
    danger: string;
    success: string;
    warning: string;
    divider: string;
    shadow: string;
    userBubbleBg: string;
    userBubbleText: string;
    aiBubbleBg: string;
    aiBubbleBorder: string;
}

/** Keys edited as hex + color input (opaque colors). */
export const THEME_SOLID_COLOR_KEYS = [
    'bgBase',
    'bgSurface',
    'bgSurfaceHover',
    'bgMuted',
    'bgInset',
    'textPrimary',
    'textSecondary',
    'textTertiary',
    'accent',
    'accentText',
    'danger',
    'success',
    'warning',
    'userBubbleBg',
    'userBubbleText',
    'aiBubbleBg',
] as const satisfies readonly (keyof ThemeColors)[];

/** Keys that are often rgba — freeform string in UI. */
export const THEME_ALPHA_COLOR_KEYS = ['accentSoft', 'divider', 'shadow', 'aiBubbleBorder'] as const satisfies readonly (
    keyof ThemeColors
)[];

export type ThemeSolidColorKey = (typeof THEME_SOLID_COLOR_KEYS)[number];
export type ThemeAlphaColorKey = (typeof THEME_ALPHA_COLOR_KEYS)[number];

export const THEME_COLOR_LABELS: Record<keyof ThemeColors, string> = {
    bgBase: 'Background base',
    bgSurface: 'Surface',
    bgSurfaceHover: 'Surface hover',
    bgMuted: 'Muted background',
    bgInset: 'Inset / depth',
    textPrimary: 'Primary text',
    textSecondary: 'Secondary text',
    textTertiary: 'Tertiary text',
    accent: 'Accent',
    accentSoft: 'Accent soft (rgba)',
    accentText: 'On accent text',
    danger: 'Danger',
    success: 'Success',
    warning: 'Warning',
    divider: 'Dividers (rgba)',
    shadow: 'Shadow (rgba)',
    userBubbleBg: 'Your message bubble',
    userBubbleText: 'Your message text',
    aiBubbleBg: 'Assistant bubble',
    aiBubbleBorder: 'Assistant border (rgba)',
};

export const CHAT_SIZE_STEPS = [0.92, 0.96, 1, 1.06, 1.12] as const;
export const CHAT_SIZE_LABELS = ['Smaller', 'Small', 'Default', 'Large', 'Larger'] as const;

function mergeThemeColors(base: ThemeColors, partial: Partial<ThemeColors>): ThemeColors {
    return { ...base, ...partial };
}

export interface ThemePreset {
    id: string;
    name: string;
    emoji: string;
    category: 'curated' | 'warm' | 'cool' | 'focus';
    isDark: boolean;
    colors: ThemeColors;
}

export const THEME_PRESETS: ThemePreset[] = [

    // ═══════════════════════════════════════════════════════════════════════════
    {
        id: 'washi',
        name: 'Washi',
        emoji: '🪷',
        category: 'warm',
        isDark: false,
        colors: {
            bgBase: '#F5F0E8',
            bgSurface: '#FDFAF5',
            bgSurfaceHover: '#EDE8DE',
            bgMuted: '#E4DDD0',
            bgInset: '#D6CEC0',
            textPrimary: '#1C1810',
            textSecondary: '#6B6358',
            textTertiary: '#A09588',
            accent: '#3D6B5E',
            accentSoft: 'rgba(61, 107, 94, 0.08)',
            accentText: '#FFFFFF',
            danger: '#A83030',
            success: '#3A6B44',
            warning: '#9A6B20',
            divider: 'rgba(28, 24, 16, 0.07)',
            shadow: 'rgba(28, 24, 16, 0.04)',
            userBubbleBg: '#3D6B5E',
            userBubbleText: '#FFFFFF',
            aiBubbleBg: '#FDFAF5',
            aiBubbleBorder: 'rgba(28, 24, 16, 0.07)',
        },
    },
    // 1. LUCEN — Brand default. Kept exactly as-is.
    // ═══════════════════════════════════════════════════════════════════════════
    {
        id: 'lucen',
        name: 'Lucen',
        emoji: '✨',
        category: 'curated',
        isDark: false,
        colors: {
            bgBase: '#F7F7F9',
            bgSurface: '#FFFFFF',
            bgSurfaceHover: '#F1F1F4',
            bgMuted: '#EAEBEF',
            bgInset: '#E2E3E8',
            textPrimary: '#1E1E24',
            textSecondary: '#64646A',
            textTertiary: '#9A9A9F',
            accent: '#14B8A6',
            accentSoft: 'rgba(20, 184, 166, 0.1)',
            accentText: '#FFFFFF',
            danger: '#EF4444',
            success: '#10B981',
            warning: '#F59E0B',
            divider: 'rgba(0, 0, 0, 0.06)',
            shadow: 'rgba(0, 0, 0, 0.05)',
            userBubbleBg: '#14B8A6',
            userBubbleText: '#FFFFFF',
            aiBubbleBg: '#FFFFFF',
            aiBubbleBorder: 'rgba(0, 0, 0, 0.06)',
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. WASHI — Japanese washi paper + sumi-e ink. Kept exactly as-is.
    // ═══════════════════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. AMBER — Upgraded (contrast pattern aligned to Lucen roles).
    // ═══════════════════════════════════════════════════════════════════════════
    {
        id: 'amber',
        name: 'Amber',
        emoji: '🍂',
        category: 'warm',
        isDark: false,
        colors: {
            bgBase: '#F6F2EA',
            bgSurface: '#FFFCF7',
            bgSurfaceHover: '#F1ECE2',
            bgMuted: '#EDE5DB',
            bgInset: '#DDD4C7',

            textPrimary: '#1F1712',
            textSecondary: '#6B5E54',
            textTertiary: '#9C8E84',

            accent: '#CC6B3D',
            accentSoft: 'rgba(204, 107, 61, 0.1)',
            accentText: '#FFFFFF',

            danger: '#C93B34',
            success: '#2F7A4B',
            warning: '#9A6018',

            divider: 'rgba(0, 0, 0, 0.06)',
            shadow: 'rgba(0, 0, 0, 0.05)',

            userBubbleBg: '#CC6B3D',
            userBubbleText: '#FFFFFF',

            aiBubbleBg: '#FFFCF7',
            aiBubbleBorder: 'rgba(0, 0, 0, 0.06)',
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. LINEN — Upgraded (neutral ladder tuned for easier long reading).
    // ═══════════════════════════════════════════════════════════════════════════
    {
        id: 'linen',
        name: 'Linen',
        emoji: '🪡',
        category: 'cool',
        isDark: false,
        colors: {
            bgBase: '#F5F5F3',
            bgSurface: '#FFFFFF',
            bgSurfaceHover: '#EEEEEC',
            bgMuted: '#E6E6E3',
            bgInset: '#D8D8D6',

            textPrimary: '#1A1A1A',
            textSecondary: '#5F5F5F',
            textTertiary: '#8E8E8E',

            accent: '#2A2826',
            accentSoft: 'rgba(42, 40, 38, 0.07)',
            accentText: '#FFFFFF',

            danger: '#C03030',
            success: '#2E6840',
            warning: '#8A6018',

            divider: 'rgba(26, 26, 26, 0.07)',
            shadow: 'rgba(26, 26, 26, 0.03)',

            userBubbleBg: '#2A2826',
            userBubbleText: '#FFFFFF',

            aiBubbleBg: '#FFFFFF',
            aiBubbleBorder: 'rgba(26, 26, 26, 0.07)',
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // 5. PETAL — Upgraded (mauve tones kept, text ladder tightened).
    // ═══════════════════════════════════════════════════════════════════════════
    {
        id: 'petal',
        name: 'Petal',
        emoji: '🌸',
        category: 'warm',
        isDark: false,
        colors: {
            bgBase: '#F6F2FB',
            bgSurface: '#FEFCFF',
            bgSurfaceHover: '#EFE9F7',
            bgMuted: '#E8E0F2',
            bgInset: '#DCD4EC',

            textPrimary: '#1E1628',
            textSecondary: '#5F5472',
            textTertiary: '#907BA3',

            accent: '#A0709A',
            accentSoft: 'rgba(160, 112, 154, 0.1)',
            accentText: '#FFFFFF',

            danger: '#B03040',
            success: '#3A6848',
            warning: '#8A5E18',

            divider: 'rgba(0, 0, 0, 0.06)',
            shadow: 'rgba(0, 0, 0, 0.05)',

            userBubbleBg: '#A0709A',
            userBubbleText: '#FFFFFF',

            aiBubbleBg: '#FEFCFF',
            aiBubbleBorder: 'rgba(0, 0, 0, 0.06)',
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // 6. STUDIO — ChatGPT's neutral dark. Kept exactly as-is.
    // ═══════════════════════════════════════════════════════════════════════════
    {
        id: 'studio',
        name: 'Studio',
        emoji: '💬',
        category: 'curated',
        isDark: true,
        colors: {
            bgBase: '#212121',
            bgSurface: '#2F2F2F',
            bgSurfaceHover: '#3A3A3A',
            bgMuted: '#2A2A2A',
            bgInset: '#171717',
            textPrimary: '#ECECEC',
            textSecondary: '#9B9B9B',
            textTertiary: '#686868',
            accent: '#10A37F',
            accentSoft: 'rgba(16, 163, 127, 0.1)',
            accentText: '#FFFFFF',
            danger: '#E05555',
            success: '#10A37F',
            warning: '#C8A030',
            divider: 'rgba(255, 255, 255, 0.08)',
            shadow: 'rgba(0, 0, 0, 0.5)',
            userBubbleBg: '#10A37F',
            userBubbleText: '#FFFFFF',
            aiBubbleBg: '#2F2F2F',
            aiBubbleBorder: 'rgba(255, 255, 255, 0.08)',
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // 7. VERDIGRIS — Upgraded (neutral divider, text ladder tightened).
    // ═══════════════════════════════════════════════════════════════════════════
    // {
    //     id: 'verdigris',
    //     name: 'Verdigris',
    //     emoji: '🏛️',
    //     category: 'focus',
    //     isDark: true,
    //     colors: {
    //         bgBase: '#141918',
    //         bgSurface: '#1C2320',
    //         bgSurfaceHover: '#242E2A',
    //         bgMuted: '#1A2220',
    //         bgInset: '#0D1210',

    //         textPrimary: '#D7E0DB',
    //         textSecondary: '#7FA39A',
    //         textTertiary: '#4F6B63',

    //         accent: '#5BA89A',
    //         accentSoft: 'rgba(91, 168, 154, 0.1)',
    //         accentText: '#FFFFFF',

    //         danger: '#D05858',
    //         success: '#5AAA7A',
    //         warning: '#C8A840',

    //         divider: 'rgba(255, 255, 255, 0.08)',
    //         shadow: 'rgba(0, 0, 0, 0.5)',

    //         userBubbleBg: '#5BA89A',
    //         userBubbleText: '#FFFFFF',

    //         aiBubbleBg: '#1C2320',
    //         aiBubbleBorder: 'rgba(255, 255, 255, 0.08)',
    //     },
    // },

    // ═══════════════════════════════════════════════════════════════════════════
    // 8. TERMINAL — Upgraded (divider neutral like Studio to reduce glare).
    // ═══════════════════════════════════════════════════════════════════════════
    // {
    //     id: 'terminal',
    //     name: 'Terminal',
    //     emoji: '⚡',
    //     category: 'focus',
    //     isDark: true,
    //     colors: {
    //         bgBase: '#0E0E0E',
    //         bgSurface: '#161616',
    //         bgSurfaceHover: '#202020',
    //         bgMuted: '#141414',
    //         bgInset: '#080808',

    //         textPrimary: '#F0F0F0',
    //         textSecondary: '#9B9B9B',
    //         textTertiary: '#686868',

    //         accent: '#C8FF00',
    //         accentSoft: 'rgba(200, 255, 0, 0.1)',
    //         accentText: '#0E0E0E',

    //         danger: '#FF5555',
    //         success: '#55DD88',
    //         warning: '#FFCC44',

    //         divider: 'rgba(255, 255, 255, 0.08)',
    //         shadow: 'rgba(0, 0, 0, 0.5)',

    //         userBubbleBg: '#C8FF00',
    //         userBubbleText: '#0E0E0E',

    //         aiBubbleBg: '#161616',
    //         aiBubbleBorder: 'rgba(255, 255, 255, 0.08)',
    //     },
    // }, 
    // {
    //     id: 'ocean',
    //     name: 'Ocean',
    //     emoji: '🌊',
    //     category: 'cool',
    //     isDark: false,
    //     colors: {
    //         bgBase: '#F2F7FF',
    //         bgSurface: '#FFFFFF',
    //         bgSurfaceHover: '#EEF5FF',
    //         bgMuted: '#E3ECFA',
    //         bgInset: '#D9E4F6',

    //         textPrimary: '#0E1A2B',
    //         textSecondary: '#3E556D',
    //         textTertiary: '#6E7E93',

    //         accent: '#0EA5E9',
    //         accentSoft: 'rgba(14, 165, 233, 0.1)',
    //         accentText: '#FFFFFF',

    //         danger: '#EF4444',
    //         success: '#22C55E',
    //         warning: '#F59E0B',

    //         divider: 'rgba(0, 0, 0, 0.06)',
    //         shadow: 'rgba(0, 0, 0, 0.05)',

    //         userBubbleBg: '#0EA5E9',
    //         userBubbleText: '#FFFFFF',
    //         aiBubbleBg: '#FFFFFF',
    //         aiBubbleBorder: 'rgba(0, 0, 0, 0.06)',
    //     },
    // },

    // // ═══════════════════════════════════════════════════════════════════════════
    // // 10. FOREST - Soft greens, calm focus (light).
    // // ═══════════════════════════════════════════════════════════════════════════
    // {
    //     id: 'forest',
    //     name: 'Forest',
    //     emoji: '🌿',
    //     category: 'focus',
    //     isDark: false,
    //     colors: {
    //         bgBase: '#F4F7F2',
    //         bgSurface: '#FFFFFF',
    //         bgSurfaceHover: '#EDF4E8',
    //         bgMuted: '#E3E9DA',
    //         bgInset: '#D4DEC7',

    //         textPrimary: '#132015',
    //         textSecondary: '#435A43',
    //         textTertiary: '#6B7D67',

    //         accent: '#16A34A',
    //         accentSoft: 'rgba(22, 163, 74, 0.1)',
    //         accentText: '#FFFFFF',

    //         danger: '#DC2626',
    //         success: '#15803D',
    //         warning: '#D97706',

    //         divider: 'rgba(0, 0, 0, 0.06)',
    //         shadow: 'rgba(0, 0, 0, 0.05)',

    //         userBubbleBg: '#16A34A',
    //         userBubbleText: '#FFFFFF',
    //         aiBubbleBg: '#FFFFFF',
    //         aiBubbleBorder: 'rgba(0, 0, 0, 0.06)',
    //     },
    // },

    // // ═══════════════════════════════════════════════════════════════════════════
    // // 11. INDIGO - Editorial cool tone with strong accent clarity (light).
    // // ═══════════════════════════════════════════════════════════════════════════
    // {
    //     id: 'indigo',
    //     name: 'Indigo',
    //     emoji: '🟦',
    //     category: 'curated',
    //     isDark: false,
    //     colors: {
    //         bgBase: '#F5F7FF',
    //         bgSurface: '#FFFFFF',
    //         bgSurfaceHover: '#EEF1FF',
    //         bgMuted: '#E6EAFB',
    //         bgInset: '#DCE2FA',

    //         textPrimary: '#0F172A',
    //         textSecondary: '#374151',
    //         textTertiary: '#6B7280',

    //         accent: '#4F46E5',
    //         accentSoft: 'rgba(79, 70, 229, 0.1)',
    //         accentText: '#FFFFFF',

    //         danger: '#EF4444',
    //         success: '#22C55E',
    //         warning: '#F59E0B',

    //         divider: 'rgba(0, 0, 0, 0.06)',
    //         shadow: 'rgba(0, 0, 0, 0.05)',

    //         userBubbleBg: '#4F46E5',
    //         userBubbleText: '#FFFFFF',
    //         aiBubbleBg: '#FFFFFF',
    //         aiBubbleBorder: 'rgba(0, 0, 0, 0.06)',
    //     },
    // },

    // ═══════════════════════════════════════════════════════════════════════════
    // 12. AURORA - Calm dark cyan glow (dark).
    // ═══════════════════════════════════════════════════════════════════════════
    // {
    //     id: 'aurora',
    //     name: 'Aurora',
    //     emoji: '🟢',
    //     category: 'focus',
    //     isDark: true,
    //     colors: {
    //         bgBase: '#061317',
    //         bgSurface: '#0A1D23',
    //         bgSurfaceHover: '#0F2B33',
    //         bgMuted: '#08171B',
    //         bgInset: '#040B0E',

    //         textPrimary: '#E6FBFF',
    //         textSecondary: '#7FB0B9',
    //         textTertiary: '#4C6E77',

    //         accent: '#22D3EE',
    //         accentSoft: 'rgba(34, 211, 238, 0.12)',
    //         accentText: '#061317',

    //         danger: '#FF5C5C',
    //         success: '#34D399',
    //         warning: '#FBBF24',

    //         divider: 'rgba(255, 255, 255, 0.08)',
    //         shadow: 'rgba(0, 0, 0, 0.5)',

    //         userBubbleBg: '#22D3EE',
    //         userBubbleText: '#061317',
    //         aiBubbleBg: '#0A1D23',
    //         aiBubbleBorder: 'rgba(255, 255, 255, 0.08)',
    //     },
    // },

    // ═══════════════════════════════════════════════════════════════════════════
    // 13. MIDNIGHT - Neutral dark with violet clarity (dark).
    // ═══════════════════════════════════════════════════════════════════════════
    // {
    //     id: 'midnight',
    //     name: 'Midnight',
    //     emoji: '🌙',
    //     category: 'curated',
    //     isDark: true,
    //     colors: {
    //         bgBase: '#0B0B12',
    //         bgSurface: '#141424',
    //         bgSurfaceHover: '#1B1B31',
    //         bgMuted: '#10101E',
    //         bgInset: '#07070C',

    //         textPrimary: '#EEEAFB',
    //         textSecondary: '#A7A0BF',
    //         textTertiary: '#6B658A',

    //         accent: '#A78BFA',
    //         accentSoft: 'rgba(167, 139, 250, 0.12)',
    //         accentText: '#0B0B12',

    //         danger: '#FB7185',
    //         success: '#34D399',
    //         warning: '#FBBF24',

    //         divider: 'rgba(255, 255, 255, 0.08)',
    //         shadow: 'rgba(0, 0, 0, 0.5)',

    //         userBubbleBg: '#A78BFA',
    //         userBubbleText: '#0B0B12',
    //         aiBubbleBg: '#141424',
    //         aiBubbleBorder: 'rgba(255, 255, 255, 0.08)',
    //     },
    // },

    // // ═══════════════════════════════════════════════════════════════════════════
    // // 14. SUNSET - Warm dark for cozy long reads (dark).
    // // ═══════════════════════════════════════════════════════════════════════════
    // {
    //     id: 'sunset',
    //     name: 'Sunset',
    //     emoji: '🔥',
    //     category: 'warm',
    //     isDark: true,
    //     colors: {
    //         bgBase: '#120A07',
    //         bgSurface: '#1C110D',
    //         bgSurfaceHover: '#241713',
    //         bgMuted: '#160F0B',
    //         bgInset: '#0B0503',

    //         textPrimary: '#FFF3EC',
    //         textSecondary: '#DDAF8F',
    //         textTertiary: '#A67B62',

    //         accent: '#F97316',
    //         accentSoft: 'rgba(249, 115, 22, 0.12)',
    //         accentText: '#120A07',

    //         danger: '#FB7185',
    //         success: '#34D399',
    //         warning: '#FBBF24',

    //         divider: 'rgba(255, 255, 255, 0.08)',
    //         shadow: 'rgba(0, 0, 0, 0.5)',

    //         userBubbleBg: '#F97316',
    //         userBubbleText: '#120A07',
    //         aiBubbleBg: '#1C110D',
    //         aiBubbleBorder: 'rgba(255, 255, 255, 0.08)',
    //     },
    // }

];

// ─── Theme Store ───
export type ThemeSource = 'preset' | 'custom';

const SYNC_DEBOUNCE_MS = 400;
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function flushAppearanceSyncToServer(): void {
    const s = useThemeStore.getState();
    const active_theme = s.themeSource === 'custom' ? 'custom' : s.activeThemeId;
    const appearance = {
        themeSource: s.themeSource,
        activeThemeId: s.activeThemeId,
        customBasePresetId: s.customBasePresetId,
        customColors: s.customColors,
        chatSizeStep: s.chatSizeStep,
    };
    schedulePersistUserSettings({
        active_theme,
        settings: { appearance },
    });
}

/** Debounced Supabase sync so rapid theme edits (e.g. color drag) do not queue hundreds of timers. */
function scheduleAppearanceSyncToServer(): void {
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => {
        syncDebounceTimer = null;
        flushAppearanceSyncToServer();
    }, SYNC_DEBOUNCE_MS);
}

function buildThemeApplyFingerprint(): string {
    const s = useThemeStore.getState();
    const t = s.getResolvedTheme();
    const c = t.colors;
    return JSON.stringify({
        themeSource: s.themeSource,
        activeThemeId: s.activeThemeId,
        customBasePresetId: s.customBasePresetId,
        customColors: s.customColors,
        chatSizeStep: s.chatSizeStep,
        bgBase: c.bgBase,
        bgSurface: c.bgSurface,
        bgSurfaceHover: c.bgSurfaceHover,
        bgMuted: c.bgMuted,
        bgInset: c.bgInset,
        textPrimary: c.textPrimary,
        textSecondary: c.textSecondary,
        textTertiary: c.textTertiary,
        accent: c.accent,
        accentSoft: c.accentSoft,
        accentText: c.accentText,
        danger: c.danger,
        success: c.success,
        warning: c.warning,
        divider: c.divider,
        shadow: c.shadow,
        userBubbleBg: c.userBubbleBg,
        userBubbleText: c.userBubbleText,
        aiBubbleBg: c.aiBubbleBg,
        aiBubbleBorder: c.aiBubbleBorder,
    });
}

let lastThemeApplyFingerprint = '';

interface ThemeStore {
    activeThemeId: string;
    themeSource: ThemeSource;
    customBasePresetId: string;
    customColors: Partial<ThemeColors>;
    chatSizeStep: number;

    settingsOpen: boolean;
    settingsTab: string;

    setTheme: (id: string) => void;
    setCustomBasePresetId: (id: string) => void;
    setCustomColor: (key: keyof ThemeColors, value: string) => void;
    patchCustomColors: (patch: Partial<ThemeColors>) => void;
    resetCustomColors: () => void;
    beginCustomTheme: () => void;
    getResolvedTheme: () => ThemePreset;
    getActiveTheme: () => ThemePreset;
    hydrateFromServerRow: (row: { active_theme: string; settings: Record<string, unknown> }) => void;

    toggleSettings: () => void;
    setSettingsOpen: (open: boolean) => void;
    setSettingsTab: (tab: string) => void;
    setChatSizeStep: (step: number) => void;
}

const DEFAULT_CHAT_SIZE_STEP = 2;

function resolveThemeFromState(state: {
    themeSource: ThemeSource;
    activeThemeId: string;
    customBasePresetId: string;
    customColors: Partial<ThemeColors>;
}): ThemePreset {
    if (state.themeSource === 'preset') {
        return THEME_PRESETS.find((t) => t.id === state.activeThemeId) || THEME_PRESETS[0];
    }
    const base =
        THEME_PRESETS.find((t) => t.id === state.customBasePresetId) || THEME_PRESETS[0];
    const colors = mergeThemeColors(base.colors, state.customColors);
    return {
        ...base,
        id: 'custom',
        name: 'Custom',
        emoji: '✎',
        colors,
    };
}

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set, get) => ({
            activeThemeId: 'washi',
            themeSource: 'preset' as ThemeSource,
            customBasePresetId: 'washi',
            customColors: {} as Partial<ThemeColors>,
            chatSizeStep: DEFAULT_CHAT_SIZE_STEP,

            settingsOpen: false,
            settingsTab: 'appearance',

            setTheme: (id) => {
                set({
                    activeThemeId: id,
                    themeSource: 'preset',
                    customColors: {},
                });
                scheduleAppearanceSyncToServer();
            },

            setCustomBasePresetId: (customBasePresetId) => {
                const base = THEME_PRESETS.find((t) => t.id === customBasePresetId) || THEME_PRESETS[0];
                set({
                    customBasePresetId: base.id,
                    customColors: {},
                    themeSource: 'custom',
                });
                scheduleAppearanceSyncToServer();
            },

            setCustomColor: (key, value) => {
                set((s) => ({
                    customColors: { ...s.customColors, [key]: value },
                    themeSource: 'custom' as ThemeSource,
                }));
                scheduleAppearanceSyncToServer();
            },

            patchCustomColors: (patch) => {
                set((s) => ({
                    customColors: { ...s.customColors, ...patch },
                    themeSource: 'custom' as ThemeSource,
                }));
                scheduleAppearanceSyncToServer();
            },

            resetCustomColors: () => {
                set((s) => ({
                    customColors: {},
                    customBasePresetId: s.customBasePresetId,
                    themeSource: 'custom' as ThemeSource,
                }));
                scheduleAppearanceSyncToServer();
            },

            beginCustomTheme: () => {
                const s = get();
                const baseId =
                    s.themeSource === 'preset'
                        ? s.activeThemeId
                        : s.customBasePresetId;
                const base = THEME_PRESETS.find((t) => t.id === baseId) || THEME_PRESETS[0];
                set({
                    themeSource: 'custom',
                    customBasePresetId: base.id,
                    customColors: {},
                });
                scheduleAppearanceSyncToServer();
            },

            getResolvedTheme: () => resolveThemeFromState(get()),

            getActiveTheme: () => resolveThemeFromState(get()),

            hydrateFromServerRow: (row) => {
                const appearance = parseAppearanceFromSettings(row.settings);
                const known = (id: string) => THEME_PRESETS.some((t) => t.id === id);

                const clampStep = (n: number | undefined) =>
                    Math.max(0, Math.min(CHAT_SIZE_STEPS.length - 1, n ?? DEFAULT_CHAT_SIZE_STEP));

                if (appearance) {
                    const chatSizeStep = clampStep(appearance.chatSizeStep);

                    if (appearance.themeSource === 'custom') {
                        const customBasePresetId =
                            appearance.customBasePresetId && known(appearance.customBasePresetId)
                                ? appearance.customBasePresetId
                                : 'washi';
                        set({
                            themeSource: 'custom',
                            customBasePresetId,
                            activeThemeId:
                                appearance.activeThemeId && known(appearance.activeThemeId)
                                    ? appearance.activeThemeId
                                    : customBasePresetId,
                            customColors: (appearance.customColors as Partial<ThemeColors>) || {},
                            chatSizeStep,
                        });
                    } else {
                        const fromRow =
                            row.active_theme && row.active_theme !== 'custom' && known(row.active_theme)
                                ? row.active_theme
                                : null;
                        const activeThemeId =
                            appearance.activeThemeId && known(appearance.activeThemeId)
                                ? appearance.activeThemeId
                                : fromRow || 'washi';
                        set({
                            themeSource: 'preset',
                            activeThemeId,
                            customBasePresetId: 'washi',
                            customColors: {},
                            chatSizeStep,
                        });
                    }
                    return;
                }

                if (row.active_theme && row.active_theme !== 'custom' && known(row.active_theme)) {
                    set({
                        themeSource: 'preset',
                        activeThemeId: row.active_theme,
                        customBasePresetId: 'washi',
                        customColors: {},
                    });
                }
            },

            toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
            setSettingsOpen: (open) => set({ settingsOpen: open }),
            setSettingsTab: (tab) => set({ settingsTab: tab }),

            setChatSizeStep: (chatSizeStep) => {
                const step = Math.max(0, Math.min(CHAT_SIZE_STEPS.length - 1, Math.round(chatSizeStep)));
                set({ chatSizeStep: step });
                scheduleAppearanceSyncToServer();
            },
        }),
        {
            name: 'lucen-theme-storage',
            version: 3,
            onRehydrateStorage: () => () => {
                lastThemeApplyFingerprint = '';
                applyThemeFromStore();
            },
            migrate: (persisted, fromVersion) => {
                const p = persisted as Record<string, unknown>;
                if (fromVersion < 2) {
                    if (p.themeSource === undefined) p.themeSource = 'preset';
                    if (p.customBasePresetId === undefined) {
                        p.customBasePresetId =
                            typeof p.activeThemeId === 'string' && p.activeThemeId ? p.activeThemeId : 'washi';
                    }
                    if (p.customColors === undefined) p.customColors = {};
                    if (p.chatSizeStep === undefined) p.chatSizeStep = DEFAULT_CHAT_SIZE_STEP;
                    if (p.activeThemeId === undefined || p.activeThemeId === '') p.activeThemeId = 'washi';
                }
                if (fromVersion < 3) {
                    delete p.chatFontId;
                }
                return persisted as typeof persisted;
            },
            partialize: (s) => ({
                activeThemeId: s.activeThemeId,
                themeSource: s.themeSource,
                customBasePresetId: s.customBasePresetId,
                customColors: s.customColors,
                chatSizeStep: s.chatSizeStep,
            }),
        }
    )
);

/** Apply theme color CSS variables to document root */
export function applyTheme(theme: ThemePreset): void {
    const root = document.documentElement;
    const c = theme.colors;
    root.style.setProperty('--bg-base', c.bgBase);
    root.style.setProperty('--bg-surface', c.bgSurface);
    root.style.setProperty('--bg-surface-hover', c.bgSurfaceHover);
    root.style.setProperty('--bg-muted', c.bgMuted);
    root.style.setProperty('--bg-inset', c.bgInset);
    root.style.setProperty('--text-primary', c.textPrimary);
    root.style.setProperty('--text-secondary', c.textSecondary);
    root.style.setProperty('--text-tertiary', c.textTertiary);
    root.style.setProperty('--accent', c.accent);
    root.style.setProperty('--accent-soft', c.accentSoft);
    root.style.setProperty('--accent-text', c.accentText);
    root.style.setProperty('--danger', c.danger);
    root.style.setProperty('--success', c.success);
    root.style.setProperty('--warning', c.warning);
    root.style.setProperty('--divider', c.divider);
    root.style.setProperty('--shadow-color', c.shadow);
    root.style.setProperty('--user-bubble-bg', c.userBubbleBg);
    root.style.setProperty('--user-bubble-text', c.userBubbleText);
    root.style.setProperty('--ai-bubble-bg', c.aiBubbleBg);
    root.style.setProperty('--ai-bubble-border', c.aiBubbleBorder);
}

export function applyChatFontScale(sizeStep: number): void {
    const root = document.documentElement;
    const step = Math.max(0, Math.min(CHAT_SIZE_STEPS.length - 1, sizeStep));
    const scale = CHAT_SIZE_STEPS[step];
    root.style.setProperty('--chat-font-scale', String(scale));
}

/** Apply resolved theme colors + chat font scale (call after hydration or store changes). */
export function applyThemeFromStore(): void {
    const fp = buildThemeApplyFingerprint();
    if (fp === lastThemeApplyFingerprint) return;
    lastThemeApplyFingerprint = fp;
    const s = useThemeStore.getState();
    const preset = s.getResolvedTheme();
    applyTheme(preset);
    applyChatFontScale(s.chatSizeStep);
}
