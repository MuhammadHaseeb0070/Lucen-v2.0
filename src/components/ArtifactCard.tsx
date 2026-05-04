import React from 'react';
import { FileCode2, Image, GitBranch, ExternalLink, Loader2, FileText, Edit3 } from 'lucide-react';
import { useArtifactStore } from '../store/artifactStore';
import { useChatStore } from '../store/chatStore';
import type { Artifact, ArtifactType } from '../types';

const TYPE_ICONS: Record<ArtifactType, React.ReactNode> = {
  html: <FileCode2 size={18} />,
  svg: <Image size={18} />,
  mermaid: <GitBranch size={18} />,
  file: <FileText size={18} />,
};

const TYPE_LABELS: Record<ArtifactType, string> = {
  html: 'HTML',
  svg: 'SVG',
  mermaid: 'Diagram',
  file: 'File',
};

interface ArtifactCardProps {
  artifact: Artifact;
}

const ArtifactCard: React.FC<ArtifactCardProps> = ({ artifact }) => {
  const { setActiveArtifact, activeArtifact } = useArtifactStore();
  const isActive = activeArtifact?.id === artifact.id;
  const setTargetArtifact = useChatStore((s) => s.setTargetArtifact);
  const targetArtifactByConv = useChatStore((s) => s.targetArtifactByConv);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const isTargeted =
    !!activeConversationId &&
    targetArtifactByConv[activeConversationId] === artifact.id;

  const handleOpen = () => {
    setActiveArtifact(artifact);
  };

  const handleUpdate = (e: React.MouseEvent) => {
    // Don't bubble up to the card's "open workspace" handler.
    e.stopPropagation();
    if (!activeConversationId || artifact.isStreaming) return;
    setTargetArtifact(activeConversationId, isTargeted ? null : artifact);
  };

  return (
    <div
      className={`artifact-card ${isActive ? 'artifact-card--active' : ''} ${artifact.isStreaming ? 'artifact-card--streaming' : ''} ${isTargeted ? 'artifact-card--targeted' : ''}`}
      role="group"
    >
      <button
        type="button"
        className="artifact-card-main"
        onClick={handleOpen}
        title={`Open ${TYPE_LABELS[artifact.type] || artifact.type}`}
      >
        <div className="artifact-card-icon">
          {TYPE_ICONS[artifact.type] || <FileCode2 size={18} />}
        </div>
        <div className="artifact-card-info">
          <span className="artifact-card-title">{artifact.title}</span>
          <span className="artifact-card-type">
            {artifact.isStreaming ? (
              <>
                <Loader2 size={12} className="artifact-card-spinner" />
                Generating {TYPE_LABELS[artifact.type] || artifact.type}...
              </>
            ) : (
              <>Click to open {TYPE_LABELS[artifact.type] || artifact.type}</>
            )}
          </span>
        </div>
        <div className="artifact-card-action">
          <ExternalLink size={14} />
        </div>
      </button>
      {!artifact.isStreaming && (
        <button
          type="button"
          className={`artifact-card-update-btn ${isTargeted ? 'artifact-card-update-btn--active' : ''}`}
          onClick={handleUpdate}
          title={isTargeted ? 'Cancel update binding' : 'Update this artifact (next message will patch it)'}
          aria-pressed={isTargeted}
        >
          <Edit3 size={13} />
          <span>{isTargeted ? 'Updating' : 'Update'}</span>
        </button>
      )}
    </div>
  );
};

export default ArtifactCard;
