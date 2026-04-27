// ============================================================================
// File type → visual category classifier, shared between <FileIcon /> and
// any other component that needs to group/colour files (e.g. FileLibrary
// filter chips). Kept in /lib/ so FileIcon.tsx stays a pure component file
// (important for react-refresh / fast-refresh tooling).
// ============================================================================

export type FileCategory =
    | 'image'
    | 'pdf'
    | 'word'
    | 'spreadsheet'
    | 'presentation'
    | 'code'
    | 'json'
    | 'archive'
    | 'audio'
    | 'video'
    | 'markdown'
    | 'text'
    | 'unknown';

/**
 * Classify a file by its name + stored type into one of our visual categories.
 *
 * The DB column `file_type` is stored as one of the coarse strings:
 *   'image' | 'pdf' | 'csv' | 'text'
 * which loses specificity (e.g. a .docx is saved as 'text'). This helper
 * falls back to the filename extension so the UI can still render a
 * Word-style icon for .docx, a spreadsheet icon for .xlsx, etc.
 */
export function classifyFile(name: string | null | undefined, type?: string | null): FileCategory {
    const t = (type || '').toLowerCase();
    if (t === 'image') return 'image';
    if (t === 'pdf') return 'pdf';
    if (t === 'csv') return 'spreadsheet';

    const lower = (name || '').toLowerCase();
    const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';

    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image';
    if (ext === 'pdf') return 'pdf';
    if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return 'word';
    if (['xls', 'xlsx', 'ods', 'csv', 'tsv'].includes(ext)) return 'spreadsheet';
    if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) return 'presentation';
    if (['md', 'mdx'].includes(ext)) return 'markdown';
    if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return 'json';
    if ([
        'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
        'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'ps1', 'lua',
        'dart', 'scala', 'sql', 'html', 'css', 'scss', 'less', 'vue', 'svelte',
    ].includes(ext)) return 'code';
    if (['zip', '7z', 'rar', 'tar', 'gz', 'bz2'].includes(ext)) return 'archive';
    if (['mp3', 'wav', 'm4a', 'ogg', 'flac'].includes(ext)) return 'audio';
    if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) return 'video';
    if (['txt', 'log'].includes(ext)) return 'text';
    if (t === 'text') return 'text';
    return 'unknown';
}

const KIND_LABELS: Record<FileCategory, string> = {
    image: 'Image',
    pdf: 'PDF',
    word: 'Word',
    spreadsheet: 'Spreadsheet',
    presentation: 'Slides',
    code: 'Code',
    json: 'JSON',
    archive: 'Archive',
    audio: 'Audio',
    video: 'Video',
    markdown: 'Markdown',
    text: 'Text',
    unknown: 'Document',
};

/** Short label for message bubbles and metadata (not the raw MIME string). */
export function getFileKindLabel(name: string | null | undefined, type?: string | null): string {
    return KIND_LABELS[classifyFile(name, type)] ?? 'File';
}
