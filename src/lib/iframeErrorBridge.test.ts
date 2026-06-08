import { describe, it, expect, vi } from 'vitest';
import { injectIntoHtml, attachErrorListener, INJECT_SCRIPT, INJECT_SCRIPT_LINE_COUNT } from './iframeErrorBridge';

describe('iframeErrorBridge', () => {
  it('should export correct script line count', () => {
    expect(INJECT_SCRIPT_LINE_COUNT).toBe(INJECT_SCRIPT.split('\n').length);
  });

  describe('injectIntoHtml', () => {
    it('should inject script directly after the opening head tag if it exists', () => {
      const srcDoc = '<html><head><title>Test</title></head><body><h1>Hi</h1></body></html>';
      const result = injectIntoHtml(srcDoc);

      expect(result.startsWith('<html><head>' + INJECT_SCRIPT)).toBe(true);
      expect(result.endsWith('</head><body><h1>Hi</h1></body></html>')).toBe(true);
    });

    it('should inject script right before the closing body tag if head does not exist but body does', () => {
      const srcDoc = '<html><body><h1>Hi</h1></body></html>';
      const result = injectIntoHtml(srcDoc);

      expect(result.includes(INJECT_SCRIPT + '</body>')).toBe(true);
    });

    it('should prepend the script as a fallback when no tags are present', () => {
      const srcDoc = '<h1>Simple text only</h1>';
      const result = injectIntoHtml(srcDoc);

      expect(result.startsWith(INJECT_SCRIPT)).toBe(true);
      expect(result.endsWith('<h1>Simple text only</h1>')).toBe(true);
    });
  });

  describe('attachErrorListener', () => {
    it('should receive messages with correct tag and invoke onError', () => {
      const callback = vi.fn();
      const cleanup = attachErrorListener(callback);

      const eventData = {
        __type: '__lucen_iframe_error',
        payload: {
          message: 'ReferenceError: x is not defined',
          origin: 'window.onerror',
          capturedAt: Date.now()
        }
      };

      // Mock a message event sent to parent window
      const messageEvent = new MessageEvent('message', {
        data: eventData
      });

      window.dispatchEvent(messageEvent);

      expect(callback).toHaveBeenCalledWith(eventData.payload);
      cleanup();
    });

    it('should ignore messages with incorrect tags', () => {
      const callback = vi.fn();
      const cleanup = attachErrorListener(callback);

      const messageEvent = new MessageEvent('message', {
        data: {
          __type: 'some_other_type',
          payload: { message: 'Ignored' }
        }
      });

      window.dispatchEvent(messageEvent);

      expect(callback).not.toHaveBeenCalled();
      cleanup();
    });
  });
});
