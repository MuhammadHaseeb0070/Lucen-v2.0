import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Globe, Lock, Loader2, Check, AlertCircle, Tag, Zap } from 'lucide-react';
import { publishArtifact, unpublishArtifact, checkSlugAvailable, updateArtifactMeta } from '../services/artifactDb';
import { useArtifactStore } from '../store/artifactStore';
import { useAuthStore } from '../store/authStore';
import type { Artifact } from '../types';

interface Props {
  artifact: Artifact;
  onClose: () => void;
}

type SlugStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

function validateSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(s);
}

const ArtifactPublishModal: React.FC<Props> = ({ artifact, onClose }) => {
  const { patchActiveArtifact } = useArtifactStore();
  const { user } = useAuthStore();

  const isAlreadyPublic = artifact.isPublic === true;

  const [slug, setSlug] = useState(artifact.slug || slugify(artifact.title));
  const [description, setDescription] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>(
    artifact.slug ? 'available' : 'idle'
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const slugCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dbId = artifact.dbId;

  // Debounced slug availability check
  const checkSlug = useCallback(async (value: string) => {
    if (!validateSlug(value)) {
      setSlugStatus('invalid');
      return;
    }
    // Skip check if it's already the published slug
    if (value === artifact.slug) {
      setSlugStatus('available');
      return;
    }
    setSlugStatus('checking');
    const available = await checkSlugAvailable(value);
    setSlugStatus(available ? 'available' : 'taken');
  }, [artifact.slug]);

  const handleSlugChange = (value: string) => {
    const cleaned = slugify(value);
    setSlug(cleaned);
    setSlugStatus('idle');
    if (slugCheckTimerRef.current) clearTimeout(slugCheckTimerRef.current);
    slugCheckTimerRef.current = setTimeout(() => checkSlug(cleaned), 500);
  };

  useEffect(() => {
    // Auto-check slug on mount
    if (slug && !artifact.slug) {
      checkSlug(slug);
    }
    return () => {
      if (slugCheckTimerRef.current) clearTimeout(slugCheckTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (t && !tags.includes(t) && tags.length < 8) {
      setTags([...tags, t]);
      setTagInput('');
    }
  };

  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
    if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  };

  const handlePublish = async () => {
    if (!dbId) { setError('Artifact not yet saved. Please wait a moment and try again.'); return; }
    if (slugStatus !== 'available') { setError('Please choose a valid, available unique name.'); return; }
    setIsSaving(true);
    setError('');
    const authorName = user?.name || user?.email?.split('@')[0] || 'Anonymous';
    const result = await publishArtifact({ dbId, slug, description, tags, authorName });
    setIsSaving(false);
    if (!result.ok) {
      setError(result.error === 'slug_taken' ? 'That name is already taken. Please pick another.' : (result.error || 'Failed to publish.'));
      if (result.error === 'slug_taken') setSlugStatus('taken');
      return;
    }
    patchActiveArtifact({ isPublic: true, slug, dbId });
    setSuccess(true);
    setTimeout(onClose, 1400);
  };

  const handleUpdateMeta = async () => {
    if (!dbId) return;
    setIsSaving(true);
    setError('');
    const ok = await updateArtifactMeta(dbId, { description, tags });
    setIsSaving(false);
    if (!ok) { setError('Failed to update. Try again.'); return; }
    setSuccess(true);
    setTimeout(onClose, 1000);
  };

  const handleUnpublish = async () => {
    if (!dbId) return;
    setIsSaving(true);
    const ok = await unpublishArtifact(dbId);
    setIsSaving(false);
    if (!ok) { setError('Failed to unpublish.'); return; }
    patchActiveArtifact({ isPublic: false, slug: undefined });
    setSuccess(true);
    setTimeout(onClose, 1000);
  };

  const slugStatusIcon = () => {
    if (slugStatus === 'checking') return <Loader2 size={14} className="apm-spin" />;
    if (slugStatus === 'available') return <Check size={14} className="apm-ok" />;
    if (slugStatus === 'taken' || slugStatus === 'invalid') return <AlertCircle size={14} className="apm-err" />;
    return null;
  };

  return (
    <div className="apm-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="apm-modal">
        {/* Header */}
        <div className="apm-header">
          <div className="apm-header-icon">
            {isAlreadyPublic ? <Globe size={18} /> : <Zap size={18} />}
          </div>
          <div className="apm-header-text">
            <span className="apm-title">{isAlreadyPublic ? 'Manage Artifact' : 'Publish to Hub'}</span>
            <span className="apm-subtitle">{isAlreadyPublic ? 'Edit or unpublish your artifact' : 'Share this artifact with the Lucen community'}</span>
          </div>
          <button className="apm-close" onClick={onClose}><X size={18} /></button>
        </div>

        {success ? (
          <div className="apm-success">
            <Check size={28} />
            <span>{isAlreadyPublic ? 'Updated!' : 'Published to Hub!'}</span>
          </div>
        ) : (
          <div className="apm-body">
            {/* Artifact preview strip */}
            <div className="apm-artifact-strip">
              <span className="apm-artifact-type">{artifact.type.toUpperCase()}</span>
              <span className="apm-artifact-name">{artifact.title}</span>
            </div>

            {/* Unique name (slug) — only editable before first publish */}
            {!isAlreadyPublic && (
              <div className="apm-field">
                <label className="apm-label">Unique Hub Name <span className="apm-required">*</span></label>
                <div className="apm-slug-wrap">
                  <input
                    className={`apm-input apm-slug-input ${slugStatus === 'taken' || slugStatus === 'invalid' ? 'apm-input--err' : slugStatus === 'available' ? 'apm-input--ok' : ''}`}
                    value={slug}
                    onChange={(e) => handleSlugChange(e.target.value)}
                    placeholder="my-cool-dashboard"
                    maxLength={60}
                    spellCheck={false}
                  />
                  <span className="apm-slug-status">{slugStatusIcon()}</span>
                </div>
                <span className="apm-hint">
                  {slugStatus === 'taken' ? '⚠ Already taken — choose another' :
                   slugStatus === 'invalid' ? '⚠ Use 3-60 lowercase letters, numbers or hyphens' :
                   slugStatus === 'available' ? '✓ Available!' :
                   'Lowercase letters, numbers and hyphens only (3–60 chars)'}
                </span>
              </div>
            )}
            {isAlreadyPublic && (
              <div className="apm-field">
                <label className="apm-label">Hub Name</label>
                <div className="apm-slug-readonly"><Globe size={13} />{artifact.slug}</div>
              </div>
            )}

            {/* Description */}
            <div className="apm-field">
              <label className="apm-label">Description <span className="apm-optional">(optional)</span></label>
              <textarea
                className="apm-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A short description of what this artifact does..."
                maxLength={200}
                rows={3}
              />
              <span className="apm-hint apm-char-count">{description.length}/200</span>
            </div>

            {/* Tags */}
            <div className="apm-field">
              <label className="apm-label">Tags <span className="apm-optional">(up to 8)</span></label>
              <div className="apm-tags-wrap">
                {tags.map((t) => (
                  <span key={t} className="apm-tag">
                    <Tag size={11} />
                    {t}
                    <button className="apm-tag-remove" onClick={() => removeTag(t)}>×</button>
                  </span>
                ))}
                {tags.length < 8 && (
                  <input
                    className="apm-tag-input"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    onBlur={addTag}
                    placeholder={tags.length === 0 ? 'Add tags (press Enter)...' : '+tag'}
                    maxLength={24}
                  />
                )}
              </div>
            </div>

            {error && (
              <div className="apm-error"><AlertCircle size={14} />{error}</div>
            )}

            {/* Actions */}
            <div className="apm-actions">
              {isAlreadyPublic ? (
                <>
                  <button className="apm-btn apm-btn--danger" onClick={handleUnpublish} disabled={isSaving}>
                    <Lock size={15} /> Make Private
                  </button>
                  <button className="apm-btn apm-btn--primary" onClick={handleUpdateMeta} disabled={isSaving}>
                    {isSaving ? <Loader2 size={15} className="apm-spin" /> : <Check size={15} />}
                    Save Changes
                  </button>
                </>
              ) : (
                <>
                  <button className="apm-btn apm-btn--ghost" onClick={onClose}>Cancel</button>
                  <button
                    className="apm-btn apm-btn--primary"
                    onClick={handlePublish}
                    disabled={isSaving || slugStatus !== 'available' || !dbId}
                  >
                    {isSaving ? <Loader2 size={15} className="apm-spin" /> : <Globe size={15} />}
                    Publish to Hub
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ArtifactPublishModal;
