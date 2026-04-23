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

  setActiveArtifact: (artifact: Artifact | null) => void;
  updateArtifactContent: (artifact: Artifact) => void;
  setViewMode: (mode: 'preview' | 'code') => void;
  setPanelWidthPercent: (pct: number) => void;
  setPreviewViewport: (vp: PreviewViewport) => void;
  clearArtifact: () => void;
  resetDismissed: () => void;
  isDismissed: (id: string) => boolean;
}

export const useArtifactStore = create<ArtifactStore>()((set, get) => ({
  activeArtifact: null,
  viewMode: 'preview',
  panelWidthPercent: 50,
  previewViewport: 'full',
  dismissedIds: new Set<string>(),

  setActiveArtifact: (artifact) => {
    if (artifact && get().dismissedIds.has(artifact.id)) return;
    set({ activeArtifact: artifact, viewMode: 'preview' });
  },

  updateArtifactContent: (artifact) => {
    const { dismissedIds, activeArtifact } = get();
    if (dismissedIds.has(artifact.id)) return;
    // Only update if this is the currently open artifact, or if none is open.
    if (activeArtifact && activeArtifact.id !== artifact.id) return;
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
}));
