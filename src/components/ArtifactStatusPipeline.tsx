// ============================================================
// ArtifactStatusPipeline — overlay shown over the artifact body
// during a patch turn (FR2 Transparency UI).
//
// Drives off `useArtifactStore.patchStatus[artifactId]`. The status is
// set/cleared by the patching engine in ChatArea.finalizePatchTurn:
//
//   reading    -> "Reading <title>..."   (set right after submit)
//   patching   -> "Applying patches..."  (set when the LLM stream starts)
//   verifying  -> "Verifying..."         (set after stream completes,
//                                         before applyPatch / mermaid.parse)
//   failed     -> "Patch failed (will retry)" (transient between retries)
//   idle       -> overlay hidden
//
// Frontend-state-machine driven, NOT model-emitted markers — that's
// more reliable because the model doesn't have to behave to drive the
// pipeline (which itself is what the pipeline is showing the user).
// ============================================================

import React from 'react';
import { Loader2, BookOpen, Wrench, ShieldCheck, AlertTriangle } from 'lucide-react';
import type { ArtifactPatchStatus } from '../types';

interface ArtifactStatusPipelineProps {
  status: ArtifactPatchStatus;
  /** Optional title to personalize the "Reading <title>..." step. */
  title?: string;
}

const STEPS: { id: ArtifactPatchStatus; label: string; icon: React.ReactNode }[] = [
  { id: 'reading', label: 'Reading', icon: <BookOpen size={14} /> },
  { id: 'planning', label: 'Planning', icon: <BookOpen size={14} /> },
  { id: 'generating', label: 'Generating', icon: <Wrench size={14} /> },
  { id: 'patching', label: 'Applying patches', icon: <Wrench size={14} /> },
  { id: 'verifying', label: 'Verifying', icon: <ShieldCheck size={14} /> },
  { id: 'repairing', label: 'Repairing', icon: <Wrench size={14} /> },
];

const ArtifactStatusPipeline: React.FC<ArtifactStatusPipelineProps> = ({ status, title }) => {
  if (status === 'idle') return null;

  // Step ordering for the progress bar.
  const stepIndex = STEPS.findIndex((s) => s.id === status);
  const isFailed = status === 'failed';
  const isDoneStatus = status === 'complete' || status === 'partial_saved';

  return (
    <div 
      className={`patch-pipeline-overlay ${isFailed ? 'patch-pipeline--failed' : ''}`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        transition: 'opacity 0.2s ease'
      }}
    >
      <div 
        className="patch-pipeline-card"
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-light)',
          borderRadius: '12px',
          padding: '24px 32px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)'
        }}
      >
        <div className="patch-pipeline-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', borderBottom: 'none', padding: 0 }}>
          {isFailed || status === 'partial_saved' ? (
            <AlertTriangle size={32} style={{ color: 'var(--error-color)' }} />
          ) : isDoneStatus ? (
            <ShieldCheck size={32} style={{ color: 'var(--success-color)' }} />
          ) : (
            <Loader2 size={32} className="patch-pipeline-spinner" style={{ color: 'var(--accent-color)' }} />
          )}
          <span className="patch-pipeline-headline" style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)' }}>
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
        <div className="patch-pipeline-steps" style={{ display: 'flex', gap: '8px', padding: '12px', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
          {STEPS.map((step, idx) => {
            const isActive = idx === stepIndex && !isFailed;
            const isDone = !isFailed && idx < stepIndex;
            return (
              <div
                key={step.id}
                className={`patch-pipeline-step ${isActive ? 'patch-pipeline-step--active' : ''} ${isDone ? 'patch-pipeline-step--done' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  background: isActive ? 'var(--accent-color-transparent)' : 'transparent',
                  color: isActive ? 'var(--accent-color)' : isDone ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                  fontWeight: isActive ? 500 : 400,
                  fontSize: '13px'
                }}
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
