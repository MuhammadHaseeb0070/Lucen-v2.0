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
    setTargetArtifact(activeConversationId, artifact);

    // Build a renderer-specific fix prompt. Each renderer has different
    // constraints the model must understand to avoid producing broken patches.
    const lines: string[] = [];
    const origin = runtimeError.origin;

    if (origin === 'iframe') {
      // HTML artifact running in a sandboxed iframe.
      lines.push('Fix the following runtime error in this HTML artifact.');
      lines.push('');
      lines.push('Environment: sandboxed iframe (allow-scripts allow-same-origin allow-forms allow-popups allow-modals)');
      lines.push('Constraints: No Node.js, no filesystem, no require(), no npm imports, no cross-origin localStorage. CDN script tags are fine.');
      lines.push(`Error message: ${runtimeError.message}`);
      if (runtimeError.line) lines.push(`Line: ${runtimeError.line}${runtimeError.column ? `:${runtimeError.column}` : ''}`);
      if (runtimeError.source && runtimeError.source !== 'about:srcdoc') lines.push(`Source: ${runtimeError.source}`);
      if (runtimeError.stack) {
        lines.push('Stack trace (first 8 lines):');
        lines.push(runtimeError.stack.split('\n').slice(0, 8).join('\n'));
      }
    } else if (origin === 'mermaid') {
      // Mermaid diagram syntax error.
      lines.push('Fix the following Mermaid diagram syntax error.');
      lines.push('');
      lines.push('Mermaid constraints:');
      lines.push('- No box-shadow, drop-shadow, or backdrop-filter in CSS styling');
      lines.push('- Node labels containing parentheses MUST be quoted: Node["Label (stuff)"]');
      lines.push('- Use default theme only; limited custom theming support');
      lines.push(`Parse error: ${runtimeError.message}`);
      if (runtimeError.stack) lines.push(`Detail: ${runtimeError.stack.split('\n')[0]}`);
    } else if (origin === 'svg') {
      // SVG render/parse error.
      lines.push('Fix the following SVG render error in this artifact.');
      lines.push('');
      lines.push('SVG constraints: Only the <svg>...</svg> element is supported. No script tags, no external font loads, no HTML inside SVG.');
      lines.push(`Error: ${runtimeError.message}`);
    } else {
      // Generic fallback for unknown origins.
      lines.push('Fix the following runtime error in this artifact.');
      lines.push('');
      lines.push(`Error origin: ${origin}`);
      lines.push(`Error message: ${runtimeError.message}`);
      if (runtimeError.line) lines.push(`Line: ${runtimeError.line}${runtimeError.column ? `:${runtimeError.column}` : ''}`);
      if (runtimeError.stack) {
        lines.push('Stack:');
        lines.push(runtimeError.stack.split('\n').slice(0, 8).join('\n'));
      }
    }

    lines.push('');
    lines.push('Use a <lucen_patch> with the smallest possible change that resolves this error. Do NOT regenerate the entire artifact.');
    lines.push(`(Self-heal attempt ${next}/${MAX_HEAL_ATTEMPTS})`);

    setPendingAutoSend({ content: lines.join('\n'), hideUserMessage: true });
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
