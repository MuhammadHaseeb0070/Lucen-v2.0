// ============================================
// user_settings — Supabase sync (appearance)
// ============================================
// No imports from themeStore to avoid circular deps.

import { supabase, isSupabaseEnabled, hasActiveSession } from '../lib/supabase';

export interface AppearanceSettingsPayload {
    themeSource: 'preset' | 'custom';
    activeThemeId: string;
    customBasePresetId: string;
    customColors: Record<string, string>;
    chatSizeStep: number;
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
        console.warn('[userSettings] fetch failed', error.message);
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
        console.warn('[userSettings] upsert failed', error.message);
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

    const out: Partial<AppearanceSettingsPayload> = { themeSource };
    if (activeThemeId !== undefined) out.activeThemeId = activeThemeId;
    if (customBasePresetId !== undefined) out.customBasePresetId = customBasePresetId;
    if (customColors !== undefined) out.customColors = customColors;
    if (chatSizeStep !== undefined) out.chatSizeStep = chatSizeStep;
    return out;
}
