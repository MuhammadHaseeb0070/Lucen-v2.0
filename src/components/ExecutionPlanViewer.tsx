import React from 'react';
import { CheckCircle2, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import type { ExecutionPlan } from '../types';
import { useExecutionQueueStore } from '../store/executionQueueStore';

interface ExecutionPlanViewerProps {
    messageId: string;
    plan: ExecutionPlan;
}

const ExecutionPlanViewer: React.FC<ExecutionPlanViewerProps> = ({ messageId, plan }) => {
    const queueItem = useExecutionQueueStore(state => state.getItem(messageId));
    const activePlan = queueItem ? queueItem.plan : plan;

    const handleRetry = () => {
        if (!queueItem) return;
        const store = useExecutionQueueStore.getState();
        store.updateQueueItemStatus(messageId, 'idle');
    };

    const status = queueItem?.status || 'idle';
    
    return (
        <div className="execution-plan-viewer">
            <div className="execution-plan-header">
                <h3>{activePlan.title}</h3>
                <span className="execution-plan-status">
                    {status === 'idle' && "Queued..."}
                    {status === 'running' && (
                        <span className="flex items-center gap-2">
                            <Loader2 size={14} className="animate-spin text-blue-500" /> Building artifact...
                        </span>
                    )}
                    {status === 'completed' && (
                        <span className="flex items-center gap-2 text-green-500">
                            <CheckCircle2 size={14} /> Done
                        </span>
                    )}
                    {status === 'failed' && (
                        <span className="flex items-center gap-2 text-red-500">
                            <AlertCircle size={14} /> Failed to generate
                        </span>
                    )}
                </span>
                {status === 'failed' && (
                    <button 
                        className="execution-plan-retry-btn"
                        onClick={handleRetry}
                        title="Retry generation"
                    >
                        <RefreshCw size={14} /> Retry
                    </button>
                )}
            </div>
        </div>
    );
};

export default ExecutionPlanViewer;
