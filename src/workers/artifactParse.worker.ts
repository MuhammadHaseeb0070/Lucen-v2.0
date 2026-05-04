import { parseArtifacts } from '../lib/artifactParser';
import type { ParseResult } from '../lib/artifactParser';

type InMsg = {
  type: 'parse';
  requestId: string;
  content: string;
  messageId: string;
  forceClose: boolean;
};

addEventListener('message', (e: MessageEvent<InMsg>) => {
  const d = e.data;
  if (!d || d.type !== 'parse') return;
  try {
    const result: ParseResult = parseArtifacts(d.content, d.messageId, d.forceClose);
    postMessage({ type: 'result', requestId: d.requestId, result });
  } catch (err) {
    postMessage({
      type: 'error',
      requestId: d.requestId,
      message: err instanceof Error ? err.message : 'parse failed',
    });
  }
});
