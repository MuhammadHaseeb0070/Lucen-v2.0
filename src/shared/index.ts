import { z } from 'zod';

export const FileAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['image', 'pdf', 'csv', 'text']),
  mimeType: z.string(),
  size: z.number(),
  dataUrl: z.string().optional(),
  textContent: z.string().optional(),
  aiDescription: z.string().optional(),
  descriptionGeneratedAt: z.number().optional(),
  storagePath: z.string().optional(),
  tokenEstimate: z.number().optional(),
  rawBase64: z.string().optional(),
  uploadFailed: z.boolean().optional(),
});

export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  reasoning: z.string().optional(),
  timestamp: z.number(),
  isStreaming: z.boolean().optional(),
  isReasoningStreaming: z.boolean().optional(),
  isTruncated: z.boolean().optional(),
  generationStatus: z.enum([
    'idle',
    'streaming',
    'continuing',
    'planning',
    'generating',
    'validating',
    'repairing',
    'complete',
    'partial_saved',
    'failed_recoverable'
  ]).optional(),
  generationStatusDetail: z.string().optional(),
  webSearchUsed: z.boolean().optional(),
  webSearchUrls: z.array(z.string()).optional(),
  isPinned: z.boolean().optional(),
  attachments: z.array(FileAttachmentSchema).optional(),
});

export const UsageReceiptSchema = z.object({
  tools_used: z.array(z.any()),
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  reasoning_tokens: z.number(),
  total_credits: z.number(),
  search_credits: z.number(),
});

export const CreditStateSchema = z.object({
  remainingCredits: z.number(),
  totalUsed: z.number(),
  subscriptionStatus: z.string(),
  subscriptionPlan: z.enum(['free', 'regular', 'pro']),
  customerPortalUrl: z.string().nullable(),
  renewsAt: z.string().nullable(),
  billingCycleUsage: z.number(),
});

export type SharedFileAttachment = z.infer<typeof FileAttachmentSchema>;
export type SharedMessage = z.infer<typeof MessageSchema>;
export type SharedUsageReceipt = z.infer<typeof UsageReceiptSchema>;
export type SharedCreditState = z.infer<typeof CreditStateSchema>;
