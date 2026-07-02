import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore, buildThemeApplyFingerprint } from './themeStore';

describe('themeStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useThemeStore.setState({
      activeThemeId: 'washi',
      savedThemes: [],
      chatSizeStep: 2,
    });
  });

  it('should resolve preset themes correctly', () => {
    const state = useThemeStore.getState();
    const resolved = state.getResolvedTheme();

    expect(resolved.id).toBe('washi');
  });

  it('should generate theme fingerprint reflecting color and scale states', () => {
    const state = useThemeStore.getState();
    const fingerprintInitial = buildThemeApplyFingerprint();

    state.setChatSizeStep(3);
    const fingerprintScale = buildThemeApplyFingerprint();

    expect(fingerprintInitial).not.toBe(fingerprintScale);
    expect(JSON.parse(fingerprintScale).chatSizeStep).toBe(3);
  });
});
