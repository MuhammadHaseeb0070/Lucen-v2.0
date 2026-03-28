import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useCreditsStore } from '../store/creditsStore';
import { planLabel, LC, formatLC } from '../config/subscriptionConfig';
import { Database } from 'lucide-react';
import './UserUsageTab.css';

interface UsageLog {
    id: string;
    conversation_id?: string;
    message_id?: string;
    prompt_tokens: number;
    completion_tokens: number;
    reasoning_tokens: number;
    image_tokens: number;
    file_tokens: number;
    total_credits_deducted: number;
    created_at: string;
}

const UserUsageTab: React.FC = () => {
    const { user } = useAuthStore();
    const { billingCycleUsage, isLoading: creditsLoading, customerPortalUrl, subscriptionPlan } = useCreditsStore();
    const [logs, setLogs] = useState<UsageLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!user) return;

        const fetchLogs = async () => {
            if (!supabase) {
                setIsLoading(false);
                setError('Supabase not configured');
                return;
            }

            setIsLoading(true);
            try {
                // Fetch user's own usage logs
                const { data, error } = await supabase
                    .from('usage_logs')
                    .select('*')
                    .eq('user_id', user.id)
                    .order('created_at', { ascending: false })
                    .limit(10);

                if (error) throw error;
                setLogs(data as UsageLog[] || []);
            } catch (err: any) {
                console.error('Failed to fetch usage logs:', err);
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchLogs();
    }, [user]);

    const toNumber = (value: number | null | undefined): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

    return (
        <div className="settings-tab-body usage-tab">
            <p className="settings-desc usage-tab__desc">
                You are on the <strong>{planLabel(subscriptionPlan)}</strong> plan. Track your {LC.unit} usage and the last 10 requests below.
            </p>

            <div className="usage-summary-grid">
                <div className="usage-credit-card">
                    <div className="usage-credit-card__icon">
                        <Database size={20} />
                    </div>
                    <div className="usage-credit-card__content">
                        <span className="usage-credit-card__label">Current Cycle Usage</span>
                        <p className="usage-credit-card__value">
                            {creditsLoading ? '...' : `${formatLC(billingCycleUsage)} ${LC.unit}`}
                        </p>
                    </div>
                </div>

                {customerPortalUrl && (
                    <a href={customerPortalUrl} target="_blank" rel="noopener noreferrer" className="usage-portal-link">
                        <div className="usage-portal-link__icon">
                            <Database size={16} />
                        </div>
                        <span>View Billing History & Invoices →</span>
                    </a>
                )}
            </div>

            <div className="usage-logs-section">
                <div className="usage-logs-header">
                    <h2>Last 10 Requests</h2>
                    <span>Input / Output / Reasoning tokens</span>
                </div>

                {isLoading ? (
                    <div className="usage-logs-state">Loading usage logs...</div>
                ) : error ? (
                    <div className="usage-logs-state usage-logs-state--error">Error: {error}</div>
                ) : logs.length === 0 ? (
                    <div className="usage-logs-state">No requests found yet. Start chatting to generate usage logs.</div>
                ) : (
                    <div className="usage-table-wrap">
                        <table className="usage-table">
                            <thead>
                                <tr>
                                    <th>Timestamp</th>
                                    <th>Request ID</th>
                                    <th>Input</th>
                                    <th>Output</th>
                                    <th>Reasoning</th>
                                    <th>Credits</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map(log => (
                                    <tr key={log.id}>
                                        <td>{new Date(log.created_at).toLocaleString()}</td>
                                        <td className="usage-table__id">
                                            {(log.message_id || log.id).substring(0, 8)}
                                        </td>
                                        <td>{toNumber(log.prompt_tokens).toLocaleString()}</td>
                                        <td>{toNumber(log.completion_tokens).toLocaleString()}</td>
                                        <td className={toNumber(log.reasoning_tokens) > 0 ? 'usage-table__reasoning' : ''}>
                                            {toNumber(log.reasoning_tokens).toLocaleString()}
                                        </td>
                                        <td className="usage-table__credits">-{toNumber(log.total_credits_deducted).toFixed(4)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default UserUsageTab;
