import React, { useState, useCallback, useRef, useEffect } from 'react';
import { X, Copy, Check, Code, Eye, FileCode2, Image, GitBranch, GripVertical, Download, Monitor, Tablet, Smartphone, Maximize2, Globe, Zap, Loader2 } from 'lucide-react';
import ArtifactRenderer from './ArtifactRenderer';
import ArtifactPublishModal from './ArtifactPublishModal';
import { useArtifactStore } from '../store/artifactStore';
import type { PreviewViewport } from '../store/artifactStore';
import type { ArtifactType } from '../types';

const TYPE_META: Record<ArtifactType, { label: string; icon: React.ReactNode }> = {
  html: { label: 'HTML', icon: <FileCode2 size={14} /> },
  svg: { label: 'SVG', icon: <Image size={14} /> },
  mermaid: { label: 'Diagram', icon: <GitBranch size={14} /> },
  file: { label: 'File', icon: <FileCode2 size={14} /> },
};

const VIEWPORT_OPTIONS: { id: PreviewViewport; icon: React.ReactNode; label: string; width: string | null }[] = [
  { id: 'full', icon: <Maximize2 size={13} />, label: 'Full width', width: null },
  { id: 'desktop', icon: <Monitor size={13} />, label: '1280px', width: '1280px' },
  { id: 'tablet', icon: <Tablet size={13} />, label: '768px', width: '768px' },
  { id: 'mobile', icon: <Smartphone size={13} />, label: '375px', width: '375px' },
];

function makeSafeName(title: string): string {
  const base = title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80) || 'artifact';
  return base.replace(/^_+|_+$/g, '');
}

// Minimal Mermaid sanitization for export: mirror the preview sanitizer but
// keep standard Mermaid styling (classDef, style, linkStyle, :::) so
// colored diagrams export correctly.
function sanitizeMermaidForExport(raw: string): string {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:mermaid)?\s*\n?/i, '').replace(/\n?```\s*$/, '');
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
  cleaned = cleaned.replace(/(\w+)\[([^\]"]*\([^)]*\)[^\]"]*)\]/g,
    (_, id, label) => `${id}["${label.replace(/"/g, "'")}"]`);
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

async function getSvgMarkupForExport(content: string, type: ArtifactType): Promise<string | null> {
  if (type === 'svg') {
    const trimmed = content.trim();
    if (trimmed.toLowerCase().includes('<svg')) return trimmed;
    return null;
  }
  if (type === 'mermaid') {
    try {
      const cleaned = sanitizeMermaidForExport(content);
      if (!cleaned) return null;
      const mermaid = (await import('mermaid')).default;
      // Match the live preview configuration so the exported SVG
      // looks exactly like what you see on screen.
      mermaid.initialize({
        startOnLoad: false,
        theme: 'neutral',
        securityLevel: 'loose',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        flowchart: { htmlLabels: true, curve: 'basis' },
        sequence: { useMaxWidth: true },
      });
      const offscreen = document.createElement('div');
      offscreen.style.cssText = 'position:absolute;left:-99999px;top:-99999px;width:2000px';
      document.body.appendChild(offscreen);
      try {
        const { svg } = await mermaid.render(`dl-${Date.now()}`, cleaned, offscreen);
        return svg;
      } finally {
        offscreen.remove();
        document.querySelectorAll('[id^="dmermaid-"], [id^="dl-"]').forEach((el) => el.remove());
      }
    } catch {
      return null;
    }
  }
  return null;
}

async function downloadArtifactSvg(content: string, type: ArtifactType, title: string) {
  const safeName = makeSafeName(title);

  if (type === 'html') {
    triggerDownload(new Blob([content], { type: 'text/html' }), `${safeName}.html`);
    return;
  }

  const svgMarkup = await getSvgMarkupForExport(content, type);
  if (!svgMarkup) {
    // If export rendering fails unexpectedly, fail silently (no text fallback).
    return;
  }

  // Export diagrams as SVG so the downloaded image matches the on-screen
  // preview exactly (including labels and styling).
  triggerDownload(new Blob([svgMarkup], { type: 'image/svg+xml' }), `${safeName}.svg`);
}

function triggerDownload(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

const ArtifactWorkspace: React.FC = () => {
  const {
    activeArtifact, viewMode, setViewMode, clearArtifact,
    panelWidthPercent, setPanelWidthPercent,
    previewViewport, setPreviewViewport,
  } = useArtifactStore();
  const [copied, setCopied] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [isPublishLoading, setIsPublishLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (!activeArtifact) return;
    if (activeArtifact.isStreaming && !prevStreamingRef.current) {
      prevStreamingRef.current = true;
      setViewMode('code');
    } else if (!activeArtifact.isStreaming && prevStreamingRef.current) {
      prevStreamingRef.current = false;
      setViewMode('preview');
    }
  }, [activeArtifact, setViewMode]);

  const handleCopy = useCallback(async () => {
    if (!activeArtifact) return;
    await navigator.clipboard.writeText(activeArtifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [activeArtifact]);

  const handleDownloadSvg = useCallback(() => {
    if (!activeArtifact) return;
    downloadArtifactSvg(activeArtifact.content, activeArtifact.type, activeArtifact.title);
  }, [activeArtifact]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const parentEl = containerRef.current?.parentElement;
    if (!parentEl) return;
    const parentWidth = parentEl.getBoundingClientRect().width;
    const startPct = panelWidthPercent;

    const handleMove = (ev: MouseEvent) => {
      const dx = startX - ev.clientX;
      const deltaPct = (dx / parentWidth) * 100;
      setPanelWidthPercent(startPct + deltaPct);
    };
    const handleUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [panelWidthPercent, setPanelWidthPercent]);

  if (!activeArtifact) return null;

  const meta = TYPE_META[activeArtifact.type] || { label: activeArtifact.type, icon: <Code size={14} /> };
  const showViewportSwitcher = viewMode === 'preview' && activeArtifact.type === 'html';

  return (
    <div
      ref={containerRef}
      className={`artifact-workspace ${isResizing ? 'artifact-workspace--resizing' : ''}`}
      style={{ '--artifact-panel-width': `${panelWidthPercent}%` } as React.CSSProperties}
    >
      <div className="artifact-resize-handle" onMouseDown={handleResizeStart}>
        <GripVertical size={12} />
      </div>

      <div className="artifact-workspace-header">
        <div className="artifact-workspace-title-row">
          <span className="artifact-type-badge">
            {meta.icon}
            {meta.label}
          </span>
          <span className="artifact-workspace-title">{activeArtifact.title}</span>
          {activeArtifact.isStreaming && (
            <span className="artifact-streaming-badge">
              <span className="artifact-streaming-dot" />
              Generating
            </span>
          )}
        </div>
        <div className="artifact-workspace-actions">
          {showViewportSwitcher && (
            <div className="artifact-viewport-switcher">
              {VIEWPORT_OPTIONS.map((vp) => (
                <button
                  key={vp.id}
                  className={`artifact-viewport-btn ${previewViewport === vp.id ? 'artifact-viewport-btn--active' : ''}`}
                  onClick={() => setPreviewViewport(vp.id)}
                  title={`${vp.label}${vp.width ? ` (${vp.width})` : ''}`}
                >
                  {vp.icon}
                </button>
              ))}
            </div>
          )}
          <div className="artifact-view-toggle">
            <button
              className={`artifact-toggle-btn ${viewMode === 'preview' ? 'artifact-toggle-btn--active' : ''}`}
              onClick={() => setViewMode('preview')}
              title="Preview"
            >
              <Eye size={14} />
              <span>Preview</span>
            </button>
            <button
              className={`artifact-toggle-btn ${viewMode === 'code' ? 'artifact-toggle-btn--active' : ''}`}
              onClick={() => setViewMode('code')}
              title="Code"
            >
              <Code size={14} />
              <span>Code</span>
            </button>
          </div>
          <button className="artifact-action-btn" onClick={handleCopy} title="Copy code">
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          {(activeArtifact.type === 'svg' || activeArtifact.type === 'mermaid') && (
            <button className="artifact-action-btn" onClick={handleDownloadSvg} title="Download diagram (SVG)">
              <Download size={15} />
            </button>
          )}
          {/* Publish / Hub button — visible when not streaming */}
          {!activeArtifact.isStreaming && (
            <button
              className={`artifact-action-btn artifact-publish-btn ${activeArtifact.isPublic ? 'artifact-publish-btn--public' : ''}`}
              onClick={handlePublishClick}
              disabled={isPublishLoading}
              title={activeArtifact.isPublic ? 'Manage Hub listing' : 'Publish to Artifact Hub'}
            >
              {isPublishLoading ? <Loader2 size={15} className="apm-spin" /> : activeArtifact.isPublic ? <Globe size={15} /> : <Zap size={15} />}
            </button>
          )}
          <button className="artifact-action-btn artifact-close-btn" onClick={clearArtifact} title="Close workspace">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="artifact-workspace-body">
        <ArtifactRenderer
          content={activeArtifact.content}
          title={activeArtifact.title}
          type={activeArtifact.type}
          viewMode={viewMode}
          viewport={previewViewport}
          isStreaming={!!activeArtifact.isStreaming}
        />
      </div>

      {publishModalOpen && (
        <ArtifactPublishModal
          artifact={activeArtifact}
          onClose={() => setPublishModalOpen(false)}
        />
      )}
    </div>
  );
};

export default ArtifactWorkspace;
