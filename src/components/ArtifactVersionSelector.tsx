// ============================================================
// ArtifactVersionSelector — < V2 of 4 > pagination for the lineage
//
// Lazy-loads the lineage chain from artifactVersionDb on mount, then
// renders a compact selector that lets the user jump backward and
// forward between versions. Selecting a non-head version flips the
// lineage's head pointer in DB (revert) so subsequent patches branch
// off the chosen point.
//
// State source of truth:
//   - lineage cache:    useArtifactStore.lineages[lineageId]
//   - which version the UI shows: useArtifactStore.currentVersionByLineage
//   - which version is HEAD in DB: derived as max(versionNo) in the
//     lineage cache (because the cache mirrors the DB ordering).
//
// Note: clicking back to V1 only changes which content the renderer
// displays. The DB head pointer is updated via revertTo only when the
// user explicitly opts in (single button "Make this the current
// version") to avoid surprise mutations from idle browsing.
// ============================================================

import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, GitBranch } from 'lucide-react';
import { useArtifactStore } from '../store/artifactStore';
import { getLineageByArtifactId, revertTo } from '../services/artifactVersionDb';
import type { Artifact } from '../types';

interface ArtifactVersionSelectorProps {
  artifact: Artifact;
}

const ArtifactVersionSelector: React.FC<ArtifactVersionSelectorProps> = ({ artifact }) => {
  const lineages = useArtifactStore((s) => s.lineages);
  const setLineage = useArtifactStore((s) => s.setLineage);
  const setCurrentVersion = useArtifactStore((s) => s.setCurrentVersion);
  const currentVersionByLineage = useArtifactStore((s) => s.currentVersionByLineage);
  const patchActiveArtifact = useArtifactStore((s) => s.patchActiveArtifact);

  const [reverting, setReverting] = useState(false);

  const lineageId = artifact.lineageId || artifact.dbId;
  const chain = lineageId ? lineages[lineageId] || [] : [];
  const headVersionNo = chain.length > 0 ? chain[chain.length - 1].versionNo : (artifact.version ?? 1);
  const viewedVersionNo: number =
    (lineageId ? currentVersionByLineage[lineageId] : undefined) ??
    artifact.version ??
    headVersionNo;

  // Lazy-load: first time we see this artifact, fetch its lineage from
  // DB if we don't already have a cached copy. Any successful patch
  // also primes the cache via appendLineageVersion, so this is mainly
  // for "user opened an artifact from a previous session".
  useEffect(() => {
    let cancelled = false;
    if (!artifact.dbId) return; // nothing to fetch
    if (lineageId && lineages[lineageId]) return; // already cached
    (async () => {
      const versions = await getLineageByArtifactId(artifact.dbId!);
      if (cancelled) return;
      if (versions.length === 0) return;
      const lid = versions[0].lineageId;
      setLineage(lid, versions);
      const head = versions[versions.length - 1];
      setCurrentVersion(lid, head.versionNo);
    })();
    return () => {
      cancelled = true;
    };
  }, [artifact.dbId, lineageId, lineages, setLineage, setCurrentVersion]);

  // No history yet (V1 only with no patches): hide the selector entirely
  // to avoid visual clutter for newly-created artifacts.
  if (chain.length <= 1) return null;

  const goTo = (versionNo: number) => {
    if (!lineageId) return;
    const target = chain.find((v) => v.versionNo === versionNo);
    if (!target) return;
    setCurrentVersion(lineageId, versionNo);
    // Render the chosen version's content. We don't flip is_head in DB
    // here — that's a separate explicit "make current" action.
    patchActiveArtifact({
      content: target.content,
      title: target.title,
      version: target.versionNo,
      dbId: target.dbId,
      parentId: target.parentDbId,
      lineageId: target.lineageId,
    });
  };

  const handlePrev = () => {
    if (viewedVersionNo > 1) goTo(viewedVersionNo - 1);
  };
  const handleNext = () => {
    if (viewedVersionNo < headVersionNo) goTo(viewedVersionNo + 1);
  };

  const handleMakeCurrent = async () => {
    if (!lineageId || viewedVersionNo === headVersionNo) return;
    setReverting(true);
    try {
      const newHeadId = await revertTo({ lineageId, targetVersionNo: viewedVersionNo });
      if (!newHeadId) return;
      // Re-fetch lineage to re-mirror DB (is_head flip changes ordering nothing
      // but keeps cache truthy if DB diverged).
      const fresh = await getLineageByArtifactId(newHeadId);
      if (fresh.length > 0) {
        setLineage(lineageId, fresh);
        // The DB function already collapsed history past target on revert
        // chains? No — we DON'T truncate; we just flip the head pointer.
        // So all V1..Vn rows still exist, but Vn is no longer head.
      }
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className="artifact-version-selector" title={`Version ${viewedVersionNo} of ${headVersionNo}`}>
      <button
        type="button"
        className="artifact-version-btn"
        onClick={handlePrev}
        disabled={viewedVersionNo <= 1}
        aria-label="Previous version"
      >
        <ChevronLeft size={13} />
      </button>
      <span className="artifact-version-label">
        <GitBranch size={11} />
        V{viewedVersionNo} of {headVersionNo}
      </span>
      <button
        type="button"
        className="artifact-version-btn"
        onClick={handleNext}
        disabled={viewedVersionNo >= headVersionNo}
        aria-label="Next version"
      >
        <ChevronRight size={13} />
      </button>
      {viewedVersionNo !== headVersionNo && (
        <button
          type="button"
          className="artifact-version-revert-btn"
          onClick={handleMakeCurrent}
          disabled={reverting}
          title="Make this the current head version"
        >
          <RotateCcw size={11} />
          {reverting ? 'Reverting…' : 'Use this'}
        </button>
      )}
    </div>
  );
};

export default ArtifactVersionSelector;
