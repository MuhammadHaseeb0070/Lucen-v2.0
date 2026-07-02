const fs = require('fs');
let content = fs.readFileSync('src/store/themeStore.ts', 'utf8');

// We just replace everything from 'interface ThemeStore' down to 'export function applyTheme'
const startIndex = content.indexOf('interface ThemeStore {');
const endIndex = content.indexOf('export function applyTheme(theme: ThemePreset): void {');

if (startIndex === -1 || endIndex === -1) {
    console.error('Could not find boundaries');
    process.exit(1);
}

const newStoreLogic = `interface ThemeStore {
    activeThemeId: string;
    chatSizeStep: number;
    savedThemes: SavedThemeData[];

    settingsOpen: boolean;
    settingsTab: string;

    setTheme: (id: string) => void;
    createCustomTheme: () => string | null;
    updateCustomTheme: (id: string, patch: Partial<ThemeColors>) => void;
    deleteSavedTheme: (id: string) => void;
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
    activeThemeId: string;
    savedThemes: SavedThemeData[];
}): ThemePreset {
    const builtIn = THEME_PRESETS.find((t) => t.id === state.activeThemeId);
    if (builtIn) return builtIn;

    const saved = state.savedThemes.find((t) => t.id === state.activeThemeId);
    if (saved) {
        const base = THEME_PRESETS.find((t) => t.id === saved.basePresetId) || THEME_PRESETS[0];
        return {
            id: saved.id,
            name: saved.name,
            category: 'curated',
            isDark: base.isDark,
            colors: mergeThemeColors(base.colors, saved.colors as Partial<ThemeColors>),
        };
    }
    return THEME_PRESETS[0];
}

export const useThemeStore = create<ThemeStore>()(
    subscribeWithSelector(
        persist(
            (set, get) => ({
                activeThemeId: 'stitch',
                chatSizeStep: DEFAULT_CHAT_SIZE_STEP,
                savedThemes: [] as SavedThemeData[],

                settingsOpen: false,
                settingsTab: 'appearance',

                setTheme: (id) => {
                    set({ activeThemeId: id });
                    scheduleAppearanceSyncToServer();
                },

                createCustomTheme: () => {
                    const s = get();
                    if (s.savedThemes.length >= 3) return null; // Hard limit

                    const newId = \`user_theme_\${Date.now()}\`;
                    const resolved = s.getResolvedTheme();
                    
                    const basePresetId = THEME_PRESETS.some(t => t.id === resolved.id) ? resolved.id : 'stitch';

                    const newTheme: SavedThemeData = {
                        id: newId,
                        name: 'My Custom Theme',
                        basePresetId,
                        colors: { ...resolved.colors } as Record<string, string>,
                    };
                    
                    set({
                        savedThemes: [...s.savedThemes, newTheme],
                        activeThemeId: newId,
                    });
                    scheduleAppearanceSyncToServer();
                    return newId;
                },

                updateCustomTheme: (id, patch) => {
                    const s = get();
                    const newSaved = s.savedThemes.map((t) => {
                        if (t.id === id) {
                            return { ...t, colors: { ...t.colors, ...patch } };
                        }
                        return t;
                    });
                    set({ savedThemes: newSaved });
                    scheduleAppearanceSyncToServer();
                },

                deleteSavedTheme: (id) => {
                    const s = get();
                    const newSaved = s.savedThemes.filter(t => t.id !== id);
                    let newActiveId = s.activeThemeId;
                    
                    if (s.activeThemeId === id) {
                        newActiveId = 'stitch';
                    }
                    
                    set({
                        savedThemes: newSaved,
                        activeThemeId: newActiveId,
                    });
                    scheduleAppearanceSyncToServer();
                },

                getResolvedTheme: () => resolveThemeFromState(get()),
                getActiveTheme: () => resolveThemeFromState(get()),

                hydrateFromServerRow: (row) => {
                    const appearance = parseAppearanceFromSettings(row.settings);
                    const known = (id: string) => THEME_PRESETS.some((t) => t.id === id) || (appearance?.savedThemes || []).some((t) => t.id === id);

                    const clampStep = (n: number | undefined) =>
                        Math.max(0, Math.min(CHAT_SIZE_STEPS.length - 1, n ?? DEFAULT_CHAT_SIZE_STEP));

                    if (appearance) {
                        const chatSizeStep = clampStep(appearance.chatSizeStep);
                        const fromRow = row.active_theme && row.active_theme !== 'custom' && known(row.active_theme)
                                    ? row.active_theme
                                    : null;
                                    
                        let activeThemeId = appearance.activeThemeId && known(appearance.activeThemeId)
                                    ? appearance.activeThemeId
                                    : fromRow || 'stitch';
                                    
                        if (appearance.themeSource === 'custom' && !activeThemeId.startsWith('user_theme_')) {
                            activeThemeId = appearance.customBasePresetId && known(appearance.customBasePresetId) ? appearance.customBasePresetId : 'stitch';
                        }

                        set({
                            activeThemeId,
                            chatSizeStep,
                            savedThemes: appearance.savedThemes || [],
                        });
                        return;
                    }

                    if (row.active_theme && row.active_theme !== 'custom' && known(row.active_theme)) {
                        set({
                            activeThemeId: row.active_theme,
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
                version: 4,
                onRehydrateStorage: () => () => {
                    lastThemeApplyFingerprint = '';
                    applyThemeFromStore();
                },
                migrate: (persisted, fromVersion) => {
                    const p = persisted as Record<string, unknown>;
                    if (fromVersion < 4) {
                        if (p.chatSizeStep === undefined) p.chatSizeStep = DEFAULT_CHAT_SIZE_STEP;
                        if (p.activeThemeId === undefined || p.activeThemeId === '') p.activeThemeId = 'stitch';
                        if (p.savedThemes === undefined) p.savedThemes = [];
                    }
                    return p as any;
                },
                partialize: (s) => ({
                    activeThemeId: s.activeThemeId,
                    chatSizeStep: s.chatSizeStep,
                    savedThemes: s.savedThemes,
                }),
            }
        )
    )
);

/** Apply theme color CSS variables to document root */
`;

content = content.substring(0, startIndex) + newStoreLogic + content.substring(endIndex + 54);

// Remove ThemeSource export
content = content.replace(/export type ThemeSource = 'preset' \| 'custom';\r?\n/, '');
content = content.replace(/let lastThemeSource: any = null;\r?\n/, '');
content = content.replace(/\s*s\.themeSource === lastThemeSource &&\r?\n/, '');
content = content.replace(/\s*lastThemeSource = s\.themeSource;\r?\n/, '');

fs.writeFileSync('src/store/themeStore.ts', content);
