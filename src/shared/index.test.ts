import { describe, it, expect } from 'vitest';
import {
  FileAttachmentSchema,
  MessageSchema,
  UsageReceiptSchema,
  CreditStateSchema
} from './index';

describe('Shared Zod Schemas', () => {
  describe('FileAttachmentSchema', () => {
    it('should validate a correct attachment object', () => {
      const valid = {
        id: 'attach-1',
        name: 'test.pdf',
        type: 'pdf',
        mimeType: 'application/pdf',
        size: 1024,
      };
      const result = FileAttachmentSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should fail validation on invalid mimeType/type', () => {
      const invalid = {
        id: 'attach-1',
        name: 'test.pdf',
        type: 'exe', // invalid enum
        mimeType: 'application/pdf',
        size: 'large', // should be number
      };
      const result = FileAttachmentSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('MessageSchema', () => {
    it('should validate a correct message object', () => {
      const valid = {
        id: 'msg-123',
        role: 'user',
        content: 'Hello World',
        timestamp: Date.now(),
      };
      const result = MessageSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  describe('UsageReceiptSchema', () => {
    it('should validate a correct usage receipt object', () => {
      const valid = {
        tools_used: [],
        prompt_tokens: 100,
        completion_tokens: 50,
        reasoning_tokens: 0,
        total_credits: 1.5,
        search_credits: 0,
      };
      const result = UsageReceiptSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });

  describe('CreditStateSchema', () => {
    it('should validate a correct credit state object', () => {
      const valid = {
        remainingCredits: 1000,
        totalUsed: 500,
        subscriptionStatus: 'active',
        subscriptionPlan: 'pro',
        customerPortalUrl: 'https://billing.example.com',
        renewsAt: '2026-07-01',
        billingCycleUsage: 250,
      };
      const result = CreditStateSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });
  });
});
