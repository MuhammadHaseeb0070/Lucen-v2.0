import { useExecutionQueueStore } from '../store/executionQueueStore';
import { useArtifactStore } from '../store/artifactStore';
import { useChatStore } from '../store/chatStore';
import { supabase } from '../lib/supabase';
import { getCodingModel } from '../config/models';
import { parseArtifacts } from '../lib/artifactParser';
import { logger } from '../lib/logger';
import { v4 as uuidv4 } from 'uuid';

const MAX_RETRIES = 2;
let isProcessing = false;

function generateSystemPrompt(hasArtifact: boolean): string {
    if (!hasArtifact) {
        return `<lucen_system>
<identity>
You are the Lucen Execution Engine. Your job is to implement the first step of a complex execution plan by creating a brand new artifact.
</identity>
<rules>
1. Output a complete, working artifact wrapped in <lucen_artifact> tags.
2. Use the correct type (html, file, etc.).
3. Do NOT output markdown formatting outside the artifact tags.
4. Do NOT output a patch. This is the first step, so you are creating the baseline artifact.
5. Provide ONLY the code. No explanations.
</rules>
</lucen_system>`;
    }

    return `<lucen_system>
<identity>
You are the Lucen Execution Engine. Your job is to surgically modify an existing artifact based on an execution step.
</identity>
<rules>
1. Output ONLY Git conflict marker patches.
2. The format is:
<<<<<<< SEARCH
[exact lines to replace]
=======
[new lines]
>>>>>>> REPLACE
3. Ensure the SEARCH block exactly matches the current code, including whitespace.
4. You can provide multiple patch blocks if needed.
5. Provide ONLY the patch blocks. No explanations.
</rules>
</lucen_system>`;
}

async function processQueue() {
    import('../store/executionQueueStore').then(({ useExecutionQueueStore }) => {
        console.log('[Orchestrator] processQueue called. Queue state:',
            JSON.stringify(useExecutionQueueStore.getState().queue));
    });
    if (isProcessing) return;
    isProcessing = true;

    try {
        const store = useExecutionQueueStore.getState();
        let item = store.getNextIdleItem();

        while (item) {
            store.updateQueueItemStatus(item.messageId, 'running');

            try {
                await processPlan(item);
                useExecutionQueueStore.getState().updateQueueItemStatus(item.messageId, 'completed');
            } catch (err) {
                logger.error('[ExecutionOrchestrator] Plan failed:', err);
                useExecutionQueueStore.getState().updateQueueItemStatus(item.messageId, 'failed');
            }

            // fetch next
            item = useExecutionQueueStore.getState().getNextIdleItem();
        }
    } finally {
        isProcessing = false;
    }
}

async function processPlan(item: ReturnType<typeof useExecutionQueueStore.getState>['queue'][string]) {
    const chatStore = useChatStore.getState();
    const artifactStore = useArtifactStore.getState();
    const queueStore = useExecutionQueueStore.getState();

    // Loop through steps
    for (let i = 0; i < item.plan.steps.length; i++) {
        const step = item.plan.steps[i];
        if (step.status === 'success' || step.status === 'failed') continue;

        queueStore.updateStepStatus(item.messageId, i, 'running');
        let retries = 0;
        let success = false;

        while (retries <= MAX_RETRIES && !success) {
            try {
                // Get current artifact state. Wait, the plan was triggered by a message.
                // The artifact might belong to the conversation.
                const activeArtifact = item.artifactId 
                    ? artifactStore.getArtifactById(item.artifactId) 
                    : artifactStore.activeArtifact;
                const hasArtifact = !!activeArtifact?.content;

                const systemPrompt = generateSystemPrompt(hasArtifact);
                const userPrompt = retries > 0 && hasArtifact ? 
                    `Step: ${step.title}\nInstruction: ${step.description}\n\nYour previous patch failed to apply because the SEARCH block did not match the current code exactly.\nHere is the CURRENT artifact content again:\n\`\`\`\n${activeArtifact.content}\n\`\`\`\nPlease read it carefully and emit a new patch for: ${step.description}` :
                    (`Step: ${step.title}\nInstruction: ${step.description}\n\n` + 
                    (hasArtifact ? `Current Artifact Content:\n\`\`\`\n${activeArtifact.content}\n\`\`\`\n\nApply the patch to fulfill the step instruction.` 
                    : `Please generate the initial artifact to fulfill the step instruction.`));

                const codingModel = getCodingModel();

                const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
                const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
                const { data: { session } } = await supabase!.auth.getSession();
                
                if (!session?.access_token) {
                    throw new Error("No active session to run executor model");
                }

                const response = await fetch(`${supabaseUrl}/functions/v1/chat-proxy`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session.access_token}`,
                        'apikey': anonKey || '',
                    },
                    body: JSON.stringify({
                        model: codingModel.id,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userPrompt }
                        ],
                        max_tokens: 8000,
                        stream: false
                    })
                });

                if (!response.ok) {
                    throw new Error(`OpenRouter API error: ${response.status}`);
                }

                const data = await response.json();
                const content = data.choices[0].message.content;

                if (!hasArtifact) {
                    // Extract new artifact
                    const parsed = parseArtifacts(content, item.messageId, false);
                    if (parsed.artifacts.length > 0) {
                        const newArtifact = parsed.artifacts[0];
                        newArtifact.id = uuidv4();
                        
                        // Wait, we need to update the artifactStore and chatStore!
                        // For a background task, adding a message to chatStore with the artifact?
                        // Actually, we can just create a new message with the artifact and add it to the conversation.
                        const msgId = uuidv4();
                        await chatStore.addMessage(item.conversationId, {
                            id: msgId,
                            role: 'assistant',
                            content: '',
                            timestamp: Date.now(),
                            isStreaming: false,
                        });
                        
                        // Simulate setting active artifact.
                        // Actually, the artifact itself needs to be saved to supabase and linked to a message.
                        // Wait, we don't need to add a message per step, we can just update the artifact content in-place.
                        // Let's assume we dispatch an event or call store.
                        // Actually, creating a new artifact requires setting it as active or updating the target artifact.
                        // Let's keep it simple for now and just set it in the store.
                        useArtifactStore.getState().setActiveArtifact(newArtifact);
                        queueStore.setArtifactId(item.messageId, newArtifact.id);
                        success = true;
                    } else {
                        throw new Error('Failed to parse artifact from response');
                    }
                } else {
                    // Extract and apply patch
                    const { parsePatches } = await import('../lib/artifactPatchParser');
                    const parsed = parsePatches(content, false);
                    if (parsed.type === 'success' && parsed.patches.length > 0) {
                        const patchBlocks = parsed.patches[0].blocks;
                        const { applyPatch } = await import('../lib/artifactPatcher');
                        const result = applyPatch(activeArtifact.content, patchBlocks, activeArtifact.type);
                        
                        if (result.ok) {
                            useArtifactStore.getState().updateArtifactContent({
                                ...activeArtifact,
                                content: result.newContent
                            });
                            success = true;
                        } else {
                            throw new Error(`Failed to apply patch: ${result.reason}`);
                        }
                    } else {
                        throw new Error('Failed to parse patch from response');
                    }
                }
            } catch (err) {
                logger.warn(`[ExecutionOrchestrator] Step ${i} attempt ${retries + 1} failed:`, err);
                retries++;
            }
        }

        if (success) {
            queueStore.updateStepStatus(item.messageId, i, 'success');
        } else {
            queueStore.updateStepStatus(item.messageId, i, 'failed');
            throw new Error(`Step ${i} failed after ${MAX_RETRIES} retries`);
        }
    }
}

export const ExecutionOrchestrator = {
    start: () => {
        console.log('[Orchestrator] start() called');
        const store = useExecutionQueueStore.getState();
        Object.values(store.queue).forEach(item => {
            if (item.status === 'running') {
                store.updateQueueItemStatus(item.messageId, 'idle');
            }
            item.plan.steps.forEach((step, idx) => {
                if (step.status === 'running') {
                    store.updateStepStatus(item.messageId, idx, 'pending');
                }
            });
        });

        processQueue();
        // Set up subscription to process queue when new items are added
        useExecutionQueueStore.subscribe(
            (state, prevState) => {
                if (state.queue !== prevState.queue) {
                    processQueue();
                }
            }
        );
    }
};
