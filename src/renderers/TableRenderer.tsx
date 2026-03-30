import React, { useMemo, useState } from 'react';

type Align = 'left' | 'center' | 'right';

const stylesId = 'lucen-table-renderer-styles';
let stylesInjected = false;

function ensureStylesInjected() {
  if (stylesInjected) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById(stylesId)) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.id = stylesId;
  style.textContent = `
    .lucen-table-wrapper {
      overflow-x: auto;
      margin: 0.75rem 0;
      border-radius: var(--border-radius-lg, 12px);
      border: 1px solid var(--color-border-tertiary, var(--divider));
    }
    .lucen-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    .lucen-table th {
      padding: 10px 14px;
      text-align: left;
      font-weight: 500;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: var(--color-background-secondary, var(--bg-muted));
      border-bottom: 1px solid var(--color-border-secondary, var(--divider));
      color: var(--color-text-secondary, var(--text-secondary));
      white-space: nowrap;
      user-select: none;
    }
    .lucen-table td {
      padding: 9px 14px;
      border-bottom: 1px solid var(--color-border-tertiary, var(--divider));
      vertical-align: top;
      color: var(--color-text-primary, var(--text-primary));
    }
    .lucen-table tbody tr:last-child td {
      border-bottom: none;
    }
    .lucen-table tbody tr:hover td {
      background: var(--color-background-secondary, var(--bg-surface-hover));
    }
    .lucen-table-sortable {
      cursor: pointer;
    }
    .lucen-table-sort-indicator {
      display: inline-block;
      margin-left: 8px;
      opacity: 0.55;
      font-size: 12px;
      transform: translateY(-1px);
    }
  `;
  document.head.appendChild(style);
}

function parseRow(line: string): string[] {
  const trimmed = line.trim();
  const noOuter = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return noOuter.split('|').map((c) => c.trim());
}

function parseAlignment(line: string, colCount: number): Align[] {
  const cells = parseRow(line);
  const aligns: Align[] = [];
  for (let i = 0; i < colCount; i++) {
    const cell = cells[i] ?? '';
    const t = cell.trim();
    const starts = t.startsWith(':');
    const ends = t.endsWith(':');
    if (starts && ends) aligns.push('center');
    else if (ends) aligns.push('right');
    else aligns.push('left');
  }
  return aligns;
}

function tryParseNumeric(value: string): number | null {
  const t = value.trim();
  if (!t) return null;
  const normalized = t.replace(/,/g, '');
  const n = Number(normalized);
  if (Number.isFinite(n)) return n;
  return null;
}

export interface TableRendererProps {
  content: string;
}

const TableRenderer: React.FC<TableRendererProps> = ({ content }) => {
  ensureStylesInjected();

  const parsed = useMemo(() => {
    const lines = content
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().startsWith('|'));

    if (lines.length < 2) {
      return null;
    }

    const header = parseRow(lines[0]);
    const alignRow = lines[1];
    const aligns = parseAlignment(alignRow, header.length);

    const rows = lines.slice(2).map((l) => parseRow(l).slice(0, header.length));
    // Normalize row widths
    const normalizedRows = rows.map((r) => {
      const out = [...r];
      while (out.length < header.length) out.push('');
      return out;
    });

    return { header, aligns, rows: normalizedRows };
  }, [content]);

  const [sortState, setSortState] = useState<{ colIndex: number; dir: 1 | -1 | 0 } | null>(null);

  const sortInfo = useMemo(() => {
    if (!parsed) return [];
    const { header, rows } = parsed;
    return header.map((_, colIndex): { sortable: boolean; mode: 'numeric' | 'string' | null } => {
      const values = rows.map((r) => (r[colIndex] ?? '').trim());
      const numeric = values.map((v) => tryParseNumeric(v));
      const allNumeric = numeric.every((n) => n !== null);
      if (allNumeric) return { sortable: true, mode: 'numeric' };

      const allString = values.every((v) => !tryParseNumeric(v));
      if (allString) return { sortable: true, mode: 'string' };

      return { sortable: false, mode: null };
    });
  }, [parsed]);

  const sortedRows = useMemo(() => {
    if (!parsed) return null;
    const { rows } = parsed;
    if (!sortState || sortState.dir === 0) return rows;

    const colIndex = sortState.colIndex;
    const info = sortInfo[colIndex];
    if (!info?.sortable) return rows;

    const withIndex = rows.map((r, idx) => ({ r, idx }));
    withIndex.sort((a, b) => {
      const av = (a.r[colIndex] ?? '').trim();
      const bv = (b.r[colIndex] ?? '').trim();
      let cmp = 0;
      if (info.mode === 'numeric') {
        const an = tryParseNumeric(av) ?? 0;
        const bn = tryParseNumeric(bv) ?? 0;
        cmp = an - bn;
      } else {
        cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      }
      if (cmp === 0) return a.idx - b.idx; // stable
      return cmp * sortState.dir;
    });
    return withIndex.map((x) => x.r);
  }, [parsed, sortInfo, sortState]);

  const handleHeaderClick = (colIndex: number) => {
    const info = sortInfo[colIndex];
    if (!info?.sortable) return;

    setSortState((prev) => {
      if (!prev || prev.colIndex !== colIndex) return { colIndex, dir: 1 };
      if (prev.dir === 1) return { colIndex, dir: -1 };
      if (prev.dir === -1) return { colIndex, dir: 0 };
      return { colIndex, dir: 0 };
    });
  };

  if (!parsed || !sortedRows) {
    return (
      <div className="lucen-table-wrapper">
        <table className="lucen-table">
          <tbody>
            <tr>
              <td>{content}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  const { header, aligns } = parsed;

  return (
    <div className="lucen-table-wrapper">
      <table className="lucen-table">
        <thead>
          <tr>
            {header.map((h, colIndex) => {
              const info = sortInfo[colIndex];
              const sortable = info?.sortable;
              const active = sortState?.colIndex === colIndex;
              const dir = sortState?.dir ?? 0;
              const indicator = !sortable
                ? null
                : active
                  ? dir === 1
                    ? '↑'
                    : dir === -1
                      ? '↓'
                      : '↕'
                  : '↕';

              return (
                <th
                  key={`${h}-${colIndex}`}
                  style={{ textAlign: aligns[colIndex] }}
                  className={sortable ? 'lucen-table-sortable' : undefined}
                  onClick={() => handleHeaderClick(colIndex)}
                  role={sortable ? 'button' : undefined}
                  tabIndex={sortable ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (!sortable) return;
                    if (e.key === 'Enter' || e.key === ' ') handleHeaderClick(colIndex);
                  }}
                  aria-sort={
                    !sortable ? undefined : active ? (dir === 1 ? 'ascending' : dir === -1 ? 'descending' : 'none') : 'none'
                  }
                >
                  {h}
                  {indicator ? <span className="lucen-table-sort-indicator">{indicator}</span> : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, colIndex) => (
                <td key={colIndex} style={{ textAlign: aligns[colIndex] }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default TableRenderer;

