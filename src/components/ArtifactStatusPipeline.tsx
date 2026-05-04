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
  { id: 'patching', label: 'Applying patches', icon: <Wrench size={14} /> },
  { id: 'verifying', label: 'Verifying', icon: <ShieldCheck size={14} /> },
];

const ArtifactStatusPipeline: React.FC<ArtifactStatusPipelineProps> = ({ status, title }) => {
  if (status === 'idle') return null;

  // Step ordering for the progress bar.
  const stepIndex = STEPS.findIndex((s) => s.id === status);
  const isFailed = status === 'failed';

  return (
    <div className={`patch-pipeline ${isFailed ? 'patch-pipeline--failed' : ''}`}>
      <div className="patch-pipeline-header">
        {isFailed ? (
          <AlertTriangle size={15} />
        ) : (
          <Loader2 size={15} className="patch-pipeline-spinner" />
        )}
        <span className="patch-pipeline-headline">
          {status === 'reading' && (title ? `Reading ${title}…` : 'Reading artifact…')}
          {status === 'patching' && 'Applying patches…'}
          {status === 'verifying' && 'Verifying…'}
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
  );
};

export default ArtifactStatusPipeline;
