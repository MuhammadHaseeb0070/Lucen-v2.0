import { create } from 'zustand';
import type { Artifact } from '../types';

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
}

export const useArtifactStore = create<ArtifactStore>()((set, get) => ({
  activeArtifact: null,
  viewMode: 'preview',
  panelWidthPercent: 50,
  previewViewport: 'full',
  dismissedIds: new Set<string>(),
  dbIds: {},
  artifactHubOpen: false,

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
}));
