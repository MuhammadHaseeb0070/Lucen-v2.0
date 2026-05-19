export interface PythonResult {
  stdout: string;
  stderr: string;
  files: Array<{ name: string; data: string; mimeType: string }>;
  error: string | null;
}

type WorkerMessage =
  | { type: 'status'; artifactId: string; status: string; message: string }
  | { type: 'result'; artifactId: string; stdout: string; stderr: string; files: Array<{ name: string; data: string; mimeType: string }>; error: string | null };

let worker: Worker | undefined;
const pending = new Map<
  string,
  {
    resolve: (res: PythonResult) => void;
    onProgress?: (message: string) => void;
  }
>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<WorkerMessage>) => {
      const data = e.data;
      if (!data) return;

      if (data.type === 'status') {
        const handler = pending.get(data.artifactId);
        if (handler && handler.onProgress) {
          handler.onProgress(data.message);
        }
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

/**
 * Runs Python code inside the Pyodide Web Worker.
 * Resolves with the stdout, stderr, written files, and error state.
 */
export function runPython(
  artifactId: string,
  code: string,
  packages: string[],
  onProgress?: (message: string) => void
): Promise<PythonResult> {
  return new Promise((resolve) => {
    pending.set(artifactId, { resolve, onProgress });
    getWorker().postMessage({
      type: 'run',
      artifactId,
      code,
      packages,
    });
  });
}

/**
 * Terminate the active worker instance if spawned, reclaiming all WebAssembly memory.
 */
export function terminateWorker() {
  if (worker) {
    worker.terminate();
    worker = undefined;
    for (const [, handler] of pending.entries()) {
      handler.resolve({
        stdout: '',
        stderr: '',
        files: [],
        error: 'Worker terminated unexpectedly.',
      });
    }
    pending.clear();
  }
}

export default runPython;
