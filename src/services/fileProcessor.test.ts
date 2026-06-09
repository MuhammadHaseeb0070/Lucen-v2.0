import { describe, it, expect, vi } from 'vitest';
import { processFiles } from './fileProcessor';
import * as pdfjsLib from 'pdfjs-dist';

// Mock pdfjs-dist
vi.mock('pdfjs-dist', () => {
  return {
    GlobalWorkerOptions: {
      workerSrc: ''
    },
    getDocument: vi.fn()
  };
});

describe('fileProcessor Security Hardening', () => {
  it('rejects empty (0-byte) files with a friendly validation error message', async () => {
    const emptyFile = new File([''], 'empty.txt', { type: 'text/plain' });
    const { attachments, errors } = await processFiles([emptyFile]);
    
    expect(attachments).toHaveLength(0);
    expect(errors).toContain('File "empty.txt" is empty (0 bytes) and cannot be processed.');
  });

  it('deduplicates uploads based on SHA-256 hashes within a batch', async () => {
    const file1 = new File(['hello world'], 'file1.txt', { type: 'text/plain' });
    const file2 = new File(['hello world'], 'file2.txt', { type: 'text/plain' });
    
    const { attachments, errors } = await processFiles([file1, file2]);
    
    expect(attachments).toHaveLength(1);
    expect(attachments[0].name).toBe('file1.txt');
    expect(errors).toContain('File "file2.txt" is a duplicate and was skipped.');
  });

  it('deduplicates uploads against existing attachments', async () => {
    const file1 = new File(['hello world'], 'file1.txt', { type: 'text/plain' });
    
    // Hash of 'hello world' is b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    const existing = [
      {
        id: 'existing-id',
        name: 'old.txt',
        type: 'text' as const,
        mimeType: 'text/plain',
        size: 11,
        hash: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
      }
    ];
    
    const { attachments, errors } = await processFiles([file1], existing);
    
    expect(attachments).toHaveLength(0);
    expect(errors).toContain('File "file1.txt" is a duplicate and was skipped.');
  });

  it('identifies password-protected PDF files and throws a dedicated error', async () => {
    const pdfFile = new File(['fake-pdf-content'], 'encrypted.pdf', { type: 'application/pdf' });
    
    // Mock pdfjsLib.getDocument to reject with PasswordException
    const passwordError = new Error('Password required');
    passwordError.name = 'PasswordException';
    const mockPromise = Promise.reject(passwordError);
    mockPromise.catch(() => {}); // Prevent unhandled rejection in test runner
    
    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: mockPromise
    } as any);

    const { attachments, errors } = await processFiles([pdfFile]);
    
    expect(attachments).toHaveLength(0);
    expect(errors).toContain('File "encrypted.pdf" is password-protected/encrypted.');
  });
});
