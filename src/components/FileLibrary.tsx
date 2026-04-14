import React, { useEffect, useState, useMemo } from 'react';
import { 
    X, 
    FileText, 
    Image as ImageIcon, 
    FileCode, 
    Search, 
    Loader2, 
    Inbox,
    Eye,
    Calendar,
    MessageSquare,
    Grid,
    List,
    ArrowUpRight
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useUIStore } from '../store/uiStore';
import { useChatStore } from '../store/chatStore';

interface FileRecord {
    id: string;
    file_name: string;
    file_type: string;
    conversation_id: string;
    created_at: string;
    storage_path?: string;
    extracted_text?: string;
    ai_description?: string;
    message_id: string;
    conversations?: {
        title: string;
    };
}

const FileLibrary: React.FC = () => {
    const { 
        fileLibraryOpen, 
        setFileLibraryOpen, 
        setViewerOpen, 
        setViewerFile,
        setPendingMessageJumpId 
    } = useUIStore();
    const { user } = useAuthStore();
    const { setActiveConversation } = useChatStore();
    
    const [files, setFiles] = useState<FileRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'image' | 'text' | 'code'>('all');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

    useEffect(() => {
        if (fileLibraryOpen && user) {
            fetchFiles();
        }
    }, [fileLibraryOpen, user]);

    const fetchFiles = async () => {
        if (!supabase) return;
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('file_attachments')
                .select(`
                    id,
                    file_name,
                    file_type,
                    conversation_id,
                    created_at,
                    storage_path,
                    extracted_text,
                    ai_description,
                    message_id,
                    conversations (
                        title
                    )
                `)
                .eq('user_id', user?.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setFiles(data as unknown as FileRecord[]);
        } catch (err) {
            console.error('[FileLibrary] Error fetching files:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleNavigate = (convId: string, msgId?: string) => {
        setActiveConversation(convId);
        if (msgId) {
            setPendingMessageJumpId(msgId);
        }
        setFileLibraryOpen(false);
    };

    const handleView = (file: FileRecord) => {
        const url = file.storage_path && supabase ? 
            supabase.storage.from('attachments').getPublicUrl(file.storage_path).data.publicUrl : undefined;
            
        setViewerFile({
            id: file.id,
            name: file.file_name,
            type: file.file_type,
            url,
            textContent: file.extracted_text,
            aiDescription: file.ai_description
        });
        setViewerOpen(true);
    };

    const getFileIcon = (type: string) => {
        switch (type) {
            case 'image': return <ImageIcon size={20} />;
            case 'code': return <FileCode size={20} />;
            default: return <FileText size={20} />;
        }
    };

    const filteredFiles = useMemo(() => {
        return files.filter(f => {
            const matchesSearch = f.file_name.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesType = filterType === 'all' || f.file_type === filterType;
            return matchesSearch && matchesType;
        });
    }, [files, searchQuery, filterType]);

    if (!fileLibraryOpen) return null;

    return (
        <div className="file-lib-overlay" onClick={() => setFileLibraryOpen(false)}>
            <div className="file-lib-modal" onClick={e => e.stopPropagation()}>
                <div className="file-lib-header">
                    <div className="file-lib-title-group">
                        <div className="lib-icon-badge">
                            <Grid size={20} />
                        </div>
                        <div>
                            <h2>Assets & Library</h2>
                            <p>{files.length} items collected across chats</p>
                        </div>
                    </div>
                    
                    <div className="header-actions">
                        <div className="view-toggle">
                            <button 
                                className={viewMode === 'grid' ? 'active' : ''} 
                                onClick={() => setViewMode('grid')}
                            >
                                <Grid size={16} />
                            </button>
                            <button 
                                className={viewMode === 'list' ? 'active' : ''} 
                                onClick={() => setViewMode('list')}
                            >
                                <List size={16} />
                            </button>
                        </div>
                        <button className="close-btn" onClick={() => setFileLibraryOpen(false)}>
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="file-lib-toolbar">
                    <div className="search-box">
                        <Search size={18} />
                        <input 
                            type="text" 
                            placeholder="Find a file..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    
                    <div className="filter-group">
                        <button 
                            className={`filter-btn ${filterType === 'all' ? 'active' : ''}`}
                            onClick={() => setFilterType('all')}
                        >
                            All
                        </button>
                        <button 
                            className={`filter-btn ${filterType === 'image' ? 'active' : ''}`}
                            onClick={() => setFilterType('image')}
                        >
                            Images
                        </button>
                        <button 
                            className={`filter-btn ${filterType === 'text' ? 'active' : ''}`}
                            onClick={() => setFilterType('text')}
                        >
                            Documents
                        </button>
                    </div>
                </div>

                <div className="file-lib-viewport">
                    {loading ? (
                        <div className="lib-state-msg">
                            <Loader2 size={32} className="spin" />
                            <p>Loading your library...</p>
                        </div>
                    ) : filteredFiles.length === 0 ? (
                        <div className="lib-state-msg">
                            <Inbox size={48} />
                            <h3>Empty Library</h3>
                            <p>{searchQuery ? 'No matches found' : 'Upload files in chats to build your library'}</p>
                        </div>
                    ) : (
                        <div className={`file-content-container mode-${viewMode}`}>
                            {filteredFiles.map(file => {
                                const isImg = file.file_type === 'image';
                                const thumbUrl = isImg && file.storage_path && supabase ? 
                                    supabase.storage.from('attachments').getPublicUrl(file.storage_path).data.publicUrl : null;

                                return (
                                    <div key={file.id} className="lib-file-card">
                                        <div className="file-card-preview" onClick={() => handleView(file)}>
                                            {thumbUrl ? (
                                                <img src={thumbUrl} alt="" className="thumb-img" />
                                            ) : (
                                                <div className="type-placeholder">
                                                    {getFileIcon(file.file_type)}
                                                </div>
                                            )}
                                            <div className="card-overlay">
                                                <button className="quick-view-btn">
                                                    <Eye size={18} />
                                                    <span>View</span>
                                                </button>
                                            </div>
                                        </div>
                                        
                                        <div className="file-card-info">
                                            <div className="name-row">
                                                <span className="file-primary-name" title={file.file_name}>
                                                    {file.file_name}
                                                </span>
                                            </div>
                                            
                                            <div className="meta-grid">
                                                <div className="meta-item">
                                                    <Calendar size={12} />
                                                    <span>{new Date(file.created_at).toLocaleDateString()}</span>
                                                </div>
                                                <div className="meta-item clickable" onClick={() => handleNavigate(file.conversation_id, file.message_id)}>
                                                    <MessageSquare size={12} />
                                                    <span className="chat-link">{file.conversations?.title || 'Chat'}</span>
                                                    <ArrowUpRight size={12} className="jump-icon" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                :root {
                    --lib-f-scale: 1;
                    --lib-s-scale: 1;
                }

                @media (max-width: 640px) {
                    :root {
                        --lib-f-scale: 0.85;
                        --lib-s-scale: 0.9;
                    }
                }

                .file-lib-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.4);
                    backdrop-filter: blur(12px);
                    z-index: 1000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    animation: fadeIn 0.3s ease-out;
                }

                .file-lib-modal {
                    width: min(100%, 900px);
                    height: 85vh;
                    background: var(--bg-surface);
                    border: 1px solid var(--divider);
                    border-radius: calc(24px * var(--lib-s-scale));
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 30px 60px rgba(0,0,0,0.4);
                    overflow: hidden;
                    animation: scaleUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                }

                .file-lib-header {
                    padding: calc(24px * var(--lib-s-scale)) calc(32px * var(--lib-s-scale));
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid var(--divider);
                    background: rgba(255, 255, 255, 0.6);
                    backdrop-filter: blur(10px);
                }

                .file-lib-title-group {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                }

                .lib-icon-badge {
                    width: 44px;
                    height: 44px;
                    background: var(--accent-soft);
                    color: var(--accent);
                    border-radius: 14px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .file-lib-title-group h2 {
                    font-size: calc(1.25rem * var(--lib-f-scale));
                    font-weight: 700;
                    margin: 0;
                    color: var(--text-primary);
                }

                .file-lib-title-group p {
                    margin: 2px 0 0 0;
                    font-size: calc(0.82rem * var(--lib-f-scale));
                    color: var(--text-tertiary);
                }

                .header-actions {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                }

                .view-toggle {
                    display: flex;
                    background: var(--bg-muted);
                    padding: 4px;
                    border-radius: 10px;
                }

                .view-toggle button {
                    padding: 6px 10px;
                    border-radius: 8px;
                    color: var(--text-tertiary);
                    transition: all 0.2s;
                }

                .view-toggle button.active {
                    background: var(--bg-surface);
                    color: var(--accent);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }

                .file-lib-toolbar {
                    padding: calc(16px * var(--lib-s-scale)) calc(32px * var(--lib-s-scale));
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 16px;
                    background: rgba(var(--bg-muted-rgb), 0.4);
                    backdrop-filter: blur(8px);
                }

                .search-box {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    background: var(--bg-surface);
                    border: 1px solid var(--divider);
                    padding: 0 16px;
                    height: 42px;
                    border-radius: 12px;
                    color: var(--text-tertiary);
                    transition: border-color 0.2s;
                }

                .search-box:focus-within {
                    border-color: var(--accent);
                }

                .search-box input {
                    flex: 1;
                    background: transparent;
                    border: none;
                    color: var(--text-primary);
                    outline: none;
                    font-size: 0.95rem;
                }

                .filter-group {
                    display: flex;
                    gap: 8px;
                }

                .filter-btn {
                    padding: 6px 16px;
                    font-size: 0.85rem;
                    font-weight: 600;
                    border-radius: 100px;
                    color: var(--text-secondary);
                    transition: all 0.2s;
                    border: 1px solid transparent;
                }

                .filter-btn:hover {
                    background: var(--bg-hover);
                }

                .filter-btn.active {
                    background: var(--accent-soft);
                    color: var(--accent);
                    border-color: var(--accent-border);
                }

                .file-lib-viewport {
                    flex: 1;
                    overflow-y: auto;
                    padding: 32px;
                }

                .file-content-container.mode-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
                    gap: 24px;
                }

                .lib-file-card {
                    display: flex;
                    flex-direction: column;
                    background: var(--bg-muted);
                    border: 1px solid var(--divider-subtle);
                    border-radius: 18px;
                    overflow: hidden;
                    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                }

                .lib-file-card:hover {
                    transform: translateY(-4px);
                    box-shadow: 0 12px 24px rgba(0,0,0,0.15);
                    border-color: var(--accent-border);
                }

                .file-card-preview {
                    position: relative;
                    aspect-ratio: 4/3;
                    background: var(--bg-surface);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    overflow: hidden;
                }

                .thumb-img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    transition: transform 0.5s ease;
                }

                .lib-file-card:hover .thumb-img {
                    transform: scale(1.1);
                }

                .type-placeholder {
                    color: var(--text-tertiary);
                    transition: color 0.3s;
                }

                .lib-file-card:hover .type-placeholder {
                    color: var(--accent);
                }

                .card-overlay {
                    position: absolute;
                    inset: 0;
                    background: rgba(0,0,0,0.4);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0;
                    transition: opacity 0.2s;
                    backdrop-filter: blur(4px);
                }

                .file-card-preview:hover .card-overlay {
                    opacity: 1;
                }

                .quick-view-btn {
                    background: white;
                    color: black;
                    padding: 8px 16px;
                    border-radius: 100px;
                    font-size: 0.85rem;
                    font-weight: 700;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    transform: translateY(10px);
                    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                }

                .file-card-preview:hover .quick-view-btn {
                    transform: translateY(0);
                }

                .file-card-info {
                    padding: 14px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .file-primary-name {
                    font-weight: 600;
                    font-size: calc(0.9rem * var(--lib-f-scale));
                    color: var(--text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    display: block;
                }

                .meta-grid {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .meta-item {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 0.75rem;
                    color: var(--text-tertiary);
                }

                .meta-item.clickable {
                    cursor: pointer;
                }

                .meta-item.clickable:hover {
                    color: var(--accent);
                }

                .chat-link {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 100px;
                }

                .jump-icon {
                    opacity: 0.4;
                    transition: opacity 0.2s, transform 0.2s;
                    color: var(--accent);
                }

                .meta-item.clickable:hover .jump-icon {
                    opacity: 1;
                    transform: translate(1px, -1px);
                }

                .lib-state-msg {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    color: var(--text-tertiary);
                    min-height: 300px;
                }

                .spin { animation: spin 1s linear infinite; }

                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                @keyframes scaleUp { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }

                @media (max-width: 640px) {
                    .file-lib-overlay { padding: 0; }
                    .file-lib-modal { height: 100vh; border-radius: 0; width: 100vw; }
                    .file-lib-header { padding: 12px 16px; flex-wrap: wrap; gap: 8px; }
                    .file-lib-title-group { gap: 10px; }
                    .lib-icon-badge { width: 32px; height: 32px; border-radius: 10px; }
                    .lib-icon-badge svg { width: 14px; height: 14px; }
                    .header-actions { margin-left: auto; gap: 8px; }
                    .view-toggle { scale: 0.85; }
                    .file-lib-toolbar { padding: 8px 16px; flex-direction: column; align-items: stretch; gap: 10px; }
                    .search-box { height: 36px; padding: 0 12px; }
                    .filter-group { overflow-x: auto; padding-bottom: 2px; gap: 4px; }
                    .filter-btn { flex-shrink: 0; padding: 4px 10px; font-size: 0.75rem; }
                    .file-lib-viewport { padding: 10px; }
                    .file-content-container.mode-grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 10px; }
                    .file-card-info { padding: 10px; gap: 4px; }
                    .meta-item svg { width: 10px; height: 10px; }
                    .chat-link { max-width: 80px; }
                }
            `}</style>
        </div>
    );
};

export default FileLibrary;

