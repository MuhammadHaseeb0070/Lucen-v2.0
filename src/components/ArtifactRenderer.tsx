import React, { useEffect, useRef, useState, useMemo, useCallback, Component } from 'react';
import { highlightCode } from '../workers/highlighterWorkerClient';
import { AlertTriangle, ZoomIn, ZoomOut, RotateCcw, Download, X } from 'lucide-react';
import type { ArtifactType } from '../types';
import type { PreviewViewport } from '../store/artifactStore';
import { useArtifactStore } from '../store/artifactStore';
import { attachErrorListener, injectIntoHtml } from '../lib/iframeErrorBridge';

interface RendererProps {
  content: string;
  title?: string;
  viewport?: PreviewViewport;
  isStreaming?: boolean;
  /** Artifact id used to route captured runtime errors back into artifactStore. */
  artifactId?: string;
}

// Heavy preview renders (iframe reload, mermaid compile, SVG parse) are
// throttled to this interval while the artifact is still streaming. Code view
// continues to update in real time.
const STREAMING_PREVIEW_THROTTLE_MS = 1500;

/**
 * Sanitize SVG content before DOM insertion. Strips elements and attributes
 * that could execute JavaScript or load external resources.
 * This is a defense-in-depth measure — SVGs in the main DOM are NOT sandboxed.
 */
function sanitizeSvg(svg: string): string {
  let cleaned = svg;
  // Strip <script> tags and their contents
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
  // Strip <foreignObject> tags (can contain arbitrary HTML+JS)
  cleaned = cleaned.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  // Strip <iframe>, <object>, <embed> tags
  cleaned = cleaned.replace(/<(iframe|object|embed)[\s\S]*?<\/\1>/gi, '');
  cleaned = cleaned.replace(/<(iframe|object|embed)[^>]*\/?>/gi, '');
  // Strip event handler attributes (onload, onerror, onclick, etc.)
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Strip javascript: URIs in href/xlink:href/src attributes
  cleaned = cleaned.replace(/((?:href|xlink:href|src|action)\s*=\s*)(["'])javascript:[^"']*["']/gi, '$1$2$3');
  // Strip <use> elements with external references
  cleaned = cleaned.replace(/<use[^>]*(?:href|xlink:href)\s*=\s*(?:"https?:[^"]*"|'https?:[^']*')[^>]*\/?>/gi, '');
  return cleaned;
}

// Custom hook: exposes a "previewContent" that only updates every N ms while
// `isStreaming` is true. When streaming ends, the final content is flushed
// immediately so the preview matches the complete artifact.
// Simple FNV-1a hash for quick content-equality checks. Much cheaper
// than a full string compare for large artifacts.
function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

function useThrottledContent(content: string, isStreaming: boolean, intervalMs: number): string {
  const [previewContent, setPreviewContent] = useState(content);
  const lastUpdateRef = useRef<number>(0);
  const lastHashRef = useRef<number>(0);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Content-hash gating: skip updates when the content hasn't
    // actually changed (e.g. from redundant store notifications).
    const hash = fnv1aHash(content);
    if (hash === lastHashRef.current && content.length === previewContent.length) return;

    if (!isStreaming) {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
      setPreviewContent(content);
      lastUpdateRef.current = Date.now();
      lastHashRef.current = hash;
      return;
    }

    const now = Date.now();
    const elapsed = now - lastUpdateRef.current;

    if (elapsed >= intervalMs) {
      setPreviewContent(content);
      lastUpdateRef.current = now;
      lastHashRef.current = hash;
      return;
    }

    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = setTimeout(() => {
      setPreviewContent(content);
      lastUpdateRef.current = Date.now();
      lastHashRef.current = fnv1aHash(content);
      pendingTimerRef.current = null;
    }, intervalMs - elapsed);

    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, [content, isStreaming, intervalMs]);

  return previewContent;
}

// ── Error Boundary ──

interface ErrorBoundaryState { hasError: boolean; error: string }

class RendererErrorBoundary extends Component<
  { children: React.ReactNode; content: string; language: string },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: '' };
  static getDerivedStateFromError(err: Error): ErrorBoundaryState {
    return { hasError: true, error: err.message || 'Unknown render error' };
  }
  componentDidCatch(err: Error) { console.warn('[ArtifactRenderer] Render error:', err); }
  componentDidUpdate(prevProps: { content: string }) {
    if (prevProps.content !== this.props.content && this.state.hasError)
      this.setState({ hasError: false, error: '' });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="artifact-render-error">
          <div className="artifact-render-error-banner">
            <AlertTriangle size={16} /><span>Preview failed, showing source code</span>
            <span className="artifact-render-error-detail">{this.state.error}</span>
          </div>
          <CodeFallback content={this.props.content} language={this.props.language} />
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Viewport widths ──

const VIEWPORT_WIDTHS: Record<string, string | null> = {
  full: null,
  desktop: '1280px',
  tablet: '768px',
  mobile: '375px',
};

// ── HTML Renderer ──

const HtmlRenderer: React.FC<RendererProps> = ({ content, viewport = 'full', isStreaming = false, artifactId }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewContent = useThrottledContent(content, isStreaming, STREAMING_PREVIEW_THROTTLE_MS);
  const setRuntimeError = useArtifactStore((s) => s.setRuntimeError);
  const runtimeError = useArtifactStore((s) => s.runtimeErrors[artifactId || ''] ?? null);

  const srcDoc = useMemo(() => {
    const trimmed = previewContent.trim();
    let baseDoc: string;
    if (!trimmed) {
      baseDoc = '<html><body></body></html>';
    } else if (trimmed.toLowerCase().includes('<html') || trimmed.toLowerCase().includes('<!doctype')) {
      baseDoc = trimmed;
    } else {
      baseDoc = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,-apple-system,sans-serif;padding:16px;color:#1a1a1a;background:#fff}</style>
</head><body>${trimmed}</body></html>`;
    }
    // Splice in the iframe error bridge so runtime errors / unhandled
    // rejections / console.errors are surfaced to the parent.
    return injectIntoHtml(baseDoc);
  }, [previewContent]);

  // Bridge runtime errors back into artifactStore so the error banner
  // (and self-heal flow) can react. We attach the listener once per
  // mount; the bridge filters by envelope tag so cross-source noise
  // is ignored.
  useEffect(() => {
    if (!artifactId) return;
    // Clear prior error on iframe rebuild. Delay slightly so we don't
    // flash-clear and immediately re-set from the same underlying bug.
    // Errors that re-fire within 2s of a srcDoc change are treated as
    // persistent (the fix didn't work).
    setRuntimeError(artifactId, null);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingError: Parameters<typeof setRuntimeError>[1] = null;
    const detach = attachErrorListener((e) => {
      pendingError = {
        message: e.message,
        stack: e.stack,
        line: e.line,
        column: e.column,
        source: e.source,
        origin: 'iframe',
        sourceOrigin: e.origin,
        capturedAt: e.capturedAt,
      };
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (pendingError) setRuntimeError(artifactId, pendingError);
      }, 800);
    });
    return () => {
      detach();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [artifactId, srcDoc, setRuntimeError]);

  const vpWidth = VIEWPORT_WIDTHS[viewport];
  const isFramed = !!vpWidth;

  return (
    <div className={`artifact-viewport-frame ${isFramed ? 'artifact-viewport-frame--active' : ''}`} style={{ height: '100%', position: 'relative' }}>
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
        className="artifact-iframe"
        style={isFramed ? { width: vpWidth!, maxWidth: '100%', height: '100%' } : { width: '100%', height: '100%', border: 'none' }}
        title="HTML Preview"
      />
      {runtimeError && (
        <div className="iframe-runtime-error-badge">
          <AlertTriangle size={14} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
          <div className="iframe-runtime-error-content">
            <div className="iframe-runtime-error-title">
              Preview Runtime Error <span style={{ opacity: 0.6 }}>· {runtimeError.sourceOrigin || 'iframe'}</span>
            </div>
            <div className="iframe-runtime-error-msg" title={runtimeError.message}>
              {runtimeError.message}
            </div>
          </div>
          <button 
            type="button"
            className="iframe-runtime-error-close" 
            onClick={() => artifactId && setRuntimeError(artifactId, null)}
            title="Dismiss error"
          >
            <X size={14} />
          </button>
        </div>
      )}
      <style>{`
        .iframe-runtime-error-badge {
          position: absolute;
          bottom: 16px;
          left: 16px;
          right: 16px;
          background: var(--bg-surface);
          border: 1px solid var(--divider);
          border-left: 4px solid #ef4444;
          border-radius: var(--r-md);
          padding: 10px 14px;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          z-index: 50;
          animation: iframeSlideUp 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .iframe-runtime-error-content {
          flex: 1;
          min-width: 0;
        }
        .iframe-runtime-error-title {
          font-size: 0.76rem;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 2px;
        }
        .iframe-runtime-error-msg {
          font-size: 0.7rem;
          color: var(--text-secondary);
          font-family: monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .iframe-runtime-error-close {
          background: none;
          border: none;
          color: var(--text-tertiary);
          cursor: pointer;
          padding: 2px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.12s var(--ease), color 0.12s var(--ease);
        }
        .iframe-runtime-error-close:hover {
          background: var(--bg-surface-hover);
          color: var(--text-primary);
        }
        @keyframes iframeSlideUp {
          from { transform: translateY(10px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

// ── Pan/Zoom Container ──
// Wraps SVG and Mermaid renderers. Supports mouse drag to pan,
// scroll/pinch to zoom, and toolbar buttons.

const PanZoomContainer: React.FC<{ children: React.ReactNode; vectorMode?: boolean }> = ({ children, vectorMode = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const step = 0.05;
    const clamp = (n: number) => Math.max(0.25, Math.min(5, n));
    const quantize = (n: number) => Math.round(n / step) * step;
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((s) => clamp(quantize(s + delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    translateStart.current = { ...translate };
    (e.currentTarget as HTMLDivElement).style.cursor = 'grabbing';
  }, [translate]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setTranslate({ x: translateStart.current.x + dx, y: translateStart.current.y + dy });
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    isDragging.current = false;
    (e.currentTarget as HTMLDivElement).style.cursor = 'grab';
  }, []);

  const handleReset = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  return (
    <div className="artifact-panzoom-wrapper">
      <div className="artifact-panzoom-toolbar">
        <button onClick={() => setScale((s) => Math.min(5, s + 0.25))} title="Zoom in"><ZoomIn size={14} /></button>
        <span className="artifact-panzoom-level">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.max(0.25, s - 0.25))} title="Zoom out"><ZoomOut size={14} /></button>
        <button onClick={handleReset} title="Reset view"><RotateCcw size={14} /></button>
      </div>
      <div
        ref={containerRef}
        className="artifact-panzoom-area"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          ref={innerRef}
          className={`artifact-panzoom-inner ${vectorMode ? 'artifact-panzoom-inner--vector' : ''}`}
          style={{ transform: `translate3d(${translate.x}px, ${translate.y}px, 0) scale3d(${scale}, ${scale}, 1)` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

// ── SVG Renderer ──

const SvgRenderer: React.FC<RendererProps> = ({ content, isStreaming = false, artifactId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const previewContent = useThrottledContent(content, isStreaming, STREAMING_PREVIEW_THROTTLE_MS);
  const setRuntimeError = useArtifactStore((s) => s.setRuntimeError);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    try {
      let svgContent = previewContent.trim();
      if (svgContent.toLowerCase().includes('<html') || svgContent.toLowerCase().includes('<!doctype')) {
        const m = svgContent.match(/<svg[\s\S]*<\/svg>/i);
        if (m) svgContent = m[0];
      }
      if (!svgContent.toLowerCase().includes('<svg')) {
        const errMsg = 'Content does not contain valid SVG markup';
        setRenderError(errMsg);
        el.innerHTML = '';
        if (artifactId) setRuntimeError(artifactId, { message: errMsg, origin: 'svg', capturedAt: Date.now() });
        return;
      }
      el.innerHTML = sanitizeSvg(svgContent);
      setRenderError(null);
      // Clear any prior SVG error on successful render.
      if (artifactId) setRuntimeError(artifactId, null);
      const svgEl = el.querySelector('svg');
      if (svgEl) {
        if (!svgEl.getAttribute('viewBox') && svgEl.getAttribute('width') && svgEl.getAttribute('height')) {
          svgEl.setAttribute('viewBox', `0 0 ${svgEl.getAttribute('width')!.replace('px', '')} ${svgEl.getAttribute('height')!.replace('px', '')}`);
        }
        svgEl.style.width = '100%';
        svgEl.style.height = 'auto';
        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to render SVG';
      setRenderError(errMsg);
      if (containerRef.current) containerRef.current.innerHTML = '';
      if (artifactId) setRuntimeError(artifactId, { message: errMsg, origin: 'svg', capturedAt: Date.now() });
    }
  }, [previewContent, artifactId, setRuntimeError]);

  if (renderError) {
    return (
      <div className="artifact-render-error">
        <div className="artifact-render-error-banner">
          <AlertTriangle size={16} /><span>SVG preview failed, showing source code</span>
          <span className="artifact-render-error-detail">{renderError}</span>
        </div>
        <CodeFallback content={content} language="xml" isStreaming={isStreaming} />
      </div>
    );
  }

  return (
    <PanZoomContainer vectorMode>
      <div ref={containerRef} className="artifact-svg-container" />
    </PanZoomContainer>
  );
};

// ── Mermaid Renderer ──

function cleanupMermaidElements() {
  document.querySelectorAll('[id^="dmermaid-"], [id^="mermaid-"], .mermaid-error').forEach((el) => el.remove());
}

function sanitizeMermaidSyntax(raw: string): string {
  let cleaned = raw.trim();
  // Strip surrounding code fences if present
  cleaned = cleaned.replace(/^```(?:mermaid)?\s*\n?/i, '').replace(/\n?```\s*$/, '');

  // Drop obviously unsupported CSS that previously caused parse errors.
  // Keep standard Mermaid styling (classDef, style, linkStyle, :::).
  cleaned = cleaned
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      const lower = t.toLowerCase();
      if (lower.includes('box-shadow')) return false;
      if (lower.includes('drop-shadow')) return false;
      if (lower.includes('backdrop-filter')) return false;
      return true;
    })
    .join('\n');

  // Fix node labels with parentheses: Node[Label (stuff)] -> Node["Label (stuff)"]
  cleaned = cleaned.replace(/(\w+)\[([^\]"]*\([^)]*\)[^\]"]*)\]/g,
    (_, id, label) => `${id}["${label.replace(/"/g, "'")}"]`);

  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

async function tryRenderMermaid(text: string, id: string): Promise<string> {
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({
    startOnLoad: false, theme: 'neutral', securityLevel: 'strict',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    flowchart: { htmlLabels: true, curve: 'basis' },
    sequence: { useMaxWidth: true },
  });
  const offscreen = document.createElement('div');
  offscreen.style.cssText = 'position:absolute;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden';
  document.body.appendChild(offscreen);
  try {
    const { svg } = await mermaid.render(id, text, offscreen);
    return svg;
  } finally {
    offscreen.remove();
    cleanupMermaidElements();
  }
}

const MermaidRenderer: React.FC<RendererProps> = ({ content, isStreaming = false, artifactId }) => {
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string>('');
  const renderIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setRuntimeError = useArtifactStore((s) => s.setRuntimeError);

  const previewContent = useThrottledContent(content, isStreaming, STREAMING_PREVIEW_THROTTLE_MS);
  const cleanedContent = useMemo(() => sanitizeMermaidSyntax(previewContent), [previewContent]);

  useEffect(() => {
    if (!cleanedContent) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const currentId = ++renderIdRef.current;
      let cancelled = false;
      (async () => {
        try {
          const rendered = await tryRenderMermaid(cleanedContent, `mermaid-${Date.now()}-${currentId}`);
          if (!cancelled && renderIdRef.current === currentId) {
            setSvg(rendered);
            setError(null);
            // Successful render — clear any prior parse error.
            if (artifactId) setRuntimeError(artifactId, null);
          }
        } catch (firstErr) {
          try {
            const lines = cleanedContent.split('\n');
            const header = lines[0];
            const structural = lines.slice(1).filter((l) => {
              const t = l.trim();
              return t && /^[\w\s]/.test(t) && (t.includes('-->') || t.includes('---') || t.includes('==>') || /^\s*\w+[\s[({]/.test(t) || /^\s*subgraph\b/.test(t) || /^\s*end\s*$/.test(t));
            });
            const rendered = await tryRenderMermaid(header + '\n' + structural.join('\n'), `mermaid-r-${Date.now()}-${currentId}`);
            if (!cancelled && renderIdRef.current === currentId) {
              setSvg(rendered);
              setError(null);
              if (artifactId) setRuntimeError(artifactId, null);
            }
          } catch {
            if (!cancelled && renderIdRef.current === currentId) {
              const rawMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
              const cleanedMsg = rawMsg.replace(/\nmermaid version[\s\S]*$/, '').replace(/Parse error on line \d+:[\s\S]*$/, 'Diagram syntax not supported').trim() || 'Invalid diagram syntax';
              setError(cleanedMsg);
              setSvg('');
              // Surface mermaid syntax errors as runtimeError so the
              // self-heal banner can react to them.
              if (artifactId) {
                setRuntimeError(artifactId, {
                  message: cleanedMsg,
                  stack: firstErr instanceof Error ? firstErr.stack : undefined,
                  origin: 'mermaid',
                  capturedAt: Date.now(),
                });
              }
            }
            cleanupMermaidElements();
          }
        }
      })();
      return () => { cancelled = true; };
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); cleanupMermaidElements(); };
  }, [cleanedContent, artifactId, setRuntimeError]);

  useEffect(() => { return () => cleanupMermaidElements(); }, []);

  if (error) {
    return (
      <div className="artifact-render-error">
        <div className="artifact-render-error-banner">
          <AlertTriangle size={16} /><span>Diagram syntax not fully supported, showing source</span>
        </div>
        <CodeFallback content={content} language="mermaid" isStreaming={isStreaming} />
      </div>
    );
  }
  if (!svg) return <div className="artifact-loading"><span className="artifact-loading-spinner" />Rendering diagram...</div>;

  return (
    <PanZoomContainer vectorMode>
      <SafeHtml html={svg} className="artifact-mermaid-container" />
    </PanZoomContainer>
  );
};

// ── SafeHtml ──

const SafeHtml: React.FC<{ html: string; className?: string }> = ({ html, className }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.innerHTML = html; }, [html]);
  return <div ref={ref} className={className} />;
};

// ── Code Fallback ──

const CodeFallback: React.FC<RendererProps & { language?: string }> = ({ content, language, isStreaming }) => {
  const displayContent = useThrottledContent(content, !!isStreaming, STREAMING_PREVIEW_THROTTLE_MS);
  const [html, setHtml] = useState<string>('');
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    highlightCode(displayContent, language || 'text')
      .then((result) => {
        if (!isCancelled) {
          setHtml(result);
          setIsError(false);
        }
      })
      .catch(() => {
        if (!isCancelled) setIsError(true);
      });
    return () => { isCancelled = true; };
  }, [displayContent, language]);
  
  return (
    <div className="artifact-code-fallback" data-lenis-prevent="true">
      {html && !isError ? (
         <div dangerouslySetInnerHTML={{ __html: html }} className="shiki-container" />
      ) : (
         <div className="shiki-container shiki-fallback-text">{displayContent}</div>
      )}
    </div>
  );
};

// ── File Renderer ──
// Renders raw file contents with a download button and uses the artifact title
// (or filename) as the download name.
const FileRenderer: React.FC<RendererProps> = ({ content, title, isStreaming }) => {
  const filename = (title || 'download.txt').trim();

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="artifact-file-preview">
      <div className="artifact-file-header">
        <div className="artifact-file-title">{filename}</div>
        <button className="artifact-file-download" onClick={handleDownload} title="Download file">
          <Download size={14} />
          <span>Download</span>
        </button>
      </div>
      <CodeFallback content={content} language="text" isStreaming={isStreaming} />
    </div>
  );
};


// ── Registry ──

const RENDERERS: Record<string, React.FC<RendererProps>> = {
  html: HtmlRenderer,
  svg: SvgRenderer,
  mermaid: MermaidRenderer,
  file: FileRenderer,
};
const LANGUAGE_MAP: Record<string, string> = { html: 'html', svg: 'xml', mermaid: 'mermaid', file: 'text' };

interface ArtifactRendererProps {
  content: string;
  title?: string;
  type: ArtifactType;
  viewMode: 'preview' | 'code';
  viewport?: PreviewViewport;
  isStreaming?: boolean;
  /** Artifact id used to route runtime errors back into artifactStore. */
  artifactId?: string;
}

const ArtifactRenderer: React.FC<ArtifactRendererProps> = ({ content, title, type, viewMode, viewport, isStreaming, artifactId }) => {
  if (!content || !content.trim())
    return <div className="artifact-loading"><span className="artifact-loading-spinner" />Waiting for content...</div>;

  if (viewMode === 'code')
    return <CodeFallback content={content} language={LANGUAGE_MAP[type] || 'text'} isStreaming={isStreaming} />;


  const Renderer = RENDERERS[type];
  const language = LANGUAGE_MAP[type] || 'text';
  if (Renderer) {
    return (
      <RendererErrorBoundary content={content} language={language}>
        <Renderer content={content} title={title} viewport={viewport} isStreaming={isStreaming} artifactId={artifactId} />
      </RendererErrorBoundary>
    );
  }
  return (
    <div className="artifact-render-error">
      <div className="artifact-render-error-banner"><AlertTriangle size={16} /><span>Unsupported type "{type}"</span></div>
      <CodeFallback content={content} language={language} isStreaming={isStreaming} />
    </div>
  );
};

export default ArtifactRenderer;
