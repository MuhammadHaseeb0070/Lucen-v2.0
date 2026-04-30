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
    Terminal,
    FolderOpen,
    Sparkles,
    Search,
    Loader2
} from 'lucide-react';
import { useChatStore } from '../store/chatStore';
import { useUIStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import { isAdminUser } from '../config/admin';
import { useArtifactStore } from '../store/artifactStore';

const Sidebar: React.FC = () => {
    const {
        conversations,
        activeConversationId,
        createConversation,
        deleteConversation,
        renameConversation,
        setActiveConversation,
        isLoading: chatsLoading,
        searchQuery,
        setSearchQuery,
        searchResults,
        isSearching,
        searchError,
        performSearch,
    } = useChatStore();

    const {
        sidebarCollapsed,
        toggleSidebar,
        sidebarWidth,
        setSidebarWidth,
        isAdminView,
        setIsAdminView,
        fileLibraryOpen,
        setFileLibraryOpen,
    } = useUIStore();
    const { user } = useAuthStore();
    const isAdmin = isAdminUser(user?.email);
    const { artifactHubOpen, setArtifactHubOpen } = useArtifactStore();

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [isResizing, setIsResizing] = useState(false);

    React.useEffect(() => {
        const handler = setTimeout(() => {
            if (searchQuery.trim()) {
                performSearch();
            }
        }, 500); // 500ms debounce
        return () => clearTimeout(handler);
    }, [searchQuery, performSearch]);

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

            <div className="sidebar-search-container" style={{ padding: '0 12px 12px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <Search size={14} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)' }} />
                    <input
                        type="text"
                        placeholder="Search chats..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '8px 12px 8px 32px',
                            borderRadius: 'var(--r-md)',
                            border: '1px solid var(--border-subtle)',
                            background: 'var(--bg-muted)',
                            color: 'var(--text-primary)',
                            fontSize: '13px',
                            outline: 'none',
                            transition: 'border-color 0.2s',
                        }}
                        onFocus={(e) => e.target.style.borderColor = 'var(--brand-primary)'}
                        onBlur={(e) => e.target.style.borderColor = 'var(--border-subtle)'}
                    />
                    {searchQuery && (
                        <button 
                            onClick={() => setSearchQuery('')}
                            style={{ position: 'absolute', right: '10px', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            title="Clear search"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            <div className="sidebar-chat-list">
                {chatsLoading ? (
                    <div className="sidebar-chat-skeleton-container" style={{ padding: '0 12px' }}>
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="chat-item-skeleton" style={{ height: '38px', borderRadius: 'var(--r-md)', background: 'var(--bg-muted)', opacity: 0.6, marginBottom: '8px', animation: 'pulse 1.5s infinite ease-in-out' }} />
                        ))}
                    </div>
                ) : searchQuery.trim() ? (
                    // ─── SEARCH RESULTS VIEW ───
                    isSearching ? (
                        <div className="sidebar-empty" style={{ opacity: 0.7 }}>
                            <Loader2 size={24} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
                            <p style={{ marginTop: '12px' }}>Searching chats...</p>
                        </div>
                    ) : searchError ? (
                        <div className="sidebar-empty" style={{ color: 'var(--danger)' }}>
                            <X size={24} />
                            <p style={{ marginTop: '12px', textAlign: 'center', padding: '0 12px' }}>{searchError}</p>
                        </div>
                    ) : searchResults && searchResults.length === 0 ? (
                        <div className="sidebar-empty">
                            <Search size={24} />
                            <p style={{ marginTop: '12px' }}>No matching chats found.</p>
                        </div>
                    ) : (
                        searchResults?.map((res) => (
                            <div
                                key={res.conversationId}
                                className={`sidebar-chat-item ${res.conversationId === activeConversationId && !isAdminView ? 'active' : ''}`}
                                onClick={() => {
                                    setIsAdminView(false);
                                    setActiveConversation(res.conversationId);
                                    if (isMobile() && !sidebarCollapsed) toggleSidebar();
                                }}
                                style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '10px 12px', gap: '4px' }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                    <div className="chat-item-info">
                                        <MessageSquare size={14} />
                                        <span className="chat-item-title" title={res.title} style={{ fontWeight: 500 }}>{res.title}</span>
                                    </div>
                                    <span className="chat-item-date" style={{ fontSize: '11px' }}>{formatDate(res.updatedAt)}</span>
                                </div>
                                {res.matchExcerpt && (
                                    <div 
                                        style={{ fontSize: '12px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', width: '100%', lineHeight: 1.4 }}
                                        dangerouslySetInnerHTML={{ __html: res.matchExcerpt.replace(/<b/g, '<b style="color:var(--text-primary)"') }} 
                                    />
                                )}
                            </div>
                        ))
                    )
                ) : conversations.length === 0 ? (
                    // ─── NORMAL EMPTY VIEW ───
                    <div className="sidebar-empty">
                        <MessageSquare size={24} />
                        <p>No conversations yet</p>
                    </div>
                ) : (
                    // ─── NORMAL LIST VIEW ───
                    [...conversations]
                        .sort((a, b) => b.updatedAt - a.updatedAt)
                        .map((conv) => (
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
                                        <span className="chat-item-title" title={conv.title}>{conv.title}</span>
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

            {/* File Library Access */}
            {!sidebarCollapsed && (
                <div
                    className={`sidebar-admin-link ${fileLibraryOpen ? 'active' : ''}`}
                    onClick={() => {
                        setFileLibraryOpen(true);
                        if (isMobile() && !sidebarCollapsed) toggleSidebar();
                    }}
                    style={{ marginTop: isAdmin && !isAdminView ? '8px' : 'auto', borderTop: isAdmin && !isAdminView ? 'none' : '1px solid var(--border-subtle)', paddingTop: isAdmin && !isAdminView ? '0' : '12px' }}
                    title="Browse your file history"
                >
                    <FolderOpen size={16} />
                    <span>File Library</span>
                </div>
            )}

            {/* Artifact Hub Access */}
            {!sidebarCollapsed && (
                <div
                    className={`sidebar-admin-link sidebar-hub-link ${artifactHubOpen ? 'active' : ''}`}
                    onClick={() => {
                        setArtifactHubOpen(true);
                        if (isMobile() && !sidebarCollapsed) toggleSidebar();
                    }}
                    title="Browse & publish artifacts"
                >
                    <Sparkles size={16} />
                    <span>Artifact Hub</span>
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
