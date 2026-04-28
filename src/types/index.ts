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
  webSearchUrls?: string[];
  isPinned?: boolean;
  attachments?: FileAttachment[];
}

export interface Conversation {
  id: string;
  title: string;
  /**
   * True while title is auto-managed by the title generator.
   * Flips to false after any manual rename so AI never overrides user intent.
   */
  titleAuto?: boolean;
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
  /** Supabase artifacts.id — populated after the artifact is saved to DB */
  dbId?: string;
  /** Whether this artifact has been published to the Hub */
  isPublic?: boolean;
  /** Globally unique slug chosen by the user at publish time */
  slug?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  supportsReasoning: boolean;
  /** Whether this model natively accepts image inputs. When false, images must be routed through the vision helper. */
  supportsVision: boolean;
  /**
   * Whether this model leaks reasoning / chain-of-thought into the
   * `content` channel instead of a separate `reasoning` field. When true
   * we raise per-call output caps (artifact mode) to give the model room
   * to both think and answer in a single pass. True for MiniMax M2 and
   * some DeepSeek R1 provider routes; false for GPT, Claude, Gemini.
   */
  reasoningLeak: boolean;
  /** Hard cap on output tokens sent to the API (computed dynamically) */
  maxTokens: number;
  /** Maximum output tokens the model supports (model capability, e.g. 32768) */
  maxOutputTokens: number;
  /** Total context window size — input + output combined (e.g. 131072 for Grok) */
  contextWindow: number;
  /**
   * Observed output throughput in tokens/second. Used together with the
   * platform wall-clock budget to size per-call `max_tokens` so a single
   * streamed response can realistically finish before Supabase's 150s
   * idle timeout.
   */
  tokensPerSecond: number;
  /** Legacy per-1k pricing, kept for backwards compatibility. */
  inputCostPer1k: number;
  outputCostPer1k: number;
  /** USD per 1,000,000 tokens — used for real cost accounting. */
  inputCostPer1m: number;
  outputCostPer1m: number;
}

