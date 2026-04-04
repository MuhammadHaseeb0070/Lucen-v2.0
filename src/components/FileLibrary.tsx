import React, { useEffect, useState } from 'react';
import { 
    X, 
    FileText, 
    Image as ImageIcon, 
    FileCode, 
    Search, 
    ExternalLink, 
    Loader2, 
    Inbox
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
    conversations?: {
        title: string;
    };
}

const FileLibrary: React.FC = () => {
    const { fileLibraryOpen, setFileLibraryOpen } = useUIStore();
    const { user } = useAuthStore();
    const { setActiveConversation } = useChatStore();
    
    const [files, setFiles] = useState<FileRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (fileLibraryOpen && user) {
            fetchFiles();
        }
    }, [fileLibraryOpen, user]);

    const fetchFiles = async () => {
        if (!supabase) return;
        setLoading(true);
        try {
            // Fetch files joined with conversation titles
            const { data, error } = await supabase
                .from('file_attachments')
                .select(`
                    id,
                    file_name,
                    file_type,
                    conversation_id,
                    created_at,
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

    const handleNavigate = (convId: string) => {
        setActiveConversation(convId);
        setFileLibraryOpen(false);
    };

    const getFileIcon = (type: string) => {
        switch (type) {
            case 'image': return <ImageIcon size={18} className="file-icon image" />;
            case 'code': return <FileCode size={18} className="file-icon code" />;
            default: return <FileText size={18} className="file-icon text" />;
        }
    };

    const filteredFiles = files.filter(f => 
        f.file_name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (!fileLibraryOpen) return null;

    return (
        <div className="file-library-overlay" onClick={() => setFileLibraryOpen(false)}>
            <div className="file-library-modal" onClick={e => e.stopPropagation()}>
                <div className="file-library-header">
                    <div className="header-title-area">
                        <h2>File Library</h2>
                        <p>Browse and navigate your uploaded resources</p>
                    </div>
                    <button className="close-btn" onClick={() => setFileLibraryOpen(false)}>
                        <X size={20} />
                    </button>
                </div>

                <div className="file-library-search">
                    <Search size={18} className="search-icon" />
                    <input 
                        type="text" 
                        placeholder="Search files..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoFocus
                    />
                </div>

                <div className="file-library-content">
                    {loading ? (
                        <div className="library-loading">
                            <Loader2 size={32} className="spinner" />
                            <span>Fetching your files...</span>
                        </div>
                    ) : filteredFiles.length === 0 ? (
                        <div className="library-empty">
                            <Inbox size={48} />
                            <h3>No files found</h3>
                            <p>{searchQuery ? 'Try a different search term' : 'Upload files in a chat to see them here'}</p>
                        </div>
                    ) : (
                        <div className="file-list">
                            {filteredFiles.map(file => (
                                <div key={file.id} className="file-item">
                                    <div className="file-main">
                                        <div className="file-preview">
                                            {getFileIcon(file.file_type)}
                                        </div>
                                        <div className="file-details">
                                            <span className="file-name">{file.file_name}</span>
                                            <div className="file-meta">
                                                <span className="file-date">
                                                    {new Date(file.created_at).toLocaleDateString()}
                                                </span>
                                                <span className="dot">•</span>
                                                <span className="conv-link">
                                                    Part of: {file.conversations?.title || 'Untitled Chat'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <button 
                                        className="navigate-btn"
                                        onClick={() => handleNavigate(file.conversation_id)}
                                        title="Jump to conversation"
                                    >
                                        <ExternalLink size={16} />
                                        <span>Jump to chat</span>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                .file-library-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.4);
                    backdrop-filter: blur(8px);
                    z-index: 1000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    animation: fadeIn 0.2s ease-out;
                }

                .file-library-modal {
                    width: min(90vw, 700px);
                    max-height: 80vh;
                    background: var(--bg-card);
                    border: 1px solid var(--border-subtle);
                    border-radius: 20px;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 20px 50px rgba(0,0,0,0.3);
                    overflow: hidden;
                    animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                }

                .file-library-header {
                    padding: 24px;
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    border-bottom: 1px solid var(--border-subtle);
                }

                .header-title-area h2 {
                    font-size: 1.5rem;
                    font-weight: 600;
                    color: var(--text-primary);
                    margin: 0 0 4px 0;
                }

                .header-title-area p {
                    font-size: 0.9rem;
                    color: var(--text-muted);
                    margin: 0;
                }

                .close-btn {
                    padding: 8px;
                    border-radius: 10px;
                    color: var(--text-muted);
                    transition: all 0.2s;
                }
                .close-btn:hover {
                    background: var(--bg-hover);
                    color: var(--text-primary);
                }

                .file-library-search {
                    padding: 16px 24px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    background: var(--bg-muted);
                    border-bottom: 1px solid var(--border-subtle);
                }

                .file-library-search input {
                    flex: 1;
                    background: transparent;
                    border: none;
                    font-size: 1rem;
                    color: var(--text-primary);
                    outline: none;
                }

                .file-library-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 12px;
                }

                .file-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .file-item {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 16px;
                    border-radius: 12px;
                    transition: all 0.2s;
                    cursor: default;
                }
                .file-item:hover {
                    background: var(--bg-hover);
                }

                .file-main {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                }

                .file-preview {
                    width: 40px;
                    height: 40px;
                    border-radius: 10px;
                    background: var(--bg-muted);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border: 1px solid var(--border-subtle);
                }

                .file-icon.image { color: var(--accent); }
                .file-icon.code { color: var(--warning); }
                .file-icon.text { color: var(--text-muted); }

                .file-details {
                    display: flex;
                    flex-direction: column;
                }

                .file-name {
                    font-weight: 500;
                    color: var(--text-primary);
                }

                .file-meta {
                    font-size: 0.8rem;
                    color: var(--text-muted);
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                .navigate-btn {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 14px;
                    border-radius: 8px;
                    background: var(--bg-muted);
                    border: 1px solid var(--border-subtle);
                    color: var(--text-muted);
                    font-size: 0.85rem;
                    font-weight: 500;
                    transition: all 0.2s;
                }
                .navigate-btn:hover {
                    background: var(--accent);
                    color: white;
                    border-color: var(--accent);
                }

                .library-loading, .library-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px 0;
                    color: var(--text-muted);
                }

                .spinner {
                    animation: spin 1s linear infinite;
                    margin-bottom: 16px;
                }

                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }

                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @keyframes slideUp {
                    from { transform: translateY(20px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
};

export default FileLibrary;
