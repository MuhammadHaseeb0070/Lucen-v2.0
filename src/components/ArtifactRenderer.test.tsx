import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// @ts-ignore
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../workers/highlighterWorkerClient', () => ({
  highlightCode: vi.fn((code: string) => Promise.resolve(`<pre>${code}</pre>`)),
}));

import ArtifactRenderer from './ArtifactRenderer';

describe('ArtifactRenderer', () => {
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container) {
      document.body.removeChild(container);
      container = null;
    }
  });

  it('renders SVG securely by sanitizing unsafe elements', async () => {
    const unsafeSvg = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <script>alert('xss')</script>
        <rect width="100" height="100" />
        <foreignObject>
          <iframe></iframe>
        </foreignObject>
      </svg>
    `;

    let root: any;
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <ArtifactRenderer
          content={unsafeSvg}
          type="svg"
          viewMode="preview"
          artifactId="test-svg"
        />
      );
    });

    // Let's check container contents
    const svgHtml = container!.innerHTML;
    // Script tag should be stripped
    expect(svgHtml).not.toContain('<script>');
    // foreignObject should be stripped
    expect(svgHtml).not.toContain('foreignObject');
    // iframe should be stripped
    expect(svgHtml).not.toContain('iframe');
    // rect should be present
    expect(svgHtml).toContain('<rect');
  });

  it('renders empty/malformed HTML artifacts with styled fallback error card', async () => {
    // Malformed HTML content
    const emptyHtml = '   ';
    
    let root: any;
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <ArtifactRenderer
          content={emptyHtml}
          type="html"
          viewMode="preview"
          isStreaming={false}
          artifactId="test-html-empty"
        />
      );
    });

    const html = container!.innerHTML;
    // Should display the malformed warning
    expect(html).toContain('Empty or Malformed HTML Artifact');
    expect(html).not.toContain('<iframe');
  });

  it('tightens sandbox to allow-scripts only on iframe', async () => {
    const validHtml = '<h1>Hello World</h1>';
    
    let root: any;
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <ArtifactRenderer
          content={validHtml}
          type="html"
          viewMode="preview"
          isStreaming={false}
          artifactId="test-html-valid"
        />
      );
    });

    const iframe = container!.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('renders a warning banner when blocked interactive elements are present in preview content', async () => {
    const interactiveHtml = '<div><form><input type="text"/></form></div>';
    
    let root: any;
    await act(async () => {
      root = createRoot(container!);
      root.render(
        <ArtifactRenderer
          content={interactiveHtml}
          type="html"
          viewMode="preview"
          isStreaming={false}
          artifactId="test-html-interactive"
        />
      );
    });

    const warningBanner = container!.querySelector('.sandbox-warning-banner');
    expect(warningBanner).not.toBeNull();
    expect(warningBanner!.textContent).toContain('Interactive elements');
  });
});
