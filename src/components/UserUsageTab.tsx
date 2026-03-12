import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useCreditsStore } from '../store/creditsStore';
import { Activity, Database, Server, Hash } from 'lucide-react';
import './OwnerDashboard.css'; // Reusing the high-end Mission Control styles

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
    const { remainingCredits, isLoading: creditsLoading } = useCreditsStore();
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
                    .limit(100);

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

    const totalTokens = logs.reduce((sum, log) => sum + log.prompt_tokens + log.completion_tokens, 0);
    const totalReasoning = logs.reduce((sum, log) => sum + log.reasoning_tokens, 0);

    return (
        <div className="settings-tab-body" style={{ padding: '0 20px 20px', maxWidth: '100%', overflowX: 'auto' }}>
            <p className="settings-desc">Monitor your API token utilization and credit balance.</p>

            <div className="stats-grid" style={{ marginBottom: 24, marginTop: 16 }}>
                <div className="stat-card glass">
                    <div className="stat-icon-wrapper blue" style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Server size={20} />
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Tokens Used</span>
                        <p className="stat-value">{totalTokens.toLocaleString()}</p>
                    </div>
                </div>
                <div className="stat-card glass">
                    <div className="stat-icon-wrapper purple" style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Activity size={20} />
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Reasoning Tokens</span>
                        <p className="stat-value">{totalReasoning.toLocaleString()}</p>
                    </div>
                </div>
                <div className="stat-card glass" style={{ border: '1px solid var(--accent)' }}>
                    <div className="stat-icon-wrapper green" style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Database size={20} />
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Available Credits</span>
                        <p className="stat-value" style={{ color: 'var(--accent)' }}>
                            {creditsLoading ? '...' : remainingCredits.toLocaleString(undefined, { maximumFractionDigits: 0 })} CR
                        </p>
                    </div>
                </div>
            </div>

            <div className="admin-logs-section">
                <div className="logs-header" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>Recent Token Events</h2>
                    <span className="logs-count" style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Showing last 100 events</span>
                </div>

                {isLoading ? (
                    <div className="logs-loading">Loading usage logs...</div>
                ) : error ? (
                    <div className="logs-error">Error: {error}</div>
                ) : logs.length === 0 ? (
                    <div className="logs-empty" style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>No usage logs found. Start chatting to use tokens!</div>
                ) : (
                    <div className="table-container">
                        <table className="owner-table">
                            <thead>
                                <tr>
                                    <th>Timestamp</th>
                                    <th>Message ID</th>
                                    <th>Prompt Tokens</th>
                                    <th>Comp. Tokens</th>
                                    <th>Reasoning</th>
                                    <th>Cost (CR)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map(log => (
                                    <tr key={log.id}>
                                        <td>{new Date(log.created_at).toLocaleString()}</td>
                                        <td className="hash-id" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                                            <Hash size={10} /> {log.message_id ? log.message_id.substring(0, 8) : 'N/A'}
                                        </td>
                                        <td>{log.prompt_tokens.toLocaleString()}</td>
                                        <td>{log.completion_tokens.toLocaleString()}</td>
                                        <td className={log.reasoning_tokens > 0 ? 'reasoning-hl' : ''} style={log.reasoning_tokens > 0 ? { color: 'var(--accent)', fontWeight: 600 } : {}}>
                                            {log.reasoning_tokens.toLocaleString()}
                                        </td>
                                        <td className="cost-cell">-{log.total_credits_deducted.toFixed(4)}</td>
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
