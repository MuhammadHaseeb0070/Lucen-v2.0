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
        background: 'rgba(0, 0, 0, 0.15)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        transition: 'opacity var(--dur) var(--ease)'
      }}
    >
      <div 
        className="patch-pipeline-card"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--divider)',
          borderRadius: 'var(--r-lg)',
          padding: '24px 32px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '20px',
          boxShadow: '0 24px 64px var(--shadow-color)',
          minWidth: '320px',
          fontFamily: 'var(--font-ui)'
        }}
      >
        <div className="patch-pipeline-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: 0 }}>
          {isFailed || status === 'partial_saved' ? (
            <AlertTriangle size={36} style={{ color: 'var(--danger)' }} />
          ) : isDoneStatus ? (
            <ShieldCheck size={36} style={{ color: 'var(--success)' }} />
          ) : (
            <Loader2 size={36} className="apm-spin" style={{ color: 'var(--accent)' }} />
          )}
          <span className="patch-pipeline-headline" style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
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
        <div className="patch-pipeline-steps" style={{ display: 'flex', gap: '10px', padding: '12px 16px', background: 'var(--bg-muted)', borderRadius: 'var(--r-md)', border: '1px solid var(--divider)', width: '100%', justifyContent: 'center' }}>
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
                  borderRadius: 'var(--r-sm)',
                  background: isActive ? 'var(--bg-surface)' : 'transparent',
                  color: isActive ? 'var(--accent)' : isDone ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: '0.8rem',
                  boxShadow: isActive ? '0 2px 8px var(--shadow-color)' : 'none',
                  transition: 'all var(--dur-fast) var(--ease)'
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
