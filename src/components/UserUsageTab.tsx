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

    // Calculate combined totals from all active ledgers
    const totalRemaining = (ledgers || []).reduce((sum, l) => sum + toNumber(l.remaining_amount), 0);
    const totalInitial = (ledgers || []).reduce((sum, l) => sum + toNumber(l.initial_amount), 0);
    const overallProgress = totalInitial > 0 ? (totalRemaining / totalInitial) * 100 : 0;

    return (
        <div className="settings-tab-body usage-tab">
            <p className="settings-desc usage-tab__desc">
                You are on the <strong>{planLabel(subscriptionPlan)}</strong> plan. Track your {LC.unit} usage and active quotas below.
            </p>

            <div className="usage-summary-grid">
                <div className="usage-credit-card usage-credit-card--total">
                    <div className="usage-credit-card__icon">
                        <Database size={22} />
                    </div>
                    <div className="usage-credit-card__content">
                        <span className="usage-credit-card__label">Total Combined Balance</span>
                        <div className="usage-credit-card__balance-wrap">
                            <p className="usage-credit-card__value">
                                {creditsLoading ? '...' : `${formatLC(totalRemaining)} / ${formatLC(totalInitial)} ${LC.unit}`}
                            </p>
                            <div className="usage-overall-progress">
                                <div 
                                    className="usage-overall-progress-fill" 
                                    style={{ width: `${overallProgress}%` }}
                                ></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="usage-secondary-grid">
                    <div className="usage-credit-card usage-credit-card--mini">
                        <div className="usage-credit-card__icon">
                            <Database size={16} />
                        </div>
                        <div className="usage-credit-card__content">
                            <span className="usage-credit-card__label">Cycle Usage</span>
                            <p className="usage-credit-card__value">
                                {creditsLoading ? '...' : `${formatLC(billingCycleUsage)} ${LC.unit}`}
                            </p>
                        </div>
                    </div>

                    {customerPortalUrl && subscriptionPlan !== 'free' && (
                        <a href={customerPortalUrl} target="_blank" rel="noopener noreferrer" className="usage-portal-link">
                            <span>Manage Subscriptions →</span>
                        </a>
                    )}
                </div>
            </div>

            {ledgers && ledgers.length > 0 && (
                <div className="usage-ledgers-section">
                    <div className="usage-section-header">
                        <h2>Active Credit Quotas</h2>
                        <p>Credits are consumed from the oldest quota first (FIFO) to ensure no tokens are wasted.</p>
                    </div>
                    <div className="usage-ledgers-list">
                        {ledgers.map((ledger, index) => {
                            const isCurrent = index === 0;
                            const progress = (ledger.remaining_amount / ledger.initial_amount) * 100;
                            
                            return (
                                <div key={ledger.id} className={`usage-ledger-card ${isCurrent ? 'usage-ledger-card--active' : ''}`}>
                                    <div className="usage-ledger-card__main">
                                        <div className="usage-ledger-card__info">
                                            <div className="usage-ledger-card__title">
                                                <span className={`usage-priority-badge ${isCurrent ? 'usage-priority-badge--active' : ''}`}>
                                                    {isCurrent ? 'Currently Using' : `Priority #${index + 1}`}
                                                </span>
                                                <strong>{planLabel(ledger.plan_name as any)} Package</strong>
                                            </div>
                                            <p className="usage-ledger-card__subtext">
                                                {ledger.subscription_id ? `Subscription ID: ${ledger.subscription_id}` : 'Bonus Package'}
                                            </p>
                                        </div>
                                        <div className="usage-ledger-card__stats">
                                            <span className="usage-ledger-card__amount">
                                                {formatLC(ledger.remaining_amount)} / {formatLC(ledger.initial_amount)} {LC.unit}
                                            </span>
                                            <span className="usage-ledger-card__expiry">
                                                Ends {new Date(ledger.expires_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="usage-ledger-card__progress-wrap">
                                        <div className="usage-ledger-card__progress-bar">
                                            <div 
                                                className="usage-ledger-card__progress-fill" 
                                                style={{ width: `${progress}%` }}
                                            ></div>
                                        </div>
                                        <span className="usage-ledger-card__percentage">{Math.round(progress)}%</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="usage-logs-section">
                <div className="usage-logs-header">
                    <h2>Last 10 Requests</h2>
                    <span>Usage breakdown (Text / Image / Web)</span>
                </div>

                {isLoading ? (
                    <div className="usage-logs-state">Loading usage logs...</div>
                ) : error ? (
                    <div className="usage-logs-state usage-logs-state--error">Error: {error}</div>
                ) : logs.length === 0 ? (
                    <div className="usage-logs-state">No requests found. Start chatting to see your usage.</div>
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
