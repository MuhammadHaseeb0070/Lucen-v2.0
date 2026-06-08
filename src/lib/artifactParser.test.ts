import { describe, it, expect } from 'vitest';
import { parseArtifacts } from './artifactParser';

describe('parseArtifacts', () => {
  it('should parse complete artifact tags and return clean content and artifact list', () => {
    const content = 'Here is the code:\n<lucen_artifact type="html" title="Test App">\n<h1>Hello</h1>\n</lucen_artifact>\nHope you like it!';
    const result = parseArtifacts(content, 'msg-1');

    expect(result.cleanContent).toBe('Here is the code:\n\nHope you like it!');
    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0]).toEqual(expect.objectContaining({
      id: 'msg-1-artifact-0',
      type: 'html',
      title: 'Test App',
      content: '<h1>Hello</h1>',
      messageId: 'msg-1'
    }));
  });

  it('should handle attributes in different order and quotes types', () => {
    const content = '<lucen_artifact title=\'Custom SVG\' type="svg">\n<svg></svg>\n</lucen_artifact>';
    const result = parseArtifacts(content, 'msg-2');

    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].title).toBe('Custom SVG');
    expect(result.artifacts[0].type).toBe('svg');
  });

  it('should neutralize tags inside markdown fenced code blocks', () => {
    const content = 'Check out this syntax:\n```xml\n<lucen_artifact type="html" title="Sample">\n<div>Code</div>\n</lucen_artifact>\n```';
    const result = parseArtifacts(content, 'msg-3');

    expect(result.artifacts.length).toBe(0);
    expect(result.cleanContent).toContain('<lucen\u200Bartifact');
  });

  it('should parse partial/streaming tags when still typing', () => {
    const content = 'Working on it:\n<lucen_artifact type="mermaid" title="Flow">\ngraph TD\nA --> B';
    const result = parseArtifacts(content, 'msg-4');

    expect(result.cleanContent).toBe('Working on it:');
    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0]).toEqual(expect.objectContaining({
      type: 'mermaid',
      title: 'Flow',
      content: 'graph TD\nA --> B',
      isStreaming: true
    }));
  });

  it('should force close unclosed tags when stream is done', () => {
    const content = 'Working on it:\n<lucen_artifact type="mermaid" title="Flow">\ngraph TD\nA --> B';
    const result = parseArtifacts(content, 'msg-5', true);

    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].isStreaming).toBe(false);
    expect(result.artifacts[0].generationStatus).toBe('partial_saved');
  });

  it('should strip orphaned closing HTML tags from cleanContent', () => {
    const content = 'Here is the app:\n<lucen_artifact type="html" title="Grid">\n<div>Grid</div>\n</lucen_artifact>\n  </div>  \n  </li>  \n</ul>';
    const result = parseArtifacts(content, 'msg-6');

    expect(result.cleanContent).toBe('Here is the app:');
  });

  it('should strip orphaned closing tags at the end of a line or text, and orphaned lucen_artifact closing tags', () => {
    const content = 'Here is the app: </lucen_artifact> </div> </li>';
    const result = parseArtifacts(content, 'msg-7');
    expect(result.cleanContent).toBe('Here is the app:');
  });
});
