import React, { useEffect, useState, useMemo } from 'react';
import { 
    X, 
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
import FileIcon, { classifyFile } from './FileIcon';

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
    // NOTE: filterType values intentionally match FileIcon's FileCategory
    // groupings, so "Documents" (text/pdf/word/markdown) is a single toggle
    // in the UI even though we store several raw file_type values in the DB.
    type FilterKey = 'all' | 'image' | 'document' | 'spreadsheet' | 'code' | 'other';
    const [filterType, setFilterType] = useState<FilterKey>('all');
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

    // Map a file's raw (stored type, filename) pair into the high-level
    // filter groups shown as chips in the toolbar.
    const fileGroup = (f: FileRecord): FilterKey => {
        const cat = classifyFile(f.file_name, f.file_type);
        if (cat === 'image') return 'image';
        if (cat === 'spreadsheet') return 'spreadsheet';
        if (cat === 'code' || cat === 'json') return 'code';
        if (cat === 'pdf' || cat === 'word' || cat === 'presentation' || cat === 'markdown' || cat === 'text') return 'document';
        // DB often stores PDFs / Office files as file_type "text" with a wrong or missing extension.
        if (cat === 'unknown') {
            const t = (f.file_type || '').toLowerCase();
            if (t === 'pdf' || t === 'text' || t === 'csv') {
                if (t === 'csv') return 'spreadsheet';
                return 'document';
            }
        }
        return 'other';
    };

    const filteredFiles = useMemo(() => {
        return files.filter(f => {
            const matchesSearch = f.file_name.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesType = filterType === 'all' || fileGroup(f) === filterType;
            return matchesSearch && matchesType;
        });
    }, [files, searchQuery, filterType]);

    // Counts per group for the chip badges (so users know what's there
    // even before clicking).
    const counts = useMemo(() => {
        const c: Record<FilterKey, number> = { all: files.length, image: 0, document: 0, spreadsheet: 0, code: 0, other: 0 };
        for (const f of files) {
            const g = fileGroup(f);
            c[g] = (c[g] ?? 0) + 1;
        }
        return c;
    }, [files]);

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
                        {([
                            { key: 'all',         label: 'All' },
                            { key: 'image',       label: 'Images' },
                            { key: 'document',    label: 'Documents' },
                            { key: 'spreadsheet', label: 'Sheets' },
                            { key: 'code',        label: 'Code' },
                            { key: 'other',       label: 'Other' },
                        ] as Array<{ key: FilterKey; label: string }>).map((b) => (
                                <button
                                    key={b.key}
                                    className={`filter-btn ${filterType === b.key ? 'active' : ''}`}
                                    onClick={() => setFilterType(b.key)}
                                >
                                    <span>{b.label}</span>
                                    <span className="filter-count">{counts[b.key] ?? 0}</span>
                                </button>
                            ))}
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
                                        <div className="file-preview-area" onClick={() => handleView(file)}>
                                            {thumbUrl ? (
                                                <img src={thumbUrl} alt="" className="thumb-img" />
                                            ) : (
                                                <div className="type-placeholder">
                                                    <FileIcon name={file.file_name} type={file.file_type} size={32} badge />
                                                </div>
                                            )}
                                            <div className="card-overlay">
                                                <button className="quick-view-btn">
                                                    <Eye size={16} />
                                                    <span>Preview</span>
                                                </button>
                                            </div>
                                        </div>
                                        
                                        <div className="file-info-area">
                                            <div className="info-top">
                                                <span className="file-primary-name" title={file.file_name}>
                                                    {file.file_name}
                                                </span>
                                                
                                                <div className="file-meta-row">
                                                    <Calendar size={12} />
                                                    <span>{new Date(file.created_at).toLocaleDateString()}</span>
                                                </div>
                                            </div>

                                            <button 
                                                className="go-to-chat-btn" 
                                                onClick={() => handleNavigate(file.conversation_id, file.message_id)}
                                                title={`Go to: ${file.conversations?.title || 'Chat'}`}
                                            >
                                                <div className="btn-content">
                                                    <MessageSquare size={14} className="chat-ic" />
                                                    <span className="btn-text">Open in Chat</span>
                                                </div>
                                                <ArrowUpRight size={14} className="arrow-ic" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                /* ─── BASE OVERLAY & MODAL ─── */
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
                    width: min(100%, 950px);
                    height: 85vh;
                    background: var(--bg-surface);
                    border: 1px solid var(--divider);
                    border-radius: 20px;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 30px 60px rgba(0,0,0,0.4);
                    overflow: hidden;
                    animation: scaleUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                }

                /* ─── HEADER ─── */
                .file-lib-header {
                    padding: 24px 32px;
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
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .file-lib-title-group h2 {
                    font-size: 1.25rem;
                    font-weight: 700;
                    margin: 0;
                    color: var(--text-primary);
                }

                .file-lib-title-group p {
                    margin: 2px 0 0 0;
                    font-size: 0.82rem;
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
                    padding: 6px 12px;
                    border-radius: 8px;
                    color: var(--text-tertiary);
                    transition: all 0.2s;
                    border: none;
                    background: transparent;
                    cursor: pointer;
                }

                .view-toggle button.active {
                    background: var(--bg-surface);
                    color: var(--accent);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }

                .close-btn {
                    background: transparent;
                    border: none;
                    color: var(--text-tertiary);
                    cursor: pointer;
                    transition: color 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .close-btn:hover { color: var(--text-primary); }

                /* ─── TOOLBAR ─── */
                .file-lib-toolbar {
                    padding: 16px 32px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 16px;
                    background: rgba(var(--bg-muted-rgb), 0.4);
                    border-bottom: 1px solid var(--divider-subtle);
                }

                .search-box {
                    flex: 1;
                    max-width: 320px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    background: var(--bg-surface);
                    border: 1px solid var(--divider);
                    padding: 0 16px;
                    height: 40px;
                    border-radius: 12px;
                    color: var(--text-tertiary);
                    transition: border-color 0.2s;
                }
                .search-box:focus-within { border-color: var(--accent); }
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
                    gap: 6px;
                    overflow-x: auto;
                    scrollbar-width: none;
                }
                .filter-group::-webkit-scrollbar { display: none; }
                .filter-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 14px;
                    font-size: 0.85rem;
                    font-weight: 600;
                    border-radius: 100px;
                    color: var(--text-secondary);
                    transition: all 0.2s;
                    border: 1px solid transparent;
                    background: transparent;
                    cursor: pointer;
                    white-space: nowrap;
                    flex-shrink: 0;
                }
                .filter-btn:hover { background: var(--bg-hover); }
                .filter-btn.active {
                    background: var(--accent-soft);
                    color: var(--accent);
                    border-color: var(--accent-border);
                }
                .filter-count {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 20px;
                    height: 18px;
                    padding: 0 6px;
                    border-radius: 999px;
                    background: color-mix(in srgb, currentColor 14%, transparent);
                    font-size: 0.72rem;
                    font-weight: 700;
                    letter-spacing: 0.02em;
                }

                /* ─── VIEWPORT & CARDS ─── */
                .file-lib-viewport {
                    flex: 1;
                    overflow-y: auto;
                    padding: 24px 32px;
                }

                .lib-state-msg {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    color: var(--text-tertiary);
                    min-height: 250px;
                }
                .spin { animation: spin 1s linear infinite; }

                /* Common Card Styles */
                .lib-file-card {
                    background: var(--bg-surface);
                    border: 1px solid var(--divider-subtle);
                    border-radius: 16px;
                    overflow: hidden;
                    transition: all 0.2s ease;
                    display: flex;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.02);
                }
                .lib-file-card:hover {
                    box-shadow: 0 8px 24px rgba(0,0,0,0.08);
                    border-color: var(--divider);
                    transform: translateY(-2px);
                }

                .file-preview-area {
                    position: relative;
                    background: var(--bg-muted);
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
                    transition: transform 0.4s ease;
                }
                .lib-file-card:hover .thumb-img { transform: scale(1.05); }

                .type-placeholder { color: var(--text-tertiary); }
                .lib-file-card:hover .type-placeholder { color: var(--accent); }

                .card-overlay {
                    position: absolute;
                    inset: 0;
                    background: rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0;
                    transition: opacity 0.2s;
                    backdrop-filter: blur(2px);
                }
                .file-preview-area:hover .card-overlay { opacity: 1; }
                
                .quick-view-btn {
                    background: white;
                    color: black;
                    padding: 6px 14px;
                    border-radius: 100px;
                    border: none;
                    font-size: 0.8rem;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    transform: translateY(8px);
                    transition: transform 0.2s ease;
                    cursor: pointer;
                }
                .file-preview-area:hover .quick-view-btn { transform: translateY(0); }

                .file-info-area {
                    display: flex;
                    flex-direction: column;
                }
                
                .file-primary-name {
                    font-weight: 600;
                    font-size: 0.9rem;
                    color: var(--text-primary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    display: block;
                }
                
                .file-meta-row {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 0.75rem;
                    color: var(--text-tertiary);
                    margin-top: 4px;
                }

                .go-to-chat-btn {
                    margin-top: auto;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    width: 100%;
                    padding: 10px 14px;
                    background: var(--bg-muted);
                    border: none;
                    border-top: 1px solid var(--divider-subtle);
                    cursor: pointer;
                    transition: all 0.2s;
                    color: var(--text-secondary);
                }
                .go-to-chat-btn .btn-content {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .go-to-chat-btn .btn-text {
                    font-size: 0.8rem;
                    font-weight: 500;
                }
                .go-to-chat-btn:hover {
                    background: var(--accent-soft);
                    color: var(--accent);
                }
                .go-to-chat-btn:hover .arrow-ic { transform: translate(2px, -2px); }

                /* ─── GRID MODE ─── */
                .file-content-container.mode-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
                    gap: 20px;
                }
                .mode-grid .lib-file-card {
                    flex-direction: column;
                }
                .mode-grid .file-preview-area {
                    aspect-ratio: 16 / 9;
                    width: 100%;
                }
                .mode-grid .info-top {
                    padding: 14px 14px 16px 14px;
                }

                /* ─── LIST MODE ─── */
                .file-content-container.mode-list {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .mode-list .lib-file-card {
                    flex-direction: row;
                    height: 84px;
                }
                .mode-list .file-preview-area {
                    width: 120px;
                    height: 100%;
                    border-right: 1px solid var(--divider-subtle);
                }
                .mode-list .file-info-area {
                    flex: 1;
                    flex-direction: row;
                    align-items: center;
                    padding: 0 20px;
                }
                .mode-list .info-top {
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                }
                .mode-list .go-to-chat-btn {
                    margin-top: 0;
                    width: auto;
                    border: none;
                    border-radius: 8px;
                    background: transparent;
                    padding: 8px 16px;
                    border: 1px solid var(--divider);
                }
                .mode-list .go-to-chat-btn:hover {
                    border-color: var(--accent-border);
                }

                /* ─── KEYFRAMES ─── */
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                @keyframes scaleUp { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

                /* ─── TABLET & BELOW (Max-Width: 820px) ─── */
                @media (max-width: 820px) {
                    .file-lib-header { padding: 18px 22px; gap: 12px; }
                    .file-lib-title-group p { display: none; } /* subtitle eats too much room */
                    .file-lib-toolbar { padding: 14px 22px; }
                    .file-lib-viewport { padding: 20px 22px; }
                }

                /* ─── MOBILE (Max-Width: 640px) ─── */
                @media (max-width: 640px) {
                    .file-lib-overlay { padding: 0; }
                    .file-lib-modal {
                        height: 100vh;
                        height: 100dvh;
                        border-radius: 0;
                        width: 100%;
                        max-width: 100vw;
                    }

                    .file-lib-header {
                        padding: 12px 14px;
                        gap: 12px;
                        flex-wrap: wrap;
                        min-width: 0;
                        align-items: center;
                        border-bottom: 1px solid var(--divider);
                    }
                    .file-lib-title-group {
                        gap: 10px;
                        flex: 1 1 0;
                        min-width: 0;
                        max-width: calc(100% - 52px);
                    }
                    .lib-icon-badge {
                        width: 40px;
                        height: 40px;
                        border-radius: 12px;
                        flex-shrink: 0;
                    }
                    .file-lib-title-group > div {
                        min-width: 0; /* enable ellipsis on h2 */
                    }
                    .file-lib-title-group h2 {
                        font-size: 1.05rem;
                        font-weight: 700;
                        line-height: 1.2;
                        display: -webkit-box;
                        -webkit-line-clamp: 2;
                        -webkit-box-orient: vertical;
                        overflow: hidden;
                    }
                    .file-lib-title-group p { display: none; }

                    .header-actions {
                        gap: 6px;
                        margin-left: auto;
                        flex: 0 0 auto;
                        align-items: center;
                    }
                    /* Hide view toggle on phones — one-column list by default is
                       cleanest. Users can always switch on tablets/desktops. */
                    .view-toggle { display: none; }
                    .close-btn {
                        width: 40px;
                        height: 40px;
                        border-radius: 12px;
                        background: var(--bg-muted);
                        flex-shrink: 0;
                    }

                    .file-lib-toolbar {
                        padding: 10px 14px 12px;
                        flex-direction: column;
                        align-items: stretch;
                        gap: 10px;
                        position: sticky;
                        top: 0;
                        z-index: 5;
                        background: var(--bg-surface);
                        box-shadow: 0 1px 0 var(--divider-subtle);
                    }
                    .search-box { max-width: 100%; height: 44px; border-radius: 10px; }
                    .filter-group {
                        gap: 6px;
                        padding: 0 0 4px 0;
                        margin: 0;
                        -webkit-overflow-scrolling: touch;
                    }
                    .filter-btn { padding: 6px 12px; font-size: 0.75rem; }
                    .filter-count { min-width: 18px; height: 16px; font-size: 0.68rem; }

                    .file-lib-viewport {
                        padding: 12px 14px 28px;
                        padding-bottom: calc(28px + env(safe-area-inset-bottom, 0));
                    }

                    /* Force a single responsive column on phones regardless of
                       stored view mode — cleanest reading experience. */
                    .file-content-container.mode-grid {
                        gap: 12px;
                        grid-template-columns: 1fr;
                    }
                    .mode-grid .file-preview-area { aspect-ratio: 16 / 9; }
                    .mode-grid .info-top { padding: 12px 14px 14px 14px; }

                    .mode-list .lib-file-card { height: auto; flex-direction: row; }
                    .mode-list .file-preview-area {
                        width: 72px;
                        height: auto;
                        border-right: 1px solid var(--divider-subtle);
                        border-bottom: none;
                        aspect-ratio: 1 / 1;
                    }
                    .mode-list .file-info-area {
                        flex-direction: column;
                        padding: 0;
                        align-items: stretch;
                        flex: 1;
                        min-width: 0;
                    }
                    .mode-list .info-top { padding: 10px 14px 6px; }
                    .mode-list .go-to-chat-btn {
                        border-radius: 0;
                        border: none;
                        border-top: 1px solid var(--divider-subtle);
                        justify-content: center;
                        padding: 10px;
                        background: transparent;
                    }
                }

                /* ─── SMALL PHONE (Max-Width: 380px) ─── */
                @media (max-width: 380px) {
                    .file-lib-title-group h2 { font-size: 0.95rem; }
                    .lib-icon-badge { width: 32px; height: 32px; }
                    .lib-icon-badge svg { width: 16px; height: 16px; }
                }
            `}</style>
        </div>
    );
};

export default FileLibrary;

