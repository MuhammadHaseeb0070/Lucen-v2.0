// ============================================================
// ArtifactStatusPipeline — overlay shown over the artifact body
// during a patch turn (FR2 Transparency UI).
// ============================================================

import React from 'react';
import { Loader2, BookOpen, Wrench, ShieldCheck, AlertTriangle } from 'lucide-react';
import type { ArtifactPatchStatus } from '../types';
import './ArtifactStatusPipeline.css';

interface ArtifactStatusPipelineProps {
  status: ArtifactPatchStatus;
  title?: string;
}

const STEPS: { id: ArtifactPatchStatus; label: string; icon: React.ReactNode }[] = [
  { id: 'reading', label: 'Reading', icon: <BookOpen size={13} /> },
  { id: 'planning', label: 'Planning', icon: <BookOpen size={13} /> },
  { id: 'generating', label: 'Generating', icon: <Wrench size={13} /> },
  { id: 'patching', label: 'Applying patches', icon: <Wrench size={13} /> },
  { id: 'verifying', label: 'Verifying', icon: <ShieldCheck size={13} /> },
  { id: 'repairing', label: 'Repairing', icon: <Wrench size={13} /> },
];

const ArtifactStatusPipeline: React.FC<ArtifactStatusPipelineProps> = ({ status, title }) => {
  if (status === 'idle') return null;

  const stepIndex = STEPS.findIndex((s) => s.id === status);
  const isFailed = status === 'failed';
  const isDoneStatus = status === 'complete' || status === 'partial_saved';

  return (
    <div className="patch-pipeline-overlay">
      <div className="patch-pipeline-card">
        <div className="patch-pipeline-header">
          {isFailed || status === 'partial_saved' ? (
            <AlertTriangle size={32} style={{ color: 'var(--danger)' }} />
          ) : isDoneStatus ? (
            <ShieldCheck size={32} style={{ color: 'var(--success)' }} />
          ) : (
            <Loader2 size={32} className="apm-spin" style={{ color: 'var(--accent)' }} />
          )}
          <span className="patch-pipeline-headline">
            {status === 'reading' && (title ? `Reading ${title}…` : 'Reading artifact…')}
            {status === 'patching' && 'Applying patches…'}
            {status === 'planning' && 'Planning artifact…'}
            {status === 'generating' && 'Generating sections…'}
            {status === 'verifying' && 'Verifying…'}
            {status === 'repairing' && 'Repairing…'}
            {status === 'complete' && 'Artifact verified'}
            {status === 'partial_saved' && 'Partial artifact saved'}
            {status === 'failed' && 'Patch failed — retrying…'}
          </span>
        </div>
        
        <div className="patch-pipeline-steps">
          {STEPS.map((step, idx) => {
            const isActive = idx === stepIndex && !isFailed;
            const isDone = !isFailed && idx < stepIndex;
            return (
              <div
                key={step.id}
                className={`patch-pipeline-step ${isActive ? 'patch-pipeline-step--active' : ''} ${isDone ? 'patch-pipeline-step--done' : ''}`}
              >
                <span className="patch-pipeline-step-icon">{step.icon}</span>
                <span className="patch-pipeline-step-label">{step.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ArtifactStatusPipeline;
