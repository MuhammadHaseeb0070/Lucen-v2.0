import React, { useState, useMemo, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { Trash2, ChevronDown, ChevronRight, Copy, Check, RotateCcw, Link2, Pin, Globe, Split, Loader2, Image, FileText, Coins, Receipt, Settings } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import ArtifactCard from './ArtifactCard';
import ArtifactSuggestionPicker from './ArtifactSuggestionPicker';
import { parseArtifacts, type ParseResult } from '../lib/artifactParser';
import { parseArtifactsOffThread } from '../workers/artifactParseWorkerClient';
import { useArtifactStore } from '../store/artifactStore';
import type { Message } from '../types';
import { fetchUsageReceipt } from '../services/database';
import { getUserFriendlyError } from '../lib/errorMessages';

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

const MessageBubbleComponent: React.FC<MessageBubbleProps> = ({
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
    const [stepsOpen, setStepsOpen] = useState(false);
    const [receiptOpen, setReceiptOpen] = useState(false);
    const [usageLogs, setUsageLogs] = useState<any[] | null>(null);
    const [loadingReceipt, setLoadingReceipt] = useState(false);

    const hasRunningTools = useMemo(() => {
        return message.toolSteps?.some(s => s.status === 'running') ?? false;
    }, [message.toolSteps]);

    const completedTools = useMemo(() => {
        return message.toolSteps?.filter(s => s.status !== 'running') ?? [];
    }, [message.toolSteps]);

    useEffect(() => {
        if (hasRunningTools) {
            setStepsOpen(true);
        }
    }, [hasRunningTools]);

    const prevIdRef = useRef(message.id);
    const prevIsStreamingRef = useRef(message.isStreaming);
    const prevHasReasoningRef = useRef(!!message.reasoning);

    useEffect(() => {
        // Reset if message ID changes (component reuse)
        if (message.id !== prevIdRef.current) {
            setReasoningOpen(false);
        }
        
        // Transition from streaming to not streaming (streaming completes)
        if (prevIsStreamingRef.current && !message.isStreaming) {
            setReasoningOpen(false);
        }

        // When reasoning first starts arriving (goes from empty/falsy to having content)
        const hasReasoningNow = !!message.reasoning;
        if (!prevHasReasoningRef.current && hasReasoningNow) {
            setReasoningOpen(false);
        }

        prevIdRef.current = message.id;
        prevIsStreamingRef.current = message.isStreaming;
        prevHasReasoningRef.current = hasReasoningNow;
    }, [message.id, message.isStreaming, message.reasoning]);

    const handleToggleReceipt = async () => {
        if (receiptOpen) {
            setReceiptOpen(false);
            return;
        }

        setReceiptOpen(true);

        if (message.usageReceipt || usageLogs) return;

        setLoadingReceipt(true);
        try {
            const logs = await fetchUsageReceipt(message.id);
            setUsageLogs(logs);
        } catch (err) {
            console.error('Failed to fetch usage logs:', err);
        } finally {
            setLoadingReceipt(false);
        }
    };

    const receiptData = useMemo(() => {
        if (message.usageReceipt) {
            const prompt_tokens = message.usageReceipt.prompt_tokens;
            const completion_tokens = message.usageReceipt.completion_tokens;
            const reasoning_tokens = message.usageReceipt.reasoning_tokens;
            const total_credits = message.usageReceipt.total_credits;
            const search_credits = message.usageReceipt.search_credits;
            const text_credits = Math.max(0, total_credits - search_credits);

            return {
                prompt_tokens,
                completion_tokens,
                reasoning_tokens,
                total_credits,
                search_credits,
                text_credits,
                tools: message.usageReceipt.tools_used || []
            };
        }

        if (usageLogs && usageLogs.length > 0) {
            let prompt_tokens = 0;
            let completion_tokens = 0;
            let reasoning_tokens = 0;
            let total_credits = 0;
            let search_credits = 0;
            const tools: any[] = [];

            for (const log of usageLogs) {
                if (log.call_kind === 'chat' || log.call_kind === 'chat_continuation') {
                    prompt_tokens += log.prompt_tokens || 0;
                    completion_tokens += log.completion_tokens || 0;
                    reasoning_tokens += log.reasoning_tokens || 0;
                }
                total_credits += log.total_credits_deducted || 0;
                if (log.call_kind === 'web_search' || log.web_search_credits) {
                    search_credits += log.web_search_credits || 0;
                }
                if (log.call_kind === 'describe_image') {
                    tools.push({
                        name: 'analyze_image',
                        durationMs: log.duration_ms,
                        status: log.status === 'completed' ? 'completed' : 'failed',
                        credits: log.total_credits_deducted || 0,
                    });
                }
                if (log.call_kind === 'web_search') {
                    tools.push({
                        name: 'web_search',
                        durationMs: log.duration_ms,
                        status: log.status === 'completed' ? 'completed' : 'failed',
                        credits: log.total_credits_deducted || 0,
                    });
                }
            }

            if (message.toolSteps) {
                for (const step of message.toolSteps) {
                    if (step.tool === 'process_file') {
                        tools.push({
                            name: 'process_file',
                            durationMs: step.durationMs,
                            status: step.status,
                            credits: 0
                        });
                    }
                }
            }

            const text_credits = Math.max(0, total_credits - search_credits);

            return {
                prompt_tokens,
                completion_tokens,
                reasoning_tokens,
                total_credits,
                search_credits,
                text_credits,
                tools
            };
        }

        return null;
    }, [message.usageReceipt, usageLogs, message.toolSteps]);

    const setActiveArtifact = useArtifactStore((s) => s.setActiveArtifact);
    const storeUpdateArtifactContent = useArtifactStore((s) => s.updateArtifactContent);
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

        // During streaming: run parseArtifacts on the main thread so the
        // <lucen_artifact> tag is stripped from the visible chat text as
        // soon as it appears. The regex is fast enough for real-time; we
        // only skip the Web Worker path during streaming.
        if (message.isStreaming) {
            setWorkerParsing(false);
            const next = parseArtifacts(content, message.id, false);
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
    const cleanContent = useMemo(() => {
        if (!rawCleanContent) return '';
        return rawCleanContent
            .replace(/<lucen_response\s+type="(plain|final)">/gi, '')
            .replace(/<\/lucen_response>/gi, '');
    }, [rawCleanContent]);

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

    // Open the artifact workspace when an artifact is first detected AND
    // stream live content updates so the renderer shows real-time progress.
    const openedRef = useRef(false);
    const artifactsRef = useRef(artifacts);
    artifactsRef.current = artifacts;
    const firstArtifactId = artifacts[0]?.id ?? '';
    const firstArtifactContent = artifacts[0]?.content ?? '';
    const firstArtifactIsStreaming = artifacts[0]?.isStreaming ?? false;
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
            // First time seeing this artifact — open the workspace.
            openedRef.current = true;
            setActiveArtifact({ ...first, isStreaming: message.isStreaming ?? false });
        } else if (message.isStreaming && first.content) {
            // Stream is still running — push live content updates to the
            // workspace so the renderer shows real-time progress.
            storeUpdateArtifactContent({ ...first, isStreaming: true });
        } else if (!message.isStreaming) {
            // Stream completed — push the final content.
            storeUpdateArtifactContent({ ...first, isStreaming: false });
        }
    }, [disableArtifacts, firstArtifactId, firstArtifactContent, firstArtifactIsStreaming, message.isStreaming, setActiveArtifact, storeUpdateArtifactContent, isDismissed]);

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
            {/* Tool Steps Block */}
            {message.toolSteps && message.toolSteps.length > 0 && (
                <div className="tool-steps-block">
                    {completedTools.length > 0 && (
                        <button className="tool-steps-toggle" onClick={() => setStepsOpen(!stepsOpen)}>
                            {stepsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            <span className="tool-steps-toggle-label">Steps taken ({completedTools.length})</span>
                        </button>
                    )}
                    {stepsOpen && (
                        <div className="tool-steps-list">
                            {message.toolSteps.map((step) => {
                                const isRunning = step.status === 'running';
                                const isFailed = step.status === 'failed';

                                let IconComponent = Settings;
                                if (step.tool === 'analyze_image') IconComponent = Image;
                                else if (step.tool === 'web_search') IconComponent = Globe;
                                else if (step.tool === 'process_file') IconComponent = FileText;

                                return (
                                    <div key={step.id} className={`tool-step-item tool-step-item--${step.status}`}>
                                        <div className="tool-step-icon-wrapper">
                                            {isRunning ? (
                                                <Loader2 size={13} className="tool-step-spinner" />
                                            ) : isFailed ? (
                                                <span className="tool-step-status-icon tool-step-status-icon--failed">✕</span>
                                            ) : (
                                                <span className="tool-step-status-icon tool-step-status-icon--completed">✓</span>
                                            )}
                                            <IconComponent size={13} className="tool-step-icon" />
                                        </div>
                                        <div className="tool-step-content">
                                            <span className="tool-step-label">{step.label}</span>
                                            {step.status === 'completed' && step.durationMs !== undefined && (
                                                <span className="tool-step-duration">({(step.durationMs / 1000).toFixed(1)}s)</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
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
            
            {message.webSearchUsed && message.webSearchUrls && message.webSearchUrls.length > 0 && (() => {
                const uniqueUrls: string[] = [];
                const seenUrls = new Set<string>();
                for (const url of message.webSearchUrls) {
                    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                        try {
                            const parsed = new URL(url);
                            const normalized = parsed.toString();
                            if (!seenUrls.has(normalized)) {
                                seenUrls.add(normalized);
                                uniqueUrls.push(url);
                            }
                        } catch {
                            // ignore
                        }
                    }
                }
                if (uniqueUrls.length === 0) return null;
                return (
                    <div className="reasoning-block search-sources-block" style={{ marginTop: normalizedReasoning ? '0.5rem' : '0' }}>
                        <button className="reasoning-toggle" onClick={() => setSearchSourcesOpen(!searchSourcesOpen)}>
                            <Globe size={14} />
                            <span className="reasoning-label" style={{ flex: 1, textAlign: 'left', marginLeft: '0.25rem' }}>
                                Searched {uniqueUrls.length} sources
                            </span>
                            {searchSourcesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        {searchSourcesOpen && (
                            <div className="citation-cards-container">
                                {uniqueUrls.map((url, idx) => {
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
                                                <div className="citation-url">{parsedUrl.pathname !== '' ? parsedUrl.pathname : '/'}</div>
                                            </a>
                                        );
                                    } catch {
                                        return null;
                                    }
                                })}
                            </div>
                        )}
                    </div>
                );
            })()}

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
                        {message.generationStatusDetail ? ` ${getUserFriendlyError(message.generationStatusDetail)}` : ''}
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
                    {cleanContent ? (
                        <MarkdownRenderer content={cleanContent} searchQuery={searchQuery} />
                    ) : (
                        !message.isStreaming && message.toolSteps && message.toolSteps.length > 0 && (
                            <div className="msg-fallback-error" style={{ opacity: 0.6, fontSize: '0.9em', fontStyle: 'italic' }}>
                                I wasn't able to generate a response. Please try again.
                            </div>
                        )
                    )}
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

            {message.isTruncated && !message.isStreaming && artifacts.length === 0 && (
                <div className="msg-truncated" role="status" style={{ opacity: 0.6, fontSize: '0.82em', marginTop: '0.5em' }}>
                    Response was cut short.
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
                    {message.role === 'assistant' && (
                        <div className="msg-usage-receipt-wrapper" style={{ position: 'relative', display: 'inline-block' }}>
                            <button
                                className={`msg-action-btn ${receiptOpen ? 'msg-action-btn--active' : ''}`}
                                onClick={handleToggleReceipt}
                                title="Show cost breakdown"
                            >
                                <Receipt size={13} />
                            </button>
                            {receiptOpen && (
                                <div className="usage-receipt-popover">
                                    <div className="usage-receipt-popover-header">
                                        <Coins size={13} className="usage-receipt-header-icon" />
                                        <span>Usage & Cost Receipt</span>
                                    </div>
                                    {loadingReceipt ? (
                                        <div className="usage-receipt-loading">
                                            <Loader2 size={13} className="usage-receipt-spinner" />
                                            <span>Loading cost breakdown...</span>
                                        </div>
                                    ) : receiptData ? (
                                        <div className="usage-receipt-content">
                                            <div className="usage-receipt-row">
                                                <span className="usage-receipt-label">Text Completion</span>
                                                <span className="usage-receipt-value">
                                                    {receiptData.total_credits > 0 ? `-${receiptData.text_credits.toFixed(4)} credits` : 'Free'}
                                                </span>
                                            </div>
                                            <div className="usage-receipt-subrow">
                                                Tokens: {receiptData.prompt_tokens.toLocaleString()} in / {receiptData.completion_tokens.toLocaleString()} out
                                                {receiptData.reasoning_tokens > 0 && ` (${receiptData.reasoning_tokens.toLocaleString()} thinking)`}
                                            </div>

                                            {receiptData.tools && receiptData.tools.length > 0 && (
                                                <>
                                                    <div className="usage-receipt-divider" />
                                                    <div className="usage-receipt-section-title">Executed Tools</div>
                                                    {receiptData.tools.map((tool: any, idx: number) => (
                                                        <div key={idx} className="usage-receipt-tool-row">
                                                            <span className="usage-receipt-tool-name">
                                                                {tool.name === 'analyze_image' ? 'analyze_image (Vision)' :
                                                                 tool.name === 'web_search' ? 'web_search (Tavily)' :
                                                                 tool.name === 'process_file' ? 'process_file (Reader)' : tool.name}
                                                            </span>
                                                            <span className="usage-receipt-tool-value">
                                                                {tool.credits > 0 ? `-${tool.credits.toFixed(4)} credits` : 'Free'}
                                                                {tool.durationMs !== undefined && ` (${(tool.durationMs / 1000).toFixed(1)}s)`}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </>
                                            )}

                                            <div className="usage-receipt-divider usage-receipt-divider--thick" />
                                            <div className="usage-receipt-row usage-receipt-row--total">
                                                <span className="usage-receipt-total-label">Total Cost</span>
                                                <span className="usage-receipt-total-value">
                                                    -{receiptData.total_credits.toFixed(4)} credits
                                                </span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="usage-receipt-empty">
                                            No billing logs found for this message.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
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
};

const MessageBubble = React.memo(MessageBubbleComponent, (prevProps, nextProps) => {
    if (prevProps.isLinked !== nextProps.isLinked) return false;
    if (prevProps.showDelete !== nextProps.showDelete) return false;
    if (prevProps.showRetry !== nextProps.showRetry) return false;
    if (prevProps.searchQuery !== nextProps.searchQuery) return false;
    if (prevProps.disableReasoning !== nextProps.disableReasoning) return false;
    if (prevProps.disableArtifacts !== nextProps.disableArtifacts) return false;

    const pm = prevProps.message;
    const nm = nextProps.message;

    if (pm.id !== nm.id) return false;
    if (pm.content !== nm.content) return false;
    if (pm.reasoning !== nm.reasoning) return false;
    if (pm.isStreaming !== nm.isStreaming) return false;
    if (pm.isPinned !== nm.isPinned) return false;
    if (pm.generationStatus !== nm.generationStatus) return false;
    if (pm.generationStatusDetail !== nm.generationStatusDetail) return false;
    if (pm.isTruncated !== nm.isTruncated) return false;

    if ((pm.toolSteps?.length ?? 0) !== (nm.toolSteps?.length ?? 0)) return false;
    if (pm.toolSteps && nm.toolSteps) {
        for (let i = 0; i < pm.toolSteps.length; i++) {
            if (pm.toolSteps[i].status !== nm.toolSteps[i].status) return false;
            if (pm.toolSteps[i].label !== nm.toolSteps[i].label) return false;
        }
    }

    if ((pm.webSearchUrls?.length ?? 0) !== (nm.webSearchUrls?.length ?? 0)) return false;

    return true;
});

MessageBubble.displayName = 'MessageBubble';

export default MessageBubble;
