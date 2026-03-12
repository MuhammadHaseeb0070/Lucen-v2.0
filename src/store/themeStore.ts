import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

export interface ThemePreset {
    id: string;
    name: string;
    emoji: string;
    category: 'curated' | 'warm' | 'cool' | 'focus';
    isDark: boolean;
    colors: ThemeColors;
}

export const THEME_PRESETS: ThemePreset[] = [
    // ─── CURATED ───
    {
        id: 'lucen',
        name: 'Lucen',
        emoji: '💎',
        category: 'curated',
        isDark: false,
        colors: {
            bgBase: '#f5f5f5',
            bgSurface: '#ffffff',
            bgSurfaceHover: '#f0f0f0',
            bgMuted: '#eceef0',
            bgInset: '#e4e6e9',
            textPrimary: '#1a1d21',
            textSecondary: '#5f6368',
            textTertiary: '#9aa0a6',
            accent: '#0bbaa8',
            accentSoft: 'rgba(11,186,168,0.08)',
            accentText: '#ffffff',
            danger: '#ef4444',
            success: '#0bbaa8',
            warning: '#f59e0b',
            divider: 'rgba(0,0,0,0.07)',
            shadow: 'rgba(0,0,0,0.08)',
            userBubbleBg: '#eceef0',
            userBubbleText: '#1a1d21',
            aiBubbleBg: '#ffffff',
            aiBubbleBorder: 'rgba(0,0,0,0.07)',
        },
    },
    {
        id: 'snowlight',
        name: 'Snowlight',
        emoji: '❄️',
        category: 'curated',
        isDark: false,
        colors: {
            bgBase: '#f9fafb',
            bgSurface: '#ffffff',
            bgSurfaceHover: '#f3f4f6',
            bgMuted: '#f0f1f4',
            bgInset: '#e8eaef',
            textPrimary: '#1f2937',
            textSecondary: '#6b7280',
            textTertiary: '#9ca3af',
            accent: '#3b82f6',
            accentSoft: 'rgba(59,130,246,0.08)',
            accentText: '#ffffff',
            danger: '#ef4444',
            success: '#10b981',
            warning: '#f59e0b',
            divider: 'rgba(0,0,0,0.06)',
            shadow: 'rgba(0,0,0,0.06)',
            userBubbleBg: '#3b82f6',
            userBubbleText: '#ffffff',
            aiBubbleBg: '#ffffff',
            aiBubbleBorder: 'rgba(0,0,0,0.06)',
        },
    },
    {
        id: 'nightfall',
        name: 'Nightfall',
        emoji: '🌙',
        category: 'curated',
        isDark: true,
        colors: {
            bgBase: '#111827',
            bgSurface: '#1f2937',
            bgSurfaceHover: '#283344',
            bgMuted: '#1a2332',
            bgInset: '#0f1621',
            textPrimary: '#e5e7eb',
            textSecondary: '#9ca3af',
            textTertiary: '#6b7280',
            accent: '#60a5fa',
            accentSoft: 'rgba(96,165,250,0.1)',
            accentText: '#111827',
            danger: '#f87171',
            success: '#34d399',
            warning: '#fbbf24',
            divider: 'rgba(255,255,255,0.06)',
            shadow: 'rgba(0,0,0,0.3)',
            userBubbleBg: '#3b82f6',
            userBubbleText: '#ffffff',
            aiBubbleBg: '#1f2937',
            aiBubbleBorder: 'rgba(255,255,255,0.06)',
        },
    },

    // ─── WARM ───
    {
        id: 'latte',
        name: 'Latte',
        emoji: '☕',
        category: 'warm',
        isDark: false,
        colors: {
            bgBase: '#faf6f1',
            bgSurface: '#fffcf8',
            bgSurfaceHover: '#f5efe8',
            bgMuted: '#eee7dd',
            bgInset: '#e6ded4',
            textPrimary: '#3c2f20',
            textSecondary: '#7a6b5d',
            textTertiary: '#a89a8c',
            accent: '#b57a4a',
            accentSoft: 'rgba(181,122,74,0.08)',
            accentText: '#ffffff',
            danger: '#c0392b',
            success: '#27ae60',
            warning: '#e67e22',
            divider: 'rgba(60,47,32,0.06)',
            shadow: 'rgba(60,47,32,0.06)',
            userBubbleBg: '#b57a4a',
            userBubbleText: '#ffffff',
            aiBubbleBg: '#fffcf8',
            aiBubbleBorder: 'rgba(60,47,32,0.06)',
        },
    },
    {
        id: 'rosewood',
        name: 'Rosewood',
        emoji: '🌸',
        category: 'warm',
        isDark: false,
        colors: {
            bgBase: '#fdf2f4',
            bgSurface: '#fff7f8',
            bgSurfaceHover: '#fce8ec',
            bgMuted: '#f5dde1',
            bgInset: '#edd3d8',
            textPrimary: '#4a2028',
            textSecondary: '#8a5a62',
            textTertiary: '#b28890',
            accent: '#c4546c',
            accentSoft: 'rgba(196,84,108,0.07)',
            accentText: '#ffffff',
            danger: '#dc2626',
            success: '#16a34a',
            warning: '#ea580c',
            divider: 'rgba(74,32,40,0.06)',
            shadow: 'rgba(74,32,40,0.05)',
            userBubbleBg: '#c4546c',
            userBubbleText: '#ffffff',
            aiBubbleBg: '#fff7f8',
            aiBubbleBorder: 'rgba(74,32,40,0.06)',
        },
    },

    // ─── COOL ───
    {
        id: 'arctic',
        name: 'Arctic',
        emoji: '🧊',
        category: 'cool',
        isDark: false,
        colors: {
            bgBase: '#f0f5fa',
            bgSurface: '#f8fbff',
            bgSurfaceHover: '#e6eef7',
            bgMuted: '#dce6f0',
            bgInset: '#d0dce8',
            textPrimary: '#1e3a5c',
            textSecondary: '#5b7a9a',
            textTertiary: '#8aa4bc',
            accent: '#2c7be5',
            accentSoft: 'rgba(44,123,229,0.07)',
            accentText: '#ffffff',
            danger: '#e53e3e',
            success: '#38a169',
            warning: '#dd6b20',
            divider: 'rgba(30,58,92,0.06)',
            shadow: 'rgba(30,58,92,0.06)',
            userBubbleBg: '#2c7be5',
            userBubbleText: '#ffffff',
            aiBubbleBg: '#f8fbff',
            aiBubbleBorder: 'rgba(30,58,92,0.06)',
        },
    },
    {
        id: 'carbon',
        name: 'Carbon',
        emoji: '⚡',
        category: 'cool',
        isDark: true,
        colors: {
            bgBase: '#0f0f13',
            bgSurface: '#1a1a22',
            bgSurfaceHover: '#24242e',
            bgMuted: '#16161e',
            bgInset: '#0c0c10',
            textPrimary: '#dcdce5',
            textSecondary: '#8888a0',
            textTertiary: '#5c5c70',
            accent: '#7c6ff6',
            accentSoft: 'rgba(124,111,246,0.1)',
            accentText: '#ffffff',
            danger: '#f06060',
            success: '#2dd4a8',
            warning: '#ffb347',
            divider: 'rgba(255,255,255,0.05)',
            shadow: 'rgba(0,0,0,0.35)',
            userBubbleBg: '#6c5ce7',
            userBubbleText: '#ffffff',
            aiBubbleBg: '#1a1a22',
            aiBubbleBorder: 'rgba(255,255,255,0.05)',
        },
    },

    // ─── FOCUS ───
    {
        id: 'sage',
        name: 'Sage',
        emoji: '🌿',
        category: 'focus',
        isDark: false,
        colors: {
            bgBase: '#f3f6f4',
            bgSurface: '#f9fbfa',
            bgSurfaceHover: '#e9eeeb',
            bgMuted: '#dfe5e1',
            bgInset: '#d4dbd7',
            textPrimary: '#2d3b33',
            textSecondary: '#5f7368',
            textTertiary: '#8fa498',
            accent: '#3d8b63',
            accentSoft: 'rgba(61,139,99,0.07)',
            accentText: '#ffffff',
            danger: '#c0392b',
            success: '#27ae60',
            warning: '#e67e22',
            divider: 'rgba(45,59,51,0.06)',
            shadow: 'rgba(45,59,51,0.05)',
            userBubbleBg: '#3d8b63',
            userBubbleText: '#ffffff',
            aiBubbleBg: '#f9fbfa',
            aiBubbleBorder: 'rgba(45,59,51,0.06)',
        },
    },
    {
        id: 'ember',
        name: 'Ember',
        emoji: '🔥',
        category: 'focus',
        isDark: true,
        colors: {
            bgBase: '#15100e',
            bgSurface: '#201a16',
            bgSurfaceHover: '#2d241e',
            bgMuted: '#1a1410',
            bgInset: '#100c0a',
            textPrimary: '#e8ddd4',
            textSecondary: '#a08e80',
            textTertiary: '#6e5e52',
            accent: '#e08040',
            accentSoft: 'rgba(224,128,64,0.1)',
            accentText: '#ffffff',
            danger: '#ef4444',
            success: '#22c55e',
            warning: '#eab308',
            divider: 'rgba(255,255,255,0.05)',
            shadow: 'rgba(0,0,0,0.35)',
            userBubbleBg: '#d06830',
            userBubbleText: '#ffffff',
            aiBubbleBg: '#201a16',
            aiBubbleBorder: 'rgba(255,255,255,0.05)',
        },
    },
];

// ─── Theme Store ───
interface ThemeStore {
    activeThemeId: string;
    settingsOpen: boolean;
    settingsTab: string;

    setTheme: (id: string) => void;
    getActiveTheme: () => ThemePreset;
    toggleSettings: () => void;
    setSettingsOpen: (open: boolean) => void;
    setSettingsTab: (tab: string) => void;
}

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set, get) => ({
            activeThemeId: 'lucen',
            settingsOpen: false,
            settingsTab: 'appearance',

            setTheme: (id) => set({ activeThemeId: id }),

            getActiveTheme: () => {
                const { activeThemeId } = get();
                return THEME_PRESETS.find((t) => t.id === activeThemeId) || THEME_PRESETS[0];
            },

            toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
            setSettingsOpen: (open) => set({ settingsOpen: open }),
            setSettingsTab: (tab) => set({ settingsTab: tab }),
        }),
        {
            name: 'lucen-theme-storage',
        }
    )
);

/** Apply theme CSS variables to document root */
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
