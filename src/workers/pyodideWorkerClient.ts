export interface ExcelResult {
  stdout: string;
  stderr: string;
  files: Array<{ name: string; data: string; mimeType: string }>;
  error: string | null;
}

export type ExcelRunStage = 'init' | 'packages' | 'input' | 'running' | 'ready';

export interface ExcelProgress {
  stage: ExcelRunStage;
  message: string;
}

type WorkerMessage =
  | { type: 'status'; artifactId: string; stage: ExcelRunStage; message: string }
  | { type: 'result'; artifactId: string; stdout: string; stderr: string; 
      files: Array<{ name: string; data: string; mimeType: string }>; error: string | null };

let worker: Worker | undefined;

const pending = new Map<string, {
  resolve: (res: ExcelResult) => void;
  onProgress?: (progress: ExcelProgress) => void;
}>();

export function cancelExcelRun(artifactId: string) {
  pending.delete(artifactId);
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

export function runExcel(
  artifactId: string,
  code: string,
  inputFiles?: Array<{ name: string; data: string }>,
  onProgress?: (progress: ExcelProgress) => void,
): Promise<ExcelResult> {
  // Cancel any prior run for this artifact
  pending.delete(artifactId);

  return new Promise((resolve) => {
    pending.set(artifactId, { resolve, onProgress });
    getWorker().postMessage({ type: 'run', artifactId, code, inputFiles });
  });
}

export function terminateExcelWorker() {
  if (worker) {
    worker.terminate();
    worker = undefined;
    for (const [, handler] of pending.entries()) {
      handler.resolve({ stdout: '', stderr: '', files: [], error: 'Worker terminated.' });
    }
    pending.clear();
  }
}

export default runExcel;
