// ── Excel schema (extracted from xlsx output files for live preview) ──────────
export interface ExcelCellSchema {
  v: string | number | boolean | null; // value
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  bg?: string;       // hex background e.g. "#4472C4"
  fg?: string;       // hex font color
  align?: 'left' | 'center' | 'right' | 'general';
  valign?: 'top' | 'middle' | 'bottom';
  fontSize?: number;
  numFmt?: string;   // number format string e.g. "0.00"
  wrap?: boolean;
}

export interface ExcelSheetSchema {
  dims: { maxRow: number; maxCol: number };
  colWidths: number[];   // width in pixels for each column (1-indexed via index 0 = col 1)
  rowHeights: number[];  // height in pixels for each row (1-indexed via index 0 = row 1)
  cells: Record<string, ExcelCellSchema>; // key = "A1", "B2" etc.
  merges: Array<[string, string]>;        // [topLeft, bottomRight] e.g. ["A1","C1"]
}

export interface XlsxSchema {
  sheets: string[];        // all sheet names (capped at 5)
  totalSheets: number;     // actual total before capping
  activeSheet: string;
  data: Record<string, ExcelSheetSchema>;
}

// ── Word/docx schema ──────────────────────────────────────────────────────────
export interface DocxRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  color?: string;
}

export interface DocxParagraph {
  style: string;            // e.g. "Normal", "Heading 1"
  text: string;             // full plain text
  runs?: DocxRun[];
  alignment?: string;
}

export interface DocxTableCell {
  text: string;
  bold?: boolean;
}

export interface DocxTable {
  rows: DocxTableCell[][];
}

export interface DocxSchema {
  paragraphs: DocxParagraph[];
  tables: DocxTable[];
}

// ── Core result type ──────────────────────────────────────────────────────────
export interface PythonResult {
  stdout: string;
  stderr: string;
  files: Array<{ name: string; data: string; mimeType: string }>;
  error: string | null;
  xlsxSchema?: XlsxSchema | null;
  docxSchema?: DocxSchema | null;
}

type WorkerMessage =
  | { type: 'status'; artifactId: string; status: string; message: string }
  | { type: 'result'; artifactId: string; stdout: string; stderr: string; files: Array<{ name: string; data: string; mimeType: string }>; error: string | null; xlsxSchema?: XlsxSchema | null; docxSchema?: DocxSchema | null };

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

      if (data.type === 'status') {
        // Progress updates: only show for the focused artifact to avoid UI confusion.
        if (data.artifactId !== focusedArtifactId) return;
        const handler = pending.get(data.artifactId);
        if (handler?.onProgress) {
          handler.onProgress(data.message);
        }
      } else if (data.type === 'result') {
        // Always resolve the pending promise — even for non-focused artifacts.
        // This prevents memory leaks and ensures the result is cached properly.
        const handler = pending.get(data.artifactId);
        if (handler) {
          pending.delete(data.artifactId);
          handler.resolve({
            stdout: data.stdout,
            stderr: data.stderr,
            files: data.files,
            error: data.error,
            xlsxSchema: data.xlsxSchema ?? null,
            docxSchema: data.docxSchema ?? null,
          });
        }
      }
    });
    worker.addEventListener('error', (e: ErrorEvent) => {
      for (const [id, handler] of pending.entries()) {
        pending.delete(id);
        handler.resolve({
          stdout: '',
          stderr: '',
          files: [],
          error: `Python worker crashed: ${e.message || 'Unknown error (possibly out of memory)'}`,
        });
      }
      // Reset worker so next run spawns fresh
      worker = undefined;
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
