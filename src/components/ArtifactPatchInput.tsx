import React, { useState, useEffect } from 'react';
import { Loader2, ArrowUp, MessageSquare, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { useArtifactStore } from '../store/artifactStore';
import { useChatStore } from '../store/chatStore';
import { executeArtifactPatch } from '../lib/artifactSidecar';
import './ArtifactPatchInput.css';

interface ArtifactPatchInputProps {
  artifactId: string;
}

const ArtifactPatchInput: React.FC<ArtifactPatchInputProps> = ({ artifactId }) => {
  const [instruction, setInstruction] = useState('');
  const [contextCount, setContextCount] = useState<number>(0);
  
  const patchStatus = useArtifactStore(s => s.patchStatus[artifactId]) || 'idle';
  const runtimeErrors = useArtifactStore(s => s.runtimeErrors);
  const runtimeError = runtimeErrors[artifactId];
  
  const activeArtifact = useArtifactStore(s => s.activeArtifact);
  const lineages = useArtifactStore(s => s.lineages);
  const historyPanelOpen = useArtifactStore(s => s.historyPanelOpen);
  const setHistoryPanelOpen = useArtifactStore(s => s.setHistoryPanelOpen);
  
  const isPatching = patchStatus !== 'idle';
  
  const [lastActiveStatus, setLastActiveStatus] = useState<string>('idle');
  const [flashState, setFlashState] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (patchStatus !== 'idle') {
      setLastActiveStatus(patchStatus);
    } else if (lastActiveStatus !== 'idle') {
      // Transitioned from active to idle. Check for patch errors.
      const hasErr = runtimeError?.origin === 'patch';
      if (hasErr) {
        setFlashState('error');
        const timer = setTimeout(() => {
          setFlashState('idle');
          setLastActiveStatus('idle');
        }, 2500);
        return () => clearTimeout(timer);
      } else {
        setFlashState('success');
        const timer = setTimeout(() => {
          setFlashState('idle');
          setLastActiveStatus('idle');
        }, 2500);
        return () => clearTimeout(timer);
      }
    }
  }, [patchStatus, lastActiveStatus, runtimeError, artifactId]);

  const handleSend = async () => {
    if (!instruction.trim() || isPatching) return;

    const activeArtifact = useArtifactStore.getState().activeArtifact;
    if (!activeArtifact || activeArtifact.id !== artifactId) return;

    const convId = useChatStore.getState().activeConversationId;
    let chatContext: any[] = [];
    if (convId && contextCount > 0) {
      const msgs = useChatStore.getState().getContextMessages(convId);
      // Slice exactly the requested number of recent messages
      chatContext = msgs.slice(-contextCount);
    }

    const currentInst = instruction;
    setInstruction('');

    await executeArtifactPatch({
      instruction: currentInst,
      currentCode: activeArtifact.content,
      chatContext,
      artifactId
    });
  };

  const getStatusLabel = () => {
    switch (patchStatus) {
      case 'reading': return 'Reading artifact…';
      case 'planning': return 'Planning artifact…';
      case 'generating': return 'Generating sections…';
      case 'patching': return 'Applying patches…';
      case 'verifying': return 'Verifying…';
      case 'repairing': return 'Repairing…';
      default: return 'Processing…';
    }
  };

  return (
    <div className={`artifact-patch-input-wrapper patch-state--${flashState}`}>
      {isPatching ? (
        <div className="artifact-patch-input-row">
          <div className="patch-inline-status-container">
            <Loader2 size={16} className="apm-spin" style={{ color: 'var(--accent)' }} />
            <span className="patch-status-text">{getStatusLabel()}</span>
          </div>
        </div>
      ) : flashState === 'error' ? (
        <div className="artifact-patch-input-row">
          <div className="patch-inline-status-container">
            <AlertCircle size={16} style={{ color: 'var(--danger)' }} />
            <span className="patch-error-text">
              {runtimeError?.message || 'Patch failed — retrying…'}
            </span>
          </div>
        </div>
      ) : flashState === 'success' ? (
        <div className="artifact-patch-input-row">
          <div className="patch-inline-status-container">
            <CheckCircle2 size={16} style={{ color: 'var(--success)' }} />
            <span className="patch-success-text">Artifact updated and verified!</span>
          </div>
        </div>
      ) : (
        <div className="artifact-patch-input-row">
          {/* Segmented Context Selector */}
          <div className="patch-context-group">
            <span className="patch-context-label" title="Include recent chat messages as context">
              <MessageSquare size={14} />
              <span>Context:</span>
            </span>
            <div className="patch-context-selector">
              {[0, 1, 2, 3].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setContextCount(val)}
                  className={`patch-context-pill ${contextCount === val ? 'patch-context-pill--active' : ''}`}
                  title={
                    val === 0
                      ? 'No chat context included'
                      : `Include last ${val} message${val > 1 ? 's' : ''} from chat history`
                  }
                >
                  {val}
                </button>
              ))}
            </div>
          </div>

          {/* History Toggle Button */}
          {activeArtifact && (
            <button
              type="button"
              className={`patch-history-toggle-btn ${historyPanelOpen ? 'patch-history-toggle-btn--active' : ''}`}
              onClick={() => setHistoryPanelOpen(!historyPanelOpen)}
              title="Toggle Version History panel"
            >
              <Clock size={14} />
              <span>
                History (v{
                  (() => {
                    const lineageId = activeArtifact.lineageId || activeArtifact.dbId;
                    const chain = lineageId ? lineages[lineageId] || [] : [];
                    const headEntry = chain.find((v) => v.isHead) || (chain.length > 0 ? chain[chain.length - 1] : undefined);
                    return headEntry?.versionNo ?? activeArtifact.version ?? 1;
                  })()
                })
              </span>
            </button>
          )}

          {/* Main Input Bar */}
          <div className="artifact-patch-bar">
            <input
              type="text"
              className="patch-text-input"
              placeholder="Ask AI to update this artifact..."
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSend();
              }}
            />
            
            <button
              className={`patch-action-btn ${
                instruction.trim() ? 'patch-action-btn--primary' : 'patch-action-btn--disabled'
              }`}
              onClick={handleSend}
              disabled={!instruction.trim()}
              title="Submit update instruction to AI"
            >
              <ArrowUp size={16} />
              <span>Update</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArtifactPatchInput;
