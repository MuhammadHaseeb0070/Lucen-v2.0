import { create } from 'zustand';

interface ComposerStore {
  pendingMainComposerPrefill: string | null;
  setPendingMainComposerPrefill: (value: string) => void;
  consumePendingMainComposerPrefill: () => void;
}

export const useComposerStore = create<ComposerStore>()((set) => ({
  pendingMainComposerPrefill: null,
  setPendingMainComposerPrefill: (value) => set({ pendingMainComposerPrefill: value }),
  consumePendingMainComposerPrefill: () => set({ pendingMainComposerPrefill: null }),
}));
