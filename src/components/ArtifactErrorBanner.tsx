// ============================================================
// ArtifactErrorBanner — surfaces iframe / mermaid runtime errors
//
// Sits inside the artifact workspace body. When the iframe error bridge
// (or mermaid renderer) reports a runtime error into
// `artifactStore.runtimeErrors[artifactId]`, we show a banner with the
// error message and a single "Fix automatically?" CTA.
//
// Click handler:
//   1. Bind the current artifact as the patch target.
//   2. Increment heal-attempts counter (cap = MAX_HEAL_ATTEMPTS).
//   3. Set a `pendingAutoSend` payload in composerStore. ChatArea picks
//      this up and calls handleSend with the synthesized prompt — the
//      patch flow proceeds exactly as if the user typed the message.
//
// We never auto-heal silently. The user always has to click. This is
// the conscious design choice from the blueprint (Always-Confirm UX).
// ============================================================

import React from 'react';
import { AlertTriangle, Wand2, X, Lock } from 'lucide-react';
import { useArtifactStore } from '../store/artifactStore';
import { useChatStore } from '../store/chatStore';
import { useComposerStore } from '../store/composerStore';
import type { Artifact } from '../types';

interface ArtifactErrorBannerProps {
  artifact: Artifact;
}

const MAX_HEAL_ATTEMPTS = 3;

const ArtifactErrorBanner: React.FC<ArtifactErrorBannerProps> = ({ artifact }) => {
  const runtimeError = useArtifactStore((s) => s.runtimeErrors[artifact.id] ?? null);
  const setRuntimeError = useArtifactStore((s) => s.setRuntimeError);
  const incHealAttempts = useArtifactStore((s) => s.incHealAttempts);
  const getHealAttempts = useArtifactStore((s) => s.getHealAttempts);
  const setTargetArtifact = useChatStore((s) => s.setTargetArtifact);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const setPendingAutoSend = useComposerStore((s) => s.setPendingAutoSend);

  if (!runtimeError) return null;

  const attempts = getHealAttempts(artifact.id);
  const capped = attempts >= MAX_HEAL_ATTEMPTS;

  const handleDismiss = () => setRuntimeError(artifact.id, null);

  const handleFix = () => {
    if (capped) return;
    if (!activeConversationId) return;

    const next = incHealAttempts(artifact.id);

    // Bind the artifact so the next prompt routes through the patching flow.
    setTargetArtifact(activeConversationId, artifact.id);

    // Compose a precise, structured fix prompt. The patching prompt
    // already tells the model how to format <lucen_patch>; we just feed
    // the error context.
    const lines: string[] = [];
    lines.push('Fix the following runtime error in this artifact.');
    lines.push('');
    lines.push(`Error origin: ${runtimeError.origin}`);
    lines.push(`Error message: ${runtimeError.message}`);
    if (runtimeError.line) lines.push(`Line: ${runtimeError.line}${runtimeError.column ? `:${runtimeError.column}` : ''}`);
    if (runtimeError.source) lines.push(`Source: ${runtimeError.source}`);
    if (runtimeError.stack) {
      lines.push('Stack:');
      lines.push(runtimeError.stack.split('\n').slice(0, 8).join('\n'));
    }
    lines.push('');
    lines.push('Use a <lucen_patch> with the smallest possible change that resolves this error. Do NOT regenerate the entire artifact.');
    lines.push(`(Self-heal attempt ${next}/${MAX_HEAL_ATTEMPTS})`);

    setPendingAutoSend(lines.join('\n'));
  };

  return (
    <div className="artifact-error-banner">
      <div className="artifact-error-banner-icon">
        <AlertTriangle size={16} />
      </div>
      <div className="artifact-error-banner-body">
        <div className="artifact-error-banner-title">
          Bug detected
          <span className="artifact-error-banner-origin">· {runtimeError.origin}</span>
        </div>
        <div className="artifact-error-banner-message">
          {runtimeError.message.length > 280
            ? runtimeError.message.slice(0, 280) + '…'
            : runtimeError.message}
        </div>
        {capped && (
          <div className="artifact-error-banner-cap">
            <Lock size={11} />
            Self-heal cap reached ({MAX_HEAL_ATTEMPTS} attempts). Edit manually or rephrase.
          </div>
        )}
      </div>
      <div className="artifact-error-banner-actions">
        {!capped && (
          <button
            type="button"
            className="artifact-error-banner-btn artifact-error-banner-btn--primary"
            onClick={handleFix}
            title="Submit a patch turn that addresses this error"
          >
            <Wand2 size={13} /> Fix automatically?
          </button>
        )}
        <button
          type="button"
          className="artifact-error-banner-btn"
          onClick={handleDismiss}
          aria-label="Dismiss error"
          title="Dismiss"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
};

export default ArtifactErrorBanner;
