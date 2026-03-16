import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SandpackProvider, useSandpack } from '@codesandbox/sandpack-react';
import { Download, FileUp, FolderCode, Play, Sparkles, Wand2 } from 'lucide-react';
import FileExplorer from './react-workspace/FileExplorer';
import EditorTabs from './react-workspace/EditorTabs';
import CodeEditorPane from './react-workspace/CodeEditorPane';
import PreviewPane from './react-workspace/PreviewPane';
import TerminalPane from './react-workspace/TerminalPane';
import DiagnosticsPane from './react-workspace/DiagnosticsPane';
import WorkspaceAiPanel from './react-workspace/WorkspaceAiPanel';
import { useProjectStore } from '../store/projectStore';
import { useWorkspaceSessionStore } from '../store/workspaceSessionStore';
import { useDiagnosticsStore } from '../store/diagnosticsStore';
import { createStarterReactProject, importReactProjectArchive } from '../services/projectImport';
import { downloadProjectArchive } from '../services/projectArchive';
import { buildWorkspaceRuntimeConfig } from '../services/workspaceRuntimeClient';
import { createWorkspaceDiagnostic, diagnosticFromSandpackError, diagnosticsFromRuntimeLogs, runtimeLogsFromConsole } from '../services/workspaceDiagnostics';

function WorkspaceSandpackBridge() {
  const { sandpack } = useSandpack();
  const project = useProjectStore((state) => state.activeProject);
  const activeFilePath = useProjectStore((state) => state.activeFilePath);
  const updateFileContent = useProjectStore((state) => state.updateFileContent);
  const setActiveFile = useProjectStore((state) => state.setActiveFile);
  const setRuntimeStatus = useWorkspaceSessionStore((state) => state.setRuntimeStatus);
  const setRuntimeError = useWorkspaceSessionStore((state) => state.setRuntimeError);
  const setRuntimeErrorDetails = useWorkspaceSessionStore((state) => state.setRuntimeErrorDetails);

  useEffect(() => {
    if (!activeFilePath) return;
    const targetPath = activeFilePath.startsWith('/') ? activeFilePath : `/${activeFilePath}`;
    if (sandpack.activeFile !== targetPath) {
      sandpack.openFile(targetPath);
      sandpack.setActiveFile(targetPath);
    }
  }, [activeFilePath, sandpack]);

  useEffect(() => {
    const sandpackActive = sandpack.activeFile?.replace(/^\//, '');
    if (sandpackActive && sandpackActive !== activeFilePath) {
      setActiveFile(sandpackActive);
    }
  }, [activeFilePath, sandpack.activeFile, setActiveFile]);

  useEffect(() => {
    if (!project) return;
    Object.entries(sandpack.files).forEach(([path, file]) => {
      const normalized = path.replace(/^\//, '');
      const current = project.files[normalized];
      if (!current || current.isBinary) return;
      if (current.content !== file.code) {
        updateFileContent(normalized, file.code);
      }
    });
  }, [project, sandpack.files, updateFileContent]);

  useEffect(() => {
    const statusMap = {
      initial: 'preparing',
      idle: 'ready',
      running: 'running',
      timeout: 'error',
      done: 'ready',
    } as const;
    setRuntimeStatus(statusMap[sandpack.status] || 'idle');
  }, [sandpack.status, setRuntimeStatus]);

  useEffect(() => {
    if (!sandpack.error) {
      setRuntimeError(null);
      setRuntimeErrorDetails(null);
      return;
    }

    setRuntimeError(sandpack.error.message);
    setRuntimeErrorDetails(sandpack.error);
  }, [sandpack.error, setRuntimeError, setRuntimeErrorDetails]);

  return null;
}

const ReactWorkspaceScreen: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeProject = useProjectStore((state) => state.activeProject);
  const activeFilePath = useProjectStore((state) => state.activeFilePath);
  const setProject = useProjectStore((state) => state.setProject);
  const clearAiHistory = useProjectStore((state) => state.clearAiHistory);
  const setBottomPanel = useWorkspaceSessionStore((state) => state.setBottomPanel);
  const bottomPanel = useWorkspaceSessionStore((state) => state.bottomPanel);
  const previewMode = useWorkspaceSessionStore((state) => state.previewMode);
  const setPreviewMode = useWorkspaceSessionStore((state) => state.setPreviewMode);
  const setRuntimeTemplate = useWorkspaceSessionStore((state) => state.setRuntimeTemplate);
  const setRuntimeLogs = useWorkspaceSessionStore((state) => state.setRuntimeLogs);
  const runtimeLogs = useWorkspaceSessionStore((state) => state.runtimeLogs);
  const runtimeErrorDetails = useWorkspaceSessionStore((state) => state.runtimeErrorDetails);
  const diagnostics = useDiagnosticsStore((state) => state.diagnostics);
  const setDiagnostics = useDiagnosticsStore((state) => state.setDiagnostics);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [aiSeedPrompt, setAiSeedPrompt] = useState<string | null>(null);

  const runtimeConfig = useMemo(() => {
    if (!activeProject) return null;
    return buildWorkspaceRuntimeConfig(activeProject, activeFilePath);
  }, [activeProject, activeFilePath]);

  useEffect(() => {
    setRuntimeTemplate(activeProject?.template || null);
  }, [activeProject, setRuntimeTemplate]);

  useEffect(() => {
    const nextDiagnostics = [
      ...((activeProject?.warnings || []).map((warning) => createWorkspaceDiagnostic({
        source: 'import',
        severity: 'warning',
        title: 'Import warning',
        message: warning,
      }))),
      ...diagnosticFromSandpackError(runtimeErrorDetails),
      ...diagnosticsFromRuntimeLogs(runtimeLogs),
    ];
    setDiagnostics(nextDiagnostics);
  }, [activeProject?.warnings, runtimeErrorDetails, runtimeLogs, setDiagnostics]);

  const handleCreateStarter = (template: 'vite-react-ts' | 'vite-react' = 'vite-react-ts') => {
    setProject(createStarterReactProject(template));
    clearAiHistory();
    requestAnimationFrame(() => useProjectStore.getState().createSnapshot('Starter project created'));
    setWorkspaceMessage('Starter React workspace created. You can edit files, preview changes live, and export the full project as a zip.');
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const result = await importReactProjectArchive(file);
      setProject(result.project);
      clearAiHistory();
      requestAnimationFrame(() => useProjectStore.getState().createSnapshot(`Imported ${result.project.name}`));
      setWorkspaceMessage(result.warnings.length > 0
        ? `Imported ${result.project.name} with ${result.warnings.length} warning(s).`
        : `Imported ${result.project.name} successfully.`);
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : 'Failed to import the selected project zip.');
    } finally {
      setIsImporting(false);
      event.target.value = '';
    }
  };

  const handleExport = async () => {
    if (!activeProject) return;
    await downloadProjectArchive(activeProject);
  };

  const handleSendDiagnosticsToAi = () => {
    if (diagnostics.length === 0) return;
    setBottomPanel('ai');
    setAiSeedPrompt('Fix the current diagnostics with the smallest possible patch. Focus on the files and lines implicated by the workspace errors.');
  };

  const handleSendCurrentFileToAi = () => {
    if (!activeFilePath) return;
    setBottomPanel('ai');
    setAiSeedPrompt(`Review ${activeFilePath} and make the requested change with the smallest possible patch. Avoid touching unrelated files.`);
  };

  return (
    <div className="react-workspace-screen">
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip"
        style={{ display: 'none' }}
        onChange={handleImport}
      />

      <div className="react-workspace-toolbar">
        <div className="react-workspace-toolbar__left">
          <div className="react-workspace-toolbar__title">
            <FolderCode size={18} />
            <div>
              <span>React Workspace</span>
              <small>{activeProject ? activeProject.name : 'Frontend-only React IDE mode'}</small>
            </div>
          </div>
          {workspaceMessage && <span className="react-workspace-toolbar__message">{workspaceMessage}</span>}
        </div>
        <div className="react-workspace-toolbar__actions">
          <button onClick={() => handleCreateStarter('vite-react-ts')}>
            <Sparkles size={14} />
            <span>Starter TS</span>
          </button>
          <button onClick={() => handleCreateStarter('vite-react')}>
            <Sparkles size={14} />
            <span>Starter JS</span>
          </button>
          <button onClick={handleImportClick} disabled={isImporting}>
            <FileUp size={14} />
            <span>{isImporting ? 'Importing...' : 'Import ZIP'}</span>
          </button>
          <button onClick={handleExport} disabled={!activeProject}>
            <Download size={14} />
            <span>Export ZIP</span>
          </button>
          <button onClick={handleSendCurrentFileToAi} disabled={!activeFilePath}>
            <Wand2 size={14} />
            <span>Send file to AI</span>
          </button>
        </div>
      </div>

      {!activeProject || !runtimeConfig ? (
        <div className="react-workspace-empty-state">
          <div className="react-workspace-empty-state__card">
            <FolderCode size={40} />
            <h2>Open a React frontend project</h2>
            <p>Import a zip archive, start from a Vite starter, edit multiple files, preview the app live, and export the updated project as a zip.</p>
            <div className="react-workspace-empty-state__actions">
              <button onClick={() => handleCreateStarter('vite-react-ts')}>
                <Play size={14} />
                Start TypeScript workspace
              </button>
              <button onClick={handleImportClick}>
                <FileUp size={14} />
                Import project zip
              </button>
            </div>
          </div>
        </div>
      ) : (
        <SandpackProvider
          template={runtimeConfig.template}
          files={runtimeConfig.files}
          customSetup={runtimeConfig.customSetup}
          options={runtimeConfig.options}
        >
          <WorkspaceSandpackBridge />
          <div className="react-workspace-layout">
            <aside className="react-workspace-layout__left">
              <FileExplorer />
            </aside>

            <section className="react-workspace-layout__center">
              <EditorTabs />
              <CodeEditorPane />
            </section>

            <aside className="react-workspace-layout__right">
              <div className="react-workspace-preview-toolbar">
                <div className="react-workspace-toggle">
                  <button
                    className={previewMode === 'preview' ? 'is-active' : ''}
                    onClick={() => setPreviewMode('preview')}
                  >
                    Preview
                  </button>
                  <button
                    className={previewMode === 'code' ? 'is-active' : ''}
                    onClick={() => setPreviewMode('code')}
                  >
                    Code
                  </button>
                </div>
                <div className="react-workspace-toggle">
                  <button
                    className={bottomPanel === 'ai' ? 'is-active' : ''}
                    onClick={() => setBottomPanel('ai')}
                  >
                    AI
                  </button>
                  <button
                    className={bottomPanel === 'diagnostics' ? 'is-active' : ''}
                    onClick={() => setBottomPanel('diagnostics')}
                  >
                    Diagnostics
                  </button>
                  <button
                    className={bottomPanel === 'terminal' ? 'is-active' : ''}
                    onClick={() => setBottomPanel('terminal')}
                  >
                    Terminal
                  </button>
                </div>
              </div>
              <div className="react-workspace-preview-region">
                <PreviewPane />
              </div>
              <div className="react-workspace-bottom-region">
                {bottomPanel === 'terminal' && (
                  <TerminalPane onLogsChange={(logs) => setRuntimeLogs(runtimeLogsFromConsole(logs))} />
                )}
                {bottomPanel === 'diagnostics' && (
                  <DiagnosticsPane onSendDiagnosticsToAi={handleSendDiagnosticsToAi} />
                )}
                {bottomPanel === 'ai' && (
                  <WorkspaceAiPanel
                    seedPrompt={aiSeedPrompt}
                    onSeedConsumed={() => setAiSeedPrompt(null)}
                  />
                )}
              </div>
            </aside>
          </div>
        </SandpackProvider>
      )}
    </div>
  );
};

export default ReactWorkspaceScreen;
