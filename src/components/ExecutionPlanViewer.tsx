import React from 'react';
import { CheckCircle2, Circle, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
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
        // Reset failed steps to pending
        activePlan.steps.forEach((step, idx) => {
            if (step.status !== 'success') {
                store.updateStepStatus(messageId, idx, 'pending');
            }
        });
        store.updateQueueItemStatus(messageId, 'idle');
    };

    return (
        <div className="execution-plan-viewer">
            <div className="execution-plan-header">
                <h3>Execution Plan</h3>
                <span className="execution-plan-status">
                    {activePlan.steps.filter(s => s.status === 'success').length} / {activePlan.steps.length} steps
                </span>
                {queueItem?.status === 'failed' && (
                    <button 
                        className="execution-plan-retry-btn"
                        onClick={handleRetry}
                        title="Retry failed steps"
                    >
                        <RefreshCw size={14} /> Retry
                    </button>
                )}
            </div>
            
            <div className="execution-plan-steps">
                {activePlan.steps.map((step, idx) => {
                    const isCompleted = step.status === 'success';
                    const isRunning = step.status === 'running';
                    const isFailed = step.status === 'failed';
                    const isPending = step.status === 'pending';

                    return (
                        <div key={idx} className={`execution-plan-step execution-plan-step--${step.status}`}>
                            <div className="execution-plan-step-icon">
                                {isCompleted && <CheckCircle2 size={16} className="text-green-500" />}
                                {isRunning && <Loader2 size={16} className="animate-spin text-blue-500" />}
                                {isFailed && <AlertCircle size={16} className="text-red-500" />}
                                {isPending && <Circle size={16} className="text-gray-400" />}
                            </div>
                            <div className="execution-plan-step-content">
                                <div className="execution-plan-step-title">
                                    {step.title}
                                    {isRunning && (
                                        <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px', fontWeight: 'normal' }}>Usually takes 10–20s</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ExecutionPlanViewer;
