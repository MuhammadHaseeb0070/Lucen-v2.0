import type { ParseResult } from '../lib/artifactParser';

type WorkerResult =
  | { type: 'result'; requestId: string; result: ParseResult }
  | { type: 'error'; requestId: string; message: string };

let worker: Worker | undefined;
const pending = new Map<string, { resolve: (r: ParseResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./artifactParse.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<WorkerResult>) => {
      const data = e.data;
      if (data.type === 'result') {
        const h = pending.get(data.requestId);
        if (h) {
          pending.delete(data.requestId);
          h.resolve(data.result);
        }
      } else {
        const h = pending.get(data.requestId);
        if (h) {
          pending.delete(data.requestId);
          h.reject(new Error(data.message));
        }
      }
    });
  }
  return worker;
}

/** Offloads {@link parseArtifacts} when the payload is large; caller must drop stale `requestId` results. */
export function parseArtifactsOffThread(
  requestId: string,
  content: string,
  messageId: string,
  forceClose: boolean
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    getWorker().postMessage({ type: 'parse', requestId, content, messageId, forceClose });
  });
}
