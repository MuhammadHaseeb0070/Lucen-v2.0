import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useUIStore } from '../store/uiStore';
import { isAdminUser } from '../config/admin';
import {
    Activity, Database, ShieldAlert,
    Users, MessageSquare, CreditCard, TrendingUp,
    RefreshCw, Search, Filter, MoreVertical
} from 'lucide-react';
import './OwnerDashboard.css';

interface UsageLog {
    id: string;
    user_id: string;
    conversation_id?: string;
    message_id?: string;
    prompt_tokens: number;
    completion_tokens: number;
    reasoning_tokens: number;
    image_tokens: number;
    file_tokens: number;
    total_credits_deducted: number;
    created_at: string;
    users?: { email: string };
}

interface UserCreditInfo {
    user_id: string;
    email: string;
    remaining_credits: number;
    subscription_status: string;
    created_at: string;
}

const OwnerDashboard: React.FC = () => {
    const { user: currentUser } = useAuthStore();
    const { setIsAdminView } = useUIStore();

    const [logs, setLogs] = useState<UsageLog[]>([]);
    const [users, setUsers] = useState<UserCreditInfo[]>([]);
    const [stats, setStats] = useState({
        totalTokens: 0,
        totalCredits: 0,
        totalUsers: 0,
        totalMessages: 0
    });

    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'analytics' | 'users' | 'health'>('analytics');
    const [error, setError] = useState<string | null>(null);

    const isAdmin = isAdminUser(currentUser?.email);

    useEffect(() => {
        if (!isAdmin) return;
        fetchDashboardData();
    }, [isAdmin]);

    const fetchDashboardData = async () => {
        if (!supabase) return;
        setIsLoading(true);
        setError(null);

        try {
            // 1. Fetch Stats & Logs
            const { data: usageData, error: usageError } = await supabase
                .from('usage_logs')
                .select('*, users:user_id(email)')
                .order('created_at', { ascending: false })
                .limit(100);

            if (usageError) throw usageError;

            // 2. Fetch User Management Data
            // Note: We join with user_credits to see their balance
            const { data: userData, error: userError } = await supabase
                .from('user_credits')
                .select('*, users:user_id(email, created_at)');

            if (userError) throw userError;

            // 3. System Totals (Simplified for MVP, would usually be a RPC call)
            const totalTokens = (usageData as UsageLog[] || []).reduce((s, l) => s + l.prompt_tokens + l.completion_tokens, 0);
            const totalCredits = (usageData as UsageLog[] || []).reduce((s, l) => s + l.total_credits_deducted, 0);

            setLogs(usageData as UsageLog[] || []);
            setUsers((userData || []).map(u => ({
                user_id: u.user_id,
                email: u.users?.email || 'Unknown',
                remaining_credits: u.remaining_credits,
                subscription_status: u.subscription_status,
                created_at: u.users?.created_at || new Date().toISOString()
            })));

            setStats({
                totalTokens,
                totalCredits,
                totalUsers: userData?.length || 0,
                totalMessages: usageData?.length || 0
            });

        } catch (err: any) {
            console.error('Owner Dashboard Load Error:', err);
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isAdmin) {
        return (
            <div className="admin-denied">
                <ShieldAlert size={48} className="denied-icon" />
                <h2>Access Restricted</h2>
                <p>Mission Control is reserved for system owners only.</p>
                <button onClick={() => setIsAdminView(false)} className="return-btn">Return to Chat</button>
            </div>
        );
    }

    return (
        <div className="owner-dashboard">
            {/* Header Area */}
            <header className="owner-header">
                <div className="header-left">
                    <div className="mission-badge">MISSION CONTROL v1.0</div>
                    <h1>Overview & Analytics</h1>
                </div>
                <div className="header-actions">
                    <button onClick={fetchDashboardData} className="refresh-btn" disabled={isLoading}>
                        <RefreshCw size={16} className={isLoading ? 'spinning' : ''} />
                        <span>Sync Database</span>
                    </button>
                    <button onClick={() => setIsAdminView(false)} className="exit-btn">
                        Go to Chat
                    </button>
                    <div className="admin-profile">
                        <div className="admin-avatar">A</div>
                        <div className="admin-meta">
                            <span className="admin-name">Owner</span>
                            <span className="admin-status">Online</span>
                        </div>
                    </div>
                </div>
            </header>

            {/* Top Level Stats */}
            <div className="stats-grid">
                <div className="stat-card glass">
                    <div className="stat-icon-wrapper blue"><TrendingUp size={20} /></div>
                    <div className="stat-content">
                        <span className="stat-label">System Tokens</span>
                        <div className="stat-value">{stats.totalTokens.toLocaleString()}</div>
                        <div className="stat-change positive">+12% from yesterday</div>
                    </div>
                </div>
                <div className="stat-card glass">
                    <div className="stat-icon-wrapper purple"><CreditCard size={20} /></div>
                    <div className="stat-content">
                        <span className="stat-label">Total Gained (Credits)</span>
                        <div className="stat-value">{stats.totalCredits.toFixed(2)} CR</div>
                        <div className="stat-change negative">-5% vs. avg</div>
                    </div>
                </div>
                <div className="stat-card glass">
                    <div className="stat-icon-wrapper green"><Users size={20} /></div>
                    <div className="stat-content">
                        <span className="stat-label">Active Users</span>
                        <div className="stat-value">{stats.totalUsers}</div>
                        <div className="stat-change positive">Healthy traffic</div>
                    </div>
                </div>
                <div className="stat-card glass">
                    <div className="stat-icon-wrapper orange"><MessageSquare size={20} /></div>
                    <div className="stat-content">
                        <span className="stat-label">Conversations</span>
                        <div className="stat-value">{stats.totalMessages}</div>
                        <div className="stat-change">Live events</div>
                    </div>
                </div>
            </div>

            {/* Dashboard Navigation */}
            <nav className="dashboard-nav">
                <button
                    className={`nav-item ${activeTab === 'analytics' ? 'active' : ''}`}
                    onClick={() => setActiveTab('analytics')}
                >
                    <Activity size={16} /> Usage Analytics
                </button>
                <button
                    className={`nav-item ${activeTab === 'users' ? 'active' : ''}`}
                    onClick={() => setActiveTab('users')}
                >
                    <Users size={16} /> User Management
                </button>
                <button
                    className={`nav-item ${activeTab === 'health' ? 'active' : ''}`}
                    onClick={() => setActiveTab('health')}
                >
                    <Database size={16} /> Database Health
                </button>
            </nav>

            {/* Main Content Area */}
            <main className="dashboard-main glass">
                {isLoading ? (
                    <div className="dashboard-loading">
                        <LoaderIcon />
                        <p>Querying Supabase Schema...</p>
                    </div>
                ) : error ? (
                    <div className="dashboard-error">
                        <ShieldAlert size={40} />
                        <h3>Sync Failed</h3>
                        <p>{error}</p>
                        <code>Likely missing migrations on this project.</code>
                    </div>
                ) : (
                    <>
                        {activeTab === 'analytics' && <AnalyticsLogs logs={logs} />}
                        {activeTab === 'users' && <UserTable users={users} />}
                        {activeTab === 'health' && <HealthOverview stats={stats} />}
                    </>
                )}
            </main>
        </div>
    );
};

// ─── Sub-Components ───

const AnalyticsLogs: React.FC<{ logs: UsageLog[] }> = ({ logs }) => (
    <div className="tab-pane">
        <div className="pane-header">
            <h3>Recent API Events</h3>
            <div className="pane-tools">
                <Search size={14} className="icon-fade" />
                <Filter size={14} className="icon-fade" />
            </div>
        </div>
        <div className="table-container">
            <table className="owner-table">
                <thead>
                    <tr>
                        <th>Timestamp</th>
                        <th>User</th>
                        <th>Tokens (I/O)</th>
                        <th>Reasoning</th>
                        <th>Cost</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    {logs.map(log => (
                        <tr key={log.id}>
                            <td>{new Date(log.created_at).toLocaleTimeString()}</td>
                            <td className="email-cell">{log.users?.email || 'Anon'}</td>
                            <td>{log.prompt_tokens}/{log.completion_tokens}</td>
                            <td className={log.reasoning_tokens > 0 ? 'reasoning-hl' : ''}>
                                {log.reasoning_tokens.toLocaleString()}
                            </td>
                            <td className="cost-cell">-{log.total_credits_deducted.toFixed(4)}</td>
                            <td><span className="badge-success">Success</span></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

const UserTable: React.FC<{ users: UserCreditInfo[] }> = ({ users }) => (
    <div className="tab-pane">
        <div className="pane-header">
            <h3>Registered Customers</h3>
        </div>
        <div className="table-container">
            <table className="owner-table">
                <thead>
                    <tr>
                        <th>Joined</th>
                        <th>Email Address</th>
                        <th>Balance</th>
                        <th>Tier</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {users.map(u => (
                        <tr key={u.user_id}>
                            <td>{new Date(u.created_at).toLocaleDateString()}</td>
                            <td className="email-cell">{u.email}</td>
                            <td>{u.remaining_credits.toLocaleString()} CR</td>
                            <td>
                                <span className={`badge-tier ${u.subscription_status}`}>
                                    {u.subscription_status.toUpperCase()}
                                </span>
                            </td>
                            <td><button className="icon-btn"><MoreVertical size={14} /></button></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

const HealthOverview: React.FC<{ stats: any }> = ({ stats }) => (
    <div className="tab-pane">
        <div className="pane-header">
            <h3>Live Health Status</h3>
        </div>
        <div className="health-grid">
            <div className="health-card">
                <h4>Conversations</h4>
                <div className="health-value">{stats.totalMessages}</div>
                <div className="health-status-bar"><div className="fill" style={{ width: '85%' }} /></div>
            </div>
            <div className="health-card">
                <h4>Connection Latency</h4>
                <div className="health-value">142ms</div>
                <div className="health-status-bar"><div className="fill" style={{ width: '95%' }} /></div>
            </div>
            <div className="health-card">
                <h4>Database Objects</h4>
                <div className="health-value">12 Tables</div>
                <div className="health-status-bar"><div className="fill" style={{ width: '100%' }} /></div>
            </div>
        </div>
    </div>
);

const LoaderIcon = () => (
    <div className="dashboard-spinner">
        <RefreshCw size={32} className="spinning" />
    </div>
);

export default OwnerDashboard;
