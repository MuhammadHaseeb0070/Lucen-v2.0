export interface FileAttachment {
  id: string;
  name: string;
  type: 'image' | 'pdf' | 'csv' | 'text';
  mimeType: string;
  size: number;
  dataUrl?: string;       // base64 data URL for images (API + display)
  textContent?: string;   // extracted text for PDF/CSV/TXT files
  aiDescription?: string;
  /** Timestamp (ms) when the current aiDescription was generated. Used to decide reuse vs refresh. */
  descriptionGeneratedAt?: number;
  storagePath?: string;
  tokenEstimate?: number;
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
  webSearchUsed?: boolean;
  isPinned?: boolean;
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



export type ArtifactType = 'html' | 'svg' | 'mermaid' | 'file';

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  /** For type='file' artifacts, the download filename (including extension) */
  filename?: string;
  content: string;
  messageId: string;
  isStreaming?: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  supportsReasoning: boolean;
  /** Whether this model natively accepts image inputs. When false, images must be routed through the vision helper. */
  supportsVision: boolean;
  /** Hard cap on output tokens sent to the API (computed dynamically) */
  maxTokens: number;
  /** Maximum output tokens the model supports (model capability, e.g. 32768) */
  maxOutputTokens: number;
  /** Total context window size — input + output combined (e.g. 131072 for Grok) */
  contextWindow: number;
  inputCostPer1k: number;
  outputCostPer1k: number;
}

