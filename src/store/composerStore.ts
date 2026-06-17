import { create } from 'zustand';
import type { ResponseMode } from '../services/outputBudget';

interface ComposerStore {
  pendingMainComposerPrefill: string | null;
  setPendingMainComposerPrefill: (value: string) => void;
  consumePendingMainComposerPrefill: () => void;
  /**
   * When set, ChatArea immediately invokes handleSend with the given
   * content — used by the self-heal flow to fire a patch turn without
   * the user typing anything. Cleared by the consumer.
   */
  pendingAutoSend: { content: string; hideUserMessage?: boolean; forceMode?: ResponseMode } | null;
  setPendingAutoSend: (value: { content: string; hideUserMessage?: boolean; forceMode?: ResponseMode }) => void;
  consumePendingAutoSend: () => { content: string; hideUserMessage?: boolean; forceMode?: ResponseMode } | null;
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
