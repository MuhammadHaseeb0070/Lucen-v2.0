import React from 'react';
import { Activity, CheckCircle2, AlertTriangle, Loader2, MinusCircle, ExternalLink } from 'lucide-react';
import { useArtifactStore } from '../store/artifactStore';
import type { Message } from '../types';

interface Props {
  report: NonNullable<Message['patchReport']>;
}

const PatchTurnReportCard: React.FC<Props> = ({ report }) => {
  const icon =
    report.status === 'success' ? <CheckCircle2 size={14} /> :
    report.status === 'failed' ? <AlertTriangle size={14} /> :
    report.status === 'skipped' ? <MinusCircle size={14} /> :
    <Loader2 size={14} className="patch-report-card-spin" />;

  const title =
    report.status === 'success' ? 'Artifact updated' :
    report.status === 'failed' ? 'Artifact update failed' :
    report.status === 'skipped' ? 'Artifact update skipped' :
    'Updating artifact';

  // Build version label: "V1 → V2" or "V1 → 2.1" if AI supplied a label.
  const prevVersionNo = report.patchedArtifact?.version != null ? report.patchedArtifact.version - 1 : null;
  const nextVersionLabel = report.versionLabel ?? report.patchedArtifact?.versionLabel;
  const prevLabel = prevVersionNo != null && prevVersionNo > 0 ? `V${prevVersionNo}` : null;
  const nextLabel = nextVersionLabel ?? (report.patchedArtifact?.version != null ? `V${report.patchedArtifact.version}` : null);
  const versionArrow = prevLabel && nextLabel ? `${prevLabel} → ${nextLabel}` : nextLabel ?? null;

  const activeArtifact = useArtifactStore((s) => s.activeArtifact);
  const targetIsActive = activeArtifact?.id === report.targetArtifactId ||
    (report.targetArtifactId && activeArtifact?.lineageId && activeArtifact.lineageId === report.targetArtifactId);

  return (
    <div className={`patch-report-card patch-report-card--${report.status}`}>
      <div className="patch-report-card-head">
        <span className="patch-report-card-icon">{icon}</span>
        <span className="patch-report-card-title">{title}</span>
        <span className="patch-report-card-meta">
          <Activity size={11} />
          {report.attempts} attempt{report.attempts === 1 ? '' : 's'} · {report.retries} retr{report.retries === 1 ? 'y' : 'ies'}
        </span>
      </div>

      <div className="patch-report-card-badges">
        {versionArrow && (
          <span className="patch-report-card-version-badge">{versionArrow}</span>
        )}
        {report.status === 'success' && report.appliedBlocks != null && (
          <span className="patch-report-card-blocks-badge">
            {report.appliedBlocks} block{report.appliedBlocks === 1 ? '' : 's'} applied
          </span>
        )}
        {report.patchedArtifact?.title && (
          <span className="patch-report-card-artifact-name">{report.patchedArtifact.title}</span>
        )}
      </div>

      <div className="patch-report-card-notes">
        {(report.notes || []).slice(-3).map((n, i) => (
          <div key={`${i}-${n.slice(0, 20)}`} className="patch-report-card-note">- {n}</div>
        ))}
      </div>

      {report.status === 'success' && targetIsActive && (
        <div className="patch-report-card-open-hint">
          Artifact is open in the workspace above.
        </div>
      )}
      {report.status === 'success' && !targetIsActive && report.targetArtifactId && (
        <button
          className="patch-report-card-open-btn"
          onClick={() => {
            // Re-open the artifact workspace by finding it in the lineage cache.
            const store = useArtifactStore.getState();
            const allVersions = Object.values(store.lineages).flat();
            const match = allVersions.find(
              (v) => v.lineageId === report.targetArtifactId || v.dbId === report.targetArtifactId
            );
            if (match) {
              store.setActiveArtifact({
                id: match.lineageId,
                type: match.type,
                title: match.title,
                content: match.content,
                messageId: match.messageId ?? '',
                dbId: match.dbId,
                lineageId: match.lineageId,
                version: match.versionNo,
                isHead: match.isHead,
              });
            }
          }}
          title="Open artifact in workspace"
          type="button"
        >
          <ExternalLink size={11} />
          Open artifact
        </button>
      )}
    </div>
  );
};

export default PatchTurnReportCard;
