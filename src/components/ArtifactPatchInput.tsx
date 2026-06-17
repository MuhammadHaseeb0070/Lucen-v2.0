import React, { useState } from 'react';
import { Loader2, ArrowUpCircle } from 'lucide-react';
import { useArtifactStore } from '../store/artifactStore';
import { useChatStore } from '../store/chatStore';
import { executeArtifactPatch } from '../lib/artifactSidecar';

interface ArtifactPatchInputProps {
  artifactId: string;
}

const ArtifactPatchInput: React.FC<ArtifactPatchInputProps> = ({ artifactId }) => {
  const [instruction, setInstruction] = useState('');
  const [contextTurns, setContextTurns] = useState<number>(0);
  const patchStatus = useArtifactStore(s => s.patchStatus[artifactId]);
  const isPatching = patchStatus === 'patching' || patchStatus === 'verifying';

  const handleSend = async () => {
    if (!instruction.trim() || isPatching) return;
    
    const activeArtifact = useArtifactStore.getState().activeArtifact;
    if (!activeArtifact || activeArtifact.id !== artifactId) return;

    const convId = useChatStore.getState().activeConversationId;
    let chatContext: any[] = [];
    if (convId && contextTurns > 0) {
       const msgs = useChatStore.getState().getContextMessages(convId);
       chatContext = msgs.slice(-contextTurns * 2); // 1 turn = user + assistant
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

  return (
    <div className="artifact-patch-input-container" style={{ padding: '12px', borderTop: '1px solid var(--border-light)', display: 'flex', gap: '8px', alignItems: 'center', background: 'var(--bg-panel)' }}>
      <select 
        value={contextTurns} 
        onChange={e => setContextTurns(Number(e.target.value))}
        className="patch-context-select"
        style={{ padding: '6px', borderRadius: '4px', border: '1px solid var(--border-light)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '12px' }}
        title="Recent chat messages to include for context"
      >
        <option value={0}>0 turns</option>
        <option value={1}>1 turn</option>
        <option value={2}>2 turns</option>
        <option value={3}>3 turns</option>
      </select>
      <input
        type="text"
        placeholder="Ask AI to update this artifact..."
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
        className="patch-instruction-input"
        style={{ flex: 1, padding: '8px 12px', borderRadius: '4px', border: '1px solid var(--border-light)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '13px' }}
        disabled={isPatching}
      />
      <button 
        className="patch-submit-btn"
        onClick={handleSend}
        disabled={!instruction.trim() || isPatching}
        style={{ padding: '8px 12px', borderRadius: '4px', background: 'var(--accent-color)', color: 'white', border: 'none', cursor: instruction.trim() && !isPatching ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: '6px' }}
      >
        {isPatching ? <Loader2 size={14} className="apm-spin" /> : <ArrowUpCircle size={14} />}
        <span>Update</span>
      </button>
    </div>
  );
};

export default ArtifactPatchInput;
