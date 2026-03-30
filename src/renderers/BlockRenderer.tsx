import React from 'react';
import type { Block } from './detectBlocks';

import ArtifactRenderer from '../components/ArtifactRenderer';
import MermaidRenderer from './MermaidRenderer';
import { MathBlockRenderer, MarkdownInlineMathRenderer } from './MathRenderer';
import CodeRenderer from './CodeRenderer';
import TableRenderer from './TableRenderer';

function safeBlockWrapper(children: React.ReactNode) {
  return <div style={{ margin: '0.75rem 0' }}>{children}</div>;
}

export function renderBlocks(block: Block, i: number): React.ReactNode {
  try {
    switch (block.type) {
      case 'artifact': {
        return (
          <React.Fragment key={i}>
            {safeBlockWrapper(
              <ArtifactRenderer
                content={block.content}
                title={block.title}
                type={block.artifactType as any}
                viewMode="preview"
              />
            )}
          </React.Fragment>
        );
      }
      case 'mermaid':
        return (
          <React.Fragment key={i}>
            <MermaidRenderer content={block.content} />
          </React.Fragment>
        );
      case 'math_block':
        return (
          <React.Fragment key={i}>
            <MathBlockRenderer content={block.content} />
          </React.Fragment>
        );
      case 'code':
        return (
          <React.Fragment key={i}>
            <CodeRenderer lang={block.lang} content={block.content} />
          </React.Fragment>
        );
      case 'table':
        return (
          <React.Fragment key={i}>
            <TableRenderer content={block.content} />
          </React.Fragment>
        );
      case 'markdown':
        return (
          <React.Fragment key={i}>
            <MarkdownInlineMathRenderer content={block.content} />
          </React.Fragment>
        );
      default:
        return (
          <React.Fragment key={i}>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{(block as any).raw}</pre>
          </React.Fragment>
        );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return (
      <React.Fragment key={i}>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{`[Render error: ${msg}]\n${block.raw}`}</pre>
      </React.Fragment>
    );
  }
}

