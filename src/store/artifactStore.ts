import { create } from 'zustand';
import type {
  Artifact,
  ArtifactPatchStatus,
  ArtifactRuntimeError,
  ArtifactVersion,
} from '../types';

export type PreviewViewport = 'full' | 'desktop' | 'tablet' | 'mobile';

interface ArtifactStore {
  activeArtifact: Artifact | null;
  viewMode: 'preview' | 'code';
  panelWidthPercent: number;
  previewViewport: PreviewViewport;
  // IDs of artifacts the user explicitly dismissed. Once dismissed, the
  // workspace must NOT reopen for that artifact even as new stream chunks
  // arrive. Non-persisted; cleared on conversation switch.
  dismissedIds: Set<string>;
  // Maps client artifact ID → Supabase DB UUID (populated after async save).
  // Non-persisted — ephmeral per session.
  dbIds: Record<string, string>;
  // Hub panel open state
  artifactHubOpen: boolean;

  // ─── Patching-engine state ──────────────────────────────────────────
  // Cached version chains keyed by lineageId. Lazy-loaded by the version
  // selector via artifactVersionDb.getLineage. Newest version last.
  lineages: Record<string, ArtifactVersion[]>;
  // Which version of a lineage is currently being viewed (for revert UX).
  // Defaults to the head version_no when absent.
  currentVersionByLineage: Record<string, number>;
  // Latest captured runtime error per artifact id. Cleared when a successful
  // patch lands or the user dismisses the banner.
  runtimeErrors: Record<string, ArtifactRuntimeError | null>;
  // Frontend pipeline status per artifact id (drives the status overlay).
  patchStatus: Record<string, ArtifactPatchStatus>;
  // Heal attempts per artifactId per error session. Caps at 3 to prevent
  // infinite confirmed-heal loops. Reset when a successful patch lands or
  // when the runtime error changes substantially.
  healAttempts: Record<string, number>;

  setActiveArtifact: (artifact: Artifact | null) => void;
  updateArtifactContent: (artifact: Artifact) => void;
  setViewMode: (mode: 'preview' | 'code') => void;
  setPanelWidthPercent: (pct: number) => void;
  setPreviewViewport: (vp: PreviewViewport) => void;
  clearArtifact: () => void;
  resetDismissed: () => void;
  isDismissed: (id: string) => boolean;
  // Set DB ID once the async save completes
  setDbId: (clientId: string, dbId: string) => void;
  getDbId: (clientId: string) => string | undefined;
  // Propagate dbId / isPublic / slug back into the active artifact
  patchActiveArtifact: (patch: Partial<Artifact>) => void;
  // Hub
  setArtifactHubOpen: (open: boolean) => void;

  // ─── Patching-engine actions ────────────────────────────────────────
  setLineage: (lineageId: string, versions: ArtifactVersion[]) => void;
  appendLineageVersion: (lineageId: string, version: ArtifactVersion) => void;
  getLineageHistory: (lineageId: string | undefined) => ArtifactVersion[];
  getLineageHead: (lineageId: string | undefined) => ArtifactVersion | undefined;
  setCurrentVersion: (lineageId: string, versionNo: number) => void;
  getCurrentVersion: (lineageId: string | undefined) => number | undefined;
  setRuntimeError: (artifactId: string, error: ArtifactRuntimeError | null) => void;
  getRuntimeError: (artifactId: string | undefined) => ArtifactRuntimeError | null;
  setPatchStatus: (artifactId: string, status: ArtifactPatchStatus) => void;
  getPatchStatus: (artifactId: string | undefined) => ArtifactPatchStatus;
  incHealAttempts: (artifactId: string) => number;
  resetHealAttempts: (artifactId: string) => void;
  getHealAttempts: (artifactId: string | undefined) => number;
}

export const useArtifactStore = create<ArtifactStore>()((set, get) => ({
  activeArtifact: null,
  viewMode: 'preview',
  panelWidthPercent: 50,
  previewViewport: 'full',
  dismissedIds: new Set<string>(),
  dbIds: {},
  artifactHubOpen: false,
  lineages: {},
  currentVersionByLineage: {},
  runtimeErrors: {},
  patchStatus: {},
  healAttempts: {},

  setActiveArtifact: (artifact) => {
    if (!artifact) {
      set({ activeArtifact: null });
      return;
    }
    // Explicit intent (user clicked the artifact card or programmatic first
    // open). Clear any prior dismissal for this id so streaming updates can
    // flow again and the workspace actually opens.
    const nextDismissed = new Set(get().dismissedIds);
    nextDismissed.delete(artifact.id);
    // Rehydrate dbId / isPublic / slug from our dbIds map if available
    const dbId = get().dbIds[artifact.id];
    set({
      activeArtifact: dbId ? { ...artifact, dbId } : artifact,
      viewMode: 'preview',
      dismissedIds: nextDismissed,
    });
  },

  updateArtifactContent: (artifact) => {
    const { dismissedIds, activeArtifact } = get();
    // Auto-streaming updates never reopen a dismissed artifact — that's the
    // whole point of the dismissal memory. Only explicit setActiveArtifact
    // can clear it.
    if (dismissedIds.has(artifact.id)) return;
    // Only update if this is the currently open artifact.
    if (!activeArtifact || activeArtifact.id !== artifact.id) return;
    set({ activeArtifact: artifact });
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setPanelWidthPercent: (pct) => set({ panelWidthPercent: Math.max(25, Math.min(75, pct)) }),
  setPreviewViewport: (vp) => set({ previewViewport: vp }),

  clearArtifact: () => {
    const current = get().activeArtifact;
    const nextDismissed = new Set(get().dismissedIds);
    if (current) nextDismissed.add(current.id);
    set({
      activeArtifact: null,
      viewMode: 'preview',
      previewViewport: 'full',
      dismissedIds: nextDismissed,
    });
  },

  resetDismissed: () => set({ dismissedIds: new Set<string>() }),
  isDismissed: (id) => get().dismissedIds.has(id),

  setDbId: (clientId, dbId) => {
    set((state) => ({ dbIds: { ...state.dbIds, [clientId]: dbId } }));
    // Also patch the active artifact if it's the one we just saved
    const active = get().activeArtifact;
    if (active && active.id === clientId) {
      set({ activeArtifact: { ...active, dbId } });
    }
  },

  getDbId: (clientId) => get().dbIds[clientId],

  patchActiveArtifact: (patch) => {
    const active = get().activeArtifact;
    if (!active) return;
    set({ activeArtifact: { ...active, ...patch } });
  },

  setArtifactHubOpen: (open) => set({ artifactHubOpen: open }),

  // ─── Patching-engine actions ────────────────────────────────────────
  setLineage: (lineageId, versions) => {
    // Sort defensively so callers can pass in any order; selectors expect
    // ascending version_no.
    const sorted = [...versions].sort((a, b) => a.versionNo - b.versionNo);
    set((state) => ({
      lineages: { ...state.lineages, [lineageId]: sorted },
    }));
  },

  appendLineageVersion: (lineageId, version) => {
    set((state) => {
      const existing = state.lineages[lineageId] || [];
      // Avoid duplicates if the same version is appended twice (e.g. eager
      // optimistic write + later refetch).
      const filtered = existing.filter((v) => v.versionNo !== version.versionNo);
      const next = [...filtered, version].sort((a, b) => a.versionNo - b.versionNo);
      return {
        lineages: { ...state.lineages, [lineageId]: next },
        currentVersionByLineage: {
          ...state.currentVersionByLineage,
          [lineageId]: version.versionNo,
        },
      };
    });
  },

  getLineageHistory: (lineageId) => {
    if (!lineageId) return [];
    return get().lineages[lineageId] || [];
  },

  getLineageHead: (lineageId) => {
    if (!lineageId) return undefined;
    const chain = get().lineages[lineageId];
    if (!chain || chain.length === 0) return undefined;
    return chain[chain.length - 1];
  },

  setCurrentVersion: (lineageId, versionNo) => {
    set((state) => ({
      currentVersionByLineage: {
        ...state.currentVersionByLineage,
        [lineageId]: versionNo,
      },
    }));
  },

  getCurrentVersion: (lineageId) => {
    if (!lineageId) return undefined;
    return get().currentVersionByLineage[lineageId];
  },

  setRuntimeError: (artifactId, error) => {
    set((state) => {
      const next = { ...state.runtimeErrors };
      if (error) next[artifactId] = error;
      else delete next[artifactId];
      return { runtimeErrors: next };
    });
  },

  getRuntimeError: (artifactId) => {
    if (!artifactId) return null;
    return get().runtimeErrors[artifactId] ?? null;
  },

  setPatchStatus: (artifactId, status) => {
    set((state) => {
      const next = { ...state.patchStatus };
      if (status === 'idle') delete next[artifactId];
      else next[artifactId] = status;
      return { patchStatus: next };
    });
  },

  getPatchStatus: (artifactId) => {
    if (!artifactId) return 'idle';
    return get().patchStatus[artifactId] ?? 'idle';
  },

  incHealAttempts: (artifactId) => {
    const current = get().healAttempts[artifactId] ?? 0;
    const next = current + 1;
    set((state) => ({
      healAttempts: { ...state.healAttempts, [artifactId]: next },
    }));
    return next;
  },

  resetHealAttempts: (artifactId) => {
    set((state) => {
      const next = { ...state.healAttempts };
      delete next[artifactId];
      return { healAttempts: next };
    });
  },

  getHealAttempts: (artifactId) => {
    if (!artifactId) return 0;
    return get().healAttempts[artifactId] ?? 0;
  },
}));
