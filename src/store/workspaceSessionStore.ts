import { create } from 'zustand';
import type {
  ReactProjectTemplate,
  WorkspaceBottomPanel,
  WorkspacePreviewMode,
  WorkspaceRuntimeLog,
  WorkspaceRuntimeStatus,
} from '../types/workspace';

interface WorkspaceSessionStore {
  previewMode: WorkspacePreviewMode;
  bottomPanel: WorkspaceBottomPanel;
  leftSidebarWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
  runtimeStatus: WorkspaceRuntimeStatus;
  runtimeTemplate: ReactProjectTemplate | null;
  runtimeError: string | null;
  runtimeErrorDetails: { title?: string; message: string; path?: string; line?: number; column?: number } | null;
  runtimeLogs: WorkspaceRuntimeLog[];
  lastRuntimeStartAt: number | null;

  setPreviewMode: (mode: WorkspacePreviewMode) => void;
  setBottomPanel: (panel: WorkspaceBottomPanel) => void;
  setLeftSidebarWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setBottomPanelHeight: (height: number) => void;
  setRuntimeStatus: (status: WorkspaceRuntimeStatus) => void;
  setRuntimeTemplate: (template: ReactProjectTemplate | null) => void;
  setRuntimeError: (message: string | null) => void;
  setRuntimeErrorDetails: (details: { title?: string; message: string; path?: string; line?: number; column?: number } | null) => void;
  setRuntimeLogs: (logs: WorkspaceRuntimeLog[]) => void;
  appendRuntimeLog: (log: WorkspaceRuntimeLog) => void;
  clearRuntimeLogs: () => void;
  markRuntimeRestart: () => void;
  resetWorkspaceSession: () => void;
}

export const useWorkspaceSessionStore = create<WorkspaceSessionStore>()((set) => ({
  previewMode: 'preview',
  bottomPanel: 'ai',
  leftSidebarWidth: 260,
  rightPanelWidth: 420,
  bottomPanelHeight: 240,
  runtimeStatus: 'idle',
  runtimeTemplate: null,
  runtimeError: null,
  runtimeErrorDetails: null,
  runtimeLogs: [],
  lastRuntimeStartAt: null,

  setPreviewMode: (mode) => set({ previewMode: mode }),
  setBottomPanel: (panel) => set({ bottomPanel: panel }),
  setLeftSidebarWidth: (width) => set({ leftSidebarWidth: Math.max(220, Math.min(420, width)) }),
  setRightPanelWidth: (width) => set({ rightPanelWidth: Math.max(320, Math.min(620, width)) }),
  setBottomPanelHeight: (height) => set({ bottomPanelHeight: Math.max(180, Math.min(420, height)) }),
  setRuntimeStatus: (status) => set({ runtimeStatus: status }),
  setRuntimeTemplate: (template) => set({ runtimeTemplate: template }),
  setRuntimeError: (message) => set({ runtimeError: message }),
  setRuntimeErrorDetails: (details) => set({ runtimeErrorDetails: details }),
  setRuntimeLogs: (logs) => set({ runtimeLogs: logs }),
  appendRuntimeLog: (log) => set((state) => ({ runtimeLogs: [...state.runtimeLogs, log].slice(-500) })),
  clearRuntimeLogs: () => set({ runtimeLogs: [] }),
  markRuntimeRestart: () => set({ lastRuntimeStartAt: Date.now() }),
  resetWorkspaceSession: () => set({
    previewMode: 'preview',
    bottomPanel: 'ai',
    runtimeStatus: 'idle',
    runtimeTemplate: null,
    runtimeError: null,
    runtimeErrorDetails: null,
    runtimeLogs: [],
    lastRuntimeStartAt: null,
  }),
}));
