import React, { useMemo } from 'react';
import { SandpackPreview, useSandpack, useSandpackPreviewProgress } from '@codesandbox/sandpack-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { useWorkspaceSessionStore } from '../../store/workspaceSessionStore';

const PreviewPane: React.FC = () => {
  const { sandpack } = useSandpack();
  const previewMode = useWorkspaceSessionStore((state) => state.previewMode);
  const activeProject = useProjectStore((state) => state.activeProject);
  const activeFilePath = useProjectStore((state) => state.activeFilePath);
  const previewProgress = useSandpackPreviewProgress({ timeout: 20000 });

  const activeFile = activeFilePath && activeProject ? activeProject.files[activeFilePath] : null;
  const runtimeError = useMemo(() => {
    if (!sandpack.error) return '';
    const parts = [sandpack.error.title, sandpack.error.message].filter(Boolean);
    if (sandpack.error.path) {
      parts.push([
        sandpack.error.path.replace(/^\//, ''),
        sandpack.error.line,
        sandpack.error.column,
      ].filter(Boolean).join(':'));
    }
    return parts.join('\n');
  }, [sandpack.error]);

  if (previewMode === 'code') {
    return (
      <div className="react-workspace-preview-code">
        <SyntaxHighlighter
          style={oneDark}
          language={activeFile?.language || 'text'}
          PreTag="div"
          wrapLongLines
          customStyle={{ margin: 0, height: '100%', minHeight: '100%', borderRadius: 0 }}
        >
          {activeFile?.content || ''}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <div className="react-workspace-preview-shell">
      <SandpackPreview
        className="react-workspace-preview-frame"
        showSandpackErrorOverlay={false}
        showNavigator={false}
        showRefreshButton={false}
        showOpenInCodeSandbox={false}
        showOpenNewtab={false}
      />

      {sandpack.status !== 'idle' && sandpack.status !== 'done' && !runtimeError && (
        <div className="react-workspace-preview-overlay react-workspace-preview-overlay--loading">
          <div className="react-workspace-preview-card">
            <Loader2 size={18} className="react-workspace-preview-card__spinner" />
            <div>
              <div className="react-workspace-preview-card__title">Preparing live preview</div>
              <div className="react-workspace-preview-card__text">{previewProgress || 'Compiling workspace runtime...'}</div>
            </div>
          </div>
        </div>
      )}

      {runtimeError && (
        <div className="react-workspace-preview-overlay react-workspace-preview-overlay--error">
          <div className="react-workspace-preview-error">
            <div className="react-workspace-preview-error__header">
              <AlertTriangle size={18} />
              <div>
                <div className="react-workspace-preview-card__title">Preview failed</div>
                <div className="react-workspace-preview-card__text">Use the Diagnostics or AI panes to fix the failing files.</div>
              </div>
            </div>
            <pre>{runtimeError}</pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default PreviewPane;
