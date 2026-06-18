import { executePatchCall } from '../services/openrouter/patchClient';
import { type Message } from '../types';
import { parsePatches } from './artifactPatchParser';
import { applyPatch } from './artifactPatcher';
import { useArtifactStore } from '../store/artifactStore';
import { useComposerStore } from '../store/composerStore';
import { updateArtifactContent as updateArtifactContentDb } from '../services/artifactDb';
import { useChatStore } from '../store/chatStore';
import { v4 as uuidv4 } from 'uuid';

export interface ArtifactPatchRequest {
  instruction: string;
  currentCode: string;
  artifactId: string;
  chatContext?: any[];
}

export async function executeArtifactPatch({
  instruction,
  currentCode,
  artifactId,
  chatContext,
}: ArtifactPatchRequest): Promise<void> {
  const setPatchStatus = useArtifactStore.getState().setPatchStatus;
  const updateArtifactContent = useArtifactStore.getState().updateArtifactContent;
  const convId = useChatStore.getState().activeConversationId;
  
  setPatchStatus(artifactId, 'patching');

  try {
    const patchResponse = await executePatchCall({
      currentCode,
      instruction,
      conversationId: convId || undefined,
      chatContext,
    });

    if (!patchResponse.ok) {
      console.error("Patch sidecar error:", patchResponse.error);
      useArtifactStore.getState().setPatchError(artifactId, patchResponse.error || 'Patch call failed.');
      setPatchStatus(artifactId, 'idle');
      return;
    }

    const responseText = patchResponse.content;

    // Check sentinels
    const parseResult = parsePatches(responseText, true);
    if (parseResult.type === 'sentinel') {
       triggerFullRegenFallback(instruction, currentCode, parseResult.value);
       setPatchStatus(artifactId, 'idle');
       return;
    }

    setPatchStatus(artifactId, 'verifying');
    if (parseResult.patches.length > 0) {
      const blocks = parseResult.patches[parseResult.patches.length - 1].blocks;
      const patchResult = applyPatch(currentCode, blocks);
      if (patchResult.ok) {
         const activeArtifact = useArtifactStore.getState().activeArtifact;
         if (activeArtifact && activeArtifact.id === artifactId) {
            // Save in-memory undo buffer
            useArtifactStore.getState().setLastPatchedContent(artifactId, activeArtifact.content);

            const updatedArtifact = { ...activeArtifact, content: patchResult.newContent };
            updateArtifactContent(updatedArtifact);
            
            // Persist the new content to the actual message in the chat store
            // so it survives hard reloads (which re-hydrate from message content).
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
                        return `${openTag}\n${patchResult.newContent}\n${closeTag}`;
                      }
                      matchIndex++;
                      return match;
                    }
                  );

                  useChatStore.getState().updateMessage(convId, activeArtifact.messageId, { content: newMsgContent });
                }
              }
            }

            const dbId = useArtifactStore.getState().getDbId(artifactId);
            if (dbId) {
              updateArtifactContentDb(dbId, patchResult.newContent, activeArtifact.title)
                .catch((err) => console.error('[Patch] DB persist failed:', err));
            }

            if (convId) {
              const userMsgId = uuidv4();
              const assistantMsgId = uuidv4();
              const userMsg: Message = {
                id: userMsgId,
                role: 'user',
                content: instruction,
                timestamp: Date.now(),
                isPatch: true
              };
              const assistantMsg: Message = {
                id: assistantMsgId,
                role: 'assistant',
                content: responseText,
                timestamp: Date.now() + 1,
                isPatch: true
              };
              useChatStore.getState().addMessage(convId, userMsg);
              useChatStore.getState().addMessage(convId, assistantMsg);
            }

            // Trigger feedback toast
            useArtifactStore.getState().setShowFeedbackToast(true);
         }
      } else {
         console.error("Patch failed to apply:", patchResult);
         const attempts = useArtifactStore.getState().incHealAttempts(artifactId);
         if (attempts >= 3) {
           useArtifactStore.getState().setPatchError(artifactId, 'Update failed after multiple attempts. Please try rephrasing your request or making a smaller change.');
         } else {
           triggerFullRegenFallback(instruction, currentCode, "PATCH_APPLY_FAILED");
         }
      }
    } else {
       console.warn("No patch blocks found in response");
       triggerFullRegenFallback(instruction, currentCode, "NO_PATCH_BLOCKS_FOUND");
    }
  } catch (err: any) {
    console.error("Patch execution failed:", err);
    useArtifactStore.getState().setPatchError(artifactId, err.message || 'Patch failed.');
  } finally {
    setPatchStatus(artifactId, 'idle');
  }
}

function triggerFullRegenFallback(instruction: string, currentCode: string, reason: string) {
  console.log(`Patch fallback triggered (${reason}). Regenerating via main composer...`);
  const lines = [
    `Apply the following updates to the artifact:`,
    instruction,
    `=== FULL ARTIFACT SOURCE CODE ===`,
    currentCode,
    `=== END SOURCE ===`,
    `IMPORTANT: Output the COMPLETE fixed artifact wrapped in <lucen_artifact> tags. Do not explain the changes - just output the fully updated artifact.`
  ];
  useComposerStore.getState().setPendingAutoSend({ content: lines.join('\n'), hideUserMessage: false, forceMode: 'artifact' });
}
