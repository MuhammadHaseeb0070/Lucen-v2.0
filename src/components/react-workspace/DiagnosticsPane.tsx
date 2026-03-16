import React from 'react';
import { AlertTriangle, Wand2 } from 'lucide-react';
import { useDiagnosticsStore } from '../../store/diagnosticsStore';

interface DiagnosticsPaneProps {
  onSendDiagnosticsToAi: () => void;
}

const DiagnosticsPane: React.FC<DiagnosticsPaneProps> = ({ onSendDiagnosticsToAi }) => {
  const diagnostics = useDiagnosticsStore((state) => state.diagnostics);

  return (
    <div className="react-workspace-pane react-workspace-diagnostics-pane">
      <div className="react-workspace-pane-header">
        <span>Diagnostics</span>
        <div className="react-workspace-pane-actions">
          <button onClick={onSendDiagnosticsToAi} title="Send diagnostics to AI">
            <Wand2 size={14} />
          </button>
        </div>
      </div>

      {diagnostics.length === 0 ? (
        <div className="react-workspace-empty-pane">
          <AlertTriangle size={18} />
          <span>No active diagnostics right now.</span>
        </div>
      ) : (
        <div className="react-workspace-diagnostics-list">
          {diagnostics.map((diagnostic) => (
            <div key={diagnostic.id} className={`react-workspace-diagnostic react-workspace-diagnostic--${diagnostic.severity}`}>
              <div className="react-workspace-diagnostic__title">{diagnostic.title}</div>
              {diagnostic.path && (
                <div className="react-workspace-diagnostic__location">
                  {diagnostic.path}
                  {typeof diagnostic.line === 'number' ? `:${diagnostic.line}` : ''}
                  {typeof diagnostic.column === 'number' ? `:${diagnostic.column}` : ''}
                </div>
              )}
              <div className="react-workspace-diagnostic__message">{diagnostic.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DiagnosticsPane;
