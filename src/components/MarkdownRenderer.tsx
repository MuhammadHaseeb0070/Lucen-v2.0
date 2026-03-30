import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check } from 'lucide-react';
import { highlightChildren } from '../lib/searchHighlight';

interface MarkdownRendererProps {
    content: string;
    searchQuery?: string;
}

const CodeBlock: React.FC<{
    language: string;
    value: string;
}> = ({ language, value }) => {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="code-block-wrapper">
            <div className="code-block-header">
                <span className="code-language">{language || 'text'}</span>
                <button className="copy-btn" onClick={handleCopy} title="Copy code">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied!' : 'Copy'}
                </button>
            </div>
            <SyntaxHighlighter
                style={oneDark}
                language={language || 'text'}
                PreTag="div"
                customStyle={{
                    margin: 0,
                    borderRadius: '0 0 8px 8px',
                    fontSize: '13px',
                    lineHeight: '1.5',
                }}
            >
                {value}
            </SyntaxHighlighter>
        </div>
    );
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, searchQuery }) => {
    const createHighlightComponent = (Tag: 'p' | 'li' | 'td' | 'th' | 'strong' | 'em' | 'span') => {
        const Component = Tag;
        return function HighlightWrapper(
            props: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }
        ) {
            const { children, ...rest } = props;
            const highlighted = searchQuery ? highlightChildren(children, searchQuery) : children;
            return <Component {...rest}>{highlighted}</Component>;
        };
    };

    const highlightComponents = searchQuery
        ? {
              p: createHighlightComponent('p'),
              li: createHighlightComponent('li'),
              td: createHighlightComponent('td'),
              th: createHighlightComponent('th'),
              strong: createHighlightComponent('strong'),
              em: createHighlightComponent('em'),
              span: createHighlightComponent('span'),
          }
        : undefined;

    return (
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
                            return <CodeBlock language={match[1]} value={codeString} />;
                        }

                        return (
                            <code className="inline-code" {...props}>
                                {children}
                            </code>
                        );
                    },
                    table({ children }) {
                        return (
                            <div className="table-wrapper">
                                <table>{children}</table>
                            </div>
                        );
                    },
                    a({ href, children }) {
                        return (
                            <a href={href} target="_blank" rel="noopener noreferrer">
                                {children}
                            </a>
                        );
                    },
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
};

export default MarkdownRenderer;
