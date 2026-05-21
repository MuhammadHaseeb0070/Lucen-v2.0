import React, { useState, useMemo, useCallback } from 'react';
import type { XlsxSchema, DocxSchema, DocxParagraph } from '../workers/pyodideWorkerClient';
import { AlertTriangle } from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert column index (1-based) to letter(s): 1→A, 26→Z, 27→AA */
function colIndexToLetter(n: number): string {
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

/** Parse "A1" → { col: 1, row: 1 } */
function parseCellRef(ref: string): { col: number; row: number } | null {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  const letters = m[1];
  const row = parseInt(m[2], 10);
  let col = 0;
  for (const ch of letters) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return { col, row };
}

/** Check if a cell is inside a merge range [minRow, minCol, maxRow, maxCol] */
function isMergeStart(row: number, col: number, merges: number[][]): number[] | null {
  for (const m of merges) {
    if (m[0] === row && m[1] === col) return m;
  }
  return null;
}
function isMergeBody(row: number, col: number, merges: number[][]): boolean {
  for (const m of merges) {
    if (row >= m[0] && row <= m[2] && col >= m[1] && col <= m[3]) {
      if (row === m[0] && col === m[1]) return false; // it's the start
      return true;
    }
  }
  return false;
}

// ── Excel Grid Preview ────────────────────────────────────────────────────────

interface ExcelGridProps {
  schema: XlsxSchema;
}

const MAX_PREVIEW_ROWS = 200;
const MAX_PREVIEW_COLS = 30;

const ExcelGrid: React.FC<ExcelGridProps> = ({ schema }) => {
  const [activeSheet, setActiveSheet] = useState(schema.activeSheet || schema.sheets[0] || '');

  const sheetData = schema.data[activeSheet];

  const { rows, cols, cells, merges } = useMemo(() => {
    if (!sheetData) return { rows: 0, cols: 0, cells: {}, merges: [] as number[][] };
    const r = Math.min(sheetData.dims.maxRow, MAX_PREVIEW_ROWS);
    const c = Math.min(sheetData.dims.maxCol, MAX_PREVIEW_COLS);
    return {
      rows: r,
      cols: c,
      cells: sheetData.cells || {},
      merges: (sheetData.merges || []).map((m: any) => {
        // merges come as [[minRow, minCol, maxRow, maxCol]] or [["A1","C1"]]
        if (typeof m[0] === 'number') return m;
        // parse string format
        const start = parseCellRef(m[0]);
        const end = parseCellRef(m[1]);
        if (!start || !end) return null;
        return [start.row, start.col, end.row, end.col];
      }).filter(Boolean) as number[][],
    };
  }, [sheetData, activeSheet]);

  const colWidths = sheetData?.colWidths || [];
  const rowHeights = sheetData?.rowHeights || [];

  // Row number column width
  const ROW_NUM_WIDTH = 40;

  const getCellStyle = useCallback((cellKey: string): React.CSSProperties => {
    const c = cells[cellKey];
    if (!c) return { textAlign: 'left' };
    const style: React.CSSProperties = {};
    if (c.bold) style.fontWeight = 'bold';
    if (c.italic) style.fontStyle = 'italic';
    if (c.underline) style.textDecoration = 'underline';
    if (c.bg) style.backgroundColor = c.bg;
    if (c.fg) style.color = c.fg;
    if (c.fontSize) style.fontSize = `${Math.min(c.fontSize, 16)}px`;
    style.textAlign = (c.align === 'general')
      ? (typeof c.v === 'number' ? 'right' : 'left')
      : (c.align as React.CSSProperties['textAlign']) || 'left';
    if (c.wrap) {
      style.whiteSpace = 'pre-wrap';
      style.wordBreak = 'break-word';
    }
    return style;
  }, [cells]);

  if (!sheetData || rows === 0) {
    return <div className="edp-empty">No data found in sheet "{activeSheet}"</div>;
  }

  return (
    <div className="edp-excel-wrapper">
      {/* Sheet tabs */}
      <div className="edp-sheet-tabs">
        {schema.sheets.map(name => (
          <button
            key={name}
            className={`edp-sheet-tab ${activeSheet === name ? 'active' : ''}`}
            onClick={() => setActiveSheet(name)}
          >
            {name}
          </button>
        ))}
        {schema.totalSheets > schema.sheets.length && (
          <span className="edp-more-sheets">
            +{schema.totalSheets - schema.sheets.length} more sheets (not previewed)
          </span>
        )}
      </div>

      {/* Scrollable grid */}
      <div className="edp-grid-scroll">
        <table className="edp-grid-table" cellSpacing={0} cellPadding={0}>
          <colgroup>
            <col style={{ width: `${ROW_NUM_WIDTH}px`, minWidth: `${ROW_NUM_WIDTH}px` }} />
            {Array.from({ length: cols }, (_, ci) => (
              <col
                key={ci}
                style={{
                  width: `${colWidths[ci] ?? 80}px`,
                  minWidth: `${Math.max(colWidths[ci] ?? 80, 40)}px`,
                }}
              />
            ))}
          </colgroup>
          {/* Column headers */}
          <thead>
            <tr>
              <th className="edp-row-num-header" />
              {Array.from({ length: cols }, (_, ci) => (
                <th key={ci} className="edp-col-header">
                  {colIndexToLetter(ci + 1)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, ri) => {
              const rowNum = ri + 1;
              const rowH = rowHeights[ri] ?? 20;
              return (
                <tr key={rowNum} style={{ height: `${Math.max(rowH, 20)}px` }}>
                  <td className="edp-row-num">{rowNum}</td>
                  {Array.from({ length: cols }, (_, ci) => {
                    const colNum = ci + 1;
                    const cellKey = `${colIndexToLetter(colNum)}${rowNum}`;

                    // Skip if this cell is the body of a merged region
                    if (isMergeBody(rowNum, colNum, merges)) return null;

                    // Check if this cell starts a merged region
                    const mergeRange = isMergeStart(rowNum, colNum, merges);
                    const rowSpan = mergeRange ? Math.min(mergeRange[2] - mergeRange[0] + 1, MAX_PREVIEW_ROWS - rowNum + 1) : 1;
                    const colSpan = mergeRange ? Math.min(mergeRange[3] - mergeRange[1] + 1, MAX_PREVIEW_COLS - colNum + 1) : 1;

                    const cell = cells[cellKey];
                    const cellStyle = getCellStyle(cellKey);

                    return (
                      <td
                        key={cellKey}
                        className="edp-cell"
                        rowSpan={rowSpan > 1 ? rowSpan : undefined}
                        colSpan={colSpan > 1 ? colSpan : undefined}
                        style={cellStyle}
                        title={cell ? String(cell.v ?? '') : undefined}
                      >
                        {cell ? String(cell.v ?? '') : ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(rows >= MAX_PREVIEW_ROWS || cols >= MAX_PREVIEW_COLS) && (
        <div className="edp-truncation-note">
          Preview shows first {rows} rows × {cols} columns. Download the file to see all data.
        </div>
      )}
    </div>
  );
};

// ── Word Document Preview ─────────────────────────────────────────────────────

interface WordPreviewProps {
  schema: DocxSchema;
}

const HEADING_STYLES: Record<string, { fontSize: string; fontWeight: string; marginTop: string }> = {
  'Heading 1': { fontSize: '1.6rem', fontWeight: '700', marginTop: '1.4rem' },
  'Heading 2': { fontSize: '1.3rem', fontWeight: '700', marginTop: '1.2rem' },
  'Heading 3': { fontSize: '1.1rem', fontWeight: '600', marginTop: '1rem' },
  'Heading 4': { fontSize: '1rem', fontWeight: '600', marginTop: '0.8rem' },
  'Heading 5': { fontSize: '0.95rem', fontWeight: '600', marginTop: '0.7rem' },
  'Heading 6': { fontSize: '0.9rem', fontWeight: '600', marginTop: '0.6rem' },
  'Title':     { fontSize: '2rem', fontWeight: '700', marginTop: '0' },
  'Subtitle':  { fontSize: '1.2rem', fontWeight: '400', marginTop: '0.2rem' },
};

const WordPreview: React.FC<WordPreviewProps> = ({ schema }) => {
  const renderParagraph = useCallback((para: DocxParagraph, idx: number) => {
    const headingStyle = HEADING_STYLES[para.style] || null;
    const baseStyle: React.CSSProperties = {
      margin: headingStyle ? `${headingStyle.marginTop} 0 0.3rem 0` : '0 0 0.4rem 0',
      fontSize: headingStyle?.fontSize,
      fontWeight: headingStyle?.fontWeight,
      textAlign: (para.alignment as React.CSSProperties['textAlign']) || 'left',
      lineHeight: 1.6,
    };

    const content = para.runs && para.runs.length > 0
      ? para.runs.map((run, ri) => {
          const runStyle: React.CSSProperties = {};
          if (run.bold) runStyle.fontWeight = 'bold';
          if (run.italic) runStyle.fontStyle = 'italic';
          if (run.underline) runStyle.textDecoration = 'underline';
          if (run.fontSize) runStyle.fontSize = `${run.fontSize}pt`;
          if (run.color) runStyle.color = run.color;
          return (
            <span key={ri} style={runStyle}>{run.text}</span>
          );
        })
      : para.text;

    return (
      <p key={idx} style={baseStyle}>{content}</p>
    );
  }, []);

  return (
    <div className="edp-word-wrapper">
      <div className="edp-word-page">
        {schema.paragraphs.map((para, idx) => renderParagraph(para, idx))}
        {schema.tables.map((table, ti) => (
          <table key={`table-${ti}`} className="edp-word-table">
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="edp-word-table-cell"
                      style={{ fontWeight: cell.bold ? 'bold' : undefined }}
                    >
                      {cell.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
};

// ── Main Export: DocumentPreview ──────────────────────────────────────────────

interface DocumentPreviewProps {
  xlsxSchema?: XlsxSchema | null;
  docxSchema?: DocxSchema | null;
  hideDisclaimer?: boolean;
}

const DocumentPreview: React.FC<DocumentPreviewProps> = ({ xlsxSchema, docxSchema, hideDisclaimer = false }) => {
  if (!xlsxSchema && !docxSchema) return null;

  const isWord = !!docxSchema;

  return (
    <div className="edp-root">
      {/* Fidelity disclaimer */}
      {!hideDisclaimer && (
        <div className="edp-disclaimer">
          <AlertTriangle size={13} className="edp-disclaimer-icon" />
          <span>
            {isWord
              ? 'Word document preview is simplified — images, complex layouts, and some formatting are not shown. '
              : 'Spreadsheet preview may not show all formatting (charts, images, custom fonts). '}
            <strong>Download the file to see the exact result.</strong>
          </span>
        </div>
      )}

      {xlsxSchema && <ExcelGrid schema={xlsxSchema} />}
      {docxSchema && <WordPreview schema={docxSchema} />}

      <style>{`
        /* ─── ROOT ─── */
        .edp-root {
          display: flex;
          flex-direction: column;
          gap: 0;
          border-top: 1px solid var(--divider);
          background: var(--bg-surface);
        }

        /* ─── DISCLAIMER BANNER ─── */
        .edp-disclaimer {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px 14px;
          background: rgba(245, 158, 11, 0.07);
          border-bottom: 1px solid rgba(245, 158, 11, 0.2);
          font-size: 0.75rem;
          color: var(--text-secondary);
          line-height: 1.4;
        }
        .edp-disclaimer-icon {
          color: #d97706;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .edp-disclaimer strong {
          color: var(--text-primary);
        }

        /* ─── SHEET TABS ─── */
        .edp-sheet-tabs {
          display: flex;
          align-items: center;
          gap: 0;
          background: var(--bg-muted);
          border-bottom: 1px solid var(--divider);
          overflow-x: auto;
          scrollbar-width: none;
          flex-shrink: 0;
        }
        .edp-sheet-tabs::-webkit-scrollbar { display: none; }

        .edp-sheet-tab {
          padding: 7px 16px;
          font-size: 0.78rem;
          font-weight: 500;
          background: transparent;
          border: none;
          border-right: 1px solid var(--divider);
          color: var(--text-secondary);
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s;
          flex-shrink: 0;
        }
        .edp-sheet-tab:hover {
          background: var(--bg-surface);
          color: var(--text-primary);
        }
        .edp-sheet-tab.active {
          background: var(--bg-surface);
          color: var(--accent);
          font-weight: 600;
          border-bottom: 2px solid var(--accent);
          margin-bottom: -1px;
        }
        .edp-more-sheets {
          padding: 7px 12px;
          font-size: 0.72rem;
          color: var(--text-tertiary);
          white-space: nowrap;
          font-style: italic;
        }

        /* ─── EXCEL WRAPPER ─── */
        .edp-excel-wrapper {
          display: flex;
          flex-direction: column;
          min-height: 0;
        }

        /* ─── GRID SCROLL ─── */
        .edp-grid-scroll {
          overflow: auto;
          max-height: 440px;
          background: #ffffff;
          border-bottom: 1px solid var(--divider);
        }
        :root[data-theme='dark'] .edp-grid-scroll,
        .dark .edp-grid-scroll {
          background: #1e1e1e;
        }

        /* ─── GRID TABLE ─── */
        .edp-grid-table {
          border-collapse: collapse;
          font-family: 'Calibri', 'Segoe UI', system-ui, sans-serif;
          font-size: 12px;
          table-layout: fixed;
          white-space: nowrap;
        }

        /* Column header row */
        .edp-row-num-header {
          width: 40px;
          min-width: 40px;
          background: #f2f2f2;
          border: 1px solid #d0d0d0;
          position: sticky;
          top: 0;
          left: 0;
          z-index: 3;
        }
        :root[data-theme='dark'] .edp-row-num-header,
        .dark .edp-row-num-header {
          background: #2a2a2a;
          border-color: #404040;
        }

        .edp-col-header {
          background: #f2f2f2;
          border: 1px solid #d0d0d0;
          text-align: center;
          font-weight: 600;
          font-size: 11px;
          color: #444;
          position: sticky;
          top: 0;
          z-index: 2;
          padding: 2px 4px;
          user-select: none;
        }
        :root[data-theme='dark'] .edp-col-header,
        .dark .edp-col-header {
          background: #2a2a2a;
          border-color: #404040;
          color: #aaa;
        }

        /* Row number cells */
        .edp-row-num {
          background: #f2f2f2;
          border: 1px solid #d0d0d0;
          text-align: right;
          font-size: 10px;
          color: #666;
          padding: 1px 4px;
          position: sticky;
          left: 0;
          z-index: 1;
          user-select: none;
        }
        :root[data-theme='dark'] .edp-row-num,
        .dark .edp-row-num {
          background: #2a2a2a;
          border-color: #404040;
          color: #888;
        }

        /* Data cells */
        .edp-cell {
          border: 1px solid #d0d0d0;
          padding: 1px 5px;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 300px;
          vertical-align: middle;
          font-size: 12px;
          line-height: 1.3;
          color: #222;
        }
        :root[data-theme='dark'] .edp-cell,
        .dark .edp-cell {
          border-color: #404040;
          color: #e0e0e0;
        }

        .edp-truncation-note {
          padding: 6px 12px;
          font-size: 0.72rem;
          color: var(--text-tertiary);
          background: var(--bg-muted);
          border-top: 1px solid var(--divider);
          text-align: center;
          font-style: italic;
        }

        /* ─── WORD PREVIEW ─── */
        .edp-word-wrapper {
          overflow-y: auto;
          max-height: 500px;
          padding: 24px 32px;
          background: var(--bg-surface);
        }

        .edp-word-page {
          max-width: 680px;
          margin: 0 auto;
          font-family: 'Calibri', 'Georgia', serif;
          font-size: 11pt;
          color: var(--text-primary);
          line-height: 1.6;
        }

        .edp-word-table {
          width: 100%;
          border-collapse: collapse;
          margin: 12px 0;
        }
        .edp-word-table-cell {
          border: 1px solid var(--divider);
          padding: 6px 10px;
          font-size: 0.88rem;
          vertical-align: top;
        }

        /* ─── EMPTY STATE ─── */
        .edp-empty {
          padding: 24px;
          text-align: center;
          color: var(--text-tertiary);
          font-size: 0.85rem;
        }
      `}</style>
    </div>
  );
};

export default DocumentPreview;
