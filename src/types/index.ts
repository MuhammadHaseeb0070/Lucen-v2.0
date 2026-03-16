export interface FileAttachment {
  id: string;
  name: string;
  type: 'image' | 'pdf' | 'csv' | 'text';
  mimeType: string;
  size: number;
  dataUrl?: string;       // base64 data URL for images (API + display)
  textContent?: string;   // extracted text for PDF/CSV/TXT files
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;
  timestamp: number;
  isStreaming?: boolean;
  isReasoningStreaming?: boolean;
  isTruncated?: boolean;
  attachments?: FileAttachment[];
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  templateId?: string;
}

export type TemplateMode = 'General' | 'Learning' | 'Problem Solving' | 'Coding';

export interface SideChatState {
  messages: Message[];
  injectedContext: Message[];
  isOpen: boolean;
}

export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price: number;
  popular?: boolean;
}

export type ArtifactType = 'html' | 'svg' | 'mermaid';

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  content: string;
  messageId: string;
  isStreaming?: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  supportsReasoning: boolean;
  maxTokens: number;
  inputCostPer1k: number;
  outputCostPer1k: number;
}

