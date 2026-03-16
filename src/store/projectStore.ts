import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
  OpenEditorTab,
  ProjectFile,
  ReactProject,
  WorkspaceAiMessage,
  WorkspacePatch,
  WorkspacePatchOperation,
  WorkspaceSnapshot,
} from '../types/workspace';

interface ProjectStore {
  activeProject: ReactProject | null;
  openTabs: OpenEditorTab[];
  activeFilePath: string | null;
  selectedPaths: string[];
  aiMessages: WorkspaceAiMessage[];
  pendingPatch: WorkspacePatch | null;
  patchHistory: WorkspacePatch[];
  snapshots: WorkspaceSnapshot[];

  setProject: (project: ReactProject) => void;
  clearProject: () => void;
  touchProject: () => void;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
  setSelectedPaths: (paths: string[]) => void;
  updateFileContent: (path: string, content: string) => void;
  createFile: (path: string, content?: string) => void;
  renamePath: (path: string, nextPath: string) => void;
  deletePath: (path: string) => void;
  createSnapshot: (label: string) => WorkspaceSnapshot | null;
  restoreSnapshot: (snapshotId: string) => void;
  addAiMessage: (message: WorkspaceAiMessage) => void;
  updateAiMessage: (messageId: string, updates: Partial<WorkspaceAiMessage>) => void;
  setPendingPatch: (patch: WorkspacePatch | null) => void;
  applyPatch: (patch?: WorkspacePatch | null) => { ok: boolean; message?: string };
  rejectPendingPatch: () => void;
  clearAiHistory: () => void;
}

function normalizeProjectPath(rawPath: string): string {
  const withSlashes = rawPath.replace(/\\/g, '/').trim();
  const stripped = withSlashes.replace(/^\.?\//, '');
  return stripped || 'src/App.tsx';
}

function getFileLanguage(path: string): string {
  const normalized = path.toLowerCase();
  if (normalized.endsWith('.tsx') || normalized.endsWith('.ts')) return 'typescript';
  if (normalized.endsWith('.jsx') || normalized.endsWith('.js')) return 'javascript';
  if (normalized.endsWith('.json')) return 'json';
  if (normalized.endsWith('.css')) return 'css';
  if (normalized.endsWith('.html')) return 'html';
  if (normalized.endsWith('.md')) return 'markdown';
  return 'text';
}

function buildProjectFile(path: string, content = ''): ProjectFile {
  const normalizedPath = normalizeProjectPath(path);
  const segments = normalizedPath.split('/');
  const name = segments[segments.length - 1];
  const directory = segments.length > 1 ? segments.slice(0, -1).join('/') : '';
  const timestamp = Date.now();

  return {
    path: normalizedPath,
    name,
    directory,
    content,
    encoding: 'utf8',
    language: getFileLanguage(normalizedPath),
    isBinary: false,
    runtimeSupported: true,
    size: content.length,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function snapshotFiles(files: Record<string, ProjectFile>): Record<string, Pick<ProjectFile, 'content' | 'updatedAt'>> {
  return Object.fromEntries(
    Object.entries(files).map(([path, file]) => [path, { content: file.content, updatedAt: file.updatedAt }]),
  );
}

function applyPatchOperation(files: Record<string, ProjectFile>, operation: WorkspacePatchOperation): { ok: boolean; message?: string } {
  if (operation.type === 'createFile') {
    files[normalizeProjectPath(operation.path)] = buildProjectFile(operation.path, operation.content);
    return { ok: true };
  }

  if (operation.type === 'updateFile') {
    const path = normalizeProjectPath(operation.path);
    if (!files[path]) {
      return { ok: false, message: `Cannot update missing file "${path}".` };
    }
    files[path] = {
      ...files[path],
      content: operation.content,
      size: operation.content.length,
      updatedAt: Date.now(),
    };
    return { ok: true };
  }

  if (operation.type === 'replaceInFile') {
    const path = normalizeProjectPath(operation.path);
    const file = files[path];
    if (!file) {
      return { ok: false, message: `Cannot edit missing file "${path}".` };
    }
    if (!file.content.includes(operation.oldText)) {
      return { ok: false, message: `Could not find expected text inside "${path}".` };
    }
    const nextContent = file.content.replace(operation.oldText, operation.newText);
    files[path] = {
      ...file,
      content: nextContent,
      size: nextContent.length,
      updatedAt: Date.now(),
    };
    return { ok: true };
  }

  if (operation.type === 'deleteFile') {
    const path = normalizeProjectPath(operation.path);
    delete files[path];
    return { ok: true };
  }

  if (operation.type === 'renameFile') {
    const path = normalizeProjectPath(operation.path);
    const nextPath = normalizeProjectPath(operation.newPath);
    const file = files[path];
    if (!file) {
      return { ok: false, message: `Cannot rename missing file "${path}".` };
    }
    delete files[path];
    files[nextPath] = {
      ...buildProjectFile(nextPath, file.content),
      encoding: file.encoding,
      isBinary: file.isBinary,
      runtimeSupported: file.runtimeSupported,
      omittedReason: file.omittedReason,
      size: file.size,
      createdAt: file.createdAt,
      updatedAt: Date.now(),
    };
    return { ok: true };
  }

  if (operation.type === 'updateDependencies') {
    const packageJsonPath = Object.keys(files).find((path) => path.endsWith('package.json'));
    if (!packageJsonPath) {
      return { ok: false, message: 'Cannot update dependencies without a package.json file.' };
    }
    try {
      const parsed = JSON.parse(files[packageJsonPath].content || '{}') as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      parsed.dependencies = { ...(parsed.dependencies || {}), ...(operation.dependencies || {}) };
      parsed.devDependencies = { ...(parsed.devDependencies || {}), ...(operation.devDependencies || {}) };
      const nextContent = JSON.stringify(parsed, null, 2);
      files[packageJsonPath] = {
        ...files[packageJsonPath],
        content: nextContent,
        size: nextContent.length,
        updatedAt: Date.now(),
      };
      return { ok: true };
    } catch {
      return { ok: false, message: 'package.json is invalid JSON and could not be updated.' };
    }
  }

  return { ok: false, message: 'Unsupported patch operation.' };
}

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  activeProject: null,
  openTabs: [],
  activeFilePath: null,
  selectedPaths: [],
  aiMessages: [],
  pendingPatch: null,
  patchHistory: [],
  snapshots: [],

  setProject: (project) => {
    const filePaths = Object.keys(project.files).sort();
    const initialPath = project.entryFilePath || filePaths[0] || null;
    set({
      activeProject: project,
      openTabs: initialPath ? [{ path: initialPath, isDirty: false }] : [],
      activeFilePath: initialPath,
      selectedPaths: initialPath ? [initialPath] : [],
      aiMessages: [],
      pendingPatch: null,
      patchHistory: [],
      snapshots: [],
    });
  },

  clearProject: () => set({
    activeProject: null,
    openTabs: [],
    activeFilePath: null,
    selectedPaths: [],
    aiMessages: [],
    pendingPatch: null,
    patchHistory: [],
    snapshots: [],
  }),

  touchProject: () => {
    const project = get().activeProject;
    if (!project) return;
    set({ activeProject: { ...project, updatedAt: Date.now() } });
  },

  openFile: (path) => {
    const normalized = normalizeProjectPath(path);
    const { openTabs } = get();
    const hasTab = openTabs.some((tab) => tab.path === normalized);
    set({
      openTabs: hasTab ? openTabs : [...openTabs, { path: normalized, isDirty: false }],
      activeFilePath: normalized,
      selectedPaths: [normalized],
    });
  },

  closeFile: (path) => {
    const normalized = normalizeProjectPath(path);
    const { openTabs, activeFilePath } = get();
    const nextTabs = openTabs.filter((tab) => tab.path !== normalized);
    const nextActive = activeFilePath === normalized ? nextTabs[nextTabs.length - 1]?.path || null : activeFilePath;
    set({
      openTabs: nextTabs,
      activeFilePath: nextActive,
      selectedPaths: nextActive ? [nextActive] : [],
    });
  },

  setActiveFile: (path) => set({
    activeFilePath: path ? normalizeProjectPath(path) : null,
    selectedPaths: path ? [normalizeProjectPath(path)] : [],
  }),

  setSelectedPaths: (paths) => set({ selectedPaths: paths.map(normalizeProjectPath) }),

  updateFileContent: (path, content) => {
    const project = get().activeProject;
    if (!project) return;
    const normalized = normalizeProjectPath(path);
    const current = project.files[normalized];
    if (!current) return;
    const updatedFile: ProjectFile = {
      ...current,
      content,
      size: content.length,
      updatedAt: Date.now(),
    };

    set({
      activeProject: {
        ...project,
        files: { ...project.files, [normalized]: updatedFile },
        updatedAt: Date.now(),
      },
      openTabs: get().openTabs.map((tab) => tab.path === normalized ? { ...tab, isDirty: true } : tab),
    });
  },

  createFile: (path, content = '') => {
    const project = get().activeProject;
    if (!project) return;
    const file = buildProjectFile(path, content);
    set({
      activeProject: {
        ...project,
        files: { ...project.files, [file.path]: file },
        updatedAt: Date.now(),
      },
      openTabs: [...get().openTabs, { path: file.path, isDirty: true }],
      activeFilePath: file.path,
      selectedPaths: [file.path],
    });
  },

  renamePath: (path, nextPath) => {
    const project = get().activeProject;
    if (!project) return;
    const files = { ...project.files };
    const normalizedPath = normalizeProjectPath(path);
    const normalizedNext = normalizeProjectPath(nextPath);
    const directFile = files[normalizedPath];

    if (directFile) {
      const result = applyPatchOperation(files, { type: 'renameFile', path, newPath: nextPath });
      if (!result.ok) return;
    } else {
      const descendants = Object.keys(files).filter((candidate) => candidate.startsWith(`${normalizedPath}/`));
      if (descendants.length === 0) return;
      descendants.forEach((candidate) => {
        const nextCandidate = candidate.replace(`${normalizedPath}/`, `${normalizedNext}/`);
        const result = applyPatchOperation(files, { type: 'renameFile', path: candidate, newPath: nextCandidate });
        if (!result.ok) {
          return;
        }
      });
    }

    set({
      activeProject: { ...project, files, updatedAt: Date.now() },
      openTabs: get().openTabs.map((tab) => {
        if (tab.path === normalizedPath) {
          return { ...tab, path: normalizedNext, isDirty: true };
        }
        if (tab.path.startsWith(`${normalizedPath}/`)) {
          return { ...tab, path: tab.path.replace(`${normalizedPath}/`, `${normalizedNext}/`), isDirty: true };
        }
        return tab;
      }),
      activeFilePath: normalizedNext,
      selectedPaths: [normalizedNext],
    });
  },

  deletePath: (path) => {
    const project = get().activeProject;
    if (!project) return;
    const normalized = normalizeProjectPath(path);
    const files = { ...project.files };
    Object.keys(files)
      .filter((candidate) => candidate === normalized || candidate.startsWith(`${normalized}/`))
      .forEach((candidate) => delete files[candidate]);

    const nextTabs = get().openTabs.filter((tab) => tab.path !== normalized && !tab.path.startsWith(`${normalized}/`));
    const nextActive = nextTabs[nextTabs.length - 1]?.path || null;
    set({
      activeProject: { ...project, files, updatedAt: Date.now() },
      openTabs: nextTabs,
      activeFilePath: nextActive,
      selectedPaths: nextActive ? [nextActive] : [],
    });
  },

  createSnapshot: (label) => {
    const project = get().activeProject;
    if (!project) return null;
    const snapshot: WorkspaceSnapshot = {
      id: uuidv4(),
      label,
      createdAt: Date.now(),
      files: snapshotFiles(project.files),
    };
    set({ snapshots: [snapshot, ...get().snapshots].slice(0, 10) });
    return snapshot;
  },

  restoreSnapshot: (snapshotId) => {
    const project = get().activeProject;
    const snapshot = get().snapshots.find((entry) => entry.id === snapshotId);
    if (!project || !snapshot) return;

    const restoredFiles = Object.fromEntries(
      Object.entries(snapshot.files).map(([path, data]) => [
        path,
        {
          ...(project.files[path] || buildProjectFile(path)),
          content: data.content,
          updatedAt: Date.now(),
          size: data.content.length,
        },
      ]),
    );

    set({
      activeProject: {
        ...project,
        files: restoredFiles,
        updatedAt: Date.now(),
      },
      openTabs: get().openTabs.map((tab) => ({ ...tab, isDirty: false })),
      pendingPatch: null,
    });
  },

  addAiMessage: (message) => set({ aiMessages: [...get().aiMessages, message] }),

  updateAiMessage: (messageId, updates) => set({
    aiMessages: get().aiMessages.map((message) => message.id === messageId ? { ...message, ...updates } : message),
  }),

  setPendingPatch: (patch) => set({
    pendingPatch: patch,
    patchHistory: patch ? [patch, ...get().patchHistory.filter((entry) => entry.id !== patch.id)] : get().patchHistory,
  }),

  applyPatch: (patch) => {
    const selectedPatch = patch ?? get().pendingPatch;
    const project = get().activeProject;
    if (!selectedPatch || !project) {
      return { ok: false, message: 'No pending patch available.' };
    }

    get().createSnapshot(`Before patch: ${selectedPatch.summary}`);
    const files = { ...project.files };
    for (const operation of selectedPatch.operations) {
      const result = applyPatchOperation(files, operation);
      if (!result.ok) {
        set({
          patchHistory: get().patchHistory.map((entry) => entry.id === selectedPatch.id ? { ...entry, status: 'failed' } : entry),
          pendingPatch: null,
        });
        return result;
      }
    }

    const pendingPatch = { ...selectedPatch, status: 'applied' as const };
    set({
      activeProject: { ...project, files, updatedAt: Date.now() },
      pendingPatch: null,
      patchHistory: get().patchHistory.map((entry) => entry.id === pendingPatch.id ? pendingPatch : entry),
      openTabs: get().openTabs.map((tab) =>
        files[tab.path] ? { ...tab, isDirty: true } : tab,
      ),
    });

    return { ok: true };
  },

  rejectPendingPatch: () => {
    const patch = get().pendingPatch;
    if (!patch) return;
    set({
      pendingPatch: null,
      patchHistory: get().patchHistory.map((entry) => entry.id === patch.id ? { ...entry, status: 'rejected' } : entry),
    });
  },

  clearAiHistory: () => set({ aiMessages: [], pendingPatch: null, patchHistory: [] }),
}));
