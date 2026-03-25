import React, { useState } from 'react';
import {
    Plus,
    Trash2,
    Edit3,
    Check,
    X,
    MessageSquare,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Terminal
} from 'lucide-react';
import { useChatStore } from '../store/chatStore';
import { useUIStore } from '../store/uiStore';
import { useCreditsStore } from '../store/creditsStore';
import { useAuthStore } from '../store/authStore';
import { isAdminUser } from '../config/admin';

const Sidebar: React.FC = () => {
    const {
        conversations,
        activeConversationId,
        createConversation,
        deleteConversation,
        renameConversation,
        setActiveConversation,
        isLoading: chatsLoading,
    } = useChatStore();

    const {
        sidebarCollapsed,
        toggleSidebar,
        sidebarWidth,
        setSidebarWidth,
        isAdminView,
        setIsAdminView,
    } = useUIStore();
    const { remainingCredits, isLoading: creditsLoading } = useCreditsStore();
    const { user } = useAuthStore();
    const isAdmin = isAdminUser(user?.email);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [isResizing, setIsResizing] = useState(false);

    const isMobile = () => window.innerWidth <= 768;

    const handleNewChat = () => {
        createConversation();
        if (isMobile() && !sidebarCollapsed) toggleSidebar();
    };

    const startRename = (id: string, currentTitle: string) => {
        setEditingId(id);
        setEditTitle(currentTitle);
    };

    const confirmRename = (id: string) => {
        if (editTitle.trim()) {
            renameConversation(id, editTitle.trim());
        }
        setEditingId(null);
    };

    const handleDelete = (id: string) => {
        if (deleteConfirm === id) {
            deleteConversation(id);
            setDeleteConfirm(null);
        } else {
            setDeleteConfirm(id);
            setTimeout(() => setDeleteConfirm(null), 3000);
        }
    };

    const handleResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
        const startX = e.clientX;
        const startWidth = sidebarWidth;

        const handleMouseMove = (e: MouseEvent) => {
            const delta = e.clientX - startX;
            setSidebarWidth(startWidth + delta);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) return 'Today';
        if (days === 1) return 'Yesterday';
        if (days < 7) return `${days} days ago`;
        return date.toLocaleDateString();
    };

    if (sidebarCollapsed) {
        return (
            <div className="sidebar sidebar-collapsed">
                <button className="sidebar-toggle-btn" onClick={toggleSidebar} title="Expand sidebar">
                    <ChevronRight size={18} />
                </button>
                <button className="sidebar-icon-btn" onClick={handleNewChat} title="New chat">
                    <Plus size={18} />
                </button>
            </div>
        );
    }

    return (
        <div className="sidebar" style={{ width: sidebarWidth }}>
            <div className="sidebar-header">
                <button className="sidebar-toggle-btn" onClick={toggleSidebar} title="Collapse sidebar">
                    <ChevronLeft size={18} />
                </button>
                <button className="new-chat-btn" onClick={() => {
                    setIsAdminView(false);
                    createConversation();
                    if (isMobile() && !sidebarCollapsed) toggleSidebar();
                }}>
                    <Plus size={16} />
                    <span>New Chat</span>
                </button>
            </div>

            <div className="sidebar-chat-list">
                {chatsLoading ? (
                    <div className="sidebar-chat-skeleton-container" style={{ padding: '0 12px' }}>
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="chat-item-skeleton" style={{ height: '38px', borderRadius: 'var(--r-md)', background: 'var(--bg-muted)', opacity: 0.6, marginBottom: '8px', animation: 'pulse 1.5s infinite ease-in-out' }} />
                        ))}
                    </div>
                ) : conversations.length === 0 ? (
                    <div className="sidebar-empty">
                        <MessageSquare size={24} />
                        <p>No conversations yet</p>
                    </div>
                ) : (
                    conversations.map((conv) => (
                        <div
                            key={conv.id}
                            className={`sidebar-chat-item ${conv.id === activeConversationId && !isAdminView ? 'active' : ''
                                }`}
                            onClick={() => {
                                setIsAdminView(false);
                                setActiveConversation(conv.id);
                                if (isMobile() && !sidebarCollapsed) toggleSidebar();
                            }}
                        >
                            {editingId === conv.id ? (
                                <div className="chat-item-edit">
                                    <input
                                        type="text"
                                        value={editTitle}
                                        onChange={(e) => setEditTitle(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') confirmRename(conv.id);
                                            if (e.key === 'Escape') setEditingId(null);
                                        }}
                                        autoFocus
                                        className="chat-item-edit-input"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <button
                                        className="chat-item-action-btn confirm-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            confirmRename(conv.id);
                                        }}
                                    >
                                        <Check size={14} />
                                    </button>
                                    <button
                                        className="chat-item-action-btn cancel-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingId(null);
                                        }}
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <div className="chat-item-info">
                                        <MessageSquare size={14} />
                                        <span className="chat-item-title">{conv.title}</span>
                                    </div>
                                    <span className="chat-item-date">{formatDate(conv.updatedAt)}</span>
                                    <div className="chat-item-actions">
                                        <button
                                            className="chat-item-action-btn"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                startRename(conv.id, conv.title);
                                            }}
                                            title="Rename"
                                        >
                                            <Edit3 size={13} />
                                        </button>
                                        <button
                                            className={`chat-item-action-btn ${deleteConfirm === conv.id ? 'delete-confirm' : ''
                                                }`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDelete(conv.id);
                                            }}
                                            title={deleteConfirm === conv.id ? 'Click again to confirm' : 'Delete'}
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Admin Dashboard Access */}
            {!sidebarCollapsed && isAdmin && (
                <div
                    className={`sidebar-admin-link ${isAdminView ? 'active' : ''}`}
                    onClick={() => {
                        setIsAdminView(true);
                        if (isMobile() && !sidebarCollapsed) toggleSidebar();
                    }}
                    title="System Mission Control"
                >
                    <Terminal size={16} />
                    <span>Mission Control</span>
                </div>
            )}

            {/* Token / Credit Visualizer */}
            {!sidebarCollapsed && user && (
                <div className="sidebar-credits-block" onClick={() => {/* Future Dashboard/Upgrade */ }}>
                    <div className="sidebar-credits-info">
                        <span className="sidebar-credits-label">Your Balance</span>
                        <div className="sidebar-credits-amount">
                            {creditsLoading ? <Loader2 size={14} className="auth-spinner" style={{ opacity: 0.5 }} /> : (
                                <>
                                    <span>{remainingCredits.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                    <span className="sidebar-credits-unit">CR</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Resize handle */}
            <div
                className={`sidebar-resize-handle ${isResizing ? 'resizing' : ''}`}
                onMouseDown={handleResizeStart}
            />
        </div>
    );
};

export default Sidebar;
