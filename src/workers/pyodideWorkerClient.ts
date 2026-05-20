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
/** Only this artifact's run may update UI callbacks (the open workspace artifact). */
let focusedArtifactId: string | null = null;

const pending = new Map<
  string,
  {
    resolve: (res: PythonResult) => void;
    onProgress?: (message: string) => void;
  }
>();

const CANCELLED: PythonResult = {
  stdout: '',
  stderr: '',
  files: [],
  error: null,
};

export function setFocusedPythonArtifact(artifactId: string | null) {
  focusedArtifactId = artifactId;
}

export function cancelPendingPythonRun(artifactId: string) {
  pending.delete(artifactId);
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<WorkerMessage>) => {
      const data = e.data;
      if (!data) return;
      if (data.artifactId !== focusedArtifactId) return;

      if (data.type === 'status') {
        const handler = pending.get(data.artifactId);
        if (handler?.onProgress) {
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
  mode?: string,
  inputFiles?: Array<{ name: string; data: string }>,
  onProgress?: (message: string) => void
): Promise<PythonResult> {
  focusedArtifactId = artifactId;

  for (const id of pending.keys()) {
    if (id !== artifactId) {
      const stale = pending.get(id);
      pending.delete(id);
      stale?.resolve(CANCELLED);
    }
  }

  return new Promise((resolve) => {
    if (focusedArtifactId !== artifactId) {
      resolve(CANCELLED);
      return;
    }

    pending.set(artifactId, { resolve, onProgress });
    getWorker().postMessage({
      type: 'run',
      artifactId,
      code,
      packages,
      mode,
      inputFiles,
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
