import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import { highlightCode } from '../workers/highlighterWorkerClient';
import { Copy, Check, Download, ExternalLink, TriangleAlert, CheckCircle, AlertOctagon, Terminal, Info } from 'lucide-react';
import { highlightChildren } from '../lib/searchHighlight';
import { useArtifactStore } from '../store/artifactStore';

interface MarkdownRendererProps {
    content: string;
    searchQuery?: string;
    isStreaming?: boolean;
}

const CodeTool = React.memo<{
    language: string;
    value: string;
    isStreaming?: boolean;
}>(({ language, value, isStreaming }) => {
    const [copied, setCopied] = useState(false);
    const [wrapped, setWrapped] = useState(false);
    const [html, setHtml] = useState<string>('');
    const setActiveArtifact = useArtifactStore((s) => s.setActiveArtifact);

    React.useEffect(() => {
        if (isStreaming) {
            setHtml('');
            return;
        }
        let isCancelled = false;
        highlightCode(value, language || 'text').then((res) => {
            if (!isCancelled) setHtml(res);
        }).catch(() => {});
        return () => { isCancelled = true; };
    }, [value, language, isStreaming]);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownload = () => {
        const ext = language ? `.${language}` : '.txt';
        const blob = new Blob([value], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `snippet${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleOpenWorkspace = () => {
        if (!['html', 'svg', 'mermaid'].includes(language)) return;
        setActiveArtifact({
            id: `pt-${Date.now()}`,
            dbId: '',
            type: language as any,
            title: `Extracted ${language.toUpperCase()}`,
            content: value,
            messageId: 'powertool',
            isPublic: false
        });
    };

    const canOpenWorkspace = ['html', 'svg', 'mermaid'].includes(language);

    return (
        <div className="powertool-code-wrapper">
            <div className="powertool-code-header">
                <span className="powertool-code-lang">
                    <Terminal size={14} />
                    {language || 'plaintext'}
                </span>
                <div className="powertool-code-actions">
                    <button className="powertool-btn" onClick={() => setWrapped(!wrapped)} title="Toggle Word Wrap">
                        {wrapped ? 'Unwrap' : 'Wrap'}
                    </button>
                    {canOpenWorkspace && (
                        <button className="powertool-btn powertool-btn--primary" onClick={handleOpenWorkspace} title="Open in Workspace">
                            <ExternalLink size={13} /> Open
                        </button>
                    )}
                    <button className="powertool-btn" onClick={handleDownload} title="Download File">
                        <Download size={13} />
                    </button>
                    <button className="powertool-btn" onClick={handleCopy} title="Copy code">
                        {copied ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                </div>
            </div>
            <div className={`powertool-code-body ${wrapped ? 'powertool-code-body--wrapped' : ''}`}>
                {html ? (
                    <div dangerouslySetInnerHTML={{ __html: html }} className="shiki-container shiki-container--markdown" />
                ) : (
                    <div className="shiki-container shiki-container--markdown shiki-fallback-text">{value}</div>
                )}
            </div>
        </div>
    );
});

CodeTool.displayName = 'CodeTool';

const TableTool = React.memo<{ children: React.ReactNode }>(({ children }) => {
    const tableRef = React.useRef<HTMLTableElement>(null);
    const [copied, setCopied] = useState(false);

    const getCsvData = () => {
        if (!tableRef.current) return '';
        const rows = Array.from(tableRef.current.querySelectorAll('tr'));
        return rows.map(row => {
            const cells = Array.from(row.querySelectorAll('th, td'));
            return cells.map(cell => {
                const text = cell.textContent || '';
                // Escape quotes and wrap in quotes if there's a comma
                return text.includes(',') || text.includes('"') || text.includes('\n') 
                    ? `"${text.replace(/"/g, '""')}"` 
                    : text;
            }).join(',');
        }).join('\n');
    };

    const handleCopy = async () => {
        const csv = getCsvData();
        await navigator.clipboard.writeText(csv);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownload = () => {
        const csv = getCsvData();
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `table_export_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="powertool-table-wrapper">
            <div className="powertool-table-header">
                <span className="powertool-table-title">Data Table</span>
                <div className="powertool-table-actions">
                    <button className="powertool-btn" onClick={handleDownload} title="Download CSV">
                        <Download size={13} /> CSV
                    </button>
                    <button className="powertool-btn" onClick={handleCopy} title="Copy CSV">
                        {copied ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                </div>
            </div>
            <div className="powertool-table-container">
                <table ref={tableRef}>{children}</table>
            </div>
        </div>
    );
});
TableTool.displayName = 'TableTool';

const BlockquoteTool = React.memo<{ children: React.ReactNode }>(({ children }) => {
    let textContent = '';
    React.Children.forEach(children, (child) => {
        if (typeof child === 'string') textContent += child;
        else if (React.isValidElement(child) && (child as any).props.children) {
            const c = (child as any).props.children;
            if (typeof c === 'string') textContent += c;
            else if (Array.isArray(c) && typeof c[0] === 'string') textContent += c[0];
        }
    });

    const match = textContent.match(/^\[!(NOTE|WARNING|IMPORTANT|TIP|CAUTION)\]/i);
    
    if (match) {
        const type = match[1].toLowerCase();
        let Icon = Info;
        let title = 'Note';
        if (type === 'warning') { Icon = TriangleAlert; title = 'Warning'; }
        if (type === 'important') { Icon = AlertOctagon; title = 'Important'; }
        if (type === 'tip') { Icon = CheckCircle; title = 'Tip'; }
        if (type === 'caution') { Icon = AlertOctagon; title = 'Caution'; }
        
        return (
            <div className={`powertool-alert powertool-alert--${type}`}>
                <div className="powertool-alert-header">
                    <Icon size={16} /> {title}
                </div>
                <div className="powertool-alert-content">
                    {children}
                </div>
            </div>
        );
    }

    return <blockquote className="powertool-blockquote">{children}</blockquote>;
});
BlockquoteTool.displayName = 'BlockquoteTool';


// Allow class + style attributes for AI-generated rich formatting.
// All event handlers (onclick, onerror, onload, …) remain blocked by
// rehype-sanitize since they are not in this whitelist.
const SANITIZE_SCHEMA = {
    ...defaultSchema,
    attributes: {
        ...defaultSchema.attributes,
        '*': [
            ...(defaultSchema.attributes?.['*'] ?? []),
            'style',
            'class',
        ],
    },
    tagNames: [
        ...(defaultSchema.tagNames ?? []),
        'details',
        'summary',
        'mark',
    ],
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = React.memo(({ content, searchQuery, isStreaming }) => {
    const highlightComponents = useMemo(() => {
        if (!searchQuery) return undefined;

        const createHighlightComponent = (Tag: 'p' | 'li' | 'td' | 'th' | 'strong' | 'em' | 'span') => {
            const Component = Tag;
            return function HighlightWrapper(
                props: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }
            ) {
                const { children, ...rest } = props;
                const highlighted = highlightChildren(children, searchQuery);
                return <Component {...rest}>{highlighted}</Component>;
            };
        };

        return {
            p: createHighlightComponent('p'),
            li: createHighlightComponent('li'),
            td: createHighlightComponent('td'),
            th: createHighlightComponent('th'),
            strong: createHighlightComponent('strong'),
            em: createHighlightComponent('em'),
            span: createHighlightComponent('span'),
        };
    }, [searchQuery]);

    // We do a fast regex pass to strip out the literal "[!TYPE]" from the content so it doesn't double render inside the alert.
    // It's cleaner than dealing with React children mapping.
    const cleanContent = useMemo(() => {
        return content.replace(/^> \s*\[!(NOTE|WARNING|IMPORTANT|TIP|CAUTION)\]\s*$/gim, '> ');
    }, [content]);

    return useMemo(() => (
        <div className="markdown-body">
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex, rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]]}
                components={{
                    ...highlightComponents,
                    code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const codeString = String(children).replace(/\n$/, '');

                        if (match) {
                            return <CodeTool language={match[1]} value={codeString} isStreaming={isStreaming} />;
                        }

                        return (
                            <code className="inline-code" {...props}>
                                {children}
                            </code>
                        );
                    },
                    table({ children }) {
                        return <TableTool>{children}</TableTool>;
                    },
                    blockquote({ children }) {
                        return <BlockquoteTool>{children}</BlockquoteTool>;
                    },
                    a({ href, children }) {
                        return (
                            <a href={href} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                {children}
                                <ExternalLink size={11} style={{ opacity: 0.6 }} />
                            </a>
                        );
                    },
                }}
            >
                {cleanContent}
            </ReactMarkdown>
        </div>
    ), [cleanContent, highlightComponents]);
});

MarkdownRenderer.displayName = 'MarkdownRenderer';

export default MarkdownRenderer;
