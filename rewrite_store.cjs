const fs = require('fs');

const filePath = 'src/store/themeStore.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Remove ThemeSource export
content = content.replace(/export type ThemeSource = 'preset' \| 'custom';\r?\n/, '');
content = content.replace(/let lastThemeSource: any = null;\r?\n/, '');
content = content.replace(/\s*s\.themeSource === lastThemeSource &&\r?\n/, '');
content = content.replace(/\s*lastThemeSource = s\.themeSource;\r?\n/, '');

const oldInterface = `interface ThemeStore {
    activeThemeId: string;
    themeSource: ThemeSource;
    customBasePresetId: string;
    customColors: Partial<ThemeColors>;
    chatSizeStep: number;
    savedThemes: SavedThemeData[];

    settingsOpen: boolean;
    settingsTab: string;

    setTheme: (id: string) => void;
    setCustomBasePresetId: (id: string) => void;
    setCustomColor: (key: keyof ThemeColors, value: string) => void;
    patchCustomColors: (patch: Partial<ThemeColors>) => void;
    resetCustomColors: () => void;
    beginCustomTheme: () => void;
    saveCustomTheme: (name: string, emoji?: string) => void;
    deleteSavedTheme: (id: string) => void;
    getResolvedTheme: () => ThemePreset;
    getActiveTheme: () => ThemePreset;
    hydrateFromServerRow: (row: { active_theme: string; settings: Record<string, unknown> }) => void;

    toggleSettings: () => void;
    setSettingsOpen: (open: boolean) => void;
    setSettingsTab: (tab: string) => void;
    setChatSizeStep: (step: number) => void;
}`;

const newInterface = `interface ThemeStore {
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
}`;

content = content.replace(oldInterface, newInterface);

const oldResolve = `function resolveThemeFromState(state: {
    themeSource: ThemeSource;
    activeThemeId: string;
    customBasePresetId: string;
    customColors: Partial<ThemeColors>;
    savedThemes: SavedThemeData[];
}): ThemePreset {
    if (state.themeSource === 'preset') {
        const builtIn = THEME_PRESETS.find((t) => t.id === state.activeThemeId);
        if (builtIn) return builtIn;

        const saved = state.savedThemes.find((t) => t.id === state.activeThemeId);
        if (saved) {
            const base = THEME_PRESETS.find((t) => t.id === saved.basePresetId) || THEME_PRESETS[0];
            return {
                id: saved.id,
                name: saved.name,
                emoji: saved.emoji,
                category: 'curated',
                isDark: base.isDark,
                colors: mergeThemeColors(base.colors, saved.colors as Partial<ThemeColors>),
            };
        }
        return THEME_PRESETS[0];
    }
    const base =
        THEME_PRESETS.find((t) => t.id === state.customBasePresetId) || THEME_PRESETS[0];
    const colors = mergeThemeColors(base.colors, state.customColors);
    return {
        ...base,
        id: 'custom',
        name: 'Custom',
        colors,
    };
}`;

const newResolve = `function resolveThemeFromState(state: {
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
}`;

content = content.replace(oldResolve, newResolve);

// now replace the zustand store implementation
const oldZustandStore = `
            activeThemeId: 'stitch',
            themeSource: 'preset' as ThemeSource,
            customBasePresetId: 'stitch',
            customColors: {} as Partial<ThemeColors>,
            chatSizeStep: DEFAULT_CHAT_SIZE_STEP,
            savedThemes: [] as SavedThemeData[],

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
                
                let actualBaseId = baseId;
                if (s.themeSource === 'preset' && s.activeThemeId.startsWith('user_theme_')) {
                    const st = s.savedThemes.find(t => t.id === s.activeThemeId);
                    if (st) actualBaseId = st.basePresetId;
                }
                        
                const base = THEME_PRESETS.find((t) => t.id === actualBaseId) || THEME_PRESETS[0];
                set({
                    themeSource: 'custom',
                    customBasePresetId: base.id,
                    customColors: s.themeSource === 'preset' && s.activeThemeId.startsWith('user_theme_') 
                        ? s.savedThemes.find(t => t.id === s.activeThemeId)?.colors as Partial<ThemeColors> || {}
                        : {},
                });
                scheduleAppearanceSyncToServer();
            },

            saveCustomTheme: (name, emoji = '🎨') => {
                const s = get();
                const newId = \`user_theme_\${Date.now()}\`;
                
                const newTheme: SavedThemeData = {
                    id: newId,
                    name: name.slice(0, 30),
                    emoji: emoji.slice(0, 5),
                    basePresetId: s.customBasePresetId,
                    colors: { ...s.customColors } as Record<string, string>,
                };
                
                set({
                    savedThemes: [...s.savedThemes, newTheme],
                    themeSource: 'preset',
                    activeThemeId: newId,
                    customColors: {},
                });
                scheduleAppearanceSyncToServer();
            },

            deleteSavedTheme: (id) => {
                const s = get();
                const newSaved = s.savedThemes.filter(t => t.id !== id);
                let newActiveId = s.activeThemeId;
                let newSource = s.themeSource;
                
                if (s.themeSource === 'preset' && s.activeThemeId === id) {
                    newActiveId = 'stitch';
                }
                
                set({
                    savedThemes: newSaved,
                    activeThemeId: newActiveId,
                    themeSource: newSource,
                });
                scheduleAppearanceSyncToServer();
            },`;

const newZustandStore = `
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
                
                // If the resolved theme is a custom theme itself, use its base. Otherwise use it.
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
            },`;

content = content.replace(oldZustandStore, newZustandStore);

const oldHydrate = `            hydrateFromServerRow: (row) => {
                const appearance = parseAppearanceFromSettings(row.settings);
                const known = (id: string) => THEME_PRESETS.some((t) => t.id === id) || (appearance?.savedThemes || []).some((t) => t.id === id);

                const clampStep = (n: number | undefined) =>
                    Math.max(0, Math.min(CHAT_SIZE_STEPS.length - 1, n ?? DEFAULT_CHAT_SIZE_STEP));

                if (appearance) {
                    const chatSizeStep = clampStep(appearance.chatSizeStep);

                    if (appearance.themeSource === 'custom') {
                        const customBasePresetId =
                            appearance.customBasePresetId && known(appearance.customBasePresetId)
                                ? appearance.customBasePresetId
                                : 'stitch';
                        set({
                            themeSource: 'custom',
                            customBasePresetId,
                            activeThemeId:
                                appearance.activeThemeId && known(appearance.activeThemeId)
                                    ? appearance.activeThemeId
                                    : customBasePresetId,
                            customColors: (appearance.customColors as Partial<ThemeColors>) || {},
                            chatSizeStep,
                            savedThemes: appearance.savedThemes || [],
                        });
                    } else {
                        const fromRow =
                            row.active_theme && row.active_theme !== 'custom' && known(row.active_theme)
                                ? row.active_theme
                                : null;
                        const activeThemeId =
                            appearance.activeThemeId && known(appearance.activeThemeId)
                                ? appearance.activeThemeId
                                : fromRow || 'stitch';
                        set({
                            themeSource: 'preset',
                            activeThemeId,
                            customBasePresetId: 'stitch',
                            customColors: {},
                            chatSizeStep,
                            savedThemes: appearance.savedThemes || [],
                        });
                    }
                    return;
                }

                if (row.active_theme && row.active_theme !== 'custom' && known(row.active_theme)) {
                    set({
                        themeSource: 'preset',
                        activeThemeId: row.active_theme,
                        customBasePresetId: 'stitch',
                        customColors: {},
                    });
                }
            },`;

const newHydrate = `            hydrateFromServerRow: (row) => {
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
                                
                    // Handle migration for users stuck in old 'custom' themeSource
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
            },`;

content = content.replace(oldHydrate, newHydrate);

const oldPersist = `            partialize: (s) => ({
                activeThemeId: s.activeThemeId,
                themeSource: s.themeSource,
                customBasePresetId: s.customBasePresetId,
                customColors: s.customColors,
                chatSizeStep: s.chatSizeStep,
                savedThemes: s.savedThemes,
            }),`;

const newPersist = `            partialize: (s) => ({
                activeThemeId: s.activeThemeId,
                chatSizeStep: s.chatSizeStep,
                savedThemes: s.savedThemes,
            }),`;
content = content.replace(oldPersist, newPersist);

fs.writeFileSync(filePath, content);
console.log('Successfully updated themeStore.ts');
