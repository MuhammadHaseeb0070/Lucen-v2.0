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
        bottom: '32px', 
        left: '50%', 
        transform: 'translateX(-50%)',
        width: '90%',
        maxWidth: '640px',
        display: 'flex', 
        gap: '8px', 
        alignItems: 'center', 
        background: 'var(--bg-surface)',
        padding: '10px 12px',
        borderRadius: 'var(--r-full)',
        border: '1px solid var(--divider)',
        boxShadow: '0 16px 40px var(--shadow-color)',
        zIndex: 100,
        transition: 'all var(--dur) var(--ease)'
      }}
    >
      <button
        onClick={() => setIncludeContext(!includeContext)}
        className="patch-context-toggle"
        title={includeContext ? "Chat context included" : "Include chat context"}
        style={{ 
          padding: '8px', 
          borderRadius: 'var(--r-full)', 
          border: '1px solid transparent', 
          background: includeContext ? 'var(--accent-soft)' : 'transparent', 
          color: includeContext ? 'var(--accent)' : 'var(--text-tertiary)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all var(--dur-fast) var(--ease)'
        }}
      >
        <MessageSquare size={18} />
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
          fontSize: '0.95rem',
          outline: 'none',
          fontFamily: 'var(--font-ui)'
        }}
        disabled={isPatching}
      />
      
      <button 
        className="patch-submit-btn"
        onClick={handleSend}
        disabled={!instruction.trim() || isPatching}
        style={{ 
          padding: '10px 20px', 
          borderRadius: 'var(--r-full)', 
          background: instruction.trim() && !isPatching ? 'var(--accent)' : 'var(--bg-muted)', 
          color: instruction.trim() && !isPatching ? 'var(--accent-text)' : 'var(--text-tertiary)', 
          border: 'none', 
          cursor: instruction.trim() && !isPatching ? 'pointer' : 'not-allowed', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          fontWeight: 600,
          fontSize: '0.85rem',
          transition: 'all var(--dur-fast) var(--ease)'
        }}
      >
        {isPatching ? <Loader2 size={16} className="apm-spin" /> : <ArrowUpCircle size={16} />}
        <span>Update</span>
      </button>
    </div>
  );
};

export default ArtifactPatchInput;
