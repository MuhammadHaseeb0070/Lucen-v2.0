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



async function processQueue() {
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
    const queueStore = useExecutionQueueStore.getState();
    const artifactStore = useArtifactStore.getState();

    let retries = 0;
    let success = false;

    while (retries <= MAX_RETRIES && !success) {
        try {
            const systemPrompt = `You are an expert frontend developer. Generate a complete, fully functional artifact exactly as described. Output ONLY a <lucen_artifact> tag with the complete code inside. No explanations, no markdown, no commentary.`;
            const userPrompt = item.plan.masterPrompt;

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
                    max_tokens: 16000,
                    stream: false
                })
            });

            if (!response.ok) {
                throw new Error(`OpenRouter API error: ${response.status}`);
            }

            const data = await response.json();
            const content = data.choices[0].message.content;

            const parsed = parseArtifacts(content, item.messageId, false);
            if (parsed.artifacts.length > 0) {
                const newArtifact = parsed.artifacts[0];
                newArtifact.id = uuidv4();
                
                artifactStore.setActiveArtifact(newArtifact);
                queueStore.setArtifactId(item.messageId, newArtifact.id);

                const conv = chatStore.conversations.find(c => c.id === item.conversationId);
                const msg = conv?.messages.find(m => m.id === item.messageId);
                const currentContent = msg?.content || '';
                
                chatStore.updateMessage(item.conversationId, item.messageId, {
                    content: currentContent + "\n\n" + content,
                    isStreaming: false,
                });
                
                success = true;
            } else {
                throw new Error('Failed to parse artifact from response');
            }
        } catch (err) {
            logger.warn(`[ExecutionOrchestrator] Attempt ${retries + 1} failed:`, err);
            retries++;
        }
    }

    if (!success) {
        const conv = chatStore.conversations.find(c => c.id === item.conversationId);
        const msg = conv?.messages.find(m => m.id === item.messageId);
        const currentContent = msg?.content || '';
        chatStore.updateMessage(item.conversationId, item.messageId, {
            content: currentContent + "\n\n*(Failed to generate artifact)*",
            isStreaming: false,
        });
        throw new Error(`Failed to generate artifact after ${MAX_RETRIES} retries`);
    }
}

export const ExecutionOrchestrator = {
    start: () => {
        const store = useExecutionQueueStore.getState();
        Object.values(store.queue).forEach(item => {
            if (item.status === 'running') {
                store.updateQueueItemStatus(item.messageId, 'idle');
            }
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
