const fs = require('fs');
let text = fs.readFileSync('src/store/themeStore.ts', 'utf8');

const target = '/** Apply theme color CSS variables to document root */\r\n    root.style.setProperty(';
const replacement = '/** Apply theme color CSS variables to document root */\r\nexport function applyTheme(theme: ThemePreset): void {\r\n    const root = document.documentElement;\r\n    const c = theme.colors;\r\n    root.style.setProperty(\'--bg-base\', c.bgBase);\r\n    root.style.setProperty(\'--bg-surface\', c.bgSurface);\r\n    root.style.setProperty(\'--bg-surface-hover\', c.bgSurfaceHover);\r\n    root.style.setProperty(\'--bg-muted\', c.bgMuted);\r\n    root.style.setProperty(';

text = text.replace(target, replacement);

const target2 = '/** Apply theme color CSS variables to document root */\n    root.style.setProperty(';
const replacement2 = '/** Apply theme color CSS variables to document root */\nexport function applyTheme(theme: ThemePreset): void {\n    const root = document.documentElement;\n    const c = theme.colors;\n    root.style.setProperty(\'--bg-base\', c.bgBase);\n    root.style.setProperty(\'--bg-surface\', c.bgSurface);\n    root.style.setProperty(\'--bg-surface-hover\', c.bgSurfaceHover);\n    root.style.setProperty(\'--bg-muted\', c.bgMuted);\n    root.style.setProperty(';

text = text.replace(target2, replacement2);

fs.writeFileSync('src/store/themeStore.ts', text);
