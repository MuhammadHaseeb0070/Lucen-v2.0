import React, { useState, useMemo, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { Trash2, ChevronDown, ChevronRight, Copy, Check, RotateCcw, ChevronLast, Link2, Pin, Globe, Split, Loader2 } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import ArtifactCard from './ArtifactCard';
import PatchSummaryCard from './PatchSummaryCard';
import PatchTurnReportCard from './PatchTurnReportCard';
import { parseArtifacts, type ParseResult } from '../lib/artifactParser';
import { parsePatches, type ParsedPatch } from '../lib/artifactPatchParser';
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
}

/** Beyond this size, artifact tag parsing runs in a Web Worker to avoid main-thread stalls. */
const ARTIFACT_PARSE_WORKER_MIN_CHARS = 12_000;

const MessageBubble: React.FC<MessageBubbleProps> = React.memo(({
    message,
    onDelete,
    onRetry,
    onContinue,
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
}) => {
    const [reasoningOpen, setReasoningOpen] = useState(false);
    const [searchSourcesOpen, setSearchSourcesOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const setActiveArtifact = useArtifactStore((s) => s.setActiveArtifact);
    const updateArtifactContent = useArtifactStore((s) => s.updateArtifactContent);
    const isDismissed = useArtifactStore((s) => s.isDismissed);

    const parseSerialRef = useRef(0);
    const [parsed, setParsed] = useState<ParseResult | null>(() => {
        const content = message.content;
        if (!content || !content.includes('<lucen_artifact')) {
            return { cleanContent: content, artifacts: [] };
        }
        if (content.length >= ARTIFACT_PARSE_WORKER_MIN_CHARS && !message.isStreaming) {
            return null;
        }
        return parseArtifacts(content, message.id, !message.isStreaming);
    });
    const [workerParsing, setWorkerParsing] = useState(false);

    useLayoutEffect(() => {
        const content = message.content;
        const forceClose = !message.isStreaming;

        if (!content || !content.includes('<lucen_artifact')) {
            setWorkerParsing(false);
            setParsed({ cleanContent: content, artifacts: [] });
            return;
        }

        // Streaming stays on the main thread so chunk updates do not flood the worker.
        if (message.isStreaming || content.length < ARTIFACT_PARSE_WORKER_MIN_CHARS) {
            setWorkerParsing(false);
            const next = parseArtifacts(content, message.id, forceClose);
            setParsed(disableArtifacts ? { cleanContent: next.cleanContent, artifacts: [] } : next);
            return;
        }

        const mySerial = ++parseSerialRef.current;
        const requestId = `${message.id}:${mySerial}:${content.length}`;
        setWorkerParsing(true);

        parseArtifactsOffThread(requestId, content, message.id, forceClose)
            .then((result) => {
                if (mySerial !== parseSerialRef.current) return;
                setWorkerParsing(false);
                setParsed(disableArtifacts ? { cleanContent: result.cleanContent, artifacts: [] } : result);
            })
            .catch(() => {
                if (mySerial !== parseSerialRef.current) return;
                setWorkerParsing(false);
                const fallback = parseArtifacts(content, message.id, forceClose);
                setParsed(disableArtifacts ? { cleanContent: fallback.cleanContent, artifacts: [] } : fallback);
            });
    }, [disableArtifacts, message.content, message.id, message.isStreaming]);

    const rawCleanContent = parsed?.cleanContent ?? '';
    const artifacts = parsed?.artifacts ?? [];

    // Patching engine: also extract <lucen_patch> blocks for display.
    // Cheap re-parse on the same content — patch tags are rare and the
    // regex returns immediately when no <lucen_patch substring exists.
    const patchParse = useMemo(() => {
        const content = message.content;
        if (!content || !content.includes('<lucen_patch')) {
            return { cleanContent: rawCleanContent, patches: [] as ParsedPatch[] };
        }
        return parsePatches(content, !message.isStreaming);
    }, [message.content, message.isStreaming, rawCleanContent]);
    const patches: ParsedPatch[] = patchParse.patches;
    const cleanContent = patchParse.cleanContent;

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

        // If the user closed this artifact's workspace, never reopen it or
        // push further updates into the store for it. The code view can still
        // render inside the message bubble card itself.
        if (isDismissed(first.id)) {
            openedRef.current = false;
            return;
        }

        if (first.isStreaming) {
            const now = Date.now();
            if (!openedRef.current) {
                // First time seeing this artifact — open workspace
                openedRef.current = true;
                setActiveArtifact(first);
                lastUpdateRef.current = now;
            } else if (now - lastUpdateRef.current > 300) {
                // Throttle store update at ~300ms. Actual heavy preview
                // re-render is further throttled inside ArtifactRenderer.
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
    }, [disableArtifacts, artifacts, setActiveArtifact, updateArtifactContent, isDismissed]);

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
                        <div className="reasoning-content search-sources-content" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {message.webSearchUrls.map((url, idx) => {
                                try {
                                    const domain = new URL(url).hostname.replace('www.', '');
                                    return (
                                        <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="search-source-link" style={{ fontSize: '0.8rem', color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0.5rem', borderRadius: '4px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                                            <span style={{ fontWeight: 600, color: 'var(--accent-color)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{domain}</span>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.7 }}>{url}</span>
                                        </a>
                                    );
                                } catch {
                                    return <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="search-source-link" style={{ fontSize: '0.8rem', color: 'inherit', wordBreak: 'break-all' }}>{url}</a>;
                                }
                            })}
                        </div>
                    )}
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
                    {!disableArtifacts && message.patchReport?.status === 'running' && artifacts.length === 0 && patches.map((patch, idx) => (
                        <PatchSummaryCard
                            key={`patch-${message.id}-${idx}`}
                            patch={patch}
                            isStreaming={patch.isStreaming || message.isStreaming}
                        />
                    ))}
                    {message.patchReport && <PatchTurnReportCard report={message.patchReport} />}
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
