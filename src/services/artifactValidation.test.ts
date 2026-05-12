import { describe, expect, it } from 'vitest';
import { validateArtifactContent } from './artifactValidation';

describe('validateArtifactContent', () => {
  it('accepts a complete HTML artifact', () => {
    const result = validateArtifactContent(
      'html',
      '<!DOCTYPE html><html><head><style>body{color:white}</style></head><body><script>console.log("ok")</script></body></html>',
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects an unclosed HTML script block', () => {
    const result = validateArtifactContent(
      'html',
      '<html><head></head><body><script>console.log("broken")</body></html>',
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Unbalanced <script> tags.');
  });

  it('rejects unsafe SVG scripts', () => {
    const result = validateArtifactContent('svg', '<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>');

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('SVG artifact cannot include script tags.');
  });

  it('rejects invalid JSON file artifacts', () => {
    const result = validateArtifactContent('file', '{ "ok": false, }', 'data.json');

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/^Invalid JSON:/);
  });

  it('rejects Mermaid diagrams without a declaration', () => {
    const result = validateArtifactContent('mermaid', 'A --> B');

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('valid diagram declaration');
  });
});
