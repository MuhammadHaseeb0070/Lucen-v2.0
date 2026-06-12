import React, { useEffect, useRef, useState, useMemo, useCallback, Component } from 'react';
import { highlightCode } from '../workers/highlighterWorkerClient';
import { AlertTriangle, ZoomIn, ZoomOut, RotateCcw, Download, X, XCircle, Terminal, FileText, CheckCircle2 } from 'lucide-react';
import type { ArtifactType, Artifact } from '../types';
import type { PreviewViewport } from '../store/artifactStore';
import { useArtifactStore } from '../store/artifactStore';
import { useChatStore } from '../store/chatStore';
import { attachErrorListener, injectIntoHtml } from '../lib/iframeErrorBridge';
import DOMPurify from 'dompurify';
import { runPythonDocument, cancelPythonRun, type PythonDocumentResult, type PythonDocumentProgress, type PythonDocumentRunStage } from '../workers/pyodideWorkerClient';

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
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } });
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
  const setViewMode = useArtifactStore((s) => s.setViewMode);

  const hasInteractiveElements = useMemo(() => {
    const lower = previewContent.toLowerCase();
    return (
      lower.includes('<form') ||
      lower.includes('<input') ||
      lower.includes('<textarea') ||
      lower.includes('window.open') ||
      lower.includes('alert(')
    );
  }, [previewContent]);

  const isMalformed = useMemo(() => {
    if (isStreaming) return false;
    const trimmed = previewContent.trim();
    if (!trimmed) return true;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(trimmed, 'text/html');
      if (doc.getElementsByTagName('parsererror').length > 0) return true;
      if (!doc.body) return true;
      const hasText = doc.body.textContent?.trim().length > 0;
      const hasChildren = doc.body.children.length > 0;
      if (!hasText && !hasChildren) return true;
      return false;
    } catch {
      return true;
    }
  }, [previewContent, isStreaming]);

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
    
    // Sanitize the HTML document using DOMPurify before injecting into iframe
    const sanitizedDoc = DOMPurify.sanitize(baseDoc, {
      WHOLE_DOCUMENT: true,
      ADD_TAGS: ['script', 'iframe'],
      ADD_ATTR: ['srcdoc', 'sandbox']
    });

    // Splice in the iframe error bridge so runtime errors / unhandled
    // rejections / console.errors are surfaced to the parent.
    return injectIntoHtml(sanitizedDoc);
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

  if (isMalformed) {
    return (
      <div className="artifact-render-error" style={{ padding: '24px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: 'var(--bg-surface)' }}>
        <div className="artifact-render-error-banner" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', background: 'none', border: 'none', color: 'var(--text-primary)', padding: 0 }}>
          <AlertTriangle size={32} style={{ color: 'var(--warning, #f59e0b)' }} />
          <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '4px 0 0 0' }}>Empty or Malformed HTML Artifact</h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', maxWidth: '320px', margin: '0 0 8px 0', lineHeight: 1.4 }}>
            This artifact cannot be previewed because it does not contain a valid HTML structure or text content.
          </p>
          <button
            type="button"
            className="artifact-file-download"
            onClick={() => setViewMode('code')}
            style={{ fontSize: '0.78rem', padding: '6px 12px' }}
          >
            Code View
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`artifact-viewport-frame ${isFramed ? 'artifact-viewport-frame--active' : ''}`} style={{ height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      {hasInteractiveElements && (
        <div className="sandbox-warning-banner">
          <AlertTriangle size={14} style={{ color: '#b45309', flexShrink: 0, marginTop: '2px' }} />
          <div className="sandbox-warning-content">
            Interactive elements (forms, inputs, alerts, or popups) detected. They may not function fully under the secure sandbox.
          </div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        className="artifact-iframe"
        style={isFramed ? { width: vpWidth!, maxWidth: '100%', flex: 1, minHeight: 0 } : { width: '100%', flex: 1, minHeight: 0, border: 'none' }}
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
        .sandbox-warning-banner {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          background: #fef3c7;
          border-bottom: 1px solid #fde68a;
          color: #92400e;
          padding: 8px 12px;
          font-size: 0.72rem;
          line-height: 1.4;
          z-index: 10;
        }
        .sandbox-warning-content {
          font-weight: 500;
        }
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
  useEffect(() => { if (ref.current) ref.current.innerHTML = DOMPurify.sanitize(html); }, [html]);
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


function parsePythonError(raw: string): { headline: string; detail: string; isTimeout: boolean; isPackage: boolean; isFile: boolean } {
  const isTimeout = /timed out/i.test(raw);
  const isPackage = /ModuleNotFoundError|No module named|ImportError/i.test(raw);
  const isFile = /FileNotFoundError|No such file/i.test(raw);
  const isSyntax = /SyntaxError/i.test(raw);
  const isMemory = /MemoryError|out of memory/i.test(raw);

  let headline = 'Script error';
  if (isTimeout) headline = 'Script timed out';
  else if (isPackage) headline = 'Missing library';
  else if (isFile) headline = 'Input file not found';
  else if (isSyntax) headline = 'Syntax error in generated code';
  else if (isMemory) headline = 'Not enough memory';

  // Extract just the last meaningful line for the detail
  const lines = raw.trim().split('\n').filter(l => l.trim());
  const detail = lines[lines.length - 1] || raw.slice(0, 120);

  return { headline, detail, isTimeout, isPackage, isFile };
}

const pythonCache = new Map<string, PythonDocumentResult>();

export function clearPythonCache(artifactId: string) {
  for (const key of Array.from(pythonCache.keys())) {
    if (key.startsWith(artifactId + '_')) pythonCache.delete(key);
  }
  pythonCache.delete(artifactId);
}

const DocxViewer = ({ file, onDownload }: { file: any, onDownload: () => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const renderDoc = async () => {
      try {
        const docx = await import('docx-preview');
        const binary = atob(file.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        
        if (paperRef.current && !paperRef.current.hasAttribute('data-rendered')) {
          paperRef.current.setAttribute('data-rendered', 'true');
          await docx.renderAsync(bytes, paperRef.current, undefined, { 
            className: 'docx-native-preview', 
            inWrapper: true, 
            ignoreWidth: false, 
            ignoreHeight: false, 
            ignoreFonts: false, 
            breakPages: true 
          });
        }
      } catch (err) {
        console.error("docx-preview error:", err);
      }
    };
    renderDoc();
    
    // Setup Responsive Scale Observer
    const ro = new ResizeObserver((entries) => {
      if (!entries || !entries.length) return;
      const { width } = entries[0].contentRect;
      if (paperRef.current && paperRef.current.firstChild) {
        const wrapper = paperRef.current.firstChild as HTMLElement;
        const targetWidth = 816; // Standard docx-preview paper width
        // Add 64px padding (32px each side)
        const availableWidth = width - 64; 
        if (availableWidth < targetWidth) {
          const scale = availableWidth / targetWidth;
          wrapper.style.transform = `scale(${scale})`;
          wrapper.style.transformOrigin = 'top center';
          // Adjust container height to prevent huge blank space
          const actualHeight = wrapper.getBoundingClientRect().height;
          paperRef.current.style.height = `${actualHeight / scale}px`;
        } else {
          wrapper.style.transform = 'none';
        }
      }
    });
    
    if (containerRef.current) {
      ro.observe(containerRef.current);
    }
    
    return () => { ro.disconnect(); };
  }, [file]);

  return (
    <div style={{ fontFamily: '"Calibri", "Segoe UI", sans-serif', background: '#f3f2f1', border: '1px solid #d4d4d4', display: 'flex', flexDirection: 'column', height: '800px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#2b579a', color: '#fff', padding: '8px 16px', flexShrink: 0, zIndex: 10, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileText size={16} />
          <strong style={{ fontSize: '14px', fontWeight: 600 }}>{file.name}</strong>
          <span style={{ opacity: 0.8, fontSize: '12px' }}>- Word Preview (Style Preserved)</span>
        </div>
        <button onClick={onDownload} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, transition: 'background 0.2s' }}>
          <Download size={14} /> Download
        </button>
      </div>
      <div ref={containerRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', background: '#e1e1e1', padding: '20px 0' }}>
        <div ref={paperRef} style={{ transition: 'transform 0.2s' }} />
      </div>
    </div>
  );
};

const ExcelViewer = ({ file, onDownload }: { file: any, onDownload: () => void }) => {
  const [htmlString, setHtmlString] = useState<string>('<div style="padding: 16px; color: #605e5c;">Parsing workbook...</div>');
  
  useEffect(() => {
    const renderExcel = async () => {
      try {
        const XLSX = await import('xlsx');
        const binary = atob(file.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        
        let workbook;
        if (file.name.endsWith('.csv')) {
          const text = new TextDecoder().decode(bytes);
          workbook = XLSX.read(text, { type: 'string' });
        } else {
          workbook = XLSX.read(bytes, { type: 'array' });
        }

        const worksheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[worksheetName];
        
        if (!worksheet || !worksheet['!ref']) {
          setHtmlString('<div style="padding: 16px; color: #605e5c;">Spreadsheet is empty</div>');
          return;
        }

        const range = XLSX.utils.decode_range(worksheet['!ref']);
        
        let html = '<table style="border-collapse: collapse; min-width: 100%;">';
        
        // Generate Header (A, B, C...)
        html += '<thead><tr><th style="width: 40px; background: #f3f2f1; border: 1px solid #d4d4d4; position: sticky; top: 0; left: 0; z-index: 3;"></th>';
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const letter = XLSX.utils.encode_col(C);
          html += `<th style="min-width: 80px; padding: 2px 6px; background: #f3f2f1; border: 1px solid #d4d4d4; color: #605e5c; font-weight: normal; text-align: center; position: sticky; top: 0; z-index: 2;">${letter}</th>`;
        }
        html += '</tr></thead><tbody>';

        // Limit to 100 rows for preview performance
        const maxRows = Math.min(range.e.r, range.s.r + 99);
        
        for (let R = range.s.r; R <= maxRows; ++R) {
          html += '<tr>';
          // Row Header
          html += `<td style="width: 40px; background: #f3f2f1; border: 1px solid #d4d4d4; color: #605e5c; text-align: center; position: sticky; left: 0; z-index: 1; font-size: 10pt;">${R + 1}</td>`;
          
          for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellAddress = {c: C, r: R};
            const cellRef = XLSX.utils.encode_cell(cellAddress);
            const cell = worksheet[cellRef];
            
            // Check if cell is master or hidden by merge
            let isMergedTarget = false;
            if (worksheet['!merges']) {
               for (const merge of worksheet['!merges']) {
                  if (R >= merge.s.r && R <= merge.e.r && C >= merge.s.c && C <= merge.e.c) {
                     if (R !== merge.s.r || C !== merge.s.c) {
                        isMergedTarget = true;
                     }
                  }
               }
            }
            
            if (isMergedTarget) continue;
            
            let rowspan = 1;
            let colspan = 1;
            if (worksheet['!merges']) {
               for (const merge of worksheet['!merges']) {
                  if (R === merge.s.r && C === merge.s.c) {
                     rowspan = merge.e.r - merge.s.r + 1;
                     colspan = merge.e.c - merge.s.c + 1;
                  }
               }
            }

            let styleStr = 'padding: 2px 6px; border: 1px solid #e1dfdd; color: #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;';
            const val = cell ? (cell.w !== undefined ? cell.w : cell.v) : '';
            html += `<td style="${styleStr}" rowspan="${rowspan}" colspan="${colspan}">${val === undefined || val === null ? '' : val}</td>`;
          }
          html += '</tr>';
        }
        
        html += '</tbody></table>';
        if (range.e.r - range.s.r + 1 > 100) {
           html += `<div style="padding: 8px; text-align: center; font-size: 11px; color: #605e5c; background: #f3f2f1; border-top: 1px solid #d4d4d4;">Showing first 100 rows of ${range.e.r - range.s.r + 1}</div>`;
        }
        
        setHtmlString(`
          <div style="padding: 8px 16px; background: #fff3cd; color: #856404; font-size: 11px; border-bottom: 1px solid #ffeeba;">
            <strong>Read Only Preview:</strong> This preview is not completely accurate and may not reflect advanced formatting, colors, or charts. For best results, download and open in native software.
          </div>
          ${html}
        `);
      } catch (err) {
        console.error("XLSX Parse Error:", err);
        setHtmlString('<div style="padding: 16px; color: #b91c1c;">Failed to parse workbook completely.</div>');
      }
    };
    renderExcel();
  }, [file]);

  return (
    <div style={{ fontFamily: '"Calibri", "Segoe UI", sans-serif', fontSize: '11pt', background: '#fff', border: '1px solid #d4d4d4' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#107c41', color: '#fff', padding: '8px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileText size={16} />
          <strong style={{ fontSize: '14px', fontWeight: 600 }}>{file.name}</strong>
          <span style={{ opacity: 0.8, fontSize: '12px' }}>- Read Only Preview</span>
        </div>
        <button onClick={onDownload} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, transition: 'background 0.2s' }}>
          <Download size={14} /> Download
        </button>
      </div>
      <div style={{ background: '#f3f2f1', borderBottom: '1px solid #d4d4d4', padding: '4px 8px', color: '#605e5c', fontSize: '12px', display: 'flex', alignItems: 'center' }}>
        <i style={{ fontFamily: 'Times New Roman, serif', fontSize: '14px', fontStyle: 'italic', marginRight: '8px', opacity: 0.8 }}>fx</i> 
        <div style={{ background: '#fff', border: '1px solid #c8c6c4', padding: '2px 8px', flex: 1, color: '#a19f9d' }}>Formula bar disabled in preview</div>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: '500px', background: '#fff' }} dangerouslySetInnerHTML={{ __html: htmlString }} />
    </div>
  );
};

const DocumentPreview = ({ file, onDownload }: { file: { name: string; data: string; mimeType: string }, onDownload: () => void }) => {
  if (file.name.endsWith('.csv') || file.name.endsWith('.xlsx')) {
    return <ExcelViewer file={file} onDownload={onDownload} />;
  } else if (file.name.endsWith('.docx')) {
    return <DocxViewer file={file} onDownload={onDownload} />;
  }

  return (
    <div style={{ margin: '16px 0', border: '1px solid var(--bg-inset)', borderRadius: '8px', overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', background: 'var(--bg-muted)', fontSize: '0.75rem', fontWeight: 600, borderBottom: '1px solid var(--bg-inset)', color: 'var(--text-secondary)' }}>Preview: {file.name}</div>
      <div style={{ padding: '16px', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>Preview not available for this file type.</div>
    </div>
  );
};


interface PythonDocumentRendererProps {
  artifact: Artifact;
  onRetry?: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  init: 'Setting up Python environment',
  packages: 'Loading necessary libraries',
  input: 'Loading your input file',
  running: 'Running script',
  ready: 'Ready',
};

const PythonDocumentRenderer: React.FC<PythonDocumentRendererProps> = ({ artifact, onRetry }) => {
  const setRuntimeError = useArtifactStore((s) => s.setRuntimeError);
  const activeArtifactId = useArtifactStore((s) => s.activeArtifact?.id);

  const inputFile = (artifact as any).meta?.inputFile || (artifact as any).filename;
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const messages = useMemo(() => {
    const conv = conversations.find((c) => c.id === activeConversationId);
    return conv?.messages || [];
  }, [conversations, activeConversationId]);

  const matchedAttachment = useMemo(() => {
    if (!inputFile) return null;
    const allAttachments = messages.flatMap((m) => m.attachments || []);
    return allAttachments.find((a) => a.name.toLowerCase() === inputFile.toLowerCase()) || null;
  }, [messages, inputFile]);

  const cacheKey = `${artifact.id}_${artifact.content}`;
  const [result, setResult] = useState<PythonDocumentResult | null>(() => pythonCache.get(cacheKey) || null);
  const [progress, setProgress] = useState<PythonDocumentProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [showRawError, setShowRawError] = useState(false);
  const [fileNotFound, setFileNotFound] = useState(false);
  const [streamData, setStreamData] = useState<{ stdout: string; stderr: string }>({ stdout: '', stderr: '' });
  const [runCounter, setRunCounter] = useState(0);

  const ranRef = useRef<string | null>(pythonCache.has(cacheKey) ? cacheKey : null);
  const isRunningRef = useRef(false);

  useEffect(() => {
    if (activeArtifactId !== artifact.id) return;
    if (ranRef.current === cacheKey || isRunningRef.current) return;

    let isMounted = true;
    const isActive = () => isMounted && useArtifactStore.getState().activeArtifact?.id === artifact.id;

    setFileNotFound(false);
    setShowRawError(false);
    setStreamData({ stdout: '', stderr: '' });

    const run = async () => {
      let inputFiles: Array<{ name: string; data: string }> | undefined;

      if (inputFile) {
        if (!matchedAttachment) {
          if (isActive()) setFileNotFound(true);
          return;
        }
        let fileData = matchedAttachment.rawBase64;
        if (!fileData && matchedAttachment.storagePath) {
          const { supabase } = await import('../lib/supabase');
          if (isActive()) setProgress({ stage: 'input', message: 'Downloading your file...' });
          try {
            const { data, error } = await supabase!.storage
              .from('attachments').download(matchedAttachment.storagePath);
            if (error || !data) throw error || new Error('No data');
            const base64 = await new Promise<string>((res, rej) => {
              const reader = new FileReader();
              reader.onload = () => res((reader.result as string).split(',')[1]);
              reader.onerror = () => rej(new Error('Read failed'));
              reader.readAsDataURL(data);
            });
            matchedAttachment.rawBase64 = base64;
            fileData = base64;
          } catch (err: any) {
            if (isActive()) {
              setResult({ stdout: '', stderr: '', files: [], 
                error: `Could not download your file: ${err.message}` });
              setIsRunning(false);
              isRunningRef.current = false;
            }
            return;
          }
        }
        if (!fileData) {
          if (isActive()) setFileNotFound(true);
          return;
        }
        inputFiles = [{ name: matchedAttachment.name, data: fileData }];
      }

      if (!isActive()) return;
      setIsRunning(true);
      isRunningRef.current = true;
      setResult(null);
      setProgress({ stage: 'init', message: 'Setting up Python environment...' });

      try {
        const res = await runPythonDocument(
          artifact.id,
          artifact.type,
          artifact.content,
          inputFiles,
          (prog) => { if (isActive()) setProgress(prog); },
          (stream, text) => {
            if (isActive()) {
              setStreamData(prev => ({
                ...prev,
                [stream]: prev[stream] + text
              }));
            }
          }
        );

        if (!isActive()) return;
        pythonCache.set(cacheKey, res);
        setResult(res);
        setIsRunning(false);
        isRunningRef.current = false;
        ranRef.current = cacheKey;

        if (res.error) {
          setRuntimeError(artifact.id, {
            message: res.error,
            origin: 'iframe' as any, // Map to iframe to trigger auto-fix banner if needed
            capturedAt: Date.now(),
          });
        } else {
          const cur = useArtifactStore.getState().runtimeErrors[artifact.id];
          if (cur) setRuntimeError(artifact.id, null);
        }
      } catch (err: any) {
        if (!isActive()) return;
        const errRes: PythonDocumentResult = { 
          stdout: '', stderr: '', files: [], 
          error: err.message || String(err) 
        };
        pythonCache.set(cacheKey, errRes);
        setResult(errRes);
        setIsRunning(false);
        isRunningRef.current = false;
        ranRef.current = cacheKey;
        setRuntimeError(artifact.id, {
          message: errRes.error!,
          origin: 'iframe' as any,
          capturedAt: Date.now(),
        });
      }
    };

    run();
    return () => {
      isMounted = false;
      isRunningRef.current = false;
    };
  }, [activeArtifactId, artifact.id, artifact.content, inputFile, matchedAttachment, setRuntimeError, cacheKey, runCounter]);

  // ── File not found state ──
  if (fileNotFound) {
    return (
      <div className="excel-output excel-output--notice" style={{ padding: '20px' }}>
        <div className="excel-notice excel-notice--warn" style={{ display: 'flex', gap: '8px', color: '#b45309' }}>
          <AlertTriangle size={16} />
          <div>
            <strong>Input file not found</strong>
            <p>This script needs <code>{inputFile}</code> but it wasn't found in the conversation. Please upload the file and try again.</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading state ──
  if (isRunning) {
    const stage = progress?.stage || 'init';
    const stages: PythonDocumentRunStage[] = ['init', 'packages', 'input', 'running'];
    const currentIdx = stages.indexOf(stage as PythonDocumentRunStage);
    return (
      <div className="excel-output excel-output--loading" style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
        <button
          onClick={() => {
            cancelPythonRun(artifact.id);
            setIsRunning(false);
            isRunningRef.current = false;
            setResult({ stdout: '', stderr: '', files: [], error: 'Cancelled' });
          }}
          style={{ position: 'absolute', top: '16px', right: '16px', background: '#ef4444', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}
        >
          <X size={14} /> Stop
        </button>
        <div className="excel-loading-icon" style={{ marginBottom: '16px' }}>
          <Terminal size={28} style={{ color: '#22c55e' }} />
        </div>
        <p className="excel-loading-label" style={{ fontWeight: 600, marginBottom: '16px' }}>{progress?.message || 'Starting...'}</p>
        <div className="excel-loading-stages" style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', maxWidth: '300px', marginBottom: '16px' }}>
          {stages.map((s, i) => (
            <div key={s} className={`excel-stage ${i < currentIdx ? 'excel-stage--done' : i === currentIdx ? 'excel-stage--active' : 'excel-stage--waiting'}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: i > currentIdx ? 0.5 : 1 }}>
              <div className="excel-stage-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: i < currentIdx ? '#22c55e' : i === currentIdx ? '#3b82f6' : '#9ca3af' }} />
              <span style={{ fontSize: '0.8rem' }}>{STAGE_LABELS[s]}</span>
            </div>
          ))}
        </div>
        <p className="excel-loading-hint" style={{ fontSize: '0.7rem', color: '#6b7280', marginBottom: '16px' }}>First run loads the Python environment (~5-10s). Subsequent runs are instant.</p>
        
        {(streamData.stdout || streamData.stderr) && (
          <details open style={{ width: '100%', maxWidth: '500px', background: 'var(--bg-surface)', border: '1px solid var(--bg-inset)', borderRadius: '8px', overflow: 'hidden', textAlign: 'left' }}>
            <summary style={{ padding: '8px 12px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-muted)' }}>
              <Terminal size={14} /> Live Output Stream
            </summary>
            <div style={{ padding: '12px', borderTop: '1px solid var(--bg-inset)', maxHeight: '200px', overflowY: 'auto' }}>
              {streamData.stdout && (
                <div style={{ marginBottom: streamData.stderr ? '8px' : '0' }}>
                  <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.7rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{streamData.stdout}</pre>
                </div>
              )}
              {streamData.stderr && (
                <div>
                  <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.7rem', color: '#d97706', whiteSpace: 'pre-wrap' }}>{streamData.stderr}</pre>
                </div>
              )}
            </div>
          </details>
        )}
      </div>
    );
  }

  if (!result) return null;

  // ── Cancelled state ──
  if (result.error === 'Cancelled') {
    return (
      <div className="excel-output excel-output--notice" style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg-base)' }}>
        <XCircle size={32} style={{ color: '#9ca3af', marginBottom: '12px' }} />
        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Execution Cancelled</div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '4px' }}>The Python script was stopped by the user.</p>
        {onRetry && (
          <button className="excel-btn excel-btn--primary" onClick={() => {
            pythonCache.delete(cacheKey);
            ranRef.current = null;
            setRunCounter(c => c + 1);
          }} style={{ marginTop: '16px', background: '#3b82f6', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>
            ↺ Try Again
          </button>
        )}
      </div>
    );
  }

  // ── Error state ──
  if (result.error) {
    const { headline, detail, isTimeout, isPackage, isFile } = parsePythonError(result.error);
    return (
      <div className="excel-output excel-output--error" style={{ padding: '20px' }}>
        <div className="excel-error-header" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <XCircle size={16} style={{ color: '#ef4444', flexShrink: 0 }} />
          <strong>{headline}</strong>
        </div>
        <p className="excel-error-detail" style={{ fontFamily: 'monospace', fontSize: '0.8rem', background: '#f3f4f6', padding: '8px', borderRadius: '4px', marginBottom: '12px' }}>{detail}</p>
        {isPackage && (
          <p className="excel-error-hint" style={{ fontSize: '0.75rem', color: '#4b5563', marginBottom: '12px' }}>A required library wasn't available. Click Regenerate below to try again with a fix.</p>
        )}
        {isFile && (
          <p className="excel-error-hint" style={{ fontSize: '0.75rem', color: '#4b5563', marginBottom: '12px' }}>The script expected <code>{inputFile || 'an input file'}</code>. Make sure it's uploaded in this conversation.</p>
        )}
        {isTimeout && (
          <p className="excel-error-hint" style={{ fontSize: '0.75rem', color: '#4b5563', marginBottom: '12px' }}>The script ran too long. Try asking for a simpler version or with a smaller dataset.</p>
        )}
        <div className="excel-error-actions" style={{ display: 'flex', gap: '12px' }}>
          <button className="excel-btn excel-btn--primary" onClick={() => {
            pythonCache.delete(cacheKey);
            ranRef.current = null;
            setRunCounter(c => c + 1);
          }} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            ↺ Try Again
          </button>
          {onRetry && (
            <button className="excel-btn excel-btn--secondary" onClick={onRetry} style={{ background: '#6b7280', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Terminal size={14} /> Ask AI to Fix
            </button>
          )}
          <button className="excel-btn excel-btn--ghost" onClick={() => setShowRawError(!showRawError)} style={{ background: 'transparent', border: '1px solid #d1d5db', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>
            {showRawError ? 'Hide' : 'Show'} details
          </button>
        </div>
        {showRawError && (
          <pre className="excel-error-raw" style={{ marginTop: '12px', padding: '8px', background: '#1f2937', color: '#f9fafb', fontSize: '0.75rem', overflow: 'auto', maxHeight: '200px' }}>{result.error}</pre>
        )}
      </div>
    );
  }

  const uniqueFiles = [...new Map(result.files.map((f) => [f.name, f])).values()];
  const documentFiles: any[] = []; // Previews disabled; use native download
  const imageFiles = uniqueFiles.filter(f => f.mimeType.startsWith('image/'));
  const otherFiles = uniqueFiles.filter(f => !imageFiles.includes(f));

  const handleDownload = (file: { name: string; data: string; mimeType: string }) => {
    const binary = atob(file.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: file.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  return (
    <div className="doc-output-container" style={{ padding: '24px', background: 'var(--bg-base)', height: '100%', overflowY: 'auto' }}>
      {(result.stdout || result.stderr) && (
        <details style={{ background: 'var(--bg-surface)', border: '1px solid var(--bg-inset)', borderRadius: '8px', marginBottom: '24px', overflow: 'hidden' }}>
          <summary style={{ padding: '12px 16px', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-muted)' }}>
            <Terminal size={14} /> View Execution Logs
          </summary>
          <div style={{ padding: '16px', borderTop: '1px solid var(--bg-inset)' }}>
            {result.stdout && (
              <div style={{ marginBottom: result.stderr ? '12px' : '0' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Output</div>
                <pre style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', background: 'var(--bg-base)', padding: '8px', borderRadius: '4px' }}>{result.stdout}</pre>
              </div>
            )}
            {result.stderr && (
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#d97706', marginBottom: '4px' }}>Warnings</div>
                <pre style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#d97706', whiteSpace: 'pre-wrap', background: '#fffbeb', padding: '8px', borderRadius: '4px' }}>{result.stderr}</pre>
              </div>
            )}
          </div>
        </details>
      )}

      {documentFiles.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginBottom: '24px' }}>
          {documentFiles.map((file) => (
            <React.Fragment key={file.name}>
              <DocumentPreview file={file} onDownload={() => handleDownload(file)} />
            </React.Fragment>
          ))}
        </div>
      )}
      {imageFiles.length > 0 && (
        <div className="excel-images-section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          {imageFiles.map((file) => (
            <div key={file.name} className="excel-image-wrap" style={{ position: 'relative', border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden' }}>
              <img src={`data:${file.mimeType};base64,${file.data}`} alt={file.name} style={{ width: '100%', height: 'auto', display: 'block' }} />
              <button className="excel-image-download" onClick={() => handleDownload(file)} title={`Download ${file.name}`} style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.5)', color: '#fff', border: 'none', borderRadius: '50%', padding: '4px', cursor: 'pointer' }}>
                <Download size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {otherFiles.map((file) => (
        <div key={file.name} className="excel-file-card" style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#f3f4f6', border: '1px solid #e5e7eb', padding: '10px 14px', borderRadius: '6px', marginBottom: '8px' }}>
          <div className="excel-file-card-icon" style={{ color: '#4b5563' }}><FileText size={20} /></div>
          <div className="excel-file-card-info" style={{ flex: 1 }}>
            <div className="excel-file-card-name" style={{ fontSize: '0.85rem', fontWeight: 600 }}>{file.name}</div>
          </div>
          <button className="excel-btn excel-btn--download" onClick={() => handleDownload(file)} style={{ background: '#4b5563', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Download size={13} /> Download
          </button>
        </div>
      ))}
      {uniqueFiles.length === 0 && !result.stdout && (
        <div className="excel-success-empty" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#16a34a' }}>
          <CheckCircle2 size={20} />
          <span>Ran successfully (no output files)</span>
        </div>
      )}
    </div>
  );
};


// ── Registry ──

const RENDERERS: Record<string, React.FC<RendererProps>> = {
  html: HtmlRenderer,
  svg: SvgRenderer,
  mermaid: MermaidRenderer,
  file: FileRenderer,
  excel: PythonDocumentRenderer as any,
  word: PythonDocumentRenderer as any,
  python: FileRenderer,
};
const LANGUAGE_MAP: Record<string, string> = { html: 'html', svg: 'xml', mermaid: 'mermaid', file: 'text', excel: 'python', word: 'python', python: 'python' };

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
  if ((!content || !content.trim()) && isStreaming)
    return <div className="artifact-loading"><span className="artifact-loading-spinner" />Waiting for content...</div>;

  if (viewMode === 'code')
    return <CodeFallback content={content} language={LANGUAGE_MAP[type] || 'text'} isStreaming={isStreaming} />;


  const language = LANGUAGE_MAP[type] || 'text';
  if (type === 'excel' || type === 'word') {
    const activeArtifact = useArtifactStore((s) => s.activeArtifact);
    const activeConversationId = useChatStore((s) => s.activeConversationId);
    const onRetry = () => {
      const error = useArtifactStore.getState().runtimeErrors[artifactId || '']?.message || '';
      if (activeConversationId) {
        useChatStore.getState().setDraft(activeConversationId, `The python script failed with this error: ${error}. Please fix it.`);
      }
    };
    return (
      <RendererErrorBoundary content={content} language={language}>
        <PythonDocumentRenderer artifact={activeArtifact!} onRetry={onRetry} />
      </RendererErrorBoundary>
    );
  }

  const Renderer = RENDERERS[type];
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
