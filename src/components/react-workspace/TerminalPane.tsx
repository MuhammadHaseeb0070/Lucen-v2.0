import React from 'react';
import { SandpackConsole } from '@codesandbox/sandpack-react';
import { useWorkspaceSessionStore } from '../../store/workspaceSessionStore';
import type { WorkspaceConsoleData } from '../../services/workspaceDiagnostics';

interface TerminalPaneProps {
  onLogsChange: (logs: WorkspaceConsoleData) => void;
}

const TerminalPane: React.FC<TerminalPaneProps> = ({ onLogsChange }) => {
  const runtimeStatus = useWorkspaceSessionStore((state) => state.runtimeStatus);
  const runtimeTemplate = useWorkspaceSessionStore((state) => state.runtimeTemplate);

  return (
    <div className="react-workspace-pane react-workspace-terminal-pane">
      <div className="react-workspace-pane-header">
        <span>Terminal</span>
        <span className="react-workspace-pane-meta">{runtimeTemplate || 'runtime'} · {runtimeStatus}</span>
      </div>
      <SandpackConsole
        standalone
        showHeader={false}
        showSetupProgress
        showSyntaxError
        showRestartButton={false}
        showResetConsoleButton
        maxMessageCount={250}
        resetOnPreviewRestart={false}
        onLogsChange={onLogsChange}
      />
    </div>
  );
};

export default TerminalPane;
