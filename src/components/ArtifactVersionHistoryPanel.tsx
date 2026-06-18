import React, { useEffect, useState } from 'react';
import { Clock, GitBranch, Trash2, RotateCcw, Loader2, X } from 'lucide-react';
import { useArtifactStore } from '../store/artifactStore';
import { useChatStore } from '../store/chatStore';
import { getLineage, revertTo, deleteVersion } from '../services/artifactVersionDb';
import type { Artifact, ArtifactVersion } from '../types';
import './ArtifactVersionHistoryPanel.css';

interface ArtifactVersionHistoryPanelProps {
  artifact: Artifact;
}

const ArtifactVersionHistoryPanel: React.FC<ArtifactVersionHistoryPanelProps> = ({ artifact }) => {
  const lineages = useArtifactStore((s) => s.lineages);
  const setLineage = useArtifactStore((s) => s.setLineage);
  const setCurrentVersion = useArtifactStore((s) => s.setCurrentVersion);
  const currentVersionByLineage = useArtifactStore((s) => s.currentVersionByLineage);
  const patchActiveArtifact = useArtifactStore((s) => s.patchActiveArtifact);
  const historyPanelOpen = useArtifactStore((s) => s.historyPanelOpen);
  const setHistoryPanelOpen = useArtifactStore((s) => s.setHistoryPanelOpen);

  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const conversations = useChatStore((s) => s.conversations);

  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const lineageId = artifact.lineageId || artifact.dbId;
  const chain = lineageId ? lineages[lineageId] || [] : [];
  
  // Get active conversation messages to contextually resolve descriptions
  const activeConv = conversations.find(c => c.id === activeConversationId);
  const messages = activeConv ? activeConv.messages : [];

  // Sort chain descending for the drawer (newest first is best UX in vertical lists)
  const displayChain = [...chain].reverse();

  // Lazy-load lineage if open but not cached
  useEffect(() => {
    if (!historyPanelOpen || !artifact.dbId || !lineageId) return;
    if (lineages[lineageId]) return;

    let cancelled = false;
    (async () => {
      try {
        const versions = await getLineage(lineageId);
        if (cancelled) return;
        if (versions.length > 0) {
          setLineage(lineageId, versions);
          const head = versions.find((v) => v.isHead) || versions[versions.length - 1];
          setCurrentVersion(lineageId, head.versionNo);
        }
      } catch (err) {
        console.error('[HistoryPanel] Lazy-load lineage failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [historyPanelOpen, artifact.dbId, lineageId, lineages, setLineage, setCurrentVersion]);

  if (!historyPanelOpen) return null;

  const viewedVersionNo: number =
    (lineageId ? currentVersionByLineage[lineageId] : undefined) ??
    artifact.version ??
    (chain.find((v) => v.isHead) || chain[chain.length - 1])?.versionNo ??
    1;

  const handlePreview = (version: ArtifactVersion) => {
    if (!lineageId) return;
    setCurrentVersion(lineageId, version.versionNo);
    patchActiveArtifact({
      content: version.content,
      title: version.title,
      version: version.versionNo,
      dbId: version.dbId,
      parentId: version.parentDbId,
      lineageId: version.lineageId,
    });
  };

  const handleRestore = async (e: React.MouseEvent, version: ArtifactVersion) => {
    e.stopPropagation();
    if (!lineageId || revertingId) return;
    setRevertingId(version.dbId);
    try {
      const newHeadId = await revertTo({ lineageId, targetVersionNo: version.versionNo });
      if (newHeadId) {
        const fresh = await getLineage(lineageId);
        if (fresh.length > 0) {
          setLineage(lineageId, fresh);
          const activeVer = fresh.find(v => v.versionNo === version.versionNo) || version;
          setCurrentVersion(lineageId, activeVer.versionNo);
          patchActiveArtifact({
            content: activeVer.content,
            title: activeVer.title,
            version: activeVer.versionNo,
            dbId: activeVer.dbId,
            parentId: activeVer.parentDbId,
            lineageId: activeVer.lineageId,
          });
        }
      }
    } catch (err) {
      console.error('[HistoryPanel] Restore failed:', err);
    } finally {
      setRevertingId(null);
    }
  };

  const handleDelete = async (e: React.MouseEvent, version: ArtifactVersion) => {
    e.stopPropagation();
    if (!lineageId || deletingId) return;
    if (!confirm('Are you sure you want to permanently delete this version? This action cannot be undone.')) {
      return;
    }
    setDeletingId(version.dbId);
    try {
      const success = await deleteVersion(version.dbId);
      if (success) {
        const fresh = await getLineage(lineageId);
        setLineage(lineageId, fresh);

        if (fresh.length === 0) {
          useArtifactStore.getState().clearArtifact();
          setHistoryPanelOpen(false);
          return;
        }

        const nextHead = fresh.find(v => v.isHead) || fresh[fresh.length - 1];
        if (viewedVersionNo === version.versionNo) {
          // If we deleted the currently viewed version, select the new head
          setCurrentVersion(lineageId, nextHead.versionNo);
          patchActiveArtifact({
            content: nextHead.content,
            title: nextHead.title,
            version: nextHead.versionNo,
            dbId: nextHead.dbId,
            parentId: nextHead.parentDbId,
            lineageId: nextHead.lineageId,
          });
        } else {
          // Ensure pointers align
          const currentViewed = fresh.find(v => v.versionNo === viewedVersionNo);
          if (currentViewed) {
            patchActiveArtifact({
              dbId: currentViewed.dbId,
              parentId: currentViewed.parentDbId,
            });
          } else {
            setCurrentVersion(lineageId, nextHead.versionNo);
            patchActiveArtifact({
              content: nextHead.content,
              title: nextHead.title,
              version: nextHead.versionNo,
              dbId: nextHead.dbId,
              parentId: nextHead.parentDbId,
              lineageId: nextHead.lineageId,
            });
          }
        }
      }
    } catch (err) {
      console.error('[HistoryPanel] Delete failed:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const getDescription = (version: ArtifactVersion) => {
    if (version.versionNo === 1) return 'Initial creation';

    if (version.messageId) {
      const idx = messages.findIndex((m) => m.id === version.messageId);
      if (idx > 0) {
        const prevMsg = messages[idx - 1];
        if (prevMsg && prevMsg.role === 'user') {
          return prevMsg.content;
        }
      }
    }

    if (version.title.toLowerCase().includes('heal') || version.content.toLowerCase().includes('heal')) {
      return 'AI Auto-Fix';
    }

    return 'Patch update';
  };

  const getBadgeType = (version: ArtifactVersion, description: string): 'patch' | 'error-fix' | 'regen' => {
    if (version.versionNo === 1) return 'regen';
    const descLower = description.toLowerCase();
    if (descLower.includes('error') || descLower.includes('fix') || descLower.includes('heal') || descLower.includes('bug') || descLower.includes('broken')) {
      return 'error-fix';
    }
    return 'patch';
  };

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + d.toLocaleDateString();
  };

  return (
    <div className="artifact-version-history-panel">
      <div className="history-panel-header">
        <div className="history-panel-title">
          <GitBranch size={16} />
          <h3>Version History</h3>
        </div>
        <button
          className="history-panel-close-btn"
          onClick={() => setHistoryPanelOpen(false)}
          title="Close history"
        >
          <X size={16} />
        </button>
      </div>

      <div className="history-panel-list-container">
        {displayChain.length === 0 ? (
          <div className="history-panel-empty-state">No versions found</div>
        ) : (
          displayChain.map((version) => {
            const desc = getDescription(version);
            const badgeType = getBadgeType(version, desc);
            const isCurrentViewed = version.versionNo === viewedVersionNo;
            const isHead = version.isHead;

            return (
              <div
                key={version.dbId}
                className={`history-item ${isCurrentViewed ? 'history-item--active' : ''} ${isHead ? 'history-item--head' : ''}`}
                onClick={() => handlePreview(version)}
              >
                <div className="history-item-meta">
                  <span className="history-item-version">v{version.versionNo}</span>
                  {isHead && <span className="history-item-head-tag">HEAD</span>}
                  
                  {badgeType === 'patch' && (
                    <span className="history-badge history-badge--patch">patch ✓</span>
                  )}
                  {badgeType === 'error-fix' && (
                    <span className="history-badge history-badge--error-fix">error fix ✓</span>
                  )}
                  {badgeType === 'regen' && (
                    <span className="history-badge history-badge--regen">regen</span>
                  )}

                  <span className="history-item-time">
                    <Clock size={11} />
                    {formatTime(version.createdAt)}
                  </span>
                </div>

                <div className="history-item-desc" title={desc}>
                  {desc}
                </div>

                <div className="history-item-actions">
                  {!isHead && isCurrentViewed && (
                    <button
                      className="history-action-btn history-action-btn--restore"
                      onClick={(e) => handleRestore(e, version)}
                      disabled={revertingId === version.dbId}
                    >
                      {revertingId === version.dbId ? (
                        <>
                          <Loader2 size={12} className="apm-spin" />
                          <span>Restoring…</span>
                        </>
                      ) : (
                        <>
                          <RotateCcw size={12} />
                          <span>Use version</span>
                        </>
                      )}
                    </button>
                  )}
                  <button
                    className="history-action-btn history-action-btn--delete"
                    onClick={(e) => handleDelete(e, version)}
                    disabled={deletingId === version.dbId}
                    title="Delete permanently"
                  >
                    {deletingId === version.dbId ? (
                      <Loader2 size={12} className="apm-spin" />
                    ) : (
                      <Trash2 size={12} />
                    )}
                    <span>Delete permanently</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ArtifactVersionHistoryPanel;
