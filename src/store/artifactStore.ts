import { create } from 'zustand';
import type { Artifact } from '../types';

export type PreviewViewport = 'full' | 'desktop' | 'tablet' | 'mobile';

interface ArtifactStore {
  activeArtifact: Artifact | null;
  viewMode: 'preview' | 'code';
  panelWidthPercent: number;
  previewViewport: PreviewViewport;

  setActiveArtifact: (artifact: Artifact | null) => void;
  updateArtifactContent: (artifact: Artifact) => void;
  setViewMode: (mode: 'preview' | 'code') => void;
  setPanelWidthPercent: (pct: number) => void;
  setPreviewViewport: (vp: PreviewViewport) => void;
  clearArtifact: () => void;
}

export const useArtifactStore = create<ArtifactStore>()((set, get) => ({
  activeArtifact: null,
  viewMode: 'preview',
  panelWidthPercent: 50,
  previewViewport: 'full',

  setActiveArtifact: (artifact) => set({ activeArtifact: artifact, viewMode: 'preview' }),

  updateArtifactContent: (artifact) => {
    const current = get().activeArtifact;
    if (current && current.id === artifact.id) {
      set({ activeArtifact: artifact });
    } else {
      set({ activeArtifact: artifact });
    }
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setPanelWidthPercent: (pct) => set({ panelWidthPercent: Math.max(25, Math.min(75, pct)) }),
  setPreviewViewport: (vp) => set({ previewViewport: vp }),
  clearArtifact: () => set({ activeArtifact: null, viewMode: 'preview', previewViewport: 'full' }),
}));
