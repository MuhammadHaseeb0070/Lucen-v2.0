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

    // ═══════════════════════════════════════════════════════════════════════════
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
    //    Who it's for: users who want warmth and calm without being "beige".
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

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. AMBER — Claude.ai's exact aesthetic: warm cream + terracotta.
    //    Who it's for: Claude.ai users, warm-light users, Birch replacement.
    //    Why better than Birch: Birch was Scandinavian-neutral. Amber is
    //    specifically Claude's palette — cream that reads as intentional, not beige.
    //    The terracotta accent is Claude's actual UI orange, not guessed.
    // ═══════════════════════════════════════════════════════════════════════════
    {
        id: 'amber',
        name: 'Amber',
        emoji: '🍂',
        category: 'warm',
        isDark: false,
        colors: {
            bgBase: '#F7F4EE',
            bgSurface: '#FFFDF9',
            bgSurfaceHover: '#F0EDE6',
            bgMuted: '#EAE5DC',
            bgInset: '#DDD7CC',
            textPrimary: '#1C1714',
            textSecondary: '#6A5E54',
            textTertiary: '#9E9088',
            accent: '#CC6B3D',
            accentSoft: 'rgba(204, 107, 61, 0.08)',
            accentText: '#FFFFFF',
            danger: '#B03028',
            success: '#3A6840',
            warning: '#9A6018',
            divider: 'rgba(28, 23, 20, 0.07)',
            shadow: 'rgba(28, 23, 20, 0.03)',
            userBubbleBg: '#CC6B3D',
            userBubbleText: '#FFFFFF',
            aiBubbleBg: '#FFFDF9',
            aiBubbleBorder: 'rgba(28, 23, 20, 0.07)',
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. LINEN — Near-monochrome minimalist light.
    //    Who it's for: pure minimalists, productivity-focused users, anyone who
    //    finds any color distracting. Backgrounds are warm near-white with zero
    //    color cast. Accent is a deep warm charcoal — the "colour" is almost
    //    the absence of colour. Like ink on a blank sheet.
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
            bgMuted: '#E5E5E3',
            bgInset: '#D8D8D6',
            textPrimary: '#1A1A1A',
            textSecondary: '#666666',
            textTertiary: '#999999',
            accent: '#2A2826',
            accentSoft: 'rgba(42, 40, 38, 0.07)',
            accentText: '#F5F5F3',
            danger: '#C03030',
            success: '#2E6840',
            warning: '#8A6018',
            divider: 'rgba(26, 26, 26, 0.07)',
            shadow: 'rgba(26, 26, 26, 0.03)',
            userBubbleBg: '#2A2826',
            userBubbleText: '#F5F5F3',
            aiBubbleBg: '#FFFFFF',
            aiBubbleBorder: 'rgba(26, 26, 26, 0.07)',
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // 5. PETAL — Dusty rose-mauve editorial soft light.
    //    Who it's for: users who want soft / pastel tones but without anything
    //    that reads as "girly pink UI". The key: bgBase is barely-lavender (not
    //    pink), accent is a specific dusty rose-mauve (not purple, not bubblegum).
    //    This is the combination you'd find in a well-designed editorial magazine
    //    or a high-end beauty brand's desktop interface.
    // ═══════════════════════════════════════════════════════════════════════════
    {
        id: 'petal',
        name: 'Petal',
        emoji: '🌸',
        category: 'warm',
        isDark: false,
        colors: {
            bgBase: '#F6F3FA',
            bgSurface: '#FEFCFF',
            bgSurfaceHover: '#EFE9F7',
            bgMuted: '#E8E0F2',
            bgInset: '#DDD4EC',
            textPrimary: '#1E1628',
            textSecondary: '#6B5E80',
            textTertiary: '#A090B8',
            accent: '#A0709A',
            accentSoft: 'rgba(160, 112, 154, 0.08)',
            accentText: '#FFFFFF',
            danger: '#B03040',
            success: '#3A6848',
            warning: '#8A5E18',
            divider: 'rgba(30, 22, 40, 0.07)',
            shadow: 'rgba(30, 22, 40, 0.03)',
            userBubbleBg: '#A0709A',
            userBubbleText: '#FFFFFF',
            aiBubbleBg: '#FEFCFF',
            aiBubbleBorder: 'rgba(30, 22, 40, 0.07)',
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // 6. STUDIO — ChatGPT's neutral dark. For users migrating from ChatGPT.
    //    Who it's for: ChatGPT users who want familiarity, minimal-dark users.
    //    The backgrounds are ChatGPT's exact grays (#212121, #2F2F2F). No color
    //    cast, no hue shift. Completely neutral. Green accent is ChatGPT's own.
    //    A user switching from ChatGPT will feel at home in under 10 seconds.
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
    // 7. VERDIGRIS — Aged copper patina. Kept exactly as-is.
    //    Who it's for: dark-mode users who want character, not just "dark".
    // ═══════════════════════════════════════════════════════════════════════════
    {
        id: 'verdigris',
        name: 'Verdigris',
        emoji: '🏛️',
        category: 'focus',
        isDark: true,
        colors: {
            bgBase: '#141918',
            bgSurface: '#1C2320',
            bgSurfaceHover: '#242E2A',
            bgMuted: '#1A2220',
            bgInset: '#0D1210',
            textPrimary: '#D4DED8',
            textSecondary: '#7A9890',
            textTertiary: '#4E6860',
            accent: '#5BA89A',
            accentSoft: 'rgba(91, 168, 154, 0.1)',
            accentText: '#0D1210',
            danger: '#D05858',
            success: '#5AAA7A',
            warning: '#C8A840',
            divider: 'rgba(91, 168, 154, 0.12)',
            shadow: 'rgba(0, 0, 0, 0.5)',
            userBubbleBg: '#5BA89A',
            userBubbleText: '#0D1210',
            aiBubbleBg: '#1C2320',
            aiBubbleBorder: 'rgba(91, 168, 154, 0.12)',
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // 8. TERMINAL — Electric chartreuse on near-black. The one neon theme.
    //    Who it's for: tech users, developers, creative agency users who want
    //    energy. The key discipline: backgrounds are PURE neutral near-black with
    //    ZERO color cast. The neon is contained entirely to the accent.
    //    This is how real creative agencies use neon — one electric hit, nothing
    //    else. Every other color in this theme defers completely to the accent.
    //    Chartreuse (#C8FF00) was chosen over cyan/green because it's unexpected —
    //    it reads as "designed" rather than "default dark mode with a neon color".
    // ═══════════════════════════════════════════════════════════════════════════
    {
        id: 'terminal',
        name: 'Terminal',
        emoji: '⚡',
        category: 'focus',
        isDark: true,
        colors: {
            bgBase: '#0E0E0E',
            bgSurface: '#161616',
            bgSurfaceHover: '#202020',
            bgMuted: '#141414',
            bgInset: '#080808',
            textPrimary: '#F0F0F0',
            textSecondary: '#888888',
            textTertiary: '#555555',
            accent: '#C8FF00',
            accentSoft: 'rgba(200, 255, 0, 0.08)',
            accentText: '#0E0E0E',
            danger: '#FF5555',
            success: '#55DD88',
            warning: '#FFCC44',
            divider: 'rgba(200, 255, 0, 0.1)',
            shadow: 'rgba(0, 0, 0, 0.6)',
            userBubbleBg: '#C8FF00',
            userBubbleText: '#0E0E0E',
            aiBubbleBg: '#161616',
            aiBubbleBorder: 'rgba(200, 255, 0, 0.1)',
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
