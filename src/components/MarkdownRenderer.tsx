import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/light-async';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, Download, ExternalLink, TriangleAlert, CheckCircle, AlertOctagon, Terminal, Info } from 'lucide-react';
import { highlightChildren } from '../lib/searchHighlight';
import { useArtifactStore } from '../store/artifactStore';

interface MarkdownRendererProps {
    content: string;
    searchQuery?: string;
}

const CodeTool = React.memo<{
    language: string;
    value: string;
}>(({ language, value }) => {
    const [copied, setCopied] = useState(false);
    const [wrapped, setWrapped] = useState(false);
    const setActiveArtifact = useArtifactStore((s) => s.setActiveArtifact);

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
            <SyntaxHighlighter
                style={oneDark}
                language={language || 'text'}
                PreTag="div"
                wrapLines={wrapped}
                wrapLongLines={wrapped}
                customStyle={{
                    margin: 0,
                    borderRadius: '0 0 8px 8px',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    background: 'transparent'
                }}
            >
                {value}
            </SyntaxHighlighter>
        </div>
    );
});

CodeTool.displayName = 'CodeTool';

const TableTool = React.memo<{ children: React.ReactNode }>(({ children }) => {
    return (
        <div className="powertool-table-wrapper">
            <div className="powertool-table-header">
                <span className="powertool-table-title">Data Table</span>
            </div>
            <div className="powertool-table-container">
                <table>{children}</table>
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


const MarkdownRenderer: React.FC<MarkdownRendererProps> = React.memo(({ content, searchQuery }) => {
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
                rehypePlugins={[rehypeKatex, rehypeRaw]}
                components={{
                    ...highlightComponents,
                    code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const codeString = String(children).replace(/\n$/, '');

                        if (match) {
                            return <CodeTool language={match[1]} value={codeString} />;
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
