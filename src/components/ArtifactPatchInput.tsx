import React, { useState } from 'react';
import { Loader2, ArrowUpCircle, MessageSquare } from 'lucide-react';
import { useArtifactStore } from '../store/artifactStore';
import { useChatStore } from '../store/chatStore';
import { executeArtifactPatch } from '../lib/artifactSidecar';

interface ArtifactPatchInputProps {
  artifactId: string;
}

const ArtifactPatchInput: React.FC<ArtifactPatchInputProps> = ({ artifactId }) => {
  const [instruction, setInstruction] = useState('');
  const [includeContext, setIncludeContext] = useState(false);
  const patchStatus = useArtifactStore(s => s.patchStatus[artifactId]);
  const isPatching = patchStatus === 'patching' || patchStatus === 'verifying';

  const handleSend = async () => {
    if (!instruction.trim() || isPatching) return;
    
    const activeArtifact = useArtifactStore.getState().activeArtifact;
    if (!activeArtifact || activeArtifact.id !== artifactId) return;

    const convId = useChatStore.getState().activeConversationId;
    let chatContext: any[] = [];
    if (convId && includeContext) {
       const msgs = useChatStore.getState().getContextMessages(convId);
       chatContext = msgs.slice(-4); // Include last 4 messages (2 turns)
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
    <div 
      className="artifact-patch-input-container" 
      style={{ 
        position: 'absolute', 
        bottom: '24px', 
        left: '50%', 
        transform: 'translateX(-50%)',
        width: '90%',
        maxWidth: '600px',
        display: 'flex', 
        gap: '8px', 
        alignItems: 'center', 
        background: 'var(--bg-panel)',
        padding: '8px',
        borderRadius: '24px',
        border: '1px solid var(--border-light)',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.12)',
        zIndex: 100
      }}
    >
      <button
        onClick={() => setIncludeContext(!includeContext)}
        className="patch-context-toggle"
        title={includeContext ? "Chat context included" : "Include chat context"}
        style={{ 
          padding: '8px', 
          borderRadius: '50%', 
          border: 'none', 
          background: includeContext ? 'var(--accent-color)' : 'transparent', 
          color: includeContext ? 'white' : 'var(--text-secondary)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease'
        }}
      >
        <MessageSquare size={16} />
      </button>

      <input
        type="text"
        placeholder="Ask AI to update this artifact..."
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
        className="patch-instruction-input"
        style={{ 
          flex: 1, 
          padding: '8px 4px', 
          border: 'none', 
          background: 'transparent', 
          color: 'var(--text-primary)', 
          fontSize: '14px',
          outline: 'none'
        }}
        disabled={isPatching}
      />
      
      <button 
        className="patch-submit-btn"
        onClick={handleSend}
        disabled={!instruction.trim() || isPatching}
        style={{ 
          padding: '8px 16px', 
          borderRadius: '16px', 
          background: instruction.trim() && !isPatching ? 'var(--accent-color)' : 'var(--bg-hover)', 
          color: instruction.trim() && !isPatching ? 'white' : 'var(--text-tertiary)', 
          border: 'none', 
          cursor: instruction.trim() && !isPatching ? 'pointer' : 'not-allowed', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '6px',
          fontWeight: 500,
          transition: 'all 0.2s ease'
        }}
      >
        {isPatching ? <Loader2 size={16} className="apm-spin" /> : <ArrowUpCircle size={16} />}
        <span>Update</span>
      </button>
    </div>
  );
};

export default ArtifactPatchInput;
