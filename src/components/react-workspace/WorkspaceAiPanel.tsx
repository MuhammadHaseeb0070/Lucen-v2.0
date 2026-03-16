import React, { useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Send, Wand2, Check, X } from 'lucide-react';
import MarkdownRenderer from '../MarkdownRenderer';
import { useProjectStore } from '../../store/projectStore';
import { useDiagnosticsStore } from '../../store/diagnosticsStore';
import { useWorkspaceSessionStore } from '../../store/workspaceSessionStore';
import { streamWorkspaceAiResponse } from '../../services/workspaceAi';
import type { WorkspaceAiMessage } from '../../types/workspace';

interface WorkspaceAiPanelProps {
  seedPrompt?: string | null;
  onSeedConsumed: () => void;
}

const WorkspaceAiPanel: React.FC<WorkspaceAiPanelProps> = ({ seedPrompt, onSeedConsumed }) => {
  const project = useProjectStore((state) => state.activeProject);
  const selectedPaths = useProjectStore((state) => state.selectedPaths);
  const aiMessages = useProjectStore((state) => state.aiMessages);
  const pendingPatch = useProjectStore((state) => state.pendingPatch);
  const addAiMessage = useProjectStore((state) => state.addAiMessage);
  const updateAiMessage = useProjectStore((state) => state.updateAiMessage);
  const setPendingPatch = useProjectStore((state) => state.setPendingPatch);
  const applyPatch = useProjectStore((state) => state.applyPatch);
  const rejectPendingPatch = useProjectStore((state) => state.rejectPendingPatch);
  const diagnostics = useDiagnosticsStore((state) => state.diagnostics);
  const runtimeLogs = useWorkspaceSessionStore((state) => state.runtimeLogs);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    if (!seedPrompt) return;
    const frame = requestAnimationFrame(() => {
      setInput(seedPrompt);
      onSeedConsumed();
    });
    return () => cancelAnimationFrame(frame);
  }, [seedPrompt, onSeedConsumed]);

  const canSend = Boolean(project) && input.trim().length > 0 && !isStreaming;

  const quickPrompts = useMemo(() => {
    const currentFile = selectedPaths[0];
    return [
      currentFile ? `Update only ${currentFile} and keep the rest of the project unchanged.` : null,
      diagnostics.length > 0 ? 'Fix the current diagnostics with the smallest possible patch.' : null,
      selectedPaths.length > 1 ? `Make the requested change using only these files when possible: ${selectedPaths.join(', ')}` : null,
    ].filter(Boolean) as string[];
  }, [diagnostics.length, selectedPaths]);

  const handleSend = async () => {
    if (!project || !input.trim() || isStreaming) return;
    const prompt = input.trim();
    const userMessage: WorkspaceAiMessage = {
      id: uuidv4(),
      role: 'user',
      content: prompt,
      createdAt: Date.now(),
    };
    const assistantMessage: WorkspaceAiMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      isStreaming: true,
    };

    addAiMessage(userMessage);
    addAiMessage(assistantMessage);
    setInput('');
    setIsStreaming(true);
    let streamed = '';

    await streamWorkspaceAiResponse({
      prompt,
      context: {
        project,
        selectedPaths,
        diagnostics,
        runtimeLogs,
        history: [...aiMessages, userMessage],
      },
      onChunk: (chunk) => {
        streamed += chunk;
        updateAiMessage(assistantMessage.id, { content: streamed });
      },
      onDone: ({ content, patch }) => {
        updateAiMessage(assistantMessage.id, { content, isStreaming: false, patchId: patch?.id });
        setPendingPatch(patch);
        setIsStreaming(false);
      },
      onError: (message) => {
        updateAiMessage(assistantMessage.id, {
          content: `Workspace AI failed: ${message}`,
          isStreaming: false,
        });
        setIsStreaming(false);
      },
    });
  };

  const handleApplyPatch = () => {
    const result = applyPatch();
    if (!result.ok && result.message) {
      addAiMessage({
        id: uuidv4(),
        role: 'system',
        content: `Patch application failed: ${result.message}`,
        createdAt: Date.now(),
      });
    }
  };

  return (
    <div className="react-workspace-pane react-workspace-ai-pane">
      <div className="react-workspace-pane-header">
        <span>Workspace AI</span>
        <div className="react-workspace-pane-actions">
          <button
            onClick={() => setInput('Fix the current diagnostics with the smallest possible patch.')}
            title="Ask AI to fix current diagnostics"
          >
            <Wand2 size={14} />
          </button>
        </div>
      </div>

      <div className="react-workspace-ai-messages">
        {aiMessages.length === 0 ? (
          <div className="react-workspace-empty-pane">
            <Wand2 size={18} />
            <span>Ask Lucen to change selected files, fix runtime errors, or patch the current React workspace.</span>
          </div>
        ) : (
          aiMessages.map((message) => (
            <div key={message.id} className={`react-workspace-ai-message react-workspace-ai-message--${message.role}`}>
              <div className="react-workspace-ai-message__role">{message.role}</div>
              <MarkdownRenderer content={message.content || (message.isStreaming ? 'Thinking…' : '')} />
            </div>
          ))
        )}
      </div>

      {pendingPatch && (
        <div className="react-workspace-patch-review">
          <div className="react-workspace-patch-review__title">{pendingPatch.summary}</div>
          <div className="react-workspace-patch-review__meta">{pendingPatch.operations.length} operation(s) ready to apply.</div>
          <div className="react-workspace-patch-review__actions">
            <button onClick={handleApplyPatch}><Check size={14} />Apply patch</button>
            <button onClick={rejectPendingPatch}><X size={14} />Reject</button>
          </div>
        </div>
      )}

      <div className="react-workspace-ai-quick-prompts">
        {quickPrompts.map((prompt) => (
          <button key={prompt} onClick={() => setInput(prompt)}>{prompt}</button>
        ))}
      </div>

      <div className="react-workspace-ai-composer">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask Lucen to change the selected files, fix errors, or make a targeted patch."
          rows={4}
        />
        <button onClick={handleSend} disabled={!canSend}>
          <Send size={15} />
          <span>{isStreaming ? 'Working...' : 'Send'}</span>
        </button>
      </div>
    </div>
  );
};

export default WorkspaceAiPanel;
