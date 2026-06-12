export interface PythonDocumentResult {
  stdout: string;
  stderr: string;
  files: Array<{ name: string; data: string; mimeType: string }>;
  error: string | null;
}

export type PythonDocumentRunStage = 'init' | 'packages' | 'input' | 'running' | 'ready';

export interface PythonDocumentProgress {
  stage: PythonDocumentRunStage;
  message: string;
}

type WorkerMessage =
  | { type: 'status'; artifactId: string; stage: PythonDocumentRunStage; message: string }
  | { type: 'stream'; artifactId: string; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'result'; artifactId: string; stdout: string; stderr: string; 
      files: Array<{ name: string; data: string; mimeType: string }>; error: string | null };

let worker: Worker | undefined;

const pending = new Map<string, {
  resolve: (res: PythonDocumentResult) => void;
  onProgress?: (progress: PythonDocumentProgress) => void;
  onStream?: (stream: 'stdout' | 'stderr', text: string) => void;
  runArgs: { artifactId: string, documentType: string, code: string, inputFiles?: Array<{ name: string; data: string }> };
}>();

export function cancelPythonRun(artifactId: string) {
  if (pending.has(artifactId)) {
    const handler = pending.get(artifactId);
    pending.delete(artifactId);
    
    // Force terminate the worker to stop the underlying Python execution completely
    if (worker) {
      worker.terminate();
      worker = undefined;
      
      // Since the worker is dead, any other pending tasks are orphaned.
      // We must resubmit them to a fresh worker so they don't fail just because one task hung.
      const toResubmit = [];
      for (const [, otherHandler] of pending.entries()) {
        toResubmit.push(otherHandler);
      }
      pending.clear();
      
      for (const other of toResubmit) {
        pending.set(other.runArgs.artifactId, other);
        getWorker().postMessage({ type: 'run', ...other.runArgs });
      }
    }
    
    // Resolve with a cancelled state
    handler?.resolve({
      stdout: '',
      stderr: '',
      files: [],
      error: 'Cancelled',
    });
  }
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<WorkerMessage>) => {
      const data = e.data;
      if (!data) return;

      if (data.type === 'status') {
        const handler = pending.get(data.artifactId);
        handler?.onProgress?.({ stage: data.stage, message: data.message });
      } else if (data.type === 'stream') {
        const handler = pending.get(data.artifactId);
        handler?.onStream?.(data.stream, data.text);
      } else if (data.type === 'result') {
        const handler = pending.get(data.artifactId);
        if (handler) {
          pending.delete(data.artifactId);
          handler.resolve({
            stdout: data.stdout,
            stderr: data.stderr,
            files: data.files,
            error: data.error,
          });
        }
      }
    });
  }
  return worker;
}

export function runPythonDocument(
  artifactId: string,
  documentType: string,
  code: string,
  inputFiles?: Array<{ name: string; data: string }>,
  onProgress?: (progress: PythonDocumentProgress) => void,
  onStream?: (stream: 'stdout' | 'stderr', text: string) => void,
): Promise<PythonDocumentResult> {
  // Cancel any prior run for this artifact
  cancelPythonRun(artifactId);

  return new Promise((resolve) => {
    pending.set(artifactId, { 
      resolve, 
      onProgress, 
      onStream,
      runArgs: { artifactId, documentType, code, inputFiles }
    });
    getWorker().postMessage({ type: 'run', artifactId, documentType, code, inputFiles });
  });
}

export function terminatePythonWorker() {
  if (worker) {
    worker.terminate();
    worker = undefined;
    for (const [, handler] of pending.entries()) {
      handler.resolve({ stdout: '', stderr: '', files: [], error: 'Worker terminated.' });
    }
    pending.clear();
  }
}

export default runPythonDocument;
