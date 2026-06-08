/**
 * src/config/themes.ts
 *
 * Canonical configuration for Lucen's theme system.
 * This module re-exports all theme types, presets, and constants from
 * `themeStore` so consumers can import from a clean config path
 * without depending on store internals.
 *
 * Usage:
 *   import { THEME_PRESETS, type ThemePreset, type ThemeColors } from '../config/themes';
 *
 * Preset authoring is done in `src/store/themeStore.ts` → `THEME_PRESETS`.
 * This file is the stable public API surface; do not inline preset data here.
 */

export type {
    ThemeColors,
    ThemePreset,
    ThemeSolidColorKey,
    ThemeAlphaColorKey,
} from '../store/themeStore';

export {
    THEME_PRESETS,
    THEME_SOLID_COLOR_KEYS,
    THEME_ALPHA_COLOR_KEYS,
    THEME_COLOR_LABELS,
    CHAT_SIZE_STEPS,
    CHAT_SIZE_LABELS,
} from '../store/themeStore';
