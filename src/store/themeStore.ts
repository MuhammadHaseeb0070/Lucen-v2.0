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
    // ─── CURATED (Brand Default) ───
    {
        id: 'lucen',
        name: 'Lucen',
        emoji: '✨',
        category: 'curated',
        isDark: false,
        colors: {
            bgBase: '#F7F7F9', // Softer than white, reduces glare
            bgSurface: '#FFFFFF',
            bgSurfaceHover: '#F1F1F4',
            bgMuted: '#EAEBEF',
            bgInset: '#E2E3E8',
            textPrimary: '#1E1E24', // Not pure black, easier to read
            textSecondary: '#64646A',
            textTertiary: '#9A9A9F',
            accent: '#14B8A6', // The Lucen brand teal
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
    {
        id: 'observatory',
        name: 'Observatory',
        emoji: '🔭',
        category: 'curated',
        isDark: true,
        colors: {
            bgBase: '#0F1115', // Deep cool slate, not pure black
            bgSurface: '#16191F',
            bgSurfaceHover: '#1F232B',
            bgMuted: '#1A1D24',
            bgInset: '#0A0C0F',
            textPrimary: '#F1F5F9',
            textSecondary: '#94A3B8',
            textTertiary: '#64748B',
            accent: '#2DD4BF', // Bright teal for dark mode contrast
            accentSoft: 'rgba(45, 212, 191, 0.12)',
            accentText: '#042F2E', // Dark text on bright accent bubble
            danger: '#F87171',
            success: '#34D399',
            warning: '#FBBF24',
            divider: 'rgba(255, 255, 255, 0.08)',
            shadow: 'rgba(0, 0, 0, 0.5)',
            userBubbleBg: '#2DD4BF',
            userBubbleText: '#042F2E',
            aiBubbleBg: '#16191F',
            aiBubbleBorder: 'rgba(255, 255, 255, 0.08)',
        },
    },

    // ─── WARM (Cozy & Calming) ───
    {
        id: 'latte',
        name: 'Latte',
        emoji: '☕',
        category: 'warm',
        isDark: false,
        colors: {
            bgBase: '#FDFBF7', // Very warm, paper-like
            bgSurface: '#FFFFFF',
            bgSurfaceHover: '#F5F2EA',
            bgMuted: '#EFECE4',
            bgInset: '#E5E1D6',
            textPrimary: '#3A322C',
            textSecondary: '#7C7065',
            textTertiary: '#ABA093',
            accent: '#D97706', // Soft amber
            accentSoft: 'rgba(217, 119, 6, 0.08)',
            accentText: '#FFFFFF',
            danger: '#DC2626',
            success: '#16A34A',
            warning: '#D97706',
            divider: 'rgba(58, 50, 44, 0.06)',
            shadow: 'rgba(58, 50, 44, 0.04)',
            userBubbleBg: '#D97706',
            userBubbleText: '#FFFFFF',
            aiBubbleBg: '#FFFFFF',
            aiBubbleBorder: 'rgba(58, 50, 44, 0.06)',
        },
    },
    {
        id: 'obsidian',
        name: 'Obsidian',
        emoji: '🪨',
        category: 'warm',
        isDark: true,
        colors: {
            bgBase: '#161412', // Warm, dark charcoal
            bgSurface: '#1E1B18',
            bgSurfaceHover: '#292522',
            bgMuted: '#221E1B',
            bgInset: '#0F0D0C',
            textPrimary: '#F3EFEA',
            textSecondary: '#A89E94',
            textTertiary: '#766D64',
            accent: '#FBBF24', // Golden amber
            accentSoft: 'rgba(251, 191, 36, 0.1)',
            accentText: '#452003',
            danger: '#F87171',
            success: '#4ADE80',
            warning: '#FCD34D',
            divider: 'rgba(255, 255, 255, 0.05)',
            shadow: 'rgba(0, 0, 0, 0.6)',
            userBubbleBg: '#FBBF24',
            userBubbleText: '#452003',
            aiBubbleBg: '#1E1B18',
            aiBubbleBorder: 'rgba(255, 255, 255, 0.05)',
        },
    },

    // ─── COOL (Professional & Crisp) ───
    {
        id: 'glacier',
        name: 'Glacier',
        emoji: '❄️',
        category: 'cool',
        isDark: false,
        colors: {
            bgBase: '#F4F7FB', // Icy, clean light blue
            bgSurface: '#FFFFFF',
            bgSurfaceHover: '#EBF1F8',
            bgMuted: '#E0E8F2',
            bgInset: '#D1DEEB',
            textPrimary: '#1E293B',
            textSecondary: '#64748B',
            textTertiary: '#94A3B8',
            accent: '#2563EB', // Strong Royal Blue
            accentSoft: 'rgba(37, 99, 235, 0.08)',
            accentText: '#FFFFFF',
            danger: '#E11D48',
            success: '#059669',
            warning: '#EA580C',
            divider: 'rgba(30, 41, 59, 0.06)',
            shadow: 'rgba(30, 41, 59, 0.05)',
            userBubbleBg: '#2563EB',
            userBubbleText: '#FFFFFF',
            aiBubbleBg: '#FFFFFF',
            aiBubbleBorder: 'rgba(30, 41, 59, 0.06)',
        },
    },
    {
        id: 'dusk',
        name: 'Dusk',
        emoji: '🌌',
        category: 'cool',
        isDark: true,
        colors: {
            bgBase: '#12101A', // Deep space violet
            bgSurface: '#191624',
            bgSurfaceHover: '#231F33',
            bgMuted: '#1D1A2B',
            bgInset: '#0A080F',
            textPrimary: '#F1EEF9',
            textSecondary: '#A39BBF',
            textTertiary: '#71698E',
            accent: '#A78BFA', // Soft violet
            accentSoft: 'rgba(167, 139, 250, 0.12)',
            accentText: '#2E1065',
            danger: '#FB7185',
            success: '#34D399',
            warning: '#FBBF24',
            divider: 'rgba(255, 255, 255, 0.07)',
            shadow: 'rgba(0, 0, 0, 0.45)',
            userBubbleBg: '#A78BFA',
            userBubbleText: '#2E1065',
            aiBubbleBg: '#191624',
            aiBubbleBorder: 'rgba(255, 255, 255, 0.07)',
        },
    },

    // ─── FOCUS (High Readability & Low Strain) ───
    {
        id: 'sage',
        name: 'Sage',
        emoji: '🌿',
        category: 'focus',
        isDark: false,
        colors: {
            bgBase: '#F5F7F5', // Soft, earthy green tint
            bgSurface: '#FFFFFF',
            bgSurfaceHover: '#EBEFEB',
            bgMuted: '#DFE5E0',
            bgInset: '#D1D9D3',
            textPrimary: '#1E2C22',
            textSecondary: '#5E7364',
            textTertiary: '#8FA396',
            accent: '#059669', // Emerald
            accentSoft: 'rgba(5, 150, 105, 0.08)',
            accentText: '#FFFFFF',
            danger: '#DC2626',
            success: '#059669',
            warning: '#D97706',
            divider: 'rgba(30, 44, 34, 0.06)',
            shadow: 'rgba(30, 44, 34, 0.04)',
            userBubbleBg: '#059669',
            userBubbleText: '#FFFFFF',
            aiBubbleBg: '#FFFFFF',
            aiBubbleBorder: 'rgba(30, 44, 34, 0.06)',
        },
    },
    {
        id: 'moss',
        name: 'Moss',
        emoji: '🌲',
        category: 'focus',
        isDark: true,
        colors: {
            bgBase: '#0D1410', // Deep forest night
            bgSurface: '#141E18',
            bgSurfaceHover: '#1D2A22',
            bgMuted: '#18241D',
            bgInset: '#080C0A',
            textPrimary: '#E8F3EB',
            textSecondary: '#8BABA0',
            textTertiary: '#5C7A6D',
            accent: '#34D399', // Bright mint
            accentSoft: 'rgba(52, 211, 153, 0.1)',
            accentText: '#064E3B',
            danger: '#F87171',
            success: '#34D399',
            warning: '#FCD34D',
            divider: 'rgba(255, 255, 255, 0.06)',
            shadow: 'rgba(0, 0, 0, 0.4)',
            userBubbleBg: '#34D399',
            userBubbleText: '#064E3B',
            aiBubbleBg: '#141E18',
            aiBubbleBorder: 'rgba(255, 255, 255, 0.06)',
        },
    },
];

// export const THEME_PRESETS: ThemePreset[] = [
//     // ─── CURATED ───
//     {
//         id: 'lucen',
//         name: 'Lucen',
//         emoji: '💎',
//         category: 'curated',
//         isDark: false,
//         colors: {
//             bgBase: '#F8F8F6',
//             bgSurface: '#FFFFFF',
//             bgSurfaceHover: '#F2F2F0',
//             bgMuted: '#EBEBE9',
//             bgInset: '#E2E2DF',
//             textPrimary: '#18181A',
//             textSecondary: '#5A5A5E',
//             textTertiary: '#94949A',
//             accent: '#0BBAA8',
//             accentSoft: 'rgba(11,186,168,0.09)',
//             accentText: '#ffffff',
//             danger: '#EF4444',
//             success: '#0BBAA8',
//             warning: '#F59E0B',
//             divider: 'rgba(0,0,0,0.07)',
//             shadow: 'rgba(0,0,0,0.07)',
//             userBubbleBg: '#0BBAA8',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#FFFFFF',
//             aiBubbleBorder: 'rgba(0,0,0,0.07)',
//         },
//     },
//     {
//         id: 'observatory',
//         name: 'Observatory',
//         emoji: '🔭',
//         category: 'curated',
//         isDark: true,
//         colors: {
//             bgBase: '#0D1117',
//             bgSurface: '#161B22',
//             bgSurfaceHover: '#1F2937',
//             bgMuted: '#131920',
//             bgInset: '#0A0F14',
//             textPrimary: '#E6EDF3',
//             textSecondary: '#7D8590',
//             textTertiary: '#484F58',
//             accent: '#1FCFC0',
//             accentSoft: 'rgba(31,207,192,0.10)',
//             accentText: '#0D1117',
//             danger: '#F85149',
//             success: '#3FB950',
//             warning: '#D29922',
//             divider: 'rgba(255,255,255,0.07)',
//             shadow: 'rgba(0,0,0,0.4)',
//             userBubbleBg: '#1FCFC0',
//             userBubbleText: '#0D1117',
//             aiBubbleBg: '#161B22',
//             aiBubbleBorder: 'rgba(255,255,255,0.07)',
//         },
//     },
//     {
//         id: 'ivory',
//         name: 'Ivory',
//         emoji: '🪻',
//         category: 'curated',
//         isDark: false,
//         colors: {
//             bgBase: '#F8F7F4',
//             bgSurface: '#FDFCFA',
//             bgSurfaceHover: '#F2F0EB',
//             bgMuted: '#ECEAE4',
//             bgInset: '#E4E1DA',
//             textPrimary: '#1C1C22',
//             textSecondary: '#626274',
//             textTertiary: '#9898A8',
//             accent: '#4F46E5',
//             accentSoft: 'rgba(79,70,229,0.08)',
//             accentText: '#ffffff',
//             danger: '#EF4444',
//             success: '#16A34A',
//             warning: '#D97706',
//             divider: 'rgba(28,28,34,0.07)',
//             shadow: 'rgba(28,28,34,0.07)',
//             userBubbleBg: '#4F46E5',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#FDFCFA',
//             aiBubbleBorder: 'rgba(28,28,34,0.07)',
//         },
//     },

//     // ─── WARM ───
//     {
//         id: 'latte',
//         name: 'Latte',
//         emoji: '☕',
//         category: 'warm',
//         isDark: false,
//         colors: {
//             bgBase: '#FAF6F0',
//             bgSurface: '#FFFCF8',
//             bgSurfaceHover: '#F5EEE6',
//             bgMuted: '#EDE5D8',
//             bgInset: '#E4D9C8',
//             textPrimary: '#3C2A18',
//             textSecondary: '#7A6550',
//             textTertiary: '#A8927A',
//             accent: '#B5743A',
//             accentSoft: 'rgba(181,116,58,0.09)',
//             accentText: '#ffffff',
//             danger: '#C0392B',
//             success: '#2A7A4A',
//             warning: '#E07820',
//             divider: 'rgba(60,42,24,0.07)',
//             shadow: 'rgba(60,42,24,0.07)',
//             userBubbleBg: '#B5743A',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#FFFCF8',
//             aiBubbleBorder: 'rgba(60,42,24,0.07)',
//         },
//     },
//     {
//         id: 'parchment',
//         name: 'Parchment',
//         emoji: '📜',
//         category: 'warm',
//         isDark: false,
//         colors: {
//             bgBase: '#F7F3EC',
//             bgSurface: '#FDFAF5',
//             bgSurfaceHover: '#F0EBE2',
//             bgMuted: '#E8E0D5',
//             bgInset: '#DED5C8',
//             textPrimary: '#2C2016',
//             textSecondary: '#7A6A56',
//             textTertiary: '#A89882',
//             accent: '#C2603A',
//             accentSoft: 'rgba(194,96,58,0.08)',
//             accentText: '#ffffff',
//             danger: '#C0392B',
//             success: '#2E7D52',
//             warning: '#E07B1A',
//             divider: 'rgba(44,32,22,0.07)',
//             shadow: 'rgba(44,32,22,0.07)',
//             userBubbleBg: '#C2603A',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#FDFAF5',
//             aiBubbleBorder: 'rgba(44,32,22,0.07)',
//         },
//     },
//     {
//         id: 'obsidian',
//         name: 'Obsidian',
//         emoji: '🪨',
//         category: 'warm',
//         isDark: true,
//         colors: {
//             bgBase: '#1A1714',
//             bgSurface: '#242019',
//             bgSurfaceHover: '#302B22',
//             bgMuted: '#1E1A16',
//             bgInset: '#141210',
//             textPrimary: '#EDE8E0',
//             textSecondary: '#A09480',
//             textTertiary: '#6E6050',
//             accent: '#E8A030',
//             accentSoft: 'rgba(232,160,48,0.10)',
//             accentText: '#1A1714',
//             danger: '#EF4444',
//             success: '#22C55E',
//             warning: '#EAB308',
//             divider: 'rgba(255,255,255,0.06)',
//             shadow: 'rgba(0,0,0,0.4)',
//             userBubbleBg: '#C8841C',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#242019',
//             aiBubbleBorder: 'rgba(255,255,255,0.06)',
//         },
//     },

//     // ─── COOL ───
//     {
//         id: 'glacier',
//         name: 'Glacier',
//         emoji: '🌊',
//         category: 'cool',
//         isDark: false,
//         colors: {
//             bgBase: '#EFF3F8',
//             bgSurface: '#F8FBFF',
//             bgSurfaceHover: '#E5ECF5',
//             bgMuted: '#D8E4F0',
//             bgInset: '#CAD8EC',
//             textPrimary: '#0F2942',
//             textSecondary: '#4A6B8A',
//             textTertiary: '#7E9BB5',
//             accent: '#0E7FC5',
//             accentSoft: 'rgba(14,127,197,0.08)',
//             accentText: '#ffffff',
//             danger: '#E53E3E',
//             success: '#2C8B5E',
//             warning: '#CF6B20',
//             divider: 'rgba(15,41,66,0.07)',
//             shadow: 'rgba(15,41,66,0.07)',
//             userBubbleBg: '#0E7FC5',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#F8FBFF',
//             aiBubbleBorder: 'rgba(15,41,66,0.07)',
//         },
//     },
//     {
//         id: 'dusk',
//         name: 'Dusk',
//         emoji: '🌆',
//         category: 'cool',
//         isDark: true,
//         colors: {
//             bgBase: '#13101C',
//             bgSurface: '#1C1828',
//             bgSurfaceHover: '#26213A',
//             bgMuted: '#181424',
//             bgInset: '#0F0C18',
//             textPrimary: '#E8E3F4',
//             textSecondary: '#9488B4',
//             textTertiary: '#635880',
//             accent: '#A78BFA',
//             accentSoft: 'rgba(167,139,250,0.10)',
//             accentText: '#13101C',
//             danger: '#F87171',
//             success: '#34D399',
//             warning: '#FCD34D',
//             divider: 'rgba(255,255,255,0.07)',
//             shadow: 'rgba(0,0,0,0.45)',
//             userBubbleBg: '#7C5CFC',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#1C1828',
//             aiBubbleBorder: 'rgba(255,255,255,0.07)',
//         },
//     },

//     // ─── FOCUS ───
//     {
//         id: 'sage',
//         name: 'Sage',
//         emoji: '🌿',
//         category: 'focus',
//         isDark: false,
//         colors: {
//             bgBase: '#F2F6F3',
//             bgSurface: '#F9FBFA',
//             bgSurfaceHover: '#E7EDE9',
//             bgMuted: '#DDE5DF',
//             bgInset: '#D0DAD3',
//             textPrimary: '#1E3326',
//             textSecondary: '#4E6B58',
//             textTertiary: '#7F9E88',
//             accent: '#2E8B57',
//             accentSoft: 'rgba(46,139,87,0.08)',
//             accentText: '#ffffff',
//             danger: '#C0392B',
//             success: '#2E8B57',
//             warning: '#E07B1A',
//             divider: 'rgba(30,51,38,0.07)',
//             shadow: 'rgba(30,51,38,0.06)',
//             userBubbleBg: '#2E8B57',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#F9FBFA',
//             aiBubbleBorder: 'rgba(30,51,38,0.07)',
//         },
//     },
//     {
//         id: 'moss',
//         name: 'Moss',
//         emoji: '🌑',
//         category: 'focus',
//         isDark: true,
//         colors: {
//             bgBase: '#0C130F',
//             bgSurface: '#141E17',
//             bgSurfaceHover: '#1C2A1F',
//             bgMuted: '#101A12',
//             bgInset: '#09100B',
//             textPrimary: '#D4ECD9',
//             textSecondary: '#6E9478',
//             textTertiary: '#456050',
//             accent: '#30D158',
//             accentSoft: 'rgba(48,209,88,0.10)',
//             accentText: '#0C130F',
//             danger: '#FF6B6B',
//             success: '#30D158',
//             warning: '#FFD60A',
//             divider: 'rgba(255,255,255,0.07)',
//             shadow: 'rgba(0,0,0,0.4)',
//             userBubbleBg: '#20A040',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#141E17',
//             aiBubbleBorder: 'rgba(255,255,255,0.07)',
//         },
//     },
// ];

// export const THEME_PRESETS: ThemePreset[] = [
//     // ─── CURATED ───
//     {
//         id: 'lucen',
//         name: 'Lucen',
//         emoji: '💎',
//         category: 'curated',
//         isDark: false,
//         colors: {
//             bgBase: '#f5f5f5',
//             bgSurface: '#ffffff',
//             bgSurfaceHover: '#f0f0f0',
//             bgMuted: '#eceef0',
//             bgInset: '#e4e6e9',
//             textPrimary: '#1a1d21',
//             textSecondary: '#5f6368',
//             textTertiary: '#9aa0a6',
//             accent: '#0bbaa8',
//             accentSoft: 'rgba(11,186,168,0.08)',
//             accentText: '#ffffff',
//             danger: '#ef4444',
//             success: '#0bbaa8',
//             warning: '#f59e0b',
//             divider: 'rgba(0,0,0,0.07)',
//             shadow: 'rgba(0,0,0,0.08)',
//             userBubbleBg: '#eceef0',
//             userBubbleText: '#1a1d21',
//             aiBubbleBg: '#ffffff',
//             aiBubbleBorder: 'rgba(0,0,0,0.07)',
//         },
//     },
//     {
//         id: 'snowlight',
//         name: 'Snowlight',
//         emoji: '❄️',
//         category: 'curated',
//         isDark: false,
//         colors: {
//             bgBase: '#f9fafb',
//             bgSurface: '#ffffff',
//             bgSurfaceHover: '#f3f4f6',
//             bgMuted: '#f0f1f4',
//             bgInset: '#e8eaef',
//             textPrimary: '#1f2937',
//             textSecondary: '#6b7280',
//             textTertiary: '#9ca3af',
//             accent: '#3b82f6',
//             accentSoft: 'rgba(59,130,246,0.08)',
//             accentText: '#ffffff',
//             danger: '#ef4444',
//             success: '#10b981',
//             warning: '#f59e0b',
//             divider: 'rgba(0,0,0,0.06)',
//             shadow: 'rgba(0,0,0,0.06)',
//             userBubbleBg: '#3b82f6',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#ffffff',
//             aiBubbleBorder: 'rgba(0,0,0,0.06)',
//         },
//     },
//     {
//         id: 'nightfall',
//         name: 'Nightfall',
//         emoji: '🌙',
//         category: 'curated',
//         isDark: true,
//         colors: {
//             bgBase: '#111827',
//             bgSurface: '#1f2937',
//             bgSurfaceHover: '#283344',
//             bgMuted: '#1a2332',
//             bgInset: '#0f1621',
//             textPrimary: '#e5e7eb',
//             textSecondary: '#9ca3af',
//             textTertiary: '#6b7280',
//             accent: '#60a5fa',
//             accentSoft: 'rgba(96,165,250,0.1)',
//             accentText: '#111827',
//             danger: '#f87171',
//             success: '#34d399',
//             warning: '#fbbf24',
//             divider: 'rgba(255,255,255,0.06)',
//             shadow: 'rgba(0,0,0,0.3)',
//             userBubbleBg: '#3b82f6',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#1f2937',
//             aiBubbleBorder: 'rgba(255,255,255,0.06)',
//         },
//     },

//     // ─── WARM ───
//     {
//         id: 'latte',
//         name: 'Latte',
//         emoji: '☕',
//         category: 'warm',
//         isDark: false,
//         colors: {
//             bgBase: '#faf6f1',
//             bgSurface: '#fffcf8',
//             bgSurfaceHover: '#f5efe8',
//             bgMuted: '#eee7dd',
//             bgInset: '#e6ded4',
//             textPrimary: '#3c2f20',
//             textSecondary: '#7a6b5d',
//             textTertiary: '#a89a8c',
//             accent: '#b57a4a',
//             accentSoft: 'rgba(181,122,74,0.08)',
//             accentText: '#ffffff',
//             danger: '#c0392b',
//             success: '#27ae60',
//             warning: '#e67e22',
//             divider: 'rgba(60,47,32,0.06)',
//             shadow: 'rgba(60,47,32,0.06)',
//             userBubbleBg: '#b57a4a',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#fffcf8',
//             aiBubbleBorder: 'rgba(60,47,32,0.06)',
//         },
//     },
//     {
//         id: 'rosewood',
//         name: 'Rosewood',
//         emoji: '🌸',
//         category: 'warm',
//         isDark: false,
//         colors: {
//             bgBase: '#fdf2f4',
//             bgSurface: '#fff7f8',
//             bgSurfaceHover: '#fce8ec',
//             bgMuted: '#f5dde1',
//             bgInset: '#edd3d8',
//             textPrimary: '#4a2028',
//             textSecondary: '#8a5a62',
//             textTertiary: '#b28890',
//             accent: '#c4546c',
//             accentSoft: 'rgba(196,84,108,0.07)',
//             accentText: '#ffffff',
//             danger: '#dc2626',
//             success: '#16a34a',
//             warning: '#ea580c',
//             divider: 'rgba(74,32,40,0.06)',
//             shadow: 'rgba(74,32,40,0.05)',
//             userBubbleBg: '#c4546c',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#fff7f8',
//             aiBubbleBorder: 'rgba(74,32,40,0.06)',
//         },
//     },

//     // ─── COOL ───
//     {
//         id: 'arctic',
//         name: 'Arctic',
//         emoji: '🧊',
//         category: 'cool',
//         isDark: false,
//         colors: {
//             bgBase: '#f0f5fa',
//             bgSurface: '#f8fbff',
//             bgSurfaceHover: '#e6eef7',
//             bgMuted: '#dce6f0',
//             bgInset: '#d0dce8',
//             textPrimary: '#1e3a5c',
//             textSecondary: '#5b7a9a',
//             textTertiary: '#8aa4bc',
//             accent: '#2c7be5',
//             accentSoft: 'rgba(44,123,229,0.07)',
//             accentText: '#ffffff',
//             danger: '#e53e3e',
//             success: '#38a169',
//             warning: '#dd6b20',
//             divider: 'rgba(30,58,92,0.06)',
//             shadow: 'rgba(30,58,92,0.06)',
//             userBubbleBg: '#2c7be5',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#f8fbff',
//             aiBubbleBorder: 'rgba(30,58,92,0.06)',
//         },
//     },
//     {
//         id: 'carbon',
//         name: 'Carbon',
//         emoji: '⚡',
//         category: 'cool',
//         isDark: true,
//         colors: {
//             bgBase: '#0f0f13',
//             bgSurface: '#1a1a22',
//             bgSurfaceHover: '#24242e',
//             bgMuted: '#16161e',
//             bgInset: '#0c0c10',
//             textPrimary: '#dcdce5',
//             textSecondary: '#8888a0',
//             textTertiary: '#5c5c70',
//             accent: '#7c6ff6',
//             accentSoft: 'rgba(124,111,246,0.1)',
//             accentText: '#ffffff',
//             danger: '#f06060',
//             success: '#2dd4a8',
//             warning: '#ffb347',
//             divider: 'rgba(255,255,255,0.05)',
//             shadow: 'rgba(0,0,0,0.35)',
//             userBubbleBg: '#6c5ce7',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#1a1a22',
//             aiBubbleBorder: 'rgba(255,255,255,0.05)',
//         },
//     },

//     // ─── FOCUS ───
//     {
//         id: 'sage',
//         name: 'Sage',
//         emoji: '🌿',
//         category: 'focus',
//         isDark: false,
//         colors: {
//             bgBase: '#f3f6f4',
//             bgSurface: '#f9fbfa',
//             bgSurfaceHover: '#e9eeeb',
//             bgMuted: '#dfe5e1',
//             bgInset: '#d4dbd7',
//             textPrimary: '#2d3b33',
//             textSecondary: '#5f7368',
//             textTertiary: '#8fa498',
//             accent: '#3d8b63',
//             accentSoft: 'rgba(61,139,99,0.07)',
//             accentText: '#ffffff',
//             danger: '#c0392b',
//             success: '#27ae60',
//             warning: '#e67e22',
//             divider: 'rgba(45,59,51,0.06)',
//             shadow: 'rgba(45,59,51,0.05)',
//             userBubbleBg: '#3d8b63',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#f9fbfa',
//             aiBubbleBorder: 'rgba(45,59,51,0.06)',
//         },
//     },
//     {
//         id: 'ember',
//         name: 'Ember',
//         emoji: '🔥',
//         category: 'focus',
//         isDark: true,
//         colors: {
//             bgBase: '#15100e',
//             bgSurface: '#201a16',
//             bgSurfaceHover: '#2d241e',
//             bgMuted: '#1a1410',
//             bgInset: '#100c0a',
//             textPrimary: '#e8ddd4',
//             textSecondary: '#a08e80',
//             textTertiary: '#6e5e52',
//             accent: '#e08040',
//             accentSoft: 'rgba(224,128,64,0.1)',
//             accentText: '#ffffff',
//             danger: '#ef4444',
//             success: '#22c55e',
//             warning: '#eab308',
//             divider: 'rgba(255,255,255,0.05)',
//             shadow: 'rgba(0,0,0,0.35)',
//             userBubbleBg: '#d06830',
//             userBubbleText: '#ffffff',
//             aiBubbleBg: '#201a16',
//             aiBubbleBorder: 'rgba(255,255,255,0.05)',
//         },
//     },
// ];

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
