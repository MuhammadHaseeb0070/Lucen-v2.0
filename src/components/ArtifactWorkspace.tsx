import React, { useState, useCallback, useRef, useEffect } from 'react';
import { X, Copy, Check, Code, Eye, FileCode2, Image, GitBranch, GripVertical, Download, Monitor, Tablet, Smartphone, Maximize2, Globe, Zap, Loader2, GitCompare } from 'lucide-react';
import ArtifactRenderer from './ArtifactRenderer';
import ArtifactPublishModal from './ArtifactPublishModal';
import ArtifactPatchInput from './ArtifactPatchInput';
import ArtifactVersionSelector from './ArtifactVersionSelector';
import ArtifactStatusPipeline from './ArtifactStatusPipeline';
import { useArtifactStore } from '../store/artifactStore';
import type { PreviewViewport } from '../store/artifactStore';
import type { ArtifactType } from '../types';

const TYPE_META: Record<ArtifactType, { label: string; icon: React.ReactNode }> = {
  html: { label: 'HTML', icon: <FileCode2 size={14} /> },
  svg: { label: 'SVG', icon: <Image size={14} /> },
  mermaid: { label: 'Diagram', icon: <GitBranch size={14} /> },
  file: { label: 'File', icon: <FileCode2 size={14} /> },
  excel: { label: 'Excel', icon: <FileCode2 size={14} /> },
  word: { label: 'Word', icon: <FileCode2 size={14} /> },
  pdf: { label: 'PDF', icon: <FileCode2 size={14} /> },
};

const VIEWPORT_OPTIONS: { id: PreviewViewport; icon: React.ReactNode; label: string; width: string | null }[] = [
  { id: 'full', icon: <Maximize2 size={13} />, label: 'Full width', width: null },
  { id: 'desktop', icon: <Monitor size={13} />, label: '1280px', width: '1280px' },
  { id: 'tablet', icon: <Tablet size={13} />, label: '768px', width: '768px' },
  { id: 'mobile', icon: <Smartphone size={13} />, label: '375px', width: '375px' },
];

const DOWNLOAD_EXTENSION_MAP: Record<string, string> = {
  file: 'txt',
  excel: 'py',
  word: 'py',
  pdf: 'py',
};

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
        securityLevel: 'strict',
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
  const activeArtifact = useArtifactStore((s) => s.activeArtifact);
  const viewMode = useArtifactStore((s) => s.viewMode);
  const setViewMode = useArtifactStore((s) => s.setViewMode);
  const clearArtifact = useArtifactStore((s) => s.clearArtifact);
  const panelWidthPercent = useArtifactStore((s) => s.panelWidthPercent);
  const setPanelWidthPercent = useArtifactStore((s) => s.setPanelWidthPercent);
  const previewViewport = useArtifactStore((s) => s.previewViewport);
  const setPreviewViewport = useArtifactStore((s) => s.setPreviewViewport);
  const patchStatus = useArtifactStore((s) => s.patchStatus);
  const [copied, setCopied] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [isPublishLoading, setIsPublishLoading] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lineages = useArtifactStore((s) => s.lineages);

  const previousArtifact = React.useMemo(() => {
    if (!activeArtifact) return null;
    const lineageId = activeArtifact.lineageId || activeArtifact.dbId;
    if (!lineageId) return null;
    const chain = lineages[lineageId];
    if (!chain || chain.length <= 1) return null;
    const currentVer = activeArtifact.version || chain[chain.length - 1].versionNo;
    return chain.find(v => v.versionNo === currentVer - 1) || null;
  }, [activeArtifact, lineages]);

  useEffect(() => {
    if (!previousArtifact && showDiff) setShowDiff(false);
  }, [previousArtifact, showDiff]);


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

  const handleDownload = useCallback((ext: string) => {
    if (!activeArtifact) return;
    let content = activeArtifact.content;
    let mime = 'text/plain';
    
    if (ext === 'svg' && (activeArtifact.type === 'mermaid' || activeArtifact.type === 'svg')) {
      downloadArtifactSvg(content, activeArtifact.type, activeArtifact.title);
      setDownloadOpen(false);
      return;
    }
    
    if (ext === 'html') mime = 'text/html';
    else if (ext === 'md') mime = 'text/markdown';
    else if (ext === 'js') mime = 'text/javascript';
    
    const blob = new Blob([content], { type: mime });
    triggerDownload(blob, `${activeArtifact.title || 'artifact'}.${ext}`);
    setDownloadOpen(false);
  }, [activeArtifact]);

  const handlePublishClick = async () => {
    if (!activeArtifact) return;
    if (activeArtifact.dbId) {
      setPublishModalOpen(true);
      return;
    }
    
    // Save to DB on the fly if it hasn't been saved yet
    setIsPublishLoading(true);
    try {
      const { saveArtifact } = await import('../services/artifactDb');
      const { useChatStore } = await import('../store/chatStore');
      const convId = useChatStore.getState().activeConversationId;
      
      const dbId = await saveArtifact({
        clientId: activeArtifact.id,
        conversationId: convId,
        messageId: activeArtifact.messageId,
        type: activeArtifact.type,
        title: activeArtifact.title,
        content: activeArtifact.content
      });
      
      if (dbId) {
        useArtifactStore.getState().setDbId(activeArtifact.id, dbId);
        setPublishModalOpen(true);
      } else {
        alert('Failed to prepare artifact for publishing. Please ensure you are logged in.');
      }
    } catch (e) {
      console.error('Error saving artifact for publish:', e);
      alert('Failed to prepare artifact for publishing.');
    } finally {
      setIsPublishLoading(false);
    }
  };

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
          {!activeArtifact.isStreaming && <ArtifactVersionSelector artifact={activeArtifact} />}
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
            {previousArtifact && (
              <button
                className={`artifact-toggle-btn ${showDiff ? 'artifact-toggle-btn--active' : ''}`}
                onClick={() => setShowDiff(!showDiff)}
                title="Compare with previous version"
              >
                <GitCompare size={14} />
                <span>Compare</span>
              </button>
            )}
            <button
              className={`artifact-toggle-btn ${viewMode === 'preview' ? 'artifact-toggle-btn--active' : ''}`}
              onClick={() => { setViewMode('preview'); setShowDiff(false); }}
              disabled={!!activeArtifact.isStreaming}
              title={activeArtifact.isStreaming ? 'Preview available after generation completes' : 'Preview'}
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
          <div style={{ position: 'relative' }}>
            {!(viewMode === 'preview' && (activeArtifact.type === 'excel' || activeArtifact.type === 'word' || activeArtifact.type === 'pdf')) && (
              <>
                <button className="artifact-action-btn" onClick={() => setDownloadOpen(!downloadOpen)} title="Download artifact">
                  <Download size={15} />
                </button>
                {downloadOpen && (
                  <div className="hub-sort-dropdown" style={{ right: 0, top: '100%', marginTop: '4px', padding: '4px' }}>
                    <button className="hub-sort-option" onClick={() => handleDownload(DOWNLOAD_EXTENSION_MAP[activeArtifact.type] || activeArtifact.type)}>
                      Download .{DOWNLOAD_EXTENSION_MAP[activeArtifact.type] || activeArtifact.type}
                    </button>
                    <button className="hub-sort-option" onClick={() => handleDownload('txt')}>
                      Download .txt
                    </button>
                    {activeArtifact.type === 'mermaid' && (
                      <button className="hub-sort-option" onClick={() => handleDownload('svg')}>
                        Download as .svg
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          {/* Publish / Hub button — visible when not streaming and not a raw import */}
          {!activeArtifact.isStreaming && !activeArtifact.isImported && (
            <button
              className={`artifact-action-btn artifact-publish-btn ${activeArtifact.isPublic ? 'artifact-publish-btn--public' : ''}`}
              onClick={handlePublishClick}
              disabled={isPublishLoading}
              title={activeArtifact.isPublic ? 'Manage Hub listing' : 'Publish to Artifact Hub'}
            >
              {isPublishLoading ? <Loader2 size={15} className="apm-spin" /> : activeArtifact.isPublic ? <Globe size={15} /> : <Zap size={15} />}
            </button>
          )}
          {!activeArtifact.isStreaming && activeArtifact.isImported && (
            <button
              className="artifact-action-btn artifact-publish-btn"
              style={{ opacity: 0.5, cursor: 'not-allowed' }}
              title="Imported artifacts cannot be published directly. Ask the AI to modify it first."
            >
              <Zap size={15} />
            </button>
          )}
          <button className="artifact-action-btn artifact-close-btn" onClick={clearArtifact} title="Close workspace">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="artifact-workspace-body" style={{ position: 'relative', display: 'flex', flex: 1, overflow: 'hidden' }}>
        {activeArtifact.id && patchStatus[activeArtifact.id] && patchStatus[activeArtifact.id] !== 'idle' && (
          <ArtifactStatusPipeline
            status={patchStatus[activeArtifact.id]}
            title={activeArtifact.title}
          />
        )}
        
        {showDiff && previousArtifact ? (
          <div className="artifact-diff-container" style={{ display: 'flex', width: '100%', height: '100%' }}>
            <div className="artifact-diff-pane" style={{ flex: 1, borderRight: '2px solid var(--divider)', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
              <div style={{ position: 'sticky', top: 0, zIndex: 10, padding: '8px 16px', background: 'var(--bg-surface-hover)', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '1px solid var(--divider)', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-ui)', backdropFilter: 'blur(4px)' }}>
                <span>V{previousArtifact.versionNo} (Previous)</span>
                <span style={{ color: 'var(--danger)' }}>Red indicates removed</span>
              </div>
              <div style={{ flex: 1, position: 'relative' }}>
                <ArtifactRenderer
                  key={`prev-${previousArtifact.versionNo}`}
                  content={previousArtifact.content}
                  title={previousArtifact.title}
                  type={activeArtifact.type}
                  viewMode={viewMode}
                  viewport={previewViewport}
                  isStreaming={false}
                  artifactId={activeArtifact.id}
                />
              </div>
            </div>
            <div className="artifact-diff-pane" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
              <div style={{ position: 'sticky', top: 0, zIndex: 10, padding: '8px 16px', background: 'var(--bg-surface-hover)', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '1px solid var(--divider)', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-ui)', backdropFilter: 'blur(4px)' }}>
                <span>V{activeArtifact.version || 'Current'} (Updated)</span>
                <span style={{ color: 'var(--success)' }}>Green indicates added</span>
              </div>
              <div style={{ flex: 1, position: 'relative' }}>
                <ArtifactRenderer
                  key={`${activeArtifact.id}-${viewMode}`}
                  content={activeArtifact.content}
                  title={activeArtifact.title}
                  type={activeArtifact.type}
                  viewMode={viewMode}
                  viewport={previewViewport}
                  isStreaming={!!activeArtifact.isStreaming}
                  artifactId={activeArtifact.id}
                />
              </div>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%' }}>
            <ArtifactRenderer
              key={`${activeArtifact.id}`}
              content={activeArtifact.content}
              title={activeArtifact.title}
              type={activeArtifact.type}
              viewMode={viewMode}
              viewport={previewViewport}
              isStreaming={!!activeArtifact.isStreaming}
              artifactId={activeArtifact.id}
            />
          </div>
        )}
        
        {!activeArtifact.isStreaming && (
          <ArtifactPatchInput artifactId={activeArtifact.id} />
        )}
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
