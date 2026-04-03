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
    model_id?: string | null;
    web_search_enabled?: boolean | null;
    web_search_engine?: string | null;
    web_search_max_results?: number | null;
    web_search_results_billed?: number | null;
    text_credits?: number | null;
    image_credits?: number | null;
    web_search_credits?: number | null;
    created_at: string;
}

const UserUsageTab: React.FC = () => {
    const { user } = useAuthStore();
    const { billingCycleUsage, isLoading: creditsLoading, customerPortalUrl, subscriptionPlan, ledgers } = useCreditsStore();
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
            } catch (err: unknown) {
                console.error('Failed to fetch usage logs:', err);
                setError(err instanceof Error ? err.message : 'Failed to fetch usage logs');
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

                {customerPortalUrl && subscriptionPlan !== 'free' && (
                    <a href={customerPortalUrl} target="_blank" rel="noopener noreferrer" className="usage-portal-link">
                        <div className="usage-portal-link__icon">
                            <Database size={16} />
                        </div>
                        <span>View Billing History & Invoices →</span>
                    </a>
                )}
            </div>

            {ledgers && ledgers.length > 0 && (
                <div className="usage-ledgers-section">
                    <div className="usage-logs-header">
                        <h2>Active Credit Quotas</h2>
                        <span>Consuming in priority order (oldest parsing first)</span>
                    </div>
                    <div className="usage-ledgers-list">
                        {ledgers.map((ledger, index) => (
                            <div key={ledger.id} className="usage-ledger-card">
                                <div className="usage-ledger-card__header">
                                    <strong>Priority {index + 1}: {planLabel(ledger.plan_name as any)} Quota {ledger.subscription_id ? `(Sub #${ledger.subscription_id})` : ''}</strong>
                                    <span className="usage-ledger-card__expires">
                                        Expires: {new Date(ledger.expires_at).toLocaleDateString()}
                                    </span>
                                </div>
                                <div className="usage-ledger-card__progress">
                                    <div 
                                        className="usage-ledger-card__progress-fill" 
                                        style={{ width: `${(ledger.remaining_amount / ledger.initial_amount) * 100}%` }}
                                    ></div>
                                </div>
                                <p className="usage-ledger-card__text">
                                    {formatLC(ledger.remaining_amount)} / {formatLC(ledger.initial_amount)} {LC.unit} left
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="usage-logs-section">
                <div className="usage-logs-header">
                    <h2>Last 10 Requests</h2>
                    <span>Tokens + {LC.unit} breakdown (Text / Image / Web)</span>
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
                                    <th>Model</th>
                                    <th>Input</th>
                                    <th>Output</th>
                                    <th>Reasoning</th>
                                    <th>Text {LC.unit}</th>
                                    <th>Image {LC.unit}</th>
                                    <th>Web {LC.unit}</th>
                                    <th>Total {LC.unit}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map(log => (
                                    <tr key={log.id}>
                                        <td>{new Date(log.created_at).toLocaleString()}</td>
                                        <td className="usage-table__id">
                                            {(log.message_id || log.id).substring(0, 8)}
                                        </td>
                                        <td className="usage-table__model" title={String(log.model_id || '')}>
                                            {String(log.model_id || '—').split('/').pop()}
                                        </td>
                                        <td>{toNumber(log.prompt_tokens).toLocaleString()}</td>
                                        <td>{toNumber(log.completion_tokens).toLocaleString()}</td>
                                        <td className={toNumber(log.reasoning_tokens) > 0 ? 'usage-table__reasoning' : ''}>
                                            {toNumber(log.reasoning_tokens).toLocaleString()}
                                        </td>
                                        <td className="usage-table__credits">-{toNumber(log.text_credits).toFixed(4)}</td>
                                        <td className="usage-table__credits">-{toNumber(log.image_credits).toFixed(4)}</td>
                                        <td className="usage-table__credits">
                                            {toNumber(log.web_search_credits) > 0 ? `-${toNumber(log.web_search_credits).toFixed(4)}` : '—'}
                                        </td>
                                        <td className="usage-table__credits usage-table__credits--total">
                                            -{toNumber(log.total_credits_deducted).toFixed(4)}
                                        </td>
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
