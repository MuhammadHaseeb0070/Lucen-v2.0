import { create } from 'zustand';
import type { WorkspaceDiagnostic } from '../types/workspace';

interface DiagnosticsStore {
  diagnostics: WorkspaceDiagnostic[];
  setDiagnostics: (diagnostics: WorkspaceDiagnostic[]) => void;
  addDiagnostic: (diagnostic: WorkspaceDiagnostic) => void;
  clearDiagnostics: () => void;
}

export const useDiagnosticsStore = create<DiagnosticsStore>()((set) => ({
  diagnostics: [],
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  addDiagnostic: (diagnostic) => set((state) => ({ diagnostics: [diagnostic, ...state.diagnostics] })),
  clearDiagnostics: () => set({ diagnostics: [] }),
}));
