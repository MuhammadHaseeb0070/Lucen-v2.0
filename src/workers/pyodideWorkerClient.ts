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

// ── Word/docx schema (kept for ExcelDocumentPreview compatibility) ─────────────
export interface DocxRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  color?: string;
}

export interface DocxParagraph {
  style: string;
  text: string;
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
export interface ExcelResult {
  stdout: string;
  stderr: string;
  files: Array<{ name: string; data: string; mimeType: string }>;
  error: string | null;
  xlsxSchema?: XlsxSchema | null;
}

export type ExcelRunStage = 'init' | 'packages' | 'input' | 'running' | 'ready';

export interface ExcelProgress {
  stage: ExcelRunStage;
  message: string;
}

type WorkerMessage =
  | { type: 'status'; artifactId: string; stage: ExcelRunStage; message: string }
  | { type: 'result'; artifactId: string; stdout: string; stderr: string;
      files: Array<{ name: string; data: string; mimeType: string }>; error: string | null;
      xlsxSchema?: XlsxSchema | null };

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
            xlsxSchema: data.xlsxSchema ?? null,
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
          error: `Excel worker crashed: ${e.message || 'Unknown error (possibly out of memory)'}`,
        });
      }
      worker = undefined;
    });
  }
  return worker;
}

/**
 * Runs Excel Python code inside the Pyodide Web Worker.
 * Resolves with stdout, stderr, written files, xlsx schema, and error state.
 */
export function runExcel(
  artifactId: string,
  code: string,
  inputFiles?: Array<{ name: string; data: string }>,
  onProgress?: (progress: ExcelProgress) => void,
  packages?: string[],
  mode?: string,
): Promise<ExcelResult> {
  return new Promise((resolve) => {
    pending.set(artifactId, { resolve, onProgress });
    getWorker().postMessage({
      type: 'run',
      artifactId,
      code,
      inputFiles,
      packages,
      mode,
    });
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
