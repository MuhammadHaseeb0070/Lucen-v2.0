import React, { useState, useMemo, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { Trash2, ChevronDown, ChevronRight, Copy, Check, RotateCcw, Link2, Pin, Globe, Split, Loader2 } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import ArtifactCard from './ArtifactCard';
import ArtifactSuggestionPicker from './ArtifactSuggestionPicker';
import { parseArtifacts, type ParseResult } from '../lib/artifactParser';
import { parseArtifactsOffThread } from '../workers/artifactParseWorkerClient';
import { useArtifactStore } from '../store/artifactStore';
import type { Message } from '../types';

interface MessageBubbleProps {
    message: Message;
    onDelete?: (msgId: string) => void;
    onRetry?: (msgId: string) => void;
    onContinue?: (msgId: string) => void;
    onFork?: (msgId: string) => void;
    onToggleLink?: (message: Message) => void;
    onPin?: (msgId: string) => void;
    onDeleteHover?: (hovering: boolean) => void;
    showDelete?: boolean;
    showRetry?: boolean;
    isLinked?: boolean;
    actionsOnly?: boolean;
    searchQuery?: string;
    disableReasoning?: boolean;
    disableArtifacts?: boolean;
    /** Called when user selects an artifact from the suggestion picker. */
    onArtifactSuggestionSelect?: (
        suggestion: NonNullable<Message['artifactSuggestions']>[0],
        originalPrompt: string,
        messageId: string,
    ) => void;
}

/** Beyond this size, artifact tag parsing runs in a Web Worker to avoid main-thread stalls. */
const ARTIFACT_PARSE_WORKER_MIN_CHARS = 12_000;

/** Stable empty list so `artifacts` dependency / `?? []` does not allocate a new [] every render. */
const EMPTY_ARTIFACTS: ParseResult['artifacts'] = [];

const MessageBubble: React.FC<MessageBubbleProps> = React.memo(({
    message,
    onDelete,
    onRetry,
    onFork,
    onToggleLink,
    onPin,
    onDeleteHover,
    showDelete = false,
    showRetry = false,
    isLinked = false,
    actionsOnly = false,
    searchQuery,
    disableReasoning = false,
    disableArtifacts = false,
    onArtifactSuggestionSelect,
}) => {
    const [reasoningOpen, setReasoningOpen] = useState(false);
    const [searchSourcesOpen, setSearchSourcesOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const setActiveArtifact = useArtifactStore((s) => s.setActiveArtifact);
    const isDismissed = useArtifactStore((s) => s.isDismissed);

    const parseSerialRef = useRef(0);
    const [parsed, setParsed] = useState<ParseResult | null>(() => {
        const content = message.content;
        if (!content || !content.includes('<lucen_artifact')) {
            return { cleanContent: content, artifacts: EMPTY_ARTIFACTS };
        }
        if (content.length >= ARTIFACT_PARSE_WORKER_MIN_CHARS && !message.isStreaming) {
            return null;
        }
        return parseArtifacts(content, message.id, !message.isStreaming);
    });
    const [workerParsing, setWorkerParsing] = useState(false);

    useLayoutEffect(() => {
        if (disableArtifacts) {
            setWorkerParsing(false);
            setParsed((prev) => {
                if (prev?.cleanContent === message.content && prev.artifacts === EMPTY_ARTIFACTS) return prev;
                return { cleanContent: message.content, artifacts: EMPTY_ARTIFACTS };
            });
            return;
        }

        const content = message.content;
        const forceClose = !message.isStreaming;

        if (!content || !content.includes('<lucen_artifact')) {
            setWorkerParsing(false);
            setParsed((prev) => {
                if (prev?.cleanContent === content && prev.artifacts === EMPTY_ARTIFACTS) return prev;
                return { cleanContent: content, artifacts: EMPTY_ARTIFACTS };
            });
            return;
        }

        // During streaming: show raw content, skip expensive artifact parsing.
        // Artifacts are only extracted once the stream completes.
        if (message.isStreaming) {
            setWorkerParsing(false);
            setParsed((prev) => {
                if (prev?.cleanContent === content && prev.artifacts === EMPTY_ARTIFACTS) return prev;
                return { cleanContent: content, artifacts: EMPTY_ARTIFACTS };
            });
            return;
        }

        // Stream completed — parse artifacts once.
        if (content.length < ARTIFACT_PARSE_WORKER_MIN_CHARS) {
            setWorkerParsing(false);
            const next = parseArtifacts(content, message.id, forceClose);
            setParsed((prev) => {
                if (
                    prev &&
                    prev.cleanContent === next.cleanContent &&
                    prev.artifacts.length === next.artifacts.length &&
                    (prev.artifacts.length === 0 ||
                        (prev.artifacts[0]?.id === next.artifacts[0]?.id &&
                            prev.artifacts[0]?.content === next.artifacts[0]?.content))
                ) {
                    return prev;
                }
                return next;
            });
            return;
        }

        const mySerial = ++parseSerialRef.current;
        const requestId = `${message.id}:${mySerial}:${content.length}`;
        setWorkerParsing(true);

        parseArtifactsOffThread(requestId, content, message.id, forceClose)
            .then((result) => {
                if (mySerial !== parseSerialRef.current) return;
                setWorkerParsing(false);
                setParsed(result);
            })
            .catch(() => {
                if (mySerial !== parseSerialRef.current) return;
                setWorkerParsing(false);
                setParsed(parseArtifacts(content, message.id, forceClose));
            });
    }, [disableArtifacts, message.content, message.id, message.isStreaming]);

    const rawCleanContent = parsed?.cleanContent ?? '';
    const artifacts = parsed?.artifacts ?? EMPTY_ARTIFACTS;
    const cleanContent = rawCleanContent;

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

    // Open the artifact workspace when parsing completes (after stream ends).
    // Since artifact parsing is now deferred until stream completion, this
    // effect only fires once per artifact — no mid-stream store churn.
    const openedRef = useRef(false);
    const artifactsRef = useRef(artifacts);
    artifactsRef.current = artifacts;
    const firstArtifactId = artifacts[0]?.id ?? '';
    const showGenerationStatus =
        message.generationStatus &&
        !['idle', 'streaming', 'complete', 'partial_saved'].includes(message.generationStatus);

    useEffect(() => {
        if (disableArtifacts) {
            openedRef.current = false;
            return;
        }
        const list = artifactsRef.current;
        if (list.length === 0) {
            openedRef.current = false;
            return;
        }
        const first = list[0];

        if (isDismissed(first.id)) {
            openedRef.current = false;
            return;
        }

        if (!openedRef.current) {
            openedRef.current = true;
            setActiveArtifact({ ...first, isStreaming: false });
        }
    }, [disableArtifacts, firstArtifactId, setActiveArtifact, isDismissed]);

    if (actionsOnly) {
        if (!message.content) return null;
        return (
            <div className="msg-inline-actions">
                <button className="msg-action-btn" onClick={handleCopy} title="Copy">
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
                {onToggleLink && (
                    <button 
                        className={`msg-action-btn ${isLinked ? 'msg-action-btn--active' : ''}`} 
                        onClick={() => onToggleLink(message)}
                        title={isLinked ? "Remove from Side Chat context" : "Add to Side Chat context"}
                    >
                        <Link2 size={13} />
                    </button>
                )}
                {onPin && (
                    <button 
                        className={`msg-action-btn ${message.isPinned ? 'msg-action-btn--pinned' : ''}`} 
                        onClick={() => onPin(message.id)}
                        title={message.isPinned ? "Unpin message" : "Pin message"}
                    >
                        <Pin size={13} fill={message.isPinned ? "currentColor" : "none"} />
                    </button>
                )}
                {onFork && (
                    <button className="msg-action-btn" onClick={() => onFork(message.id)} title="Fork chat from here">
                        <Split size={13} />
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
        );
    }

    return (
        <div className={`msg-response ${message.isPinned ? 'msg-response--pinned' : ''}`}>
            {message.isPinned && (
                <div className="msg-pinned-indicator">
                    <Pin size={12} fill="currentColor" />
                    <span>Pinned Message</span>
                </div>
            )}
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
            
            {message.webSearchUsed && message.webSearchUrls && message.webSearchUrls.length > 0 && (
                <div className="reasoning-block search-sources-block" style={{ marginTop: normalizedReasoning ? '0.5rem' : '0' }}>
                    <button className="reasoning-toggle" onClick={() => setSearchSourcesOpen(!searchSourcesOpen)}>
                        <Globe size={14} />
                        <span className="reasoning-label" style={{ flex: 1, textAlign: 'left', marginLeft: '0.25rem' }}>
                            Searched {message.webSearchUrls.length} sources
                        </span>
                        {searchSourcesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    {searchSourcesOpen && (
                        <div className="citation-cards-container">
                            {message.webSearchUrls.map((url, idx) => {
                                try {
                                    const parsedUrl = new URL(url);
                                    const domain = parsedUrl.hostname.replace('www.', '');
                                    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
                                    return (
                                        <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="citation-card" title={url}>
                                            <div className="citation-card-header">
                                                <img src={faviconUrl} alt={`${domain} favicon`} className="citation-favicon" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                                                <span className="citation-domain">{domain}</span>
                                            </div>
                                            <div className="citation-url">{parsedUrl.pathname !== '/' ? parsedUrl.pathname : url}</div>
                                        </a>
                                    );
                                } catch {
                                    return (
                                        <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="citation-card">
                                            <div className="citation-url" style={{ wordBreak: 'break-all' }}>{url}</div>
                                        </a>
                                    );
                                }
                            })}
                        </div>
                    )}
                </div>
            )}

            {showGenerationStatus && (
                <div className="artifact-parse-loading" aria-live="polite">
                    {(message.isStreaming || message.generationStatus === 'planning' || message.generationStatus === 'generating' || message.generationStatus === 'validating' || message.generationStatus === 'repairing') && (
                        <Loader2 size={14} className="artifact-parse-loading__spin" />
                    )}
                    <span>
                        {message.generationStatus === 'continuing' && 'Continuing response…'}
                        {message.generationStatus === 'planning' && 'Planning artifact…'}
                        {message.generationStatus === 'generating' && 'Generating artifact sections…'}
                        {message.generationStatus === 'validating' && 'Validating artifact…'}
                        {message.generationStatus === 'repairing' && 'Repairing artifact…'}
                        {message.generationStatus === 'failed_recoverable' && 'Generation failed recoverably. You can retry.'}
                        {message.generationStatusDetail ? ` ${message.generationStatusDetail}` : ''}
                    </span>
                </div>
            )}

            {message.isStreaming && !message.content && !message.reasoning ? (
                <div className="streaming-indicator">
                    <span className="dot" /><span className="dot" /><span className="dot" />
                </div>
            ) : (
                <>
                    {workerParsing && !cleanContent && !message.isStreaming && (
                        <div className="artifact-parse-loading" aria-live="polite">
                            <Loader2 size={14} className="artifact-parse-loading__spin" />
                            <span>Processing artifact…</span>
                        </div>
                    )}
                    {cleanContent && <MarkdownRenderer content={cleanContent} searchQuery={searchQuery} />}
                    {!disableArtifacts && artifacts.map((artifact) => (
                        <ArtifactCard key={artifact.id} artifact={artifact} />
                    ))}
                    {!disableArtifacts && message.artifactSuggestions && message.artifactSuggestions.length > 0 && (
                        <ArtifactSuggestionPicker
                            message={message}
                            onSelect={(suggestion, originalPrompt) => {
                                onArtifactSuggestionSelect?.(suggestion, originalPrompt, message.id);
                            }}
                            onDismiss={() => {
                                // Dismiss handled externally via onArtifactSuggestionSelect with empty prompt
                                onArtifactSuggestionSelect?.(
                                    message.artifactSuggestions![0],
                                    '',
                                    message.id,
                                );
                            }}
                        />
                    )}
                </>
            )}

            {message.isTruncated && !message.isStreaming && (
                <div className="msg-truncated" role="status">
                    {message.generationStatusDetail?.trim() ||
                        'Try a narrower question or retry if this still looks cut off.'}
                </div>
            )}

            {!message.isStreaming && message.content && (
                <div className="msg-response-actions">
                    <button className="msg-action-btn" onClick={handleCopy} title="Copy response">
                        {copied ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                    {onToggleLink && (
                        <button 
                            className={`msg-action-btn ${isLinked ? 'msg-action-btn--active' : ''}`} 
                            onClick={() => onToggleLink(message)}
                            title={isLinked ? "Remove from Side Chat context" : "Add to Side Chat context"}
                        >
                            <Link2 size={13} />
                        </button>
                    )}
                    {onPin && (
                        <button 
                            className={`msg-action-btn ${message.isPinned ? 'msg-action-btn--pinned' : ''}`} 
                            onClick={() => onPin(message.id)}
                            title={message.isPinned ? "Unpin message" : "Pin message"}
                        >
                            <Pin size={13} fill={message.isPinned ? "currentColor" : "none"} />
                        </button>
                    )}
                    {onFork && (
                        <button className="msg-action-btn" onClick={() => onFork(message.id)} title="Fork chat from here">
                            <Split size={13} />
                        </button>
                    )}
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
        </div>
    );
});

MessageBubble.displayName = 'MessageBubble';

export default MessageBubble;
