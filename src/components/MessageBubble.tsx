import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Trash2, ChevronDown, ChevronRight, Copy, Check, RotateCcw, ChevronLast, Globe, ExternalLink } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import ArtifactCard from './ArtifactCard';
import { parseArtifacts } from '../lib/artifactParser';
import { useArtifactStore } from '../store/artifactStore';
import type { Message } from '../types';

interface MessageBubbleProps {
    message: Message;
    onDelete?: (msgId: string) => void;
    onRetry?: (msgId: string) => void;
    onContinue?: (msgId: string) => void;
    onDeleteHover?: (hovering: boolean) => void;
    showDelete?: boolean;
    showRetry?: boolean;
    actionsOnly?: boolean;
    searchQuery?: string;
    disableReasoning?: boolean;
    disableArtifacts?: boolean;
}

const MessageBubble: React.FC<MessageBubbleProps> = React.memo(({
    message,
    onDelete,
    onRetry,
    onContinue,
    onDeleteHover,
    showDelete = false,
    showRetry = false,
    actionsOnly = false,
    searchQuery,
    disableReasoning = false,
    disableArtifacts = false,
}) => {
    const [reasoningOpen, setReasoningOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const setActiveArtifact = useArtifactStore((s) => s.setActiveArtifact);
    const updateArtifactContent = useArtifactStore((s) => s.updateArtifactContent);

    const { cleanContent, artifacts } = useMemo(() => {
        // Even when we are not rendering artifacts (e.g. side chat),
        // we still strip the tags so the user sees clean "basic chat" text.
        if (disableArtifacts) {
            const parsed = parseArtifacts(message.content, message.id);
            return { cleanContent: parsed.cleanContent, artifacts: [] };
        }
        return parseArtifacts(message.content, message.id);
    }, [disableArtifacts, message.content, message.id]);

    const normalizedReasoning = useMemo(() => {
        const raw = (message.reasoning || '').trim();
        if (!raw) return '';

        // Some providers return reasoning as a JSON array that contains:
        // - a plaintext summary item: { type: "reasoning.summary", summary: "..." }
        // - an encrypted blob item:   { type: "reasoning.encrypted", data: "..." }
        // We only show the summary to avoid rendering huge encrypted payloads.
        if (raw.startsWith('[') && raw.includes('"type"')) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    const summaryItem = parsed.find((it) => {
                        if (!it || typeof it !== 'object') return false;
                        const type = (it as any).type;
                        return type === 'reasoning.summary' || String(type).includes('reasoning.summary');
                    }) as any;

                    if (summaryItem && typeof summaryItem.summary === 'string') {
                        return summaryItem.summary.trim();
                    }
                }
            } catch {
                // If streaming gave us only a partial JSON fragment, we fall back to raw.
            }
        }

        // Regex fallback (partial JSON / non-ideal formatting):
        // Try to capture "... reasoning.summary ... summary: '...'"
        if (raw.includes('reasoning.summary') && raw.includes('"summary"')) {
            const m = raw.match(/"type"\s*:\s*"reasoning\.summary"[\s\S]*?"summary"\s*:\s*"([^"]*)"/);
            if (m?.[1]) return m[1];
        }

        // Fallback: avoid dumping extremely large reasoning blobs into the UI.
        if (raw.length > 8000) return raw.slice(0, 8000) + '…';
        return raw;
    }, [message.reasoning]);

    const handleCopy = useCallback(async () => {
        await navigator.clipboard.writeText(message.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [message.content]);

    // Throttled artifact update during streaming to reduce store churn
    const lastUpdateRef = useRef(0);
    const openedRef = useRef(false);

    useEffect(() => {
        if (disableArtifacts) {
            openedRef.current = false;
            return;
        }
        if (artifacts.length === 0) {
            openedRef.current = false;
            return;
        }
        const first = artifacts[0];

        if (first.isStreaming) {
            const now = Date.now();
            if (!openedRef.current) {
                // First time seeing this artifact — open workspace
                openedRef.current = true;
                setActiveArtifact(first);
                lastUpdateRef.current = now;
            } else if (now - lastUpdateRef.current > 300) {
                // Throttle: update content at most every 300ms during streaming
                updateArtifactContent(first);
                lastUpdateRef.current = now;
            }
        } else if (openedRef.current) {
            // Streaming just finished — send final update and reset.
            // Force isStreaming:false regardless of what the parser reports.
            // This handles the truncation case where the closing </lucen_artifact>
            // tag was never received, leaving the artifact in a partial state.
            updateArtifactContent({ ...first, isStreaming: false });
            openedRef.current = false;
        }
    }, [disableArtifacts, artifacts, setActiveArtifact, updateArtifactContent]);

    if (actionsOnly) {
        if (!message.content) return null;
        return (
            <div className="msg-inline-actions">
                <button className="msg-action-btn" onClick={handleCopy} title="Copy">
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
                {showDelete && onDelete && (
                    <button
                        className="msg-action-btn msg-action-danger"
                        onClick={() => onDelete(message.id)}
                        onMouseEnter={() => onDeleteHover?.(true)}
                        onMouseLeave={() => onDeleteHover?.(false)}
                        title="Delete this exchange"
                    >
                        <Trash2 size={13} />
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="msg-response">
                    {!disableReasoning && normalizedReasoning && (
                        <div className="reasoning-block">
                            <button className="reasoning-toggle" onClick={() => setReasoningOpen(!reasoningOpen)}>
                                {reasoningOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                <span className="reasoning-label">
                                    {message.isReasoningStreaming ? 'Thinking...' : 'Thought process'}
                                </span>
                                {message.isReasoningStreaming && <span className="reasoning-pulse" />}
                            </button>
                            {reasoningOpen && (
                                <div className="reasoning-content">
                                    <MarkdownRenderer content={normalizedReasoning} searchQuery={searchQuery} />
                                </div>
                            )}
                        </div>
                    )}

            {message.webSearch?.used && (
                <div className="web-search-badge">
                    <Globe size={13} />
                    <span>WEB SEARCH</span>
                </div>
            )}

            {message.isStreaming && !message.content && !message.reasoning ? (
                <div className="streaming-indicator">
                    <span className="dot" /><span className="dot" /><span className="dot" />
                </div>
            ) : (
                <>
                    {cleanContent && <MarkdownRenderer content={cleanContent} searchQuery={searchQuery} />}
                    {!disableArtifacts && artifacts.map((artifact) => (
                        <ArtifactCard key={artifact.id} artifact={artifact} />
                    ))}
                </>
            )}

            {message.isTruncated && !message.isStreaming && (
                <div className="msg-truncated">
                    <button
                        className="msg-continue-btn"
                        onClick={() => onContinue?.(message.id)}
                        title="The response was cut off. Click to continue generating."
                    >
                        <ChevronLast size={14} />
                        <span>Continue generating</span>
                    </button>
                </div>
            )}

            {!message.isStreaming && message.content && (
                <div className="msg-response-actions">
                    <button className="msg-action-btn" onClick={handleCopy} title="Copy response">
                        {copied ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                    {showRetry && onRetry && (
                        <button className="msg-action-btn" onClick={() => onRetry(message.id)} title="Regenerate response">
                            <RotateCcw size={13} />
                        </button>
                    )}
                    {showDelete && onDelete && (
                        <button
                            className="msg-action-btn msg-action-danger"
                            onClick={() => onDelete(message.id)}
                            onMouseEnter={() => onDeleteHover?.(true)}
                            onMouseLeave={() => onDeleteHover?.(false)}
                            title="Delete this exchange"
                        >
                            <Trash2 size={13} />
                        </button>
                    )}
                </div>
            )}

            {message.webSearch?.links && message.webSearch.links.length > 0 && !message.isStreaming && (
                <div className="msg-sources">
                    <div className="sources-header">
                        <Globe size={12} />
                        <span>Sources</span>
                    </div>
                    <div className="sources-list">
                        {message.webSearch.links.slice(0, 5).map((link, idx) => (
                            <a 
                                key={`${link.url}-${idx}`} 
                                href={link.url} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="source-item"
                                title={link.title}
                            >
                                <span className="source-index">{idx + 1}</span>
                                <span className="source-title">{link.title}</span>
                                <ExternalLink size={10} className="source-icon" />
                            </a>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
});

MessageBubble.displayName = 'MessageBubble';

export default MessageBubble;
