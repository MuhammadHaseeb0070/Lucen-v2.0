// ============================================================
// ArtifactSuggestionPicker — legacy patch-flow UI (disabled)
//
// Artifact patching/updating was removed. This component now renders
// nothing and exists only to avoid refactors in older message payloads.
// ============================================================

import React from 'react';
import type { Message } from '../types';

interface ArtifactSuggestionPickerProps {
  message: Message;
  /** Called when the user selects an artifact — parent should re-queue the original prompt. */
  onSelect: (artifact: NonNullable<Message['artifactSuggestions']>[0], originalPrompt: string) => void;
  /** Called when user dismisses without selecting. */
  onDismiss: () => void;
}

const ArtifactSuggestionPicker: React.FC<ArtifactSuggestionPickerProps> = ({
  message: _message,
  onSelect: _onSelect,
  onDismiss: _onDismiss,
}) => {
  return null;
};

export default ArtifactSuggestionPicker;
