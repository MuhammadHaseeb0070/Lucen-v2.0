import { create } from 'zustand';

interface ComposerStore {
  pendingMainComposerPrefill: string | null;
  setPendingMainComposerPrefill: (value: string) => void;
  consumePendingMainComposerPrefill: () => void;
  /**
   * When set, ChatArea immediately invokes handleSend with the given
   * content — used by the self-heal flow to fire a patch turn without
   * the user typing anything. Cleared by the consumer.
   */
  pendingAutoSend: string | null;
  setPendingAutoSend: (value: string) => void;
  consumePendingAutoSend: () => string | null;
}

export const useComposerStore = create<ComposerStore>()((set, get) => ({
  pendingMainComposerPrefill: null,
  setPendingMainComposerPrefill: (value) => set({ pendingMainComposerPrefill: value }),
  consumePendingMainComposerPrefill: () => set({ pendingMainComposerPrefill: null }),
  pendingAutoSend: null,
  setPendingAutoSend: (value) => set({ pendingAutoSend: value }),
  consumePendingAutoSend: () => {
    const v = get().pendingAutoSend;
    set({ pendingAutoSend: null });
    return v;
  },
}));
