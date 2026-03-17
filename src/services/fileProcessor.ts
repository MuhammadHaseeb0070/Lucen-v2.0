import { v4 as uuidv4 } from 'uuid';
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import type { FileAttachment } from '../types';

// ─── PDF Worker ───
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
).toString();

// ═══════════════════════════════════════════
//  LIMITS & TOKEN OPTIMIZATION
// ═══════════════════════════════════════════
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;   // 10 MB
const MAX_TEXT_CHARS = 50_000;             // ~12k tokens — plenty for context
const MAX_PDF_PAGES = 20;
const MAX_EXCEL_ROWS = 200;
const MAX_EXCEL_SHEETS = 5;
const MAX_PPTX_SLIDES = 30;
const MAX_FILES = 5;

// ═══════════════════════════════════════════
//  SUPPORTED FILE TYPES
// ═══════════════════════════════════════════
const IMAGE_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'image/svg+xml', 'image/bmp', 'image/tiff',
];

const TEXT_MIME_TYPES = [
    'text/plain', 'text/csv', 'text/markdown', 'text/html',
    'application/json', 'application/xml', 'text/xml',
    'application/javascript', 'text/css',
];

const CODE_EXTENSIONS = [
    '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
    '.cs', '.go', '.rs', '.rb', '.php', '.sql', '.sh', '.bash', '.bat', '.ps1',
    '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env', '.conf',
    '.css', '.scss', '.less', '.sass', '.html', '.htm', '.vue', '.svelte',
    '.md', '.txt', '.log', '.csv', '.tsv', '.jsonl', '.ndjson',
    '.r', '.m', '.swift', '.kt', '.kts', '.dart', '.lua', '.pl', '.pm',
    '.ex', '.exs', '.erl', '.hs', '.ml', '.clj', '.scala', '.groovy',
    '.tf', '.dockerfile', '.makefile', '.cmake',
    '.xml', '.json', '.graphql', '.gql', '.proto',
];

// ═══════════════════════════════════════════
//  FILE TYPE DETECTION
// ═══════════════════════════════════════════
type InternalFileType = 'image' | 'pdf' | 'csv' | 'text' | 'docx' | 'xlsx' | 'pptx';

function getFileType(file: File): InternalFileType {
    const ext = getExt(file.name);
    const mime = (file.type || '').toLowerCase();

    if (IMAGE_TYPES.includes(mime)) return 'image';
    if (mime === 'application/pdf' || ext === '.pdf') return 'pdf';
    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === '.docx' || ext === '.doc') return 'docx';
    if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || ext === '.xlsx' || ext === '.xls'
        || mime === 'application/vnd.ms-excel') return 'xlsx';
    if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || ext === '.pptx' || ext === '.ppt') return 'pptx';
    if (mime === 'text/csv' || ext === '.csv') return 'csv';
    // Extension fallback for generic/empty MIME (e.g. application/octet-stream)
    if (mime === 'application/octet-stream' || mime === '') {
        if (ext === '.pdf') return 'pdf';
        if (['.docx', '.doc'].includes(ext)) return 'docx';
        if (['.xlsx', '.xls'].includes(ext)) return 'xlsx';
        if (['.pptx', '.ppt'].includes(ext)) return 'pptx';
        if (/\.(jpe?g|png|gif|webp|bmp|tiff?|svg)$/i.test(file.name)) return 'image';
    }
    return 'text';
}

function getExt(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function isAcceptedFile(file: File): boolean {
    const ext = getExt(file.name);
    const mime = (file.type || '').toLowerCase();

    if (IMAGE_TYPES.includes(mime)) return true;
    if (TEXT_MIME_TYPES.includes(mime)) return true;
    if (mime === 'application/pdf') return true;
    // Office docs
    if (mime.includes('openxmlformats') || mime.includes('ms-excel') || mime.includes('ms-powerpoint')
        || mime.includes('msword')) return true;
    if (['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.pdf'].includes(ext)) return true;
    // Code/text by extension — many OSes use application/octet-stream for unknown types
    if (CODE_EXTENSIONS.includes(ext)) return true;
    if (ext === '.svg') return true; // SVG can be image or text
    // Fallback: accept anything text-like
    if (mime.startsWith('text/')) return true;
    // Generic binary / unknown MIME — accept by extension only
    if (mime === 'application/octet-stream' || mime === '') {
        const knownExts = [...CODE_EXTENSIONS, '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.svg'];
        return knownExts.includes(ext) || /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(file.name);
    }
    return false;
}

// ═══════════════════════════════════════════
//  FILE READERS
// ═══════════════════════════════════════════
function readAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
        reader.readAsDataURL(file);
    });
}

function readAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
        reader.readAsText(file);
    });
}

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
        reader.readAsArrayBuffer(file);
    });
}

// ═══════════════════════════════════════════
//  TOKEN OPTIMIZATION
// ═══════════════════════════════════════════
/**
 * Smart truncation: keeps the beginning and end of content,
 * adds a summary note in the middle showing what was truncated.
 * This preserves context better than chopping off the tail.
 */
function smartTruncate(text: string, maxChars: number, label: string): string {
    if (text.length <= maxChars) return text;

    const headRatio = 0.7; // keep 70% from start, 30% from end
    const headLen = Math.floor(maxChars * headRatio);
    const tailLen = maxChars - headLen - 200; // reserve space for truncation notice

    const head = text.slice(0, headLen);
    const tail = tailLen > 0 ? text.slice(-tailLen) : '';
    const skipped = text.length - headLen - Math.max(tailLen, 0);

    return `${head}\n\n[... ${formatFileSize(skipped)} of ${label} omitted for token efficiency ...]\n\n${tail}`;
}

/**
 * Compress whitespace while preserving structure.
 * Removes excessive blank lines, trims trailing spaces.
 */
function compressWhitespace(text: string): string {
    return text
        .replace(/[ \t]+$/gm, '')           // trim trailing whitespace per line
        .replace(/\n{4,}/g, '\n\n\n')        // collapse 4+ newlines to 3
        .trim();
}

// ═══════════════════════════════════════════
//  FORMAT HELPERS
// ═══════════════════════════════════════════
function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getAttachmentType(ftype: InternalFileType): FileAttachment['type'] {
    if (ftype === 'docx' || ftype === 'pptx' || ftype === 'xlsx') return 'text';
    return ftype;
}

// ═══════════════════════════════════════════
//  EXTRACTORS
// ═══════════════════════════════════════════

/** PDF → text via pdf.js */
async function extractPdfText(file: File): Promise<string> {
    try {
        const buffer = await readAsArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        const totalPages = Math.min(pdf.numPages, MAX_PDF_PAGES);
        const pages: string[] = [];

        for (let i = 1; i <= totalPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = (textContent.items as Array<{ str?: string }>)
                .map((item) => item.str || '')
                .join(' ');
            if (pageText.trim()) {
                pages.push(`── Page ${i} ──\n${pageText.trim()}`);
            }
        }

        let result = pages.join('\n\n');
        if (pdf.numPages > MAX_PDF_PAGES) {
            result += `\n\n[... showing ${MAX_PDF_PAGES} of ${pdf.numPages} pages]`;
        }

        return compressWhitespace(result) || '[No extractable text found — PDF may be scanned/image-based]';
    } catch (err) {
        console.warn('PDF extraction failed:', err);
        return '[Failed to extract text — PDF may be encrypted or corrupted]';
    }
}

/** DOCX → text via mammoth */
async function extractDocxText(file: File): Promise<string> {
    try {
        const buffer = await readAsArrayBuffer(file);
        const result = await mammoth.extractRawText({ arrayBuffer: buffer });
        const text = compressWhitespace(result.value);
        return text || '[No text found in document]';
    } catch (err) {
        console.warn('DOCX extraction failed:', err);
        return '[Failed to extract text from Word document]';
    }
}

/** XLSX/XLS → structured text via SheetJS */
async function extractExcelText(file: File): Promise<string> {
    try {
        const buffer = await readAsArrayBuffer(file);
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheets: string[] = [];

        const sheetNames = workbook.SheetNames.slice(0, MAX_EXCEL_SHEETS);
        for (const name of sheetNames) {
            const sheet = workbook.Sheets[name];
            const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });

            if (jsonData.length === 0) continue;

            // Header row
            const header = jsonData[0] as string[];
            const dataRows = jsonData.slice(1, MAX_EXCEL_ROWS + 1);
            const totalRows = jsonData.length - 1;

            // Format as markdown table for better LLM comprehension
            let table = `── Sheet: "${name}" (${totalRows} rows × ${header.length} cols) ──\n`;
            table += '| ' + header.map(h => String(h || '(empty)')).join(' | ') + ' |\n';
            table += '| ' + header.map(() => '---').join(' | ') + ' |\n';

            for (const row of dataRows) {
                const cells = (row as string[]).map(cell => String(cell ?? ''));
                table += '| ' + cells.join(' | ') + ' |\n';
            }

            if (totalRows > MAX_EXCEL_ROWS) {
                table += `\n[... showing ${MAX_EXCEL_ROWS} of ${totalRows} rows]`;
            }

            sheets.push(table);
        }

        if (workbook.SheetNames.length > MAX_EXCEL_SHEETS) {
            sheets.push(`\n[... showing ${MAX_EXCEL_SHEETS} of ${workbook.SheetNames.length} sheets]`);
        }

        return sheets.join('\n\n') || '[No data found in spreadsheet]';
    } catch (err) {
        console.warn('Excel extraction failed:', err);
        return '[Failed to extract data from spreadsheet]';
    }
}

/** PPTX → text via JSZip (reads XML slides) */
async function extractPptxText(file: File): Promise<string> {
    try {
        const buffer = await readAsArrayBuffer(file);
        const zip = await JSZip.loadAsync(buffer);
        const slides: string[] = [];
        let slideNum = 0;

        // PPTX stores slides in ppt/slides/slide1.xml, slide2.xml, etc.
        const slideEntries: [string, JSZip.JSZipObject][] = [];
        zip.folder('ppt/slides')?.forEach((path, entry) => {
            if (path.match(/^slide\d+\.xml$/)) {
                slideEntries.push([path, entry]);
            }
        });

        // Sort by slide number
        slideEntries.sort((a, b) => {
            const numA = parseInt(a[0].match(/\d+/)?.[0] || '0');
            const numB = parseInt(b[0].match(/\d+/)?.[0] || '0');
            return numA - numB;
        });

        for (const [, entry] of slideEntries.slice(0, MAX_PPTX_SLIDES)) {
            slideNum++;
            const xml = await entry.async('text');
            // Extract text from XML tags: <a:t>text</a:t>
            const textMatches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g);
            if (textMatches) {
                const slideText = textMatches
                    .map(m => m.replace(/<[^>]+>/g, ''))
                    .join(' ')
                    .trim();
                if (slideText) {
                    slides.push(`── Slide ${slideNum} ──\n${slideText}`);
                }
            }
        }

        let result = slides.join('\n\n');
        if (slideEntries.length > MAX_PPTX_SLIDES) {
            result += `\n\n[... showing ${MAX_PPTX_SLIDES} of ${slideEntries.length} slides]`;
        }

        return compressWhitespace(result) || '[No text found in presentation]';
    } catch (err) {
        console.warn('PPTX extraction failed:', err);
        return '[Failed to extract text from presentation]';
    }
}

// ═══════════════════════════════════════════
//  MAIN PROCESSOR
// ═══════════════════════════════════════════

/**
 * Process a single file into a FileAttachment.
 * Each format has a dedicated extractor with proper parsing.
 * Token optimization: smart truncation + whitespace compression.
 */
export async function processFile(file: File): Promise<FileAttachment> {
    const fileType = getFileType(file);

    // ─── Images ───
    if (fileType === 'image') {
        if (file.size > MAX_IMAGE_SIZE) {
            throw new Error(`Image "${file.name}" is too large (${formatFileSize(file.size)}). Max is ${formatFileSize(MAX_IMAGE_SIZE)}.`);
        }
        const dataUrl = await readAsDataURL(file);
        return {
            id: uuidv4(),
            name: file.name,
            type: 'image',
            mimeType: file.type,
            size: file.size,
            dataUrl,
        };
    }

    // ─── PDF ───
    if (fileType === 'pdf') {
        let text = await extractPdfText(file);
        text = smartTruncate(text, MAX_TEXT_CHARS, file.name);
        return {
            id: uuidv4(),
            name: file.name,
            type: 'pdf',
            mimeType: file.type,
            size: file.size,
            textContent: text,
        };
    }

    // ─── Word (DOCX) ───
    if (fileType === 'docx') {
        let text = await extractDocxText(file);
        text = smartTruncate(text, MAX_TEXT_CHARS, file.name);
        return {
            id: uuidv4(),
            name: file.name,
            type: 'text',
            mimeType: file.type,
            size: file.size,
            textContent: text,
        };
    }

    // ─── Excel (XLSX/XLS) ───
    if (fileType === 'xlsx') {
        let text = await extractExcelText(file);
        text = smartTruncate(text, MAX_TEXT_CHARS, file.name);
        return {
            id: uuidv4(),
            name: file.name,
            type: 'csv', // reuse csv type for spreadsheet display
            mimeType: file.type,
            size: file.size,
            textContent: text,
        };
    }

    // ─── PowerPoint (PPTX) ───
    if (fileType === 'pptx') {
        let text = await extractPptxText(file);
        text = smartTruncate(text, MAX_TEXT_CHARS, file.name);
        return {
            id: uuidv4(),
            name: file.name,
            type: 'text',
            mimeType: file.type,
            size: file.size,
            textContent: text,
        };
    }

    // ─── Text / Code / CSV ───
    let text: string;
    if (file.size > MAX_TEXT_CHARS * 4) {
        // For very large text files, only read a portion
        const blob = file.slice(0, MAX_TEXT_CHARS * 4);
        text = await readAsText(new File([blob], file.name, { type: file.type }));
    } else {
        text = await readAsText(file);
    }

    text = compressWhitespace(text);
    text = smartTruncate(text, MAX_TEXT_CHARS, file.name);

    return {
        id: uuidv4(),
        name: file.name,
        type: getAttachmentType(fileType),
        mimeType: file.type || 'text/plain',
        size: file.size,
        textContent: text,
    };
}

/**
 * Process multiple files from a drop or file input.
 * Filters unsupported types, caps at MAX_FILES.
 */
export async function processFiles(files: FileList | File[]): Promise<{
    attachments: FileAttachment[];
    errors: string[];
}> {
    const fileArray = Array.from(files);
    const errors: string[] = [];
    const attachments: FileAttachment[] = [];

    const accepted = fileArray.filter((f) => {
        if (!isAcceptedFile(f)) {
            errors.push(`"${f.name}" is not a supported file type.`);
            return false;
        }
        return true;
    }).slice(0, MAX_FILES);

    if (fileArray.length > MAX_FILES) {
        errors.push(`Only the first ${MAX_FILES} files were attached.`);
    }

    // Process in parallel for speed
    const results = await Promise.allSettled(accepted.map(processFile));
    for (const result of results) {
        if (result.status === 'fulfilled') {
            attachments.push(result.value);
        } else {
            errors.push(result.reason?.message || 'Failed to process a file.');
        }
    }

    return { attachments, errors };
}

export { formatFileSize, isAcceptedFile, MAX_FILES };
