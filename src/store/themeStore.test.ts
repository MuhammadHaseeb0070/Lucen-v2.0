import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore, buildThemeApplyFingerprint } from './themeStore';

describe('themeStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useThemeStore.setState({
      activeThemeId: 'washi',
      themeSource: 'preset',
      customBasePresetId: 'washi',
      customColors: {},
      chatSizeStep: 2,
    });
  });

  it('should resolve preset themes correctly', () => {
    const state = useThemeStore.getState();
    const resolved = state.getResolvedTheme();

    expect(resolved.id).toBe('washi');
    expect(state.themeSource).toBe('preset');
  });

  it('should resolve custom theme base presets and colors', () => {
    const state = useThemeStore.getState();

    state.setCustomBasePresetId('washi');
    state.setCustomColor('bgBase', '#ff0000');

    const updatedState = useThemeStore.getState();
    const resolved = updatedState.getResolvedTheme();

    expect(updatedState.themeSource).toBe('custom');
    expect(resolved.id).toBe('custom');
    expect(resolved.colors.bgBase).toBe('#ff0000');
  });

  it('should generate theme fingerprint reflecting color and scale states', () => {
    const state = useThemeStore.getState();
    const fingerprintInitial = buildThemeApplyFingerprint();

    state.setChatSizeStep(3);
    const fingerprintScale = buildThemeApplyFingerprint();

    expect(fingerprintInitial).not.toBe(fingerprintScale);
    expect(JSON.parse(fingerprintScale).chatSizeStep).toBe(3);

    state.setCustomColor('bgSurface', '#0000ff');
    const fingerprintColor = buildThemeApplyFingerprint();

    expect(fingerprintScale).not.toBe(fingerprintColor);
    expect(JSON.parse(fingerprintColor).bgSurface).toBe('#0000ff');
  });
});
