const ctx: Worker = self as any;

let pyodide: any = null;

const OUTPUT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg', 'csv', 'xlsx', 'json', 'txt', 'pdf', 'docx', 'doc'];

function arrayBufferToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  if (!base64) return new Uint8Array(0);
  try {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    console.error('base64ToUint8Array conversion failed:', err);
    return new Uint8Array(0);
  }
}

interface FileMeta {
  mtime: number;
  size: number;
}

function listFilesRecursively(dir: string): string[] {
  const result: string[] = [];
  try {
    const files = pyodide.FS.readdir(dir);
    for (const file of files) {
      if (file === '.' || file === '..') continue;
      const fullPath = dir === '/' ? `/${file}` : `${dir}/${file}`;
      const stat = pyodide.FS.stat(fullPath);
      if (pyodide.FS.isDir(stat.mode)) {
        result.push(...listFilesRecursively(fullPath));
      } else {
        result.push(fullPath);
      }
    }
  } catch {
    // Ignore read errors
  }
  return result;
}

function getFilesMeta(dir: string): Map<string, FileMeta> {
  const meta = new Map<string, FileMeta>();
  const paths = listFilesRecursively(dir);
  for (const p of paths) {
    try {
      const stat = pyodide.FS.stat(p);
      meta.set(p, { mtime: stat.mtime, size: stat.size });
    } catch {
      // Ignore stat errors
    }
  }
  return meta;
}

function rmRecursive(py: any, path: string) {
  const stat = py.FS.stat(path);
  if (py.FS.isDir(stat.mode)) {
    for (const name of py.FS.readdir(path)) {
      if (name === '.' || name === '..') continue;
      rmRecursive(py, path.endsWith('/') ? `${path}${name}` : `${path}/${name}`);
    }
    py.FS.rmdir(path);
  } else {
    py.FS.unlink(path);
  }
}

/** Wipe output files from prior artifact runs in this shared worker. */
function clearWorkspace(py: any) {
  const dir = '/home/pyodide';
  try {
    for (const name of py.FS.readdir(dir)) {
      if (name === '.' || name === '..') continue;
      rmRecursive(py, `${dir}/${name}`);
    }
  } catch {
    // Directory may not exist yet on first run
  }
}

function extractPythonError(err: any): string {
  if (!err) return 'Unknown error';
  const full = typeof err.toString === 'function' ? err.toString() : String(err);
  if (err.message === 'PythonError' || err.type || (err.constructor && err.constructor.name === 'PythonError')) {
    return full;
  }
  return err.message || full;
}

async function initPyodide(artifactId: string) {
  if (pyodide) return pyodide;

  ctx.postMessage({
    type: 'status',
    artifactId,
    status: 'loading_pyodide',
    message: 'Setting up Python environment (~10MB first load)...'
  });

  const pyodideModule = await (Function('u', 'return import(u)')(
    'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.mjs'
  ));
  pyodide = await pyodideModule.loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/',
  });

  // Pre-load micropip for package installs
  ctx.postMessage({
    type: 'status',
    artifactId,
    status: 'loading_micropip',
    message: 'Preparing package installer...'
  });
  await pyodide.loadPackage('micropip');

  await pyodide.runPythonAsync(`
import os
os.makedirs('/home/pyodide', exist_ok=True)
os.chdir('/home/pyodide')
  `);

  ctx.postMessage({
    type: 'status',
    artifactId,
    status: 'ready',
    message: 'Pyodide initialized.'
  });

  return pyodide;
}

async function installPackagesDynamic(
  py: any,
  packages: string[],
  code: string,
  artifactId: string
): Promise<void> {
  // Step 1: Let Pyodide auto-detect and load its own native packages
  // from import statements in the code
  try {
    ctx.postMessage({
      type: 'status',
      artifactId,
      status: 'installing_packages',
      message: 'Scanning imports...',
    });
    await py.loadPackagesFromImports(code);
  } catch (err) {
    console.warn('loadPackagesFromImports error:', err);
  }

  // Step 2: For explicitly requested packages, check Pyodide's runtime registry
  if (packages.length === 0) return;

  const repoPackages: Record<string, unknown> = py._api?.repodata_packages ?? {};
  const alreadyLoaded = new Set(Object.keys(py.loadedPackages ?? {}));

  const nativeToLoad: string[] = [];
  const pipToInstall: string[] = [];

  for (const pkg of packages) {
    const normalized = pkg.trim().toLowerCase();
    if (!normalized) continue;
    if (alreadyLoaded.has(pkg) || alreadyLoaded.has(normalized)) continue;

    const isNative =
      normalized in repoPackages ||
      pkg in repoPackages ||
      Object.keys(repoPackages).some((k) => k.toLowerCase() === normalized);

    if (isNative) {
      nativeToLoad.push(pkg);
    } else {
      pipToInstall.push(pkg);
    }
  }

  if (nativeToLoad.length > 0) {
    ctx.postMessage({
      type: 'status',
      artifactId,
      status: 'installing_packages',
      message: `Loading ${nativeToLoad.join(', ')}...`,
    });
    await py.loadPackage(nativeToLoad);
  }

  if (pipToInstall.length > 0) {
    ctx.postMessage({
      type: 'status',
      artifactId,
      status: 'installing_packages',
      message: `Downloading ${pipToInstall.join(', ')} from PyPI...`,
    });
    await py.loadPackage('micropip');
    const micropip = py.pyimport('micropip');
    await Promise.all(
      pipToInstall.map((pkg) =>
        micropip.install(pkg).catch((err: unknown) => {
          console.warn(`micropip could not install ${pkg}:`, err);
        })
      )
    );
  }
}

// ── XLSX Schema Extraction ────────────────────────────────────────────────────

const XLSX_EXTRACTOR_PYTHON = `
import json, openpyxl
from openpyxl.utils import get_column_letter

MAX_SHEETS = 5
MAX_ROWS = 500
MAX_COLS = 50

def _argb_to_hex(argb):
    if not argb or argb == '00000000':
        return None
    try:
        s = str(argb)
        if len(s) == 8:
            return '#' + s[2:]
        if len(s) == 6:
            return '#' + s
    except Exception:
        pass
    return None

def _cell_color(cell):
    try:
        fill = cell.fill
        if fill and fill.fgColor and fill.patternType and fill.patternType != 'none':
            c = fill.fgColor
            if c.type == 'rgb':
                return _argb_to_hex(c.rgb)
            if c.type == 'indexed' and c.indexed not in (0, 64):
                return None
    except Exception:
        pass
    return None

def _font_color(cell):
    try:
        f = cell.font
        if f and f.color and f.color.type == 'rgb':
            return _argb_to_hex(f.color.rgb)
    except Exception:
        pass
    return None

def _align(cell):
    try:
        a = cell.alignment
        if a and a.horizontal and a.horizontal != 'general':
            return a.horizontal
    except Exception:
        pass
    return None

def extract_xlsx(path):
    try:
        wb = openpyxl.load_workbook(path, data_only=True, read_only=False)
    except Exception as e:
        return json.dumps({'error': str(e)})

    all_sheets = wb.sheetnames
    total_sheets = len(all_sheets)
    sheets_to_extract = all_sheets[:MAX_SHEETS]
    active_name = wb.active.title if wb.active else (sheets_to_extract[0] if sheets_to_extract else '')

    result = {
        'sheets': sheets_to_extract,
        'totalSheets': total_sheets,
        'activeSheet': active_name if active_name in sheets_to_extract else sheets_to_extract[0] if sheets_to_extract else '',
        'data': {}
    }

    for sheet_name in sheets_to_extract:
        ws = wb[sheet_name]
        max_row = min(ws.max_row or 0, MAX_ROWS)
        max_col = min(ws.max_column or 0, MAX_COLS)

        # Column widths (convert from Excel units to approximate pixels: *7 + 5)
        col_widths = []
        for ci in range(1, max_col + 1):
            letter = get_column_letter(ci)
            cd = ws.column_dimensions.get(letter)
            if cd and cd.width and cd.width > 0:
                col_widths.append(round(cd.width * 7 + 5))
            else:
                col_widths.append(75)  # default

        # Row heights (Excel units ~= pixels * 0.75, so pixels = units / 0.75)
        row_heights = []
        for ri in range(1, max_row + 1):
            rd = ws.row_dimensions.get(ri)
            if rd and rd.height and rd.height > 0:
                row_heights.append(round(rd.height / 0.75))
            else:
                row_heights.append(20)  # default

        # Merged cells
        merges = []
        for m in ws.merged_cells.ranges:
            merges.append([m.min_row, m.min_col, m.max_row, m.max_col])

        # Cells
        cells = {}
        for ri in range(1, max_row + 1):
            for ci in range(1, max_col + 1):
                cell = ws.cell(row=ri, column=ci)
                v = cell.value
                if v is None:
                    continue
                letter = get_column_letter(ci)
                key = f"{letter}{ri}"
                cell_data = {'v': str(v) if not isinstance(v, (int, float, bool)) else v}
                try:
                    f = cell.font
                    if f:
                        if f.bold: cell_data['bold'] = True
                        if f.italic: cell_data['italic'] = True
                        if f.underline: cell_data['underline'] = True
                        if f.size: cell_data['fontSize'] = f.size
                        fc = _font_color(cell)
                        if fc: cell_data['fg'] = fc
                except Exception:
                    pass
                bg = _cell_color(cell)
                if bg: cell_data['bg'] = bg
                al = _align(cell)
                if al: cell_data['align'] = al
                try:
                    if cell.number_format and cell.number_format != 'General':
                        cell_data['numFmt'] = cell.number_format
                except Exception:
                    pass
                cells[key] = cell_data

        result['data'][sheet_name] = {
            'dims': {'maxRow': max_row, 'maxCol': max_col},
            'colWidths': col_widths,
            'rowHeights': row_heights,
            'cells': cells,
            'merges': merges,
        }

    return json.dumps(result)

_xlsx_schema_result = extract_xlsx(_xlsx_extract_path)
`;

async function extractXlsxSchema(py: any, filePath: string, artifactId: string): Promise<object | null> {
  try {
    ctx.postMessage({
      type: 'status',
      artifactId,
      status: 'extracting_schema',
      message: 'Reading spreadsheet data for live preview...',
    });

    // Make sure openpyxl is available
    try {
      await py.loadPackagesFromImports('import openpyxl');
    } catch { /* already loaded */ }

    py.globals.set('_xlsx_extract_path', filePath);
    await py.runPythonAsync(XLSX_EXTRACTOR_PYTHON);
    const jsonStr: string = py.globals.get('_xlsx_schema_result');
    if (!jsonStr) return null;
    const parsed = JSON.parse(jsonStr);
    if (parsed.error) {
      console.warn('[xlsxSchema] extraction error:', parsed.error);
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('[xlsxSchema] extraction failed:', err);
    return null;
  }
}

// ── DOCX Schema Extraction ────────────────────────────────────────────────────

const DOCX_EXTRACTOR_PYTHON = `
import json

def extract_docx(path):
    try:
        from docx import Document
        from docx.oxml.ns import qn
    except ImportError:
        return json.dumps({'error': 'python-docx not installed'})

    try:
        doc = Document(path)
    except Exception as e:
        return json.dumps({'error': str(e)})

    MAX_PARAGRAPHS = 300
    paragraphs = []
    for i, para in enumerate(doc.paragraphs):
        if i >= MAX_PARAGRAPHS:
            break
        if not para.text.strip():
            continue
        p_data = {
            'style': para.style.name if para.style else 'Normal',
            'text': para.text,
        }
        runs_data = []
        for run in para.runs:
            if not run.text:
                continue
            r = {'text': run.text}
            if run.bold: r['bold'] = True
            if run.italic: r['italic'] = True
            if run.underline: r['underline'] = True
            if run.font.size:
                try: r['fontSize'] = round(run.font.size.pt)
                except Exception: pass
            if run.font.color and run.font.color.type == 'rgb':
                try:
                    rgb = run.font.color.rgb
                    r['color'] = f'#{str(rgb)}'
                except Exception: pass
            runs_data.append(r)
        if runs_data:
            p_data['runs'] = runs_data
        if para.alignment is not None:
            try:
                align_map = {0: 'left', 1: 'center', 2: 'right', 3: 'justify'}
                p_data['alignment'] = align_map.get(para.alignment.value, 'left')
            except Exception: pass
        paragraphs.append(p_data)

    tables_data = []
    for table in doc.tables[:20]:
        rows_data = []
        for row in table.rows:
            cells_data = []
            for cell in row.cells:
                cd = {'text': cell.text}
                # Check if first para is bold
                try:
                    if cell.paragraphs and cell.paragraphs[0].runs:
                        if cell.paragraphs[0].runs[0].bold:
                            cd['bold'] = True
                except Exception: pass
                cells_data.append(cd)
            rows_data.append(cells_data)
        tables_data.append({'rows': rows_data})

    return json.dumps({'paragraphs': paragraphs, 'tables': tables_data})

_docx_schema_result = extract_docx(_docx_extract_path)
`;

async function extractDocxSchema(py: any, filePath: string, artifactId: string): Promise<object | null> {
  try {
    ctx.postMessage({
      type: 'status',
      artifactId,
      status: 'extracting_schema',
      message: 'Reading document structure for preview...',
    });

    // Make sure python-docx is available (it may need micropip install)
    try {
      const micropip = py.pyimport('micropip');
      await micropip.install('python-docx').catch(() => {/* already installed */});
    } catch { /* ignore */ }

    py.globals.set('_docx_extract_path', filePath);
    await py.runPythonAsync(DOCX_EXTRACTOR_PYTHON);
    const jsonStr: string = py.globals.get('_docx_schema_result');
    if (!jsonStr) return null;
    const parsed = JSON.parse(jsonStr);
    if (parsed.error) {
      console.warn('[docxSchema] extraction error:', parsed.error);
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('[docxSchema] extraction failed:', err);
    return null;
  }
}

// ── Main message handler ──────────────────────────────────────────────────────

ctx.addEventListener('message', async (e: MessageEvent) => {
  const d = e.data;
  if (!d || d.type !== 'run') return;

  const { code, packages = [], mode: _mode, artifactId } = d;

  try {
    // 1. Lazy load Pyodide
    const py = await initPyodide(artifactId);

    const packageList = [...new Set(
      (packages as string[])
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 0)
    )];

    // 2. Dynamic package installation (imports + packages attribute)
    await installPackagesDynamic(py, packageList, code, artifactId);

    clearWorkspace(py);

    // Track input file names so we can exclude them from the output scan
    const inputFileNames = new Set<string>();

    // Write input files
    if (d.inputFiles && Array.isArray(d.inputFiles)) {
      for (const file of d.inputFiles) {
        try {
          const bytes = base64ToUint8Array(file.data || (file as any).base64);
          py.FS.writeFile(`/home/pyodide/${file.name}`, bytes);
          inputFileNames.add(file.name);
          ctx.postMessage({
            type: 'status',
            artifactId,
            status: 'loading_file',
            message: `Loaded: ${file.name}`
          });
        } catch (err: any) {
          throw new Error(
            `Failed to load "${file.name}": ${err.message}`
          );
        }
      }
    }

    ctx.postMessage({
      type: 'status',
      artifactId,
      status: 'running',
      message: 'Executing script...'
    });

    // 3. Snapshot FS before execution
    const beforeMeta = getFilesMeta('/home/pyodide');

    // 5. Redirect stdout/stderr & Inject Matplotlib backend
    await py.runPythonAsync(`
import sys, io
sys._lucen_orig_stdout = sys.stdout
sys._lucen_orig_stderr = sys.stderr
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
    `);

    if (code.includes('matplotlib') || code.includes('plt.')) {
      try {
        await py.runPythonAsync(`
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as _plt
    _plt.show = lambda *args, **kwargs: None
except Exception:
    pass
        `);
      } catch { /* ignore */ }
    }

    // 6. Run the code
    let runError: string | null = null;
    try {
      await py.runPythonAsync(code);
    } catch (err: any) {
      runError = extractPythonError(err);
    }

    // 7. Get outputs and restore streams
    let stdout = '';
    let stderr = '';
    try {
      stdout = py.runPython('sys.stdout.getvalue()') ?? '';
      stderr = py.runPython('sys.stderr.getvalue()') ?? '';
    } catch {
      stdout = '[output capture failed]';
    }

    try {
      await py.runPythonAsync(`
try:
    import sys, io
    sys.stdout = getattr(sys, '_lucen_orig_stdout', 
                         sys.__stdout__ or io.StringIO())
    sys.stderr = getattr(sys, '_lucen_orig_stderr', 
                         sys.__stderr__ or io.StringIO())
except Exception:
    pass
      `);
    } catch { /* ignore */ }

    // 8. Scan FS for new/modified files
    let outputFiles: Array<{ name: string; data: string; mimeType: string }> = [];
    let xlsxOutputPath: string | null = null;
    let docxOutputPath: string | null = null;

    try {
      const afterMeta = getFilesMeta('/home/pyodide');

      for (const [p, meta] of afterMeta.entries()) {
        // Skip files that were written as inputs — they are not outputs
        const shortName = p.replace(/^\/home\/pyodide\//, '');
        if (inputFileNames.has(shortName)) continue;

        const before = beforeMeta.get(p);
        const isNewOrChanged = !before || before.size !== meta.size || before.mtime !== meta.mtime;
        if (!isNewOrChanged) continue;

        const ext = p.split('.').pop()?.toLowerCase();
        if (!ext || !OUTPUT_EXTENSIONS.includes(ext)) continue;

        try {
          const contentBytes = py.FS.readFile(p);
          const base64Data = arrayBufferToBase64(contentBytes);

          let mimeType = 'text/plain';
          if (ext === 'png') mimeType = 'image/png';
          else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
          else if (ext === 'svg') mimeType = 'image/svg+xml';
          else if (ext === 'csv') mimeType = 'text/csv';
          else if (ext === 'xlsx') {
            mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            if (!xlsxOutputPath) xlsxOutputPath = p;
          } else if (ext === 'xls') {
            mimeType = 'application/vnd.ms-excel';
          } else if (ext === 'docx') {
            mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            if (!docxOutputPath) docxOutputPath = p;
          } else if (ext === 'json') mimeType = 'application/json';
          else if (ext === 'pdf') mimeType = 'application/pdf';

          outputFiles.push({ name: shortName, data: base64Data, mimeType });
        } catch (err) {
          console.error(`Failed to read output file ${p}`, err);
        }
      }
    } catch (err) {
      console.warn('FS scan failed:', err);
    }

    // 9. Schema extraction — always attempt if file exists, even if script had an error
    //    (the file may have been partially written and still readable)
    let xlsxSchema: object | null = null;
    let docxSchema: object | null = null;

    if (xlsxOutputPath) {
      try {
        xlsxSchema = await extractXlsxSchema(py, xlsxOutputPath, artifactId);
      } catch (err) {
        console.debug('[schema] xlsx extraction failed silently:', err);
      }
    }

    if (docxOutputPath) {
      try {
        docxSchema = await extractDocxSchema(py, docxOutputPath, artifactId);
      } catch (err) {
        console.debug('[schema] docx extraction failed silently:', err);
      }
    }

    // 10. Post back results
    ctx.postMessage({
      type: 'result',
      artifactId,
      stdout,
      stderr,
      files: outputFiles,
      error: runError,
      xlsxSchema,
      docxSchema,
    });

  } catch (err: any) {
    ctx.postMessage({
      type: 'result',
      artifactId,
      stdout: '',
      stderr: '',
      files: [],
      error: extractPythonError(err),
      xlsxSchema: null,
      docxSchema: null,
    });
  }
});
