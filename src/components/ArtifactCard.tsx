import React from 'react';
import { FileCode2, Image, GitBranch, ExternalLink, Loader2 } from 'lucide-react';
import { useArtifactStore } from '../store/artifactStore';
import type { Artifact, ArtifactType } from '../types';

const TYPE_ICONS: Record<ArtifactType, React.ReactNode> = {
  html: <FileCode2 size={18} />,
  svg: <Image size={18} />,
  mermaid: <GitBranch size={18} />,
};

const TYPE_LABELS: Record<ArtifactType, string> = {
  html: 'HTML',
  svg: 'SVG',
  mermaid: 'Diagram',
};

interface ArtifactCardProps {
  artifact: Artifact;
}

const ArtifactCard: React.FC<ArtifactCardProps> = ({ artifact }) => {
  const { setActiveArtifact, activeArtifact } = useArtifactStore();
  const isActive = activeArtifact?.id === artifact.id;

  const handleClick = () => {
    setActiveArtifact(artifact);
  };

  return (
    <button
      className={`artifact-card ${isActive ? 'artifact-card--active' : ''} ${artifact.isStreaming ? 'artifact-card--streaming' : ''}`}
      onClick={handleClick}
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
  );
};

export default ArtifactCard;
