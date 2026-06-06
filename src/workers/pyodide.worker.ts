const ctx: Worker = self as any;

let pyodide: any = null;

// Output extensions to capture
const OUTPUT_EXTENSIONS = ['xlsx', 'xls', 'csv', 'png', 'jpg', 'jpeg', 'pdf', 'json', 'txt', 'zip'];

// Pre-loaded native packages (available in Pyodide without micropip)
const NATIVE_PACKAGES = [
  'openpyxl', 'xlsxwriter', 'pandas', 'numpy', 'matplotlib', 'Pillow',
  'scipy', 'sympy', 'lxml', 'beautifulsoup4', 'networkx', 'tabulate',
  'jinja2', 'pyyaml', 'jsonschema',
];

function arrayBufferToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  if (!base64) return new Uint8Array(0);
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    console.error('base64ToUint8Array conversion failed:', err);
    return new Uint8Array(0);
  }
}

interface FileMeta { mtime: number; size: number; }

function listFilesRecursively(dir: string): string[] {
  const result: string[] = [];
  try {
    const files = pyodide.FS.readdir(dir);
    for (const file of files) {
      if (file === '.' || file === '..') continue;
      const fullPath = `${dir}/${file}`;
      const stat = pyodide.FS.stat(fullPath);
      if (pyodide.FS.isDir(stat.mode)) {
        result.push(...listFilesRecursively(fullPath));
      } else {
        result.push(fullPath);
      }
    }
  } catch { /* ignore */ }
  return result;
}

function getFilesMeta(dir: string): Map<string, FileMeta> {
  const meta = new Map<string, FileMeta>();
  for (const p of listFilesRecursively(dir)) {
    try {
      const stat = pyodide.FS.stat(p);
      meta.set(p, { mtime: stat.mtime, size: stat.size });
    } catch { /* ignore */ }
  }
  return meta;
}

function rmRecursive(py: any, path: string) {
  try {
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
  } catch { /* ignore */ }
}

function clearWorkspace(py: any) {
  const dir = '/home/pyodide';
  try {
    for (const name of py.FS.readdir(dir)) {
      if (name === '.' || name === '..') continue;
      rmRecursive(py, `${dir}/${name}`);
    }
  } catch { /* directory may not exist yet */ }
}

/**
 * Extract meaningful error messages from Pyodide PythonError exceptions.
 * Pyodide throws a generic "PythonError" but the real traceback is in .stack.
 */
function extractPythonError(err: any): string {
  if (!err) return 'Unknown error';

  const msg = err.message || '';
  const stack = err.stack || '';
  const full = typeof err.toString === 'function' ? err.toString() : String(err);

  // If we have a python traceback in the message, stack, or toString, use it
  if (msg.includes('Traceback')) return msg;
  if (stack.includes('Traceback')) return stack;
  if (full.includes('Traceback')) return full;

  // Handle module not found gracefully
  if (msg.includes('ModuleNotFoundError') || msg.includes('No module named')) {
    const moduleName = msg.match(/No module named '?([^'"\s]+)'?/)?.[1] || 'unknown';
    return `ModuleNotFoundError: No module named '${moduleName}'\n\nThis package is not available in the browser Python environment. Available packages: ${NATIVE_PACKAGES.join(', ')}\n\nTo use this package, download the .py file and run it locally with: pip install ${moduleName}`;
  }

  // Fallback for generic "PythonError" or any error without a Python Traceback
  if (msg.trim() === 'PythonError' || full.trim() === 'PythonError') {
    let details = "PythonError (Traceback missing)";
    if (stack && stack !== 'PythonError') {
      details += "\n\nStack:\n" + stack;
    }
    try {
      details += "\n\nObject dump:\n" + JSON.stringify(err, Object.getOwnPropertyNames(err), 2);
    } catch(e) {}
    return details;
  }

  return stack || msg || full;
}

async function initPyodide(artifactId: string) {
  if (pyodide) return pyodide;

  ctx.postMessage({
    type: 'status', artifactId, stage: 'init',
    message: 'Setting up Python environment (~10MB first load)...'
  });

  const pyodideModule = await (Function('u', 'return import(u)')(
    'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.mjs'
  ));
  pyodide = await pyodideModule.loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/',
  });

  // Pre-load micropip for dynamic package installs
  ctx.postMessage({
    type: 'status', artifactId, stage: 'packages',
    message: 'Preparing package installer...'
  });
  await pyodide.loadPackage('micropip');

  // Pre-load all native packages
  ctx.postMessage({
    type: 'status', artifactId, stage: 'packages',
    message: 'Loading Excel libraries...'
  });
  await pyodide.loadPackage(NATIVE_PACKAGES);

  await pyodide.runPythonAsync(`
import os
os.makedirs('/home/pyodide', exist_ok=True)
os.chdir('/home/pyodide')
`);

  ctx.postMessage({
    type: 'status', artifactId, stage: 'ready',
    message: 'Ready.'
  });

  return pyodide;
}

/**
 * Auto-detect imports from code and install missing packages.
 * Uses Pyodide's loadPackagesFromImports + micropip for fallback.
 */
async function installPackagesDynamic(
  py: any,
  packages: string[],
  code: string,
  artifactId: string
): Promise<void> {
  // Step 1: Let Pyodide auto-detect and load packages from import statements
  try {
    ctx.postMessage({
      type: 'status', artifactId, stage: 'packages',
      message: 'Scanning imports...'
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
      type: 'status', artifactId, stage: 'packages',
      message: `Loading ${nativeToLoad.join(', ')}...`
    });
    await py.loadPackage(nativeToLoad);
  }

  if (pipToInstall.length > 0) {
    ctx.postMessage({
      type: 'status', artifactId, stage: 'packages',
      message: `Downloading ${pipToInstall.join(', ')} from PyPI...`
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
import json, openpyxl, colorsys
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

def get_theme_colors(wb):
    try:
        from openpyxl.xml.functions import QName, fromstring
        xlmns = 'http://schemas.openxmlformats.org/drawingml/2006/main'
        root = fromstring(wb.loaded_theme)
        theme_el = root.find(QName(xlmns, 'themeElements').text)
        color_scheme = theme_el.find(QName(xlmns, 'clrScheme').text)

        colors = []
        for c in ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2',
                  'accent3', 'accent4', 'accent5', 'accent6']:
            accent = color_scheme.find(QName(xlmns, c).text)
            default_color = 'FFFFFF' if c.startswith('lt') else '000000'
            if accent is not None:
                srgb = accent.find(QName(xlmns, 'srgbClr').text)
                if srgb is not None:
                    colors.append(srgb.attrib['val'])
                    continue
                sys = accent.find(QName(xlmns, 'sysClr').text)
                if sys is not None:
                    colors.append(sys.attrib.get('lastClr', default_color))
                    continue
            colors.append(default_color)
        return colors
    except Exception:
        return [
            "FFFFFF", "000000", "E7E6E6", "44546A",
            "5B9BD5", "ED7D31", "A5A5A5", "FFC000",
            "4472C4", "70AD47",
        ]

def apply_excel_tint(base_hex, tint):
    if not tint:
        return '#' + base_hex
    try:
        r = int(base_hex[0:2], 16)
        g = int(base_hex[2:4], 16)
        b = int(base_hex[4:6], 16)
        h, l, s = colorsys.rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)
        if tint > 0:
            l = l + (1.0 - l) * tint
        else:
            l = l * (1.0 + tint)
        r_new, g_new, b_new = colorsys.hls_to_rgb(h, l, s)
        rn = max(0, min(255, int(round(r_new * 255))))
        gn = max(0, min(255, int(round(g_new * 255))))
        bn = max(0, min(255, int(round(b_new * 255))))
        return f"#{rn:02x}{gn:02x}{bn:02x}"
    except Exception:
        return '#' + base_hex

def _cell_color(cell, theme_colors):
    try:
        fill = cell.fill
        if fill and fill.fgColor and fill.patternType and fill.patternType != 'none':
            c = fill.fgColor
            if c.type == 'rgb':
                return _argb_to_hex(c.rgb)
            if c.type == 'theme' and c.theme is not None:
                theme_idx = c.theme
                if 0 <= theme_idx < len(theme_colors):
                    return apply_excel_tint(theme_colors[theme_idx], c.tint or 0.0)
            if c.type == 'indexed' and c.indexed is not None:
                from openpyxl.styles.colors import COLOR_INDEX
                if 0 <= c.indexed < len(COLOR_INDEX):
                    return _argb_to_hex(COLOR_INDEX[c.indexed])
    except Exception:
        pass
    return None

def _font_color(cell, theme_colors):
    try:
        f = cell.font
        if f and f.color:
            c = f.color
            if c.type == 'rgb':
                return _argb_to_hex(c.rgb)
            if c.type == 'theme' and c.theme is not None:
                theme_idx = c.theme
                if 0 <= theme_idx < len(theme_colors):
                    return apply_excel_tint(theme_colors[theme_idx], c.tint or 0.0)
            if c.type == 'indexed' and c.indexed is not None:
                from openpyxl.styles.colors import COLOR_INDEX
                if 0 <= c.indexed < len(COLOR_INDEX):
                    return _argb_to_hex(COLOR_INDEX[c.indexed])
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

    theme_colors = get_theme_colors(wb)
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

        col_widths = []
        for ci in range(1, max_col + 1):
            letter = get_column_letter(ci)
            w = ws.column_dimensions.get(letter)
            col_widths.append(int((w.width or 8.43) * 7 + 5) if w else 64)

        row_heights = []
        for ri in range(1, max_row + 1):
            h = ws.row_dimensions.get(ri)
            row_heights.append(int((h.height or 15) * 1.33) if h else 20)

        cells = {}
        for ri in range(1, max_row + 1):
            for ci in range(1, max_col + 1):
                cell = ws.cell(row=ri, column=ci)
                if cell.value is None:
                    continue
                key = f"{get_column_letter(ci)}{ri}"
                entry: dict = {'v': str(cell.value) if not isinstance(cell.value, (int, float)) else cell.value}
                try:
                    if cell.font and cell.font.bold:
                        entry['bold'] = True
                except Exception:
                    pass
                try:
                    if cell.font and cell.font.italic:
                        entry['italic'] = True
                except Exception:
                    pass
                try:
                    if cell.font and cell.font.underline and cell.font.underline != 'none':
                        entry['underline'] = True
                except Exception:
                    pass
                bg = _cell_color(cell, theme_colors)
                if bg:
                    entry['bg'] = bg
                fg = _font_color(cell, theme_colors)
                if fg:
                    entry['fg'] = fg
                al = _align(cell)
                if al:
                    entry['align'] = al
                try:
                    if cell.font and cell.font.size:
                        entry['fontSize'] = cell.font.size
                except Exception:
                    pass
                try:
                    nf = cell.number_format
                    if nf and nf != 'General':
                        entry['numFmt'] = nf
                except Exception:
                    pass
                try:
                    if cell.alignment and cell.alignment.wrap_text:
                        entry['wrap'] = True
                except Exception:
                    pass
                cells[key] = entry

        merges = []
        for merge in ws.merged_cells.ranges:
            try:
                tl = str(merge).split(':')[0]
                br = str(merge).split(':')[1]
                merges.append([tl, br])
            except Exception:
                pass

        result['data'][sheet_name] = {
            'dims': {'maxRow': max_row, 'maxCol': max_col},
            'colWidths': col_widths,
            'rowHeights': row_heights,
            'cells': cells,
            'merges': merges,
        }

    return json.dumps(result)
`;

function getMimeType(ext: string): string {
  const types: Record<string, string> = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    csv: 'text/csv',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    pdf: 'application/pdf',
    json: 'application/json',
    txt: 'text/plain',
    zip: 'application/zip',
  };
  return types[ext] || 'application/octet-stream';
}

ctx.addEventListener('message', async (e: MessageEvent) => {
  const d = e.data;
  if (!d || d.type !== 'run') return;

  const { code, artifactId, inputFiles, packages } = d;

  try {
    const py = await initPyodide(artifactId);
    clearWorkspace(py);

    // Mount input files
    if (inputFiles && Array.isArray(inputFiles)) {
      for (const file of inputFiles) {
        try {
          py.FS.writeFile(`/home/pyodide/${file.name}`, base64ToUint8Array(file.data));
          ctx.postMessage({
            type: 'status', artifactId, stage: 'input',
            message: `Loaded: ${file.name}`
          });
        } catch (err: any) {
          throw new Error(`Could not load input file "${file.name}": ${err.message}`);
        }
      }
    }

    // Install packages dynamically based on code imports + explicit packages
    const explicitPackages = packages
      ? (typeof packages === 'string' ? packages.split(',').map((p: string) => p.trim()).filter(Boolean) : packages)
      : [];
    await installPackagesDynamic(py, explicitPackages, code, artifactId);

    ctx.postMessage({
      type: 'status', artifactId, stage: 'running',
      message: 'Running script...'
    });

    const beforeMeta = getFilesMeta('/home/pyodide');

    // Redirect stdout/stderr
    await py.runPythonAsync(`
import sys, io
sys.stdout = io.StringIO()
sys.stderr = io.StringIO()
`);

    // Set matplotlib to headless mode
    await py.runPythonAsync(`
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams['figure.dpi'] = 150
except Exception:
    pass
`);

    // Execute with timeout
    let runError: string | null = null;
    const TIMEOUT_MS = 60000;
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(
          'Script timed out after 60 seconds. It may contain an infinite loop or process too much data.'
        )), TIMEOUT_MS)
      );
      await Promise.race([py.runPythonAsync(code + '\nNone'), timeoutPromise]);
    } catch (err: any) {
      runError = extractPythonError(err);
    }

    // Capture stdout/stderr
    let stdout = '';
    let stderr = '';
    try {
      stdout = py.runPython('sys.stdout.getvalue()') ?? '';
      stderr = py.runPython('sys.stderr.getvalue()') ?? '';
    } catch { stdout = ''; }

    // Restore streams
    try {
      await py.runPythonAsync(`
import sys, io
sys.stdout = sys.__stdout__ or io.StringIO()
sys.stderr = sys.__stderr__ or io.StringIO()
`);
    } catch { /* ignore */ }

    // Scan for output files
    const outputFiles: Array<{ name: string; data: string; mimeType: string }> = [];
    let xlsxSchema: any = null;
    try {
      const afterMeta = getFilesMeta('/home/pyodide');
      for (const [p, meta] of afterMeta.entries()) {
        const before = beforeMeta.get(p);
        const isNew = !before || before.size !== meta.size || before.mtime !== meta.mtime;
        if (!isNew) continue;
        const ext = p.split('.').pop()?.toLowerCase() || '';
        if (!OUTPUT_EXTENSIONS.includes(ext)) continue;
        try {
          const bytes = py.FS.readFile(p);
          const data = arrayBufferToBase64(bytes);
          outputFiles.push({
            name: p.replace('/home/pyodide/', ''),
            data,
            mimeType: getMimeType(ext),
          });

          // Extract XLSX schema for live preview
          if (ext === 'xlsx' && !xlsxSchema) {
            try {
              await py.runPythonAsync(XLSX_EXTRACTOR_PYTHON);
              const schemaJson = py.runPython(`extract_xlsx('${p}')`);
              if (schemaJson) {
                xlsxSchema = JSON.parse(schemaJson);
              }
            } catch (schemaErr) {
              console.warn('XLSX schema extraction failed:', schemaErr);
            }
          }
        } catch { /* ignore single file read error */ }
      }
    } catch { /* ignore fs scan error */ }

    ctx.postMessage({
      type: 'result',
      artifactId,
      stdout,
      stderr,
      files: outputFiles,
      error: runError,
      xlsxSchema,
    });

  } catch (err: any) {
    ctx.postMessage({
      type: 'result',
      artifactId,
      stdout: '',
      stderr: '',
      files: [],
      error: extractPythonError(err),
    });
  }
});
