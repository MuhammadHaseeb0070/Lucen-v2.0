import React, { useEffect, useState } from 'react';
import { Check, RotateCcw, X, Loader2 } from 'lucide-react';
import { useArtifactStore } from '../store/artifactStore';
import { revertTo, getLineage } from '../services/artifactVersionDb';
import './ArtifactFeedbackToast.css';

const ArtifactFeedbackToast: React.FC = () => {
  const showFeedbackToast = useArtifactStore((s) => s.showFeedbackToast);
  const toastLineageId = useArtifactStore((s) => s.toastLineageId);
  const toastParentVersionNo = useArtifactStore((s) => s.toastParentVersionNo);
  const setShowFeedbackToast = useArtifactStore((s) => s.setShowFeedbackToast);
  const setLineage = useArtifactStore((s) => s.setLineage);
  const setCurrentVersion = useArtifactStore((s) => s.setCurrentVersion);
  const patchActiveArtifact = useArtifactStore((s) => s.patchActiveArtifact);

  const [reverting, setReverting] = useState(false);

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    if (!showFeedbackToast) return;
    const timer = setTimeout(() => {
      setShowFeedbackToast(false);
    }, 8000);
    return () => clearTimeout(timer);
  }, [showFeedbackToast, setShowFeedbackToast]);

  if (!showFeedbackToast || !toastLineageId || toastParentVersionNo === null) return null;

  const handleRevert = async () => {
    setReverting(true);
    try {
      const newHeadId = await revertTo({
        lineageId: toastLineageId,
        targetVersionNo: toastParentVersionNo,
      });

      if (newHeadId) {
        // Fetch fresh lineage to sync cache
        const fresh = await getLineage(toastLineageId);
        if (fresh.length > 0) {
          setLineage(toastLineageId, fresh);
          
          const target = fresh.find((v) => v.versionNo === toastParentVersionNo);
          if (target) {
            setCurrentVersion(toastLineageId, toastParentVersionNo);
            patchActiveArtifact({
              content: target.content,
              title: target.title,
              version: target.versionNo,
              dbId: target.dbId,
              parentId: target.parentDbId,
              lineageId: target.lineageId,
            });
          }
        }
      }
    } catch (err) {
      console.error('[FeedbackToast] Revert failed:', err);
    } finally {
      setReverting(false);
      setShowFeedbackToast(false);
    }
  };

  return (
    <div className="artifact-feedback-toast">
      <span className="toast-header">Did this look right?</span>
      
      <div className="toast-actions">
        <button
          className="toast-btn toast-btn--success"
          onClick={() => setShowFeedbackToast(false)}
          title="Looks good!"
        >
          <Check size={14} />
          <span>Yes</span>
        </button>

        <button
          className="toast-btn toast-btn--revert"
          onClick={handleRevert}
          disabled={reverting}
          title="Revert to previous version"
        >
          {reverting ? (
            <Loader2 size={14} className="apm-spin" />
          ) : (
            <RotateCcw size={14} />
          )}
          <span>Revert</span>
        </button>
      </div>

      <button
        className="toast-dismiss-btn"
        onClick={() => setShowFeedbackToast(false)}
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default ArtifactFeedbackToast;
