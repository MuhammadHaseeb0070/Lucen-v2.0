// ============================================================
// PatchSummaryCard — chat-side summary for a patch turn
//
// Rendered inline in the assistant message that emitted a <lucen_patch>
// (instead of an ArtifactCard, since a patch turn doesn't introduce a
// new artifact — it modifies an existing one). Clicking the card opens
// the workspace on the artifact at its CURRENT head version.
//
// Lookup order to find the "live" artifact for the click target:
//   1. The active artifact in store (most common — user is patching the
//      one they have open).
//   2. Best-effort: the artifact id parsed from the <lucen_patch
//      artifact_id="..."> attribute, mapped via dbIds.
// If neither resolves, the card still renders but is not clickable.
// ============================================================

import React from 'react';
import { GitBranch, Wand2 } from 'lucide-react';
import { useArtifactStore } from '../store/artifactStore';
import type { ParsedPatch } from '../lib/artifactPatchParser';
import type { Artifact } from '../types';

interface PatchSummaryCardProps {
  patch: ParsedPatch;
  /** When the patch is mid-stream we render a "patching" pulse instead of static counts. */
  isStreaming?: boolean;
}

const PatchSummaryCard: React.FC<PatchSummaryCardProps> = ({ patch, isStreaming }) => {
  const setActiveArtifact = useArtifactStore((s) => s.setActiveArtifact);
  const activeArtifact = useArtifactStore((s) => s.activeArtifact);
  const lineages = useArtifactStore((s) => s.lineages);
  const lineageHit = Object.values(lineages)
    .flat()
    .find((v) => v.dbId === patch.artifactId || v.lineageId === patch.artifactId);
  const resolvedId = patch.artifactId || lineageHit?.dbId || lineageHit?.lineageId;

  const targetArtifact: Artifact | null =
    activeArtifact && (activeArtifact.id === patch.artifactId || activeArtifact.dbId === patch.artifactId)
      ? activeArtifact
      : lineageHit && resolvedId
        ? {
            id: resolvedId,
            type: lineageHit.type,
            title: lineageHit.title,
            content: lineageHit.content,
            messageId: lineageHit.messageId || '',
            dbId: lineageHit.dbId,
            lineageId: lineageHit.lineageId,
            parentId: lineageHit.parentDbId,
            version: lineageHit.versionNo,
            isHead: lineageHit.isHead,
          }
        : null;

  const handleClick = () => {
    if (!targetArtifact) return;
    setActiveArtifact(targetArtifact);
  };

  const blockCount = patch.blocks.length;
  // Prefer the AI-supplied semantic version label over the numeric version.
  // Show "V1 → 2.1" or "V1 → V2" depending on what is available.
  const currentVersionNo = targetArtifact?.version;
  const prevVersionNo = currentVersionNo != null && currentVersionNo > 1 ? currentVersionNo - 1 : null;
  const aiLabel = patch.versionLabel;
  const prevLabel = prevVersionNo != null ? `V${prevVersionNo}` : null;
  const nextLabel = aiLabel ?? (currentVersionNo != null ? `V${currentVersionNo}` : null);
  const versionArrow = prevLabel && nextLabel
    ? `${prevLabel} → ${nextLabel}`
    : nextLabel
      ? `→ ${nextLabel}`
      : '';
  const titleText = targetArtifact?.title || 'Targeted artifact';

  return (
    <div className={`patch-summary-card ${isStreaming ? 'patch-summary-card--streaming' : ''} ${targetArtifact ? '' : 'patch-summary-card--orphan'}`}>
      <div className="patch-summary-card-icon">
        <Wand2 size={16} />
      </div>
      <div className="patch-summary-card-info">
        <span className="patch-summary-card-title">
          {isStreaming ? 'Patching ' : 'Patched '}
          <strong>{titleText}</strong> {versionArrow}
        </span>
        <span className="patch-summary-card-meta">
          <GitBranch size={11} />
          {isStreaming
            ? blockCount > 0
              ? `${blockCount} block${blockCount === 1 ? '' : 's'} so far`
              : 'streaming…'
            : `${blockCount} block${blockCount === 1 ? '' : 's'} applied`}
        </span>
      </div>
      {targetArtifact && (
        <button
          type="button"
          className="patch-summary-card-open"
          onClick={handleClick}
          title="Open artifact"
        >
          Open
        </button>
      )}
    </div>
  );
};

export default PatchSummaryCard;
