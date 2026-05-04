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

/**
 * Frontend status of an artifact during the agentic patching pipeline.
 *   idle      → not actively being patched
 *   reading   → user submitted a targeted update; we're injecting context
 *   patching  → LLM is streaming patch blocks
 *   verifying → patch parsed; applying search/replace + (for mermaid) parsing
 *   failed    → patch could not be applied (no_match / multi_match / max retries)
 */
export type ArtifactPatchStatus =
  | 'idle'
  | 'reading'
  | 'patching'
  | 'verifying'
  | 'failed';

/**
 * A captured runtime error from the artifact's iframe sandbox or mermaid
 * renderer. Surfaced in the UI as a "Bug detected — fix automatically?"
 * banner.
 */
export interface ArtifactRuntimeError {
  /** Best-effort error message. */
  message: string;
  /** Optional stack trace (string form). */
  stack?: string;
  /** Source line/col when known. */
  line?: number;
  column?: number;
  /** Source URL/file when known. Often the iframe srcDoc origin. */
  source?: string;
  /** Where the error originated. */
  origin: 'iframe' | 'mermaid' | 'patch';
  /** Timestamp (ms) when captured. */
  capturedAt: number;
}

/**
 * A snapshot of a single point in an artifact's patch lineage. The first
 * version of a chain has parentId === undefined and versionNo === 1.
 */
export interface ArtifactVersion {
  /** Supabase artifacts.id for THIS version (unique across the lineage). */
  dbId: string;
  /** Stable id shared by every version in the chain. The first version's dbId === lineageId. */
  lineageId: string;
  /** The previous version's dbId (undefined for V1). */
  parentDbId?: string;
  /** 1-based sequential version number within the lineage. */
  versionNo: number;
  /** Snapshot of the artifact content at this version. */
  content: string;
  /** Title at the time this version was created. */
  title: string;
  /** Type at the time this version was created. */
  type: ArtifactType;
  /** Message id of the chat turn that produced this version (the patching turn for V2+, or the original artifact-creation turn for V1). */
  messageId: string | null;
  /** Server timestamp (ms) when this version was inserted. */
  createdAt: number;
}

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
  /** Whether this artifact was imported directly from the Hub (blocks re-publishing until modified) */
  isImported?: boolean;
  // ─── Patching-engine fields (additive, all optional) ──────────────────
  /** 1-based version number within the lineage. Defaults to 1 when omitted. */
  version?: number;
  /** dbId of the previous version (undefined for V1). */
  parentId?: string;
  /** Stable id shared by every version of this artifact. Used by the version selector to enumerate the chain. */
  lineageId?: string;
  /** Cached full version chain. Lazy-loaded by useLineageHistory; absence does NOT mean no history exists. */
  versionHistory?: ArtifactVersion[];
  /** Latest captured runtime error from the iframe / mermaid renderer. Cleared when a successful patch lands. */
  runtimeError?: ArtifactRuntimeError | null;
  /** Frontend pipeline status (drives the status overlay). Defaults to 'idle' when omitted. */
  patchStatus?: ArtifactPatchStatus;
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

