import React from 'react';
import { Activity, CheckCircle2, AlertTriangle, Loader2, MinusCircle } from 'lucide-react';
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
      <div className="patch-report-card-notes">
        {(report.notes || []).slice(-3).map((n, i) => (
          <div key={`${i}-${n.slice(0, 20)}`} className="patch-report-card-note">- {n}</div>
        ))}
      </div>
      {report.status === 'success' && report.patchedArtifact?.content && (
        <details className="patch-report-card-artifact" open>
          <summary>
            Full patched artifact: {report.patchedArtifact.title}
            {typeof report.patchedArtifact.version === 'number' ? ` (V${report.patchedArtifact.version})` : ''}
          </summary>
          <pre>{report.patchedArtifact.content}</pre>
        </details>
      )}
    </div>
  );
};

export default PatchTurnReportCard;
