const fs = require('fs');

function fixThemeStore() {
    let content = fs.readFileSync('src/store/themeStore.ts', 'utf8');

    // Fix buildThemeApplyFingerprint and scheduleAppearanceSyncToServer references to old variables
    content = content.replace(/const active_theme = s\.themeSource === 'custom' \? 'custom' : s\.activeThemeId;/g, "const active_theme = s.activeThemeId;");
    content = content.replace(/themeSource: s\.themeSource,\s*/g, "");
    content = content.replace(/customBasePresetId: s\.customBasePresetId,\s*/g, "");
    content = content.replace(/customColors: s\.customColors,\s*/g, "");

    content = content.replace(/let lastCustomBasePresetId: any = null;\s*/g, "");
    content = content.replace(/let lastCustomColors: any = null;\s*/g, "");

    content = content.replace(/const customColorsChanged = s\.customColors !== lastCustomColors && \s*JSON\.stringify\(s\.customColors\) !== JSON\.stringify\(lastCustomColors\);\s*/g, "");
    content = content.replace(/s\.customBasePresetId === lastCustomBasePresetId &&\s*/g, "");
    content = content.replace(/!customColorsChanged/g, "true");
    
    content = content.replace(/lastCustomBasePresetId = s\.customBasePresetId;\s*/g, "");
    content = content.replace(/lastCustomColors = s\.customColors;\s*/g, "");

    fs.writeFileSync('src/store/themeStore.ts', content);
}

function fixHomePage() {
    let content = fs.readFileSync('src/pages/HomePage.tsx', 'utf8');
    content = content.replace(/const isCustom = themeSource === 'custom';/g, "const isCustom = activeThemeId.startsWith('user_theme_');");
    fs.writeFileSync('src/pages/HomePage.tsx', content);
}

function fixSettingsScreen() {
    let content = fs.readFileSync('src/components/SettingsScreen.tsx', 'utf8');
    content = content.replace(/const isCustomTheme = themeSource === 'custom';/g, "const isCustomTheme = activeThemeId.startsWith('user_theme_');");
    content = content.replace(/const isCustomTheme = useThemeStore\(\(s\) => s\.themeSource === 'custom'\);/g, "const isCustomTheme = useThemeStore((s) => s.activeThemeId.startsWith('user_theme_'));");
    // Also remove beginCustomTheme calls in settings if any
    content = content.replace(/beginCustomTheme,/g, "createCustomTheme,");
    content = content.replace(/beginCustomTheme\(\)/g, "createCustomTheme()");
    fs.writeFileSync('src/components/SettingsScreen.tsx', content);
}

function fixCommandPalette() {
    let content = fs.readFileSync('src/components/CommandPalette.tsx', 'utf8');
    content = content.replace(/const isCustomTheme = useThemeStore\(\(s\) => s\.themeSource === 'custom'\);/g, "const isCustomTheme = useThemeStore((s) => s.activeThemeId.startsWith('user_theme_'));");
    fs.writeFileSync('src/components/CommandPalette.tsx', content);
}

function fixThemeStoreTest() {
    if(fs.existsSync('src/store/themeStore.test.ts')){
        let content = fs.readFileSync('src/store/themeStore.test.ts', 'utf8');
        content = content.replace(/themeSource: 'preset'/g, "");
        content = content.replace(/expect\(state\.themeSource\)\.toBe\('preset'\);/g, "");
        content = content.replace(/expect\(state\.themeSource\)\.toBe\('custom'\);/g, "");
        content = content.replace(/useThemeStore\.getState\(\)\.setCustomBasePresetId\('stitch'\);/g, "");
        content = content.replace(/useThemeStore\.getState\(\)\.setCustomColor\('bgBase', '#000000'\);/g, "");
        fs.writeFileSync('src/store/themeStore.test.ts', content);
    }
}

try {
    fixThemeStore();
    fixHomePage();
    fixSettingsScreen();
    fixCommandPalette();
    fixThemeStoreTest();
} catch (e) {
    console.error(e);
}
