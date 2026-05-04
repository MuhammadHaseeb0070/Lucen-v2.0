// ============================================================
// ArtifactUpdateBinding — chat-input pill for the patching engine
//
// When the user clicks "Update" on an artifact (in the workspace or on
// an inline ArtifactCard), `chatStore.targetArtifactByConv[convId]` is
// set to the artifact's client id. This component renders a small pill
// just above the message input so the user knows their next prompt
// will patch a specific artifact (and gives them an easy way to cancel).
//
// The pill resolves the bound artifact id back to its content via:
//   1. The active artifact in `useArtifactStore` (preferred — it's the
//      hot in-memory copy and includes streaming/version info).
//   2. The most recent artifact in the lineage cache, when available.
//
// If the artifact can't be resolved (e.g. user switched conversations
// while the binding lingered), the pill silently auto-clears the
// binding rather than rendering a broken state.
// ============================================================

import React, { useEffect } from 'react';
import { Edit3, X, AlertTriangle } from 'lucide-react';
import { useArtifactStore } from '../store/artifactStore';
import { useChatStore } from '../store/chatStore';

// Soft-warn at this size; hard-block above HARD_BLOCK_CHARS.
// Token-economy guard: 40k chars ≈ 10k tokens of context.
const SOFT_WARN_CHARS = 40_000;
const HARD_BLOCK_CHARS = 100_000;

const ArtifactUpdateBinding: React.FC = () => {
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const targetArtifactByConv = useChatStore((s) => s.targetArtifactByConv);
  const setTargetArtifact = useChatStore((s) => s.setTargetArtifact);
  const activeArtifact = useArtifactStore((s) => s.activeArtifact);

  const targetId = activeConversationId ? targetArtifactByConv[activeConversationId] : null;

  // Resolve the bound artifact. Today the active artifact is the only
  // artifact we keep hot in memory; if the user closed the workspace,
  // we still know enough to render a pill (id + an "open me to view" CTA).
  // If we can't even find the id in any source, auto-clear.
  const boundArtifact =
    activeArtifact && activeArtifact.id === targetId ? activeArtifact : null;

  // Auto-cleanup: if the binding refers to nothing we can resolve AND
  // the active artifact has changed, drop the binding. Without this,
  // a stale binding can persist after a conversation switch.
  useEffect(() => {
    if (!targetId || !activeConversationId) return;
    if (boundArtifact) return;
    // We have an id but no artifact. Wait one frame then check again —
    // ArtifactStore hydrates async on conversation load.
    const t = window.setTimeout(() => {
      const stillNotFound =
        useArtifactStore.getState().activeArtifact?.id !== targetId;
      if (stillNotFound) {
        setTargetArtifact(activeConversationId, null);
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [targetId, activeConversationId, boundArtifact, setTargetArtifact]);

  if (!targetId || !activeConversationId) return null;

  const handleClear = () => setTargetArtifact(activeConversationId, null);

  // Token-economy warnings (NFR2.2): soft + hard.
  const contentLen = boundArtifact?.content?.length ?? 0;
  const overSoft = contentLen > SOFT_WARN_CHARS;
  const overHard = contentLen > HARD_BLOCK_CHARS;

  return (
    <div className={`artifact-binding-pill ${overHard ? 'artifact-binding-pill--blocked' : overSoft ? 'artifact-binding-pill--warn' : ''}`}>
      <Edit3 size={13} />
      <span className="artifact-binding-pill-label">Updating:</span>
      <span className="artifact-binding-pill-title">
        {boundArtifact?.title || 'Targeted artifact'}
        {typeof boundArtifact?.version === 'number' ? ` · V${boundArtifact.version}` : ''}
      </span>
      {overHard && (
        <span className="artifact-binding-pill-warn-text">
          <AlertTriangle size={12} /> too large to patch — consider rewriting from scratch
        </span>
      )}
      {overSoft && !overHard && (
        <span className="artifact-binding-pill-warn-text">
          <AlertTriangle size={12} /> {Math.round(contentLen / 1000)}k chars — patch will be slow
        </span>
      )}
      <button
        type="button"
        className="artifact-binding-pill-close"
        onClick={handleClear}
        title="Cancel update binding"
        aria-label="Cancel update binding"
      >
        <X size={13} />
      </button>
    </div>
  );
};

export default ArtifactUpdateBinding;
