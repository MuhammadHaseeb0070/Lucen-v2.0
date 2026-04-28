import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Search, Zap, Globe, Lock, Tag, ArrowUpDown, TrendingUp, Clock, Eye,
  Download, Loader2, MessageSquare, Trash2, CornerDownRight, Check, Star
} from 'lucide-react';
import { useArtifactStore } from '../store/artifactStore';
import { useChatStore } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';
import ArtifactRenderer from './ArtifactRenderer';
import {
  fetchPublicArtifacts, fetchMyArtifacts, toggleSpark, fetchUserSparks,
  fetchComments, addComment, deleteComment, unpublishArtifact, deleteArtifact,
  incrementViews,
} from '../services/artifactDb';
import type { DbArtifact, DbComment } from '../services/artifactDb';
import type { Artifact } from '../types';
import { v4 as uuidv4 } from 'uuid';

// ─── Helpers ──────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const TYPE_COLOR: Record<string, string> = {
  html: '#e57cd8', svg: '#7cb9e8', mermaid: '#7dde92', file: '#f0a57a',
};

// ─── ArtifactCard for Hub ────────────────────────────────────
interface HubCardProps {
  artifact: DbArtifact;
  userSparked: boolean;
  onSpark: (id: string) => void;
  onPreview: (artifact: DbArtifact) => void;
  onImport: (artifact: DbArtifact, mode: 'current' | 'new') => void;
  isOwner?: boolean;
  onUnpublish?: (id: string) => void;
  onDelete?: (id: string) => void;
}

const HubCard: React.FC<HubCardProps> = ({
  artifact, userSparked, onSpark, onPreview, onImport, isOwner, onUnpublish, onDelete
}) => (
  <div className="hub-card">
    <div className="hub-card-header">
      <span className="hub-card-type" style={{ background: `${TYPE_COLOR[artifact.type]}22`, color: TYPE_COLOR[artifact.type] }}>
        {artifact.type.toUpperCase()}
      </span>
      <span className="hub-card-title" title={artifact.title}>{artifact.title}</span>
      {isOwner && (
        <span className="hub-card-owner-badge">
          {artifact.is_public ? <Globe size={11} /> : <Lock size={11} />}
          {artifact.is_public ? 'Public' : 'Private'}
        </span>
      )}
    </div>

    {artifact.description && (
      <p className="hub-card-desc">{artifact.description}</p>
    )}

    {artifact.tags.length > 0 && (
      <div className="hub-card-tags">
        {artifact.tags.slice(0, 5).map(t => (
          <span key={t} className="hub-card-tag"><Tag size={9} />{t}</span>
        ))}
      </div>
    )}

    <div className="hub-card-meta">
      <span className="hub-card-author">@{artifact.author_name || 'anonymous'}</span>
      <span className="hub-card-dot">·</span>
      <span className="hub-card-time">{timeAgo(artifact.created_at)}</span>
      <span className="hub-card-dot">·</span>
      <span className="hub-card-views"><Eye size={11} />{artifact.view_count}</span>
    </div>

    <div className="hub-card-actions">
      <button
        className={`hub-spark-btn ${userSparked ? 'hub-spark-btn--sparked' : ''}`}
        onClick={() => onSpark(artifact.id)}
        title={userSparked ? 'Remove spark' : 'Give a spark'}
      >
        <Zap size={13} fill={userSparked ? 'currentColor' : 'none'} />
        <span>{artifact.spark_count}</span>
      </button>

      <div className="hub-card-right-actions">
        {isOwner && onUnpublish && artifact.is_public && (
          <button className="hub-action-btn hub-action-btn--ghost" onClick={() => onUnpublish(artifact.id)} title="Make private">
            <Lock size={13} />
          </button>
        )}
        {isOwner && onDelete && (
          <button className="hub-action-btn hub-action-btn--danger" onClick={() => onDelete(artifact.id)} title="Delete artifact">
            <Trash2 size={13} />
          </button>
        )}
        <button className="hub-action-btn" onClick={() => onPreview(artifact)} title="Preview">
          <Eye size={13} />
          <span>Preview</span>
        </button>
        <button className="hub-action-btn hub-action-btn--primary" onClick={() => onImport(artifact, 'new')} title="Import to new chat">
          <Download size={13} />
          <span>Import</span>
        </button>
      </div>
    </div>
  </div>
);

// ─── Preview Modal ────────────────────────────────────────────
interface PreviewModalProps {
  artifact: DbArtifact;
  userSparked: boolean;
  onSpark: (id: string) => void;
  onImport: (artifact: DbArtifact, mode: 'current' | 'new') => void;
  onClose: () => void;
  currentUserId?: string;
}

const PreviewModal: React.FC<PreviewModalProps> = ({
  artifact, userSparked, onSpark, onImport, onClose, currentUserId
}) => {
  const [comments, setComments] = useState<DbComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const { user } = useAuthStore();

  useEffect(() => {
    incrementViews(artifact.id);
    fetchComments(artifact.id).then(c => { setComments(c); setLoadingComments(false); });
  }, [artifact.id]);

  const handlePostComment = async () => {
    if (!commentText.trim() || !user) return;
    setPosting(true);
    const comment = await addComment({
      artifactId: artifact.id,
      content: commentText.trim(),
      authorName: user.name || user.email?.split('@')[0] || 'Anonymous',
    });
    setPosting(false);
    if (comment) { setComments(prev => [...prev, comment]); setCommentText(''); }
  };

  const handleDeleteComment = async (commentId: string) => {
    await deleteComment(commentId);
    setComments(prev => prev.filter(c => c.id !== commentId));
  };

  return (
    <div className="preview-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="preview-modal">
        <div className="preview-header">
          <div className="preview-header-meta">
            <span className="hub-card-type" style={{ background: `${TYPE_COLOR[artifact.type]}22`, color: TYPE_COLOR[artifact.type] }}>
              {artifact.type.toUpperCase()}
            </span>
            <span className="preview-title">{artifact.title}</span>
          </div>
          <div className="preview-header-actions">
            <button
              className={`hub-spark-btn ${userSparked ? 'hub-spark-btn--sparked' : ''}`}
              onClick={() => onSpark(artifact.id)}
            >
              <Zap size={14} fill={userSparked ? 'currentColor' : 'none'} />
              <span>{artifact.spark_count}</span>
            </button>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button className="hub-action-btn hub-action-btn--ghost" onClick={() => onImport(artifact, 'current')} title="Import to current chat">
                <Download size={14} /> Current
              </button>
              <button className="hub-action-btn hub-action-btn--primary" onClick={() => onImport(artifact, 'new')} title="Import to new chat">
                <Download size={14} /> New Chat
              </button>
            </div>
            <button className="hub-close-btn" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <div className="preview-body">
          <div className="preview-renderer">
            <ArtifactRenderer
              content={artifact.content}
              title={artifact.title}
              type={artifact.type}
              viewMode="preview"
              viewport="full"
              isStreaming={false}
            />
          </div>

          <div className="preview-sidebar">
            <div className="preview-info">
              <span className="preview-author">@{artifact.author_name || 'anonymous'}</span>
              <span className="hub-card-dot">·</span>
              <span className="preview-time">{timeAgo(artifact.created_at)}</span>
              <span className="hub-card-views"><Eye size={11} />{artifact.view_count + 1}</span>
            </div>
            {artifact.description && <p className="preview-desc">{artifact.description}</p>}
            {artifact.tags.length > 0 && (
              <div className="hub-card-tags" style={{ marginTop: '0.5rem' }}>
                {artifact.tags.map(t => <span key={t} className="hub-card-tag"><Tag size={9} />{t}</span>)}
              </div>
            )}

            {/* Comments */}
            <div className="preview-comments">
              <div className="preview-comments-title">
                <MessageSquare size={14} /> Comments ({comments.length})
              </div>
              <div className="preview-comments-list">
                {loadingComments ? (
                  <div className="preview-comments-loading"><Loader2 size={16} className="apm-spin" /></div>
                ) : comments.length === 0 ? (
                  <p className="preview-comments-empty">No comments yet. Be the first!</p>
                ) : (
                  comments.map(c => (
                    <div key={c.id} className="preview-comment">
                      <div className="preview-comment-header">
                        <span className="preview-comment-author">@{c.author_name || 'anon'}</span>
                        <span className="preview-comment-time">{timeAgo(c.created_at)}</span>
                        {(c.user_id === currentUserId || artifact.user_id === currentUserId) && (
                          <button className="preview-comment-delete" onClick={() => handleDeleteComment(c.id)}>
                            <X size={11} />
                          </button>
                        )}
                      </div>
                      <p className="preview-comment-text">{c.content}</p>
                    </div>
                  ))
                )}
              </div>
              {user && (
                <div className="preview-comment-form">
                  <textarea
                    className="preview-comment-input"
                    value={commentText}
                    onChange={e => setCommentText(e.target.value)}
                    placeholder="Leave a comment..."
                    rows={2}
                    maxLength={1000}
                    onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handlePostComment(); }}
                  />
                  <button
                    className="hub-action-btn hub-action-btn--primary"
                    onClick={handlePostComment}
                    disabled={posting || !commentText.trim()}
                  >
                    {posting ? <Loader2 size={13} className="apm-spin" /> : <CornerDownRight size={13} />}
                    Post
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Main ArtifactHub ────────────────────────────────────────
const SORT_OPTIONS = [
  { id: 'sparks', label: 'Most Sparked', icon: <TrendingUp size={13} /> },
  { id: 'newest', label: 'Newest', icon: <Clock size={13} /> },
  { id: 'views', label: 'Most Viewed', icon: <Eye size={13} /> },
] as const;

type SortBy = 'sparks' | 'newest' | 'views';
type TabId = 'hub' | 'mine';

const ArtifactHub: React.FC = () => {
  const { artifactHubOpen, setArtifactHubOpen } = useArtifactStore();
  const { createConversation, addMessage, setActiveConversation } = useChatStore();
  const { setActiveArtifact } = useArtifactStore();
  const { user } = useAuthStore();

  const [tab, setTab] = useState<TabId>('hub');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('sparks');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [publicArtifacts, setPublicArtifacts] = useState<DbArtifact[]>([]);
  const [myArtifacts, setMyArtifacts] = useState<DbArtifact[]>([]);
  const [userSparks, setUserSparks] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [previewArtifact, setPreviewArtifact] = useState<DbArtifact | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPublic = useCallback(async (searchQ: string, sort: SortBy, tag: string | null) => {
    setLoading(true);
    const items = await fetchPublicArtifacts({
      search: searchQ || undefined,
      tags: tag ? [tag] : undefined,
      sortBy: sort,
    });
    setPublicArtifacts(items);
    // Hydrate spark state for logged-in users
    if (user && items.length > 0) {
      const sparked = await fetchUserSparks(items.map(i => i.id));
      setUserSparks(sparked);
    }
    setLoading(false);
  }, [user]);

  const loadMine = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const items = await fetchMyArtifacts();
    setMyArtifacts(items);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!artifactHubOpen) return;
    if (tab === 'hub') loadPublic(search, sortBy, activeTag);
    else loadMine();
  }, [artifactHubOpen, tab, sortBy, activeTag]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => loadPublic(val, sortBy, activeTag), 400);
  };

  const handleSpark = async (artifactId: string) => {
    if (!user) return;
    const result = await toggleSpark(artifactId);
    if (!result) return;
    const update = (arr: DbArtifact[]) =>
      arr.map(a => a.id === artifactId ? { ...a, spark_count: result.sparkCount } : a);
    setPublicArtifacts(prev => update(prev));
    setMyArtifacts(prev => update(prev));
    if (previewArtifact?.id === artifactId) {
      setPreviewArtifact(prev => prev ? { ...prev, spark_count: result.sparkCount } : prev);
    }
    setUserSparks(prev => {
      const next = new Set(prev);
      result.userSparked ? next.add(artifactId) : next.delete(artifactId);
      return next;
    });
  };

  const handleImport = useCallback((artifact: DbArtifact, mode: 'current' | 'new') => {
    const clientArtifact: Artifact = {
      id: uuidv4(),
      dbId: artifact.id,
      type: artifact.type,
      title: artifact.title,
      content: artifact.content,
      messageId: 'imported',
      isPublic: true,
      slug: artifact.slug || undefined,
    };
    
    // Generate standard artifact block so it renders exactly as if AI generated it
    // No markdown block around it needed - our parser ignores code blocks around artifacts anyway,
    // but generating naked XML is safer so it isn't rendered as a simple code block if parsing fails.
    const content = `✨ Imported **${artifact.title}** from the Hub by @${artifact.author_name || 'anonymous'}!\n\n<lucen_artifact identifier="${clientArtifact.id}" type="${artifact.type}" title="${artifact.title}" imported="true">\n${artifact.content}\n</lucen_artifact>\n\nYou can click on the artifact block above to open it in the workspace.`;
    
    let targetConvId = useChatStore.getState().activeConversationId;
    
    if (mode === 'new' || !targetConvId) {
      targetConvId = createConversation();
    }
    
    addMessage(targetConvId, {
      id: uuidv4(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
    });
    
    setActiveArtifact(clientArtifact);
    setActiveConversation(targetConvId);
    setArtifactHubOpen(false);
    incrementViews(artifact.id);
  }, [createConversation, addMessage, setActiveArtifact, setActiveConversation, setArtifactHubOpen]);

  const handleUnpublish = async (artifactId: string) => {
    await unpublishArtifact(artifactId);
    setMyArtifacts(prev => prev.map(a => a.id === artifactId ? { ...a, is_public: false, slug: null } : a));
    setPublicArtifacts(prev => prev.filter(a => a.id !== artifactId));
  };

  const handleDelete = async (artifactId: string) => {
    if (deleteConfirm !== artifactId) {
      setDeleteConfirm(artifactId);
      setTimeout(() => setDeleteConfirm(null), 3000);
      return;
    }
    await deleteArtifact(artifactId);
    setMyArtifacts(prev => prev.filter(a => a.id !== artifactId));
    setDeleteConfirm(null);
  };

  if (!artifactHubOpen) return null;

  const displayList = tab === 'hub' ? publicArtifacts : myArtifacts;
  const currentUserId = user?.id;

  // Popular tags from current list
  const popularTags = Array.from(
    new Set(publicArtifacts.flatMap(a => a.tags))
  ).slice(0, 10);

  return (
    <>
      <div className="hub-overlay" onClick={() => setArtifactHubOpen(false)} />
      <div className="hub-panel">
        {/* Header */}
        <div className="hub-header">
          <div className="hub-header-left">
            <div className="hub-header-icon"><Zap size={18} /></div>
            <div>
              <div className="hub-header-title">Artifact Hub</div>
              <div className="hub-header-subtitle">Community-built artifacts</div>
            </div>
          </div>
          <button className="hub-close" onClick={() => setArtifactHubOpen(false)}><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div className="hub-tabs">
          <button className={`hub-tab ${tab === 'hub' ? 'hub-tab--active' : ''}`} onClick={() => setTab('hub')}>
            <Globe size={14} /> Public Hub
          </button>
          <button className={`hub-tab ${tab === 'mine' ? 'hub-tab--active' : ''}`} onClick={() => { setTab('mine'); loadMine(); }}>
            <Lock size={14} /> My Artifacts
          </button>
        </div>

        {/* Search + Sort (Hub tab only) */}
        {tab === 'hub' && (
          <>
            <div className="hub-search-row">
              <div className="hub-search-wrap">
                <Search size={15} className="hub-search-icon" />
                <input
                  className="hub-search-input"
                  placeholder="Search artifacts..."
                  value={search}
                  onChange={e => handleSearchChange(e.target.value)}
                />
                {search && (
                  <button className="hub-search-clear" onClick={() => { setSearch(''); loadPublic('', sortBy, activeTag); }}>
                    <X size={13} />
                  </button>
                )}
              </div>

              <div className="hub-sort-wrap">
                <button className="hub-sort-btn" onClick={() => setSortOpen(s => !s)}>
                  <ArrowUpDown size={13} />
                  <span>{SORT_OPTIONS.find(s => s.id === sortBy)?.label}</span>
                </button>
                {sortOpen && (
                  <div className="hub-sort-dropdown">
                    {SORT_OPTIONS.map(opt => (
                      <button
                        key={opt.id}
                        className={`hub-sort-option ${sortBy === opt.id ? 'hub-sort-option--active' : ''}`}
                        onClick={() => { setSortBy(opt.id); setSortOpen(false); loadPublic(search, opt.id, activeTag); }}
                      >
                        {opt.icon} {opt.label}
                        {sortBy === opt.id && <Check size={12} style={{ marginLeft: 'auto' }} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Tag pills */}
            {popularTags.length > 0 && (
              <div className="hub-tags-row">
                <button
                  className={`hub-tag-pill ${!activeTag ? 'hub-tag-pill--active' : ''}`}
                  onClick={() => { setActiveTag(null); loadPublic(search, sortBy, null); }}
                >All</button>
                {popularTags.map(t => (
                  <button
                    key={t}
                    className={`hub-tag-pill ${activeTag === t ? 'hub-tag-pill--active' : ''}`}
                    onClick={() => { setActiveTag(t); loadPublic(search, sortBy, t); }}
                  >#{t}</button>
                ))}
              </div>
            )}
          </>
        )}

        {/* List */}
        <div className="hub-list">
          {loading ? (
            <div className="hub-loading"><Loader2 size={24} className="apm-spin" /><span>Loading...</span></div>
          ) : displayList.length === 0 ? (
            <div className="hub-empty">
              {tab === 'hub' ? (
                <>
                  <Star size={32} />
                  <span>No public artifacts yet</span>
                  <p>Publish your first artifact from the workspace toolbar!</p>
                </>
              ) : (
                <>
                  <Lock size={32} />
                  <span>No artifacts yet</span>
                  <p>Your artifacts will appear here after the AI generates one in a chat.</p>
                </>
              )}
            </div>
          ) : (
            displayList.map(artifact => (
              <HubCard
                key={artifact.id}
                artifact={artifact}
                userSparked={userSparks.has(artifact.id)}
                onSpark={handleSpark}
                onPreview={setPreviewArtifact}
                onImport={handleImport}
                isOwner={artifact.user_id === currentUserId}
                onUnpublish={handleUnpublish}
                onDelete={(id) => {
                  if (deleteConfirm === id) handleDelete(id);
                  else { setDeleteConfirm(id); setTimeout(() => setDeleteConfirm(null), 3000); }
                }}
              />
            ))
          )}
        </div>
      </div>

      {/* Preview modal */}
      {previewArtifact && (
        <PreviewModal
          artifact={previewArtifact}
          userSparked={userSparks.has(previewArtifact.id)}
          onSpark={handleSpark}
          onImport={handleImport}
          onClose={() => setPreviewArtifact(null)}
          currentUserId={currentUserId}
        />
      )}
    </>
  );
};

export default ArtifactHub;
