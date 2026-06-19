import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ExecutionPlan, ExecutionStep } from '../types';

export interface QueueItem {
    messageId: string;
    conversationId: string;
    plan: ExecutionPlan;
    status: 'idle' | 'running' | 'completed' | 'failed';
    createdAt: number;
    artifactId?: string;
}

interface ExecutionQueueStore {
    queue: Record<string, QueueItem>;
    
    // Add a new plan to the queue
    enqueuePlan: (messageId: string, conversationId: string, plan: ExecutionPlan) => void;
    
    // Update the status of a specific step in a plan
    updateStepStatus: (messageId: string, stepIndex: number, status: ExecutionStep['status']) => void;
    
    // Update the status of a queue item
    updateQueueItemStatus: (messageId: string, status: QueueItem['status']) => void;
    
    // Set the artifact ID bound to this plan
    setArtifactId: (messageId: string, artifactId: string) => void;
    
    // Get the next idle queue item
    getNextIdleItem: () => QueueItem | undefined;
    
    // Get an item by messageId
    getItem: (messageId: string) => QueueItem | undefined;
}

export const useExecutionQueueStore = create<ExecutionQueueStore>()(
    persist(
        (set, get) => ({
            queue: {},
            
            enqueuePlan: (messageId, conversationId, plan) => {
                set((state) => ({
                    queue: {
                        ...state.queue,
                        [messageId]: {
                            messageId,
                            conversationId,
                            plan,
                            status: 'idle',
                            createdAt: Date.now(),
                        }
                    }
                }));
            },
            
            updateStepStatus: (messageId, stepIndex, status) => {
                set((state) => {
                    const item = state.queue[messageId];
                    if (!item) return state;
                    
                    const newSteps = [...item.plan.steps];
                    if (newSteps[stepIndex]) {
                        newSteps[stepIndex] = { ...newSteps[stepIndex], status };
                    }
                    
                    return {
                        queue: {
                            ...state.queue,
                            [messageId]: {
                                ...item,
                                plan: {
                                    ...item.plan,
                                    steps: newSteps
                                }
                            }
                        }
                    };
                });
            },
            
            updateQueueItemStatus: (messageId, status) => {
                set((state) => {
                    const item = state.queue[messageId];
                    if (!item) return state;
                    
                    return {
                        queue: {
                            ...state.queue,
                            [messageId]: {
                                ...item,
                                status
                            }
                        }
                    };
                });
            },
            
            setArtifactId: (messageId, artifactId) => {
                set((state) => {
                    const item = state.queue[messageId];
                    if (!item) return state;
                    
                    return {
                        queue: {
                            ...state.queue,
                            [messageId]: {
                                ...item,
                                artifactId
                            }
                        }
                    };
                });
            },
            
            getNextIdleItem: () => {
                const { queue } = get();
                return Object.values(queue)
                    .filter(item => item.status === 'idle')
                    .sort((a, b) => a.createdAt - b.createdAt)[0];
            },
            
            getItem: (messageId) => {
                return get().queue[messageId];
            }
        }),
        {
            name: 'execution-queue-storage',
        }
    )
);
