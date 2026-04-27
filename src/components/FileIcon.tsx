// ============================================================================
// FileIcon — a small, theme-aligned icon badge for file attachments.
// Classification + labels live in `fileIconUtil.ts` (single source of truth).
// ============================================================================

import React from 'react';
import {
    FileText,
    FileSpreadsheet,
    FileCode2,
    FileImage,
    FileType,
    File as FileGeneric,
    Presentation,
    FileArchive,
    FileJson,
    FileAudio,
    FileVideo,
} from 'lucide-react';
import {
    type FileCategory,
    classifyFile as classifyFileUtil,
    getFileKindLabel,
} from '../lib/fileIconUtil';

export type { FileCategory };
export { classifyFileUtil as classifyFile, getFileKindLabel };

interface FileIconProps {
    name: string | null | undefined;
    type?: string | null;
    size?: number;
    /** When true, draws a soft filled badge around the glyph. */
    badge?: boolean;
    className?: string;
}

const CATEGORY_STYLE: Record<FileCategory, { color: string; bg: string; Icon: React.ComponentType<{ size?: number }> }> = {
    // Colors picked to work on both light + dark themes (soft bg + saturated fg).
    image:        { color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.14)', Icon: FileImage },
    pdf:          { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.14)',  Icon: FileType },
    word:         { color: '#2563eb', bg: 'rgba(37, 99, 235, 0.14)',  Icon: FileText },
    spreadsheet:  { color: '#16a34a', bg: 'rgba(22, 163, 74, 0.14)',  Icon: FileSpreadsheet },
    presentation: { color: '#ea580c', bg: 'rgba(234, 88, 12, 0.14)',  Icon: Presentation },
    code:         { color: '#0891b2', bg: 'rgba(8, 145, 178, 0.14)',  Icon: FileCode2 },
    json:         { color: '#ca8a04', bg: 'rgba(202, 138, 4, 0.14)',  Icon: FileJson },
    markdown:     { color: '#475569', bg: 'rgba(71, 85, 105, 0.14)',  Icon: FileText },
    archive:      { color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.14)', Icon: FileArchive },
    audio:        { color: '#db2777', bg: 'rgba(219, 39, 119, 0.14)', Icon: FileAudio },
    video:        { color: '#c026d3', bg: 'rgba(192, 38, 211, 0.14)', Icon: FileVideo },
    text:         { color: '#64748b', bg: 'rgba(100, 116, 139, 0.14)', Icon: FileText },
    unknown:      { color: '#64748b', bg: 'rgba(100, 116, 139, 0.14)', Icon: FileGeneric },
};

export const FileIcon: React.FC<FileIconProps> = ({ name, type, size = 22, badge = false, className }) => {
    const category = classifyFileUtil(name, type);
    const style = CATEGORY_STYLE[category];
    const Icon = style.Icon;

    if (!badge) {
        return <Icon size={size} aria-label={category} />;
    }

    const boxSize = Math.max(size + 16, 40);
    return (
        <span
            className={className}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: boxSize,
                height: boxSize,
                borderRadius: 10,
                background: style.bg,
                color: style.color,
                flexShrink: 0,
            }}
            aria-label={category}
        >
            <Icon size={size} />
        </span>
    );
};

export default FileIcon;
