import React, { useEffect, useState } from 'react';
import { RotateCcw, Loader2 } from 'lucide-react';
import { useArtifactStore } from '../store/artifactStore';
import { useChatStore } from '../store/chatStore';
import './ArtifactFeedbackToast.css';

const ArtifactFeedbackToast: React.FC = () => {
  const showFeedbackToast = useArtifactStore((s) => s.showFeedbackToast);
  const lastPatchedContent = useArtifactStore((s) => s.lastPatchedContent);
  const lastPatchedArtifactId = useArtifactStore((s) => s.lastPatchedArtifactId);
  const setShowFeedbackToast = useArtifactStore((s) => s.setShowFeedbackToast);
  const setLastPatchedContent = useArtifactStore((s) => s.setLastPatchedContent);
  
  const activeArtifact = useArtifactStore((s) => s.activeArtifact);
  const updateArtifactContent = useArtifactStore((s) => s.updateArtifactContent);

  const [reverting, setReverting] = useState(false);

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    if (!showFeedbackToast) return;
    const timer = setTimeout(() => {
      setShowFeedbackToast(false);
      setLastPatchedContent(null, null);
    }, 8000);
    return () => clearTimeout(timer);
  }, [showFeedbackToast, setShowFeedbackToast, setLastPatchedContent]);

  if (!showFeedbackToast || !activeArtifact || !lastPatchedContent || activeArtifact.id !== lastPatchedArtifactId) {
    return null;
  }

  const handleRevert = async () => {
    setReverting(true);
    try {
      // 1. Roll back local UI workspace state
      const revertedArtifact = { ...activeArtifact, content: lastPatchedContent };
      updateArtifactContent(revertedArtifact);

      // 2. Roll back message in chat history so it survives reload
      const convId = useChatStore.getState().activeConversationId;
      if (convId && activeArtifact.messageId) {
        const conv = useChatStore.getState().conversations.find(c => c.id === convId);
        if (conv) {
          const parentMsg = conv.messages.find(m => m.id === activeArtifact.messageId);
          if (parentMsg && parentMsg.content) {
            const indexStr = activeArtifact.id.split('-artifact-')[1];
            const targetIndex = parseInt(indexStr, 10);
            
            let matchIndex = 0;
            const newMsgContent = parentMsg.content.replace(
              /(<lucen_artifact[^>]*>)[\s\S]*?(<\/lucen_artifact>)/g,
              (match, openTag, closeTag) => {
                if (matchIndex === targetIndex) {
                  matchIndex++;
                  return `${openTag}\n${lastPatchedContent}\n${closeTag}`;
                }
                matchIndex++;
                return match;
              }
            );

            useChatStore.getState().updateMessage(convId, activeArtifact.messageId, { content: newMsgContent });
          }
        }
      }

      // 3. Roll back DB row content
      const dbId = useArtifactStore.getState().getDbId(activeArtifact.id);
      if (dbId) {
        const { updateArtifactContent: updateArtifactContentDb } = await import('../services/artifactDb');
        await updateArtifactContentDb(dbId, lastPatchedContent, activeArtifact.title)
          .catch((err) => console.error('[Revert] DB save failed:', err));
      }
    } catch (err) {
      console.error('[FeedbackToast] Revert failed:', err);
    } finally {
      setReverting(false);
      setShowFeedbackToast(false);
      setLastPatchedContent(null, null);
    }
  };

  const handleDismiss = () => {
    setShowFeedbackToast(false);
    setLastPatchedContent(null, null);
  };

  return (
    <div className="artifact-feedback-toast-container">
      <div className="artifact-feedback-toast">
        <span className="toast-text">Patch applied. Looks correct?</span>
        
        <div className="toast-actions">
          <button
            className="toast-btn toast-btn--revert"
            onClick={handleRevert}
            disabled={reverting}
            title="Undo recent update"
          >
            {reverting ? (
              <Loader2 size={13} className="apm-spin" />
            ) : (
              <RotateCcw size={13} />
            )}
            <span>Undo</span>
          </button>

          <button
            className="toast-btn toast-btn--dismiss"
            onClick={handleDismiss}
            title="Looks good!"
          >
            <span>Dismiss</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ArtifactFeedbackToast;
