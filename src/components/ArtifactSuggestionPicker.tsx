// ============================================================
// ArtifactSuggestionPicker — inline artifact selector for ambiguous updates
//
// Rendered inside MessageBubble when an assistant message has
// `artifactSuggestions` set. Shows clickable cards for each
// candidate artifact. On click:
//   1. Binds the selected artifact as the patch target.
//   2. Removes this suggestion message from chat.
//   3. Re-sends the original user prompt through the normal handleSend
//      flow (which will now route through the patching engine).
//
// The user can also dismiss without selecting — the binding stays
// unset and they can click "Update" on an artifact card manually.
// ============================================================

import React, { useCallback } from 'react';
import { FileCode2, GitBranch, Image, Wand2, X } from 'lucide-react';
import { useChatStore } from '../store/chatStore';
import { useArtifactStore } from '../store/artifactStore';
import type { ArtifactType, Message } from '../types';

const TYPE_ICON: Record<ArtifactType, React.ReactNode> = {
  html: <FileCode2 size={14} />,
  svg: <Image size={14} />,
  mermaid: <GitBranch size={14} />,
  file: <FileCode2 size={14} />,
};

const TYPE_LABEL: Record<ArtifactType, string> = {
  html: 'HTML',
  svg: 'SVG',
  mermaid: 'Diagram',
  file: 'File',
};

interface ArtifactSuggestionPickerProps {
  message: Message;
  /** Called when the user selects an artifact — parent should re-queue the original prompt. */
  onSelect: (artifact: NonNullable<Message['artifactSuggestions']>[0], originalPrompt: string) => void;
  /** Called when user dismisses without selecting. */
  onDismiss: () => void;
}

const ArtifactSuggestionPicker: React.FC<ArtifactSuggestionPickerProps> = ({
  message,
  onSelect,
  onDismiss,
}) => {
  const suggestions = message.artifactSuggestions;
  const originalPrompt = message.artifactSuggestionOriginalPrompt ?? '';

  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div className="artifact-suggestion-picker">
      <div className="artifact-suggestion-picker-header">
        <Wand2 size={14} className="artifact-suggestion-picker-icon" />
        <span>Which artifact should be updated?</span>
        <button
          className="artifact-suggestion-picker-dismiss"
          onClick={onDismiss}
          type="button"
          title="Dismiss — click Update on an artifact card manually"
          aria-label="Dismiss artifact selector"
        >
          <X size={13} />
        </button>
      </div>
      <div className="artifact-suggestion-picker-list">
        {suggestions.map((s) => {
          const versionDisplay = s.versionLabel ?? (s.version != null ? `V${s.version}` : null);
          return (
            <button
              key={s.id}
              type="button"
              className="artifact-suggestion-card"
              onClick={() => onSelect(s, originalPrompt)}
              title={`Update "${s.title}"`}
            >
              <span className="artifact-suggestion-card-icon">
                {TYPE_ICON[s.type] ?? <FileCode2 size={14} />}
              </span>
              <span className="artifact-suggestion-card-body">
                <span className="artifact-suggestion-card-title">{s.title}</span>
                <span className="artifact-suggestion-card-meta">
                  {TYPE_LABEL[s.type] ?? s.type}
                  {versionDisplay && (
                    <span className="artifact-suggestion-card-version">{versionDisplay}</span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="artifact-suggestion-picker-hint">
        Or click <strong>Update</strong> (✏) on any artifact workspace to target it directly.
      </div>
    </div>
  );
};

/**
 * Standalone hook-based wrapper used inside ChatArea / MessageList contexts
 * that need to wire selection to the chat store and send flow.
 */
export function useArtifactSuggestionHandler(convId: string | null) {
  const setTargetArtifact = useChatStore((s) => s.setTargetArtifact);
  const activeArtifact = useArtifactStore((s) => s.activeArtifact);
  const setActiveArtifact = useArtifactStore((s) => s.setActiveArtifact);

  const handleSelect = useCallback(
    (
      suggestion: NonNullable<Message['artifactSuggestions']>[0],
      originalPrompt: string,
      onSend: (prompt: string) => void,
    ) => {
      if (!convId) return;

      // Build a minimal Artifact object from the suggestion.
      const artifactForBinding = {
        id: suggestion.id,
        type: suggestion.type,
        title: suggestion.title,
        content: suggestion.content,
        messageId: '',
        dbId: suggestion.dbId,
        lineageId: suggestion.lineageId,
        version: suggestion.version,
      };

      // If no artifact is open or a different one is active, open this one.
      if (!activeArtifact || activeArtifact.id !== suggestion.id) {
        setActiveArtifact(artifactForBinding);
      }

      // Bind as patch target.
      setTargetArtifact(convId, artifactForBinding);

      // Re-queue the original prompt (now routes through patching engine).
      if (originalPrompt.trim()) {
        onSend(originalPrompt);
      }
    },
    [convId, activeArtifact, setActiveArtifact, setTargetArtifact],
  );

  return { handleSelect };
}

export default ArtifactSuggestionPicker;
