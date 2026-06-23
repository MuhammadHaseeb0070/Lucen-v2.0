// ============================================
// user_settings — Supabase sync (appearance)
// ============================================
// No imports from themeStore to avoid circular deps.

import { supabase, isSupabaseEnabled, hasActiveSession } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface SavedThemeData {
    id: string;
    name: string;
    emoji: string;
    basePresetId: string;
    colors: Record<string, string>;
}

export interface AppearanceSettingsPayload {
    themeSource: 'preset' | 'custom';
    activeThemeId: string;
    customBasePresetId: string;
    customColors: Record<string, string>;
    chatSizeStep: number;
    savedThemes?: SavedThemeData[];
}

const DEBOUNCE_MS = 900;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPayload: { active_theme: string; settings: Record<string, unknown> } | null = null;

export async function fetchUserSettingsRow(): Promise<{
    active_theme: string;
    settings: Record<string, unknown>;
} | null> {
    if (!isSupabaseEnabled() || !supabase) return null;
    if (!(await hasActiveSession())) return null;

    const { data, error } = await supabase.from('user_settings').select('active_theme, settings').maybeSingle();

    if (error) {
        logger.warn('[userSettings] fetch failed', error.message);
        return null;
    }
    if (!data) return null;

    return {
        active_theme: String(data.active_theme ?? 'washi'),
        settings: (data.settings && typeof data.settings === 'object' ? data.settings : {}) as Record<string, unknown>,
    };
}

export async function upsertUserSettingsRow(payload: {
    active_theme: string;
    settings: Record<string, unknown>;
}): Promise<void> {
    if (!isSupabaseEnabled() || !supabase) return;
    if (!(await hasActiveSession())) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return;

    const { error } = await supabase.from('user_settings').upsert(
        {
            user_id: user.id,
            active_theme: payload.active_theme,
            settings: payload.settings,
            updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
    );

    if (error) {
        logger.warn('[userSettings] upsert failed', error.message);
    }
}

export function schedulePersistUserSettings(payload: { active_theme: string; settings: Record<string, unknown> }): void {
    pendingPayload = payload;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        persistTimer = null;
        const p = pendingPayload;
        pendingPayload = null;
        if (p) void upsertUserSettingsRow(p);
    }, DEBOUNCE_MS);
}

export function parseAppearanceFromSettings(settings: Record<string, unknown>): Partial<AppearanceSettingsPayload> | null {
    const raw = settings.appearance;
    if (!raw || typeof raw !== 'object') return null;
    const a = raw as Record<string, unknown>;

    const themeSource = a.themeSource === 'custom' ? 'custom' : 'preset';
    const activeThemeId = typeof a.activeThemeId === 'string' ? a.activeThemeId : undefined;
    const customBasePresetId = typeof a.customBasePresetId === 'string' ? a.customBasePresetId : undefined;
    const chatSizeStep = typeof a.chatSizeStep === 'number' && Number.isFinite(a.chatSizeStep) ? a.chatSizeStep : undefined;

    let customColors: Record<string, string> | undefined;
    if (a.customColors && typeof a.customColors === 'object' && !Array.isArray(a.customColors)) {
        customColors = {};
        for (const [k, v] of Object.entries(a.customColors as Record<string, unknown>)) {
            if (typeof v === 'string') customColors[k] = v;
        }
    }

    let savedThemes: SavedThemeData[] | undefined;
    if (Array.isArray(a.savedThemes)) {
        savedThemes = [];
        for (const item of a.savedThemes) {
            if (savedThemes.length >= 3) break; // Hard limit
            if (typeof item !== 'object' || !item) continue;
            
            const st = item as Record<string, unknown>;
            if (typeof st.id !== 'string' || !st.id.startsWith('user_theme_')) continue;
            
            const id = st.id;
            const name = typeof st.name === 'string' ? st.name.slice(0, 30) : 'Saved Theme';
            const emoji = typeof st.emoji === 'string' ? st.emoji.slice(0, 5) : '🎨';
            const basePresetId = typeof st.basePresetId === 'string' ? st.basePresetId : 'washi';
            
            const rawColors = st.colors as Record<string, unknown>;
            if (typeof rawColors !== 'object' || !rawColors || Array.isArray(rawColors)) continue;
            
            const colors: Record<string, string> = {};
            for (const [k, v] of Object.entries(rawColors)) {
                if (typeof v === 'string') {
                    // Strict sanitization to prevent CSS injection via DB payload
                    const s = v.trim();
                    if (!s.toLowerCase().includes('url(') && !s.includes(';') && !s.includes('}') && !s.includes('{') && !s.includes('var(') && !s.includes('expression(')) {
                        colors[k] = s;
                    }
                }
            }
            
            savedThemes.push({ id, name, emoji, basePresetId, colors });
        }
    }

    const out: Partial<AppearanceSettingsPayload> = { themeSource };
    if (activeThemeId !== undefined) out.activeThemeId = activeThemeId;
    if (customBasePresetId !== undefined) out.customBasePresetId = customBasePresetId;
    if (customColors !== undefined) out.customColors = customColors;
    if (chatSizeStep !== undefined) out.chatSizeStep = chatSizeStep;
    if (savedThemes !== undefined) out.savedThemes = savedThemes;
    return out;
}
