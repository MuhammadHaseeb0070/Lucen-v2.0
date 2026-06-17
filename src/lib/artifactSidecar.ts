import { streamChat } from '../services/openrouter/client';
import { PATCH_SIDECAR_SYSTEM_PROMPT } from '../config/prompts';
import { type Message } from '../types';
import { parsePatches } from './artifactPatchParser';
import { applyPatch } from './artifactPatcher';
import { useArtifactStore } from '../store/artifactStore';
import { useComposerStore } from '../store/composerStore';
import { updateArtifactContent as updateArtifactContentDb } from '../services/artifactDb';

export interface ArtifactPatchRequest {
  instruction: string;
  currentCode: string;
  chatContext: Message[];
  artifactId: string;
}

export async function executeArtifactPatch({
  instruction,
  currentCode,
  chatContext,
  artifactId,
}: ArtifactPatchRequest): Promise<void> {
  const userMessageContent = `
Current Artifact Code:
\`\`\`
${currentCode}
\`\`\`

User Instruction:
${instruction}
`;

  const messages: Message[] = [
    ...chatContext,
    { id: `patch-req-${Date.now()}`, role: 'user', content: userMessageContent, timestamp: Date.now() }
  ];

  let buffer = '';
  const setPatchStatus = useArtifactStore.getState().setPatchStatus;
  const updateArtifactContent = useArtifactStore.getState().updateArtifactContent;
  
  setPatchStatus(artifactId, 'patching');

  await streamChat(messages, {
    onChunk: (chunk) => {
      buffer += chunk;
      const parseResult = parsePatches(buffer, false);
      if (parseResult.type === 'sentinel') {
        return;
      }
    },
    onReasoning: () => {},
    onDone: () => {
      const parseResult = parsePatches(buffer, true);
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
             const updatedArtifact = { ...activeArtifact, content: patchResult.newContent };
             updateArtifactContent(updatedArtifact);
             
             // Persist the new content to the actual message in the chat store
             // so it survives hard reloads (which re-hydrate from message content).
             const convId = useChatStore.getState().activeConversationId;
             if (convId && activeArtifact.messageId) {
               const msgs = useChatStore.getState().getContextMessages(convId);
               const parentMsg = msgs.find(m => m.id === activeArtifact.messageId);
               if (parentMsg && parentMsg.content) {
                 const regex = new RegExp(`(<lucen_artifact[^>]*id=["']${activeArtifact.id}["'][^>]*>)[\\s\\S]*?(<\\/lucen_artifact>)`);
                 const newMsgContent = parentMsg.content.replace(regex, `$1\n${patchResult.newContent}\n$2`);
                 useChatStore.getState().updateMessage(convId, activeArtifact.messageId, { content: newMsgContent });
               }
             }

             const dbId = useArtifactStore.getState().getDbId(artifactId);
             if (dbId) {
               updateArtifactContentDb(dbId, patchResult.newContent, activeArtifact.title)
                 .catch((err) => console.error('[Patch] DB persist failed:', err));
             } else {
               console.warn('[Patch] No dbId found for artifact — patch not persisted to Artifacts DB:', artifactId);
             }
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
      }
      setPatchStatus(artifactId, 'idle');
    },
    onError: (err) => {
      console.error("Patch sidecar error:", err);
      setTimeout(() => {
        useArtifactStore.getState().setPatchError(artifactId, 'Patch stream failed. The connection was interrupted.');
        setPatchStatus(artifactId, 'idle');
      }, 100);
    }
  }, {
    systemPromptOverride: PATCH_SIDECAR_SYSTEM_PROMPT,
    isSideChat: true,
    forceMode: 'artifact',
  });
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
