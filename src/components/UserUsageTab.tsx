import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useCreditsStore } from '../store/creditsStore';
import { planLabel, LC, formatLC } from '../config/subscriptionConfig';
import { Database, CheckCircle2, AlertTriangle, XCircle, RotateCw, ChevronDown, ChevronRight } from 'lucide-react';
import './UserUsageTab.css';

type UsageStatus =
    | 'completed'
    | 'truncated'
    | 'aborted'
    | 'upstream_error'
    | 'timeout'
    | 'auth_error'
    | 'insufficient_credits'
    | 'client_error';

type UsageCallKind =
    | 'chat'
    | 'chat_continuation'
    | 'classify_intent'
    | 'embed'
    | 'retrieve'
    | 'describe_image'
    | 'web_search'
    | 'title_gen';

interface UsageLog {
    id: string;
    conversation_id?: string | null;
    message_id?: string | null;
    prompt_tokens: number;
    completion_tokens: number;
    reasoning_tokens: number;
    image_tokens: number;
    file_tokens: number;
    total_credits_deducted: number;
    model_id?: string | null;
    provider?: string | null;
    web_search_enabled?: boolean | null;
    web_search_engine?: string | null;
    web_search_max_results?: number | null;
    web_search_results_billed?: number | null;
    text_credits?: number | null;
    image_credits?: number | null;
    web_search_credits?: number | null;
    status?: UsageStatus | null;
    status_reason?: string | null;
    error_message?: string | null;
    call_kind?: UsageCallKind | null;
    request_id?: string | null;
    parent_request_id?: string | null;
    duration_ms?: number | null;
    usd_cost?: number | null;
    created_at: string;
}

type FilterChip = 'all' | 'chat' | 'background' | 'web_search' | 'errors';

const CALL_KIND_LABELS: Record<UsageCallKind, string> = {
    chat: 'Chat',
    chat_continuation: 'Chat (cont.)',
    classify_intent: 'Intent',
    embed: 'Embed',
    retrieve: 'RAG',
    describe_image: 'Vision',
    web_search: 'Web',
    title_gen: 'Title',
};

function statusBadge(status: UsageStatus | null | undefined): {
    icon: React.ReactNode;
    label: string;
    className: string;
} {
    switch (status) {
        case 'completed':
            return { icon: <CheckCircle2 size={14} />, label: 'Completed', className: 'usage-status--ok' };
        case 'truncated':
            return { icon: <AlertTriangle size={14} />, label: 'Truncated', className: 'usage-status--warn' };
        case 'aborted':
            return { icon: <RotateCw size={14} />, label: 'Aborted', className: 'usage-status--warn' };
        case 'upstream_error':
            return { icon: <XCircle size={14} />, label: 'Upstream error', className: 'usage-status--err' };
        case 'timeout':
            return { icon: <XCircle size={14} />, label: 'Timeout', className: 'usage-status--err' };
        case 'auth_error':
            return { icon: <XCircle size={14} />, label: 'Auth error', className: 'usage-status--err' };
        case 'insufficient_credits':
            return { icon: <XCircle size={14} />, label: 'No credits', className: 'usage-status--err' };
        case 'client_error':
            return { icon: <XCircle size={14} />, label: 'Client error', className: 'usage-status--err' };
        default:
            return { icon: <CheckCircle2 size={14} />, label: 'Completed', className: 'usage-status--ok' };
    }
}

function callKindTooltip(kind: UsageCallKind | null | undefined): string {
    switch (kind) {
        case 'chat': return 'Main conversation stream';
        case 'chat_continuation': return 'Automatic continuation of a truncated response';
        case 'classify_intent': return 'Decided whether this turn should do a web search';
        case 'embed': return 'Generated embeddings for uploaded file chunks';
        case 'retrieve': return 'Retrieved relevant file chunks for this turn';
        case 'describe_image': return 'Vision helper described an attached image';
        case 'web_search': return 'Tavily/OpenRouter web search';
        case 'title_gen': return 'Auto-generated conversation title';
        default: return '';
    }
}

function formatDuration(ms: number | null | undefined): string {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function formatUsd(cost: number | null | undefined): string {
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost === 0) return '—';
    if (cost < 0.0001) return '<$0.0001';
    return `$${cost.toFixed(cost < 0.01 ? 5 : 4)}`;
}

const UserUsageTab: React.FC = () => {
    const { user } = useAuthStore();
    const { billingCycleUsage, isLoading: creditsLoading, customerPortalUrl, subscriptionPlan, ledgers } = useCreditsStore();
    const [logs, setLogs] = useState<UsageLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<FilterChip>('all');
    const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

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
                const { data, error } = await supabase
                    .from('usage_logs')
                    .select('*')
                    .eq('user_id', user.id)
                    .order('created_at', { ascending: false })
                    .limit(100);

                if (error) throw error;
                setLogs((data as UsageLog[]) || []);
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

    // Filter chips
    const filteredLogs = useMemo(() => {
        switch (filter) {
            case 'chat':
                return logs.filter(l => l.call_kind === 'chat' || l.call_kind === 'chat_continuation');
            case 'background':
                return logs.filter(l => l.call_kind === 'classify_intent' || l.call_kind === 'embed' || l.call_kind === 'retrieve' || l.call_kind === 'title_gen' || l.call_kind === 'describe_image');
            case 'web_search':
                return logs.filter(l => l.call_kind === 'web_search');
            case 'errors':
                return logs.filter(l => {
                    const s = l.status;
                    return s === 'upstream_error' || s === 'timeout' || s === 'auth_error' || s === 'insufficient_credits' || s === 'client_error' || s === 'aborted' || s === 'truncated';
                });
            case 'all':
            default:
                return logs;
        }
    }, [logs, filter]);

    // Group continuation chunks under their parent.
    // Strategy: rows are sorted newest-first. We keep the ordering but
    // when a row has a parent_request_id whose parent IS IN the list,
    // we collapse it under that parent. Orphan continuations (parent
    // missing from current page) still show as top-level.
    const { topRows, childrenByParent } = useMemo(() => {
        const byRequestId = new Map<string, UsageLog>();
        for (const row of filteredLogs) {
            if (row.request_id) byRequestId.set(row.request_id, row);
        }
        const children = new Map<string, UsageLog[]>();
        const top: UsageLog[] = [];
        for (const row of filteredLogs) {
            const pid = row.parent_request_id;
            if (pid && byRequestId.has(pid) && pid !== row.request_id) {
                const arr = children.get(pid) || [];
                arr.push(row);
                children.set(pid, arr);
            } else {
                top.push(row);
            }
        }
        for (const arr of children.values()) {
            arr.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
        }
        return { topRows: top, childrenByParent: children };
    }, [filteredLogs]);

    const toggleParent = (requestId: string) => {
        setExpandedParents(prev => {
            const next = new Set(prev);
            if (next.has(requestId)) next.delete(requestId);
            else next.add(requestId);
            return next;
        });
    };

    const renderRow = (log: UsageLog, isChild = false): React.ReactNode => {
        const badge = statusBadge(log.status);
        const kind = log.call_kind ?? 'chat';
        const kindLabel = CALL_KIND_LABELS[kind] ?? kind;
        const children = log.request_id ? childrenByParent.get(log.request_id) : undefined;
        const hasChildren = !!children && children.length > 0;
        const isExpanded = log.request_id ? expandedParents.has(log.request_id) : false;

        return (
            <React.Fragment key={log.id}>
                <tr className={isChild ? 'usage-row--child' : ''}>
                    <td>
                        {hasChildren && (
                            <button
                                type="button"
                                className="usage-expand-btn"
                                onClick={() => log.request_id && toggleParent(log.request_id)}
                                title={isExpanded ? 'Collapse continuation chunks' : `Show ${children!.length} continuation chunk(s)`}
                            >
                                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                        )}
                        {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td>
                        <span className={`usage-status-badge ${badge.className}`} title={log.status_reason || log.error_message || badge.label}>
                            {badge.icon}
                            <span>{badge.label}</span>
                        </span>
                    </td>
                    <td>
                        <span className="usage-kind-badge" title={callKindTooltip(kind)}>
                            {isChild ? `↳ ${kindLabel}` : kindLabel}
                        </span>
                    </td>
                    <td className="usage-table__model" title={String(log.model_id || '')}>
                        {String(log.model_id || '—').split('/').pop()}
                    </td>
                    <td>{toNumber(log.prompt_tokens).toLocaleString()}</td>
                    <td>{toNumber(log.completion_tokens).toLocaleString()}</td>
                    <td className={toNumber(log.reasoning_tokens) > 0 ? 'usage-table__reasoning' : ''}>
                        {toNumber(log.reasoning_tokens).toLocaleString()}
                    </td>
                    <td>{formatDuration(log.duration_ms)}</td>
                    <td className="usage-table__credits" title="Real provider USD cost">
                        {formatUsd(log.usd_cost)}
                    </td>
                    <td className="usage-table__credits usage-table__credits--total">
                        -{toNumber(log.total_credits_deducted).toFixed(4)}
                    </td>
                </tr>
                {hasChildren && isExpanded && children!.map(child => renderRow(child, true))}
            </React.Fragment>
        );
    };

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
                    <h2>Recent AI Requests</h2>
                    <span>Every call the app makes — including background helpers and errors</span>
                </div>

                <div className="usage-filter-chips">
                    {([
                        { id: 'all', label: 'All' },
                        { id: 'chat', label: 'Chat' },
                        { id: 'background', label: 'Background' },
                        { id: 'web_search', label: 'Web Search' },
                        { id: 'errors', label: 'Errors' },
                    ] as Array<{ id: FilterChip; label: string }>).map(chip => (
                        <button
                            key={chip.id}
                            type="button"
                            className={`usage-filter-chip ${filter === chip.id ? 'usage-filter-chip--active' : ''}`}
                            onClick={() => setFilter(chip.id)}
                        >
                            {chip.label}
                        </button>
                    ))}
                </div>

                {isLoading ? (
                    <div className="usage-logs-state">Loading usage logs...</div>
                ) : error ? (
                    <div className="usage-logs-state usage-logs-state--error">Error: {error}</div>
                ) : topRows.length === 0 ? (
                    <div className="usage-logs-state">No requests found for this filter.</div>
                ) : (
                    <div className="usage-table-wrap">
                        <table className="usage-table">
                            <thead>
                                <tr>
                                    <th>Timestamp</th>
                                    <th>Status</th>
                                    <th>Type</th>
                                    <th>Model</th>
                                    <th>Input</th>
                                    <th>Output</th>
                                    <th>Reasoning</th>
                                    <th>Duration</th>
                                    <th>USD Cost</th>
                                    <th>Total {LC.unit}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {topRows.map(log => renderRow(log, false))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default UserUsageTab;
