export type ReactWorkspaceMode = 'chat' | 'admin' | 'react-workspace';

export type ReactProjectSource = 'starter' | 'zip-import';

export type ReactProjectTemplate = 'vite-react-ts' | 'vite-react' | 'react-ts' | 'react' | 'custom';

export type WorkspacePreviewMode = 'preview' | 'code';

export type WorkspaceBottomPanel = 'terminal' | 'diagnostics' | 'ai';

export type WorkspaceRuntimeStatus =
  | 'idle'
  | 'preparing'
  | 'running'
  | 'ready'
  | 'error'
  | 'stopped';

export type WorkspaceDiagnosticSeverity = 'info' | 'warning' | 'error';

export type WorkspaceDiagnosticSource = 'import' | 'runtime' | 'preview' | 'ai';

export type WorkspaceRuntimeLogLevel = 'info' | 'warning' | 'error';

export interface ProjectFile {
  path: string;
  name: string;
  directory: string;
  content: string;
  encoding: 'utf8' | 'base64';
  language: string;
  isBinary: boolean;
  isHidden?: boolean;
  runtimeSupported: boolean;
  omittedReason?: string;
  size: number;
  createdAt: number;
  updatedAt: number;
}

export interface DirectoryNode {
  path: string;
  name: string;
  directories: DirectoryNode[];
  files: ProjectFile[];
}

export interface ReactProject {
  id: string;
  name: string;
  source: ReactProjectSource;
  framework: 'react';
  template: ReactProjectTemplate;
  rootPath: string;
  packageJsonPath: string | null;
  entryFilePath: string | null;
  files: Record<string, ProjectFile>;
  warnings: string[];
  ignoredPaths: string[];
  binaryAssetPaths: string[];
  createdAt: number;
  updatedAt: number;
}

export interface OpenEditorTab {
  path: string;
  isDirty: boolean;
}

export interface WorkspaceSnapshot {
  id: string;
  label: string;
  createdAt: number;
  files: Record<string, Pick<ProjectFile, 'content' | 'updatedAt'>>;
}

export interface WorkspaceRuntimeLog {
  id: string;
  level: WorkspaceRuntimeLogLevel;
  message: string;
  timestamp: number;
  source?: string;
}

export interface WorkspaceDiagnostic {
  id: string;
  source: WorkspaceDiagnosticSource;
  severity: WorkspaceDiagnosticSeverity;
  title: string;
  message: string;
  path?: string;
  line?: number;
  column?: number;
  raw?: string;
}

export interface WorkspacePatchCreateFileOperation {
  type: 'createFile';
  path: string;
  content: string;
}

export interface WorkspacePatchUpdateFileOperation {
  type: 'updateFile';
  path: string;
  content: string;
}

export interface WorkspacePatchReplaceInFileOperation {
  type: 'replaceInFile';
  path: string;
  oldText: string;
  newText: string;
}

export interface WorkspacePatchDeleteFileOperation {
  type: 'deleteFile';
  path: string;
}

export interface WorkspacePatchRenameFileOperation {
  type: 'renameFile';
  path: string;
  newPath: string;
}

export interface WorkspacePatchUpdateDependenciesOperation {
  type: 'updateDependencies';
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export type WorkspacePatchOperation =
  | WorkspacePatchCreateFileOperation
  | WorkspacePatchUpdateFileOperation
  | WorkspacePatchReplaceInFileOperation
  | WorkspacePatchDeleteFileOperation
  | WorkspacePatchRenameFileOperation
  | WorkspacePatchUpdateDependenciesOperation;

export interface WorkspacePatch {
  id: string;
  summary: string;
  reasoning?: string;
  createdAt: number;
  status: 'pending' | 'applied' | 'rejected' | 'failed';
  operations: WorkspacePatchOperation[];
  rawResponse?: string;
}

export interface WorkspaceAiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  patchId?: string;
  isStreaming?: boolean;
}

export interface WorkspaceImportResult {
  project: ReactProject;
  warnings: string[];
}
