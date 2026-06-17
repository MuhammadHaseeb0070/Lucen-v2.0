import { describe, it, expect } from 'vitest';
import { applyPatch } from './artifactPatcher';
import type { PatchBlock } from './artifactPatchParser';

describe('artifactPatcher pre-flight with overlap checks', () => {
  it('should successfully apply multiple non-overlapping patches', () => {
    const original = 'line 1\nline 2\nline 3\nline 4';
    const blocks: PatchBlock[] = [
      {
        search: 'line 2',
        replace: 'line TWO',
      },
      {
        search: 'line 4',
        replace: 'line FOUR',
      },
    ];

    const result = applyPatch(original, blocks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newContent).toBe('line 1\nline TWO\nline 3\nline FOUR');
      expect(result.appliedBlocks.length).toBe(2);
      expect(result.appliedBlocks[0].strategy).toBe('exact');
      expect(result.appliedBlocks[1].strategy).toBe('exact');
    }
  });

  it('should fail if a single block fails to match', () => {
    const original = 'line 1\nline 2\nline 3';
    const blocks: PatchBlock[] = [
      {
        search: 'line 2',
        replace: 'line TWO',
      },
      {
        search: 'nonexistent line',
        replace: 'whatever',
      },
    ];

    const result = applyPatch(original, blocks);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockIndex).toBe(1);
      expect(result.reason).toBe('no_match');
    }
  });

  it('should fail and return overlapping_blocks if blocks overlap', () => {
    const original = 'line 1\nline 2\nline 3\nline 4';
    const blocks: PatchBlock[] = [
      {
        search: 'line 2\nline 3',
        replace: 'line TWO AND THREE',
      },
      {
        search: 'line 3\nline 4',
        replace: 'line THREE AND FOUR',
      },
    ];

    const result = applyPatch(original, blocks);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockIndex).toBe(1);
      expect(result.reason).toBe('overlapping_blocks');
    }
  });

  it('should apply blocks bottom-up correctly', () => {
    const original = 'alpha beta gamma';
    const blocks: PatchBlock[] = [
      {
        search: 'beta',
        replace: 'BETA',
      },
      {
        search: 'alpha',
        replace: 'ALPHA',
      },
    ];

    const result = applyPatch(original, blocks);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newContent).toBe('ALPHA BETA gamma');
    }
  });
});
