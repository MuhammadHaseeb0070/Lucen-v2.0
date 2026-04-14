import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Search, X, ChevronUp, ChevronDown, ArrowDown, Upload } from 'lucide-react';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import SelectionMenu from './SelectionMenu';
import { useChatStore } from '../store/chatStore';
import { useCreditsStore } from '../store/creditsStore';
import { useSideChatStore } from '../store/sideChatStore';
import Logo from './Logo';
import { useArtifactStore } from '../store/artifactStore';
import { useComposerStore } from '../store/composerStore';
import { streamChat } from '../services/openrouter';
import { getActiveModel } from '../config/models';
import { processFiles } from '../services/fileProcessor';
import { highlightText } from '../lib/searchHighlight';
import type { FileAttachment, Message } from '../types';
import { useUIStore } from '../store/uiStore';

const ChatArea: React.FC = () => {
    const {
        activeConversationId,
        getActiveConversation,
        createConversation,
        addMessage,
        updateMessage,
        deleteMessagePair,
        getContextMessages,
        getDraft,
        setDraft,
        togglePinMessage,
        isMessageLoading,
    } = useChatStore();

    const { hasEnoughCredits } = useCreditsStore();
    const { 
        injectedContext, 
        toggleInjectedMessage, 
        removeInjectedMessage
    } = useSideChatStore();

    const { 
        setSideChatOpen, 
        setViewerOpen, 
        setViewerFile 
    } = useUIStore();

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const activeConv = getActiveConversation();
    // @ts-ignore: Suppress Vercel unused error if it builds differently
    const model = getActiveModel();

    const pendingMainComposerPrefill = useComposerStore((s) => s.pendingMainComposerPrefill);
    const consumePendingMainComposerPrefill = useComposerStore((s) => s.consumePendingMainComposerPrefill);

    const [highlightedPairId, setHighlightedPairId] = useState<string | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [matchCount, setMatchCount] = useState(0);
    const [activeMatchIndex, setActiveMatchIndex] = useState(0);
    const [activeMatchMsgId, setActiveMatchMsgId] = useState<string | null>(null);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [isAutoScroll, setIsAutoScroll] = useState(true);
    const [prefillValue, setPrefillValue] = useState('');
    const [prefillCounter, setPrefillCounter] = useState(0);
    const [isDragOver, setIsDragOver] = useState(false);
    const [droppedFiles, setDroppedFiles] = useState<FileAttachment[]>([]);
    const [webSearchEnabled, setWebSearchEnabled] = useState(false);
    const dragCounterRef = useRef(0);

    const scrollToBottom = useCallback(() => {
        // Jump directly to bottom (no smooth) to keep up with streaming.
        const container = messagesContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
        } else {
            messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
        }
        setIsAutoScroll(true);
    }, []);

    // Auto-scroll only when user is near the bottom (isAutoScroll = true).
    useEffect(() => {
        if (!isAutoScroll) return;
        scrollToBottom();
    }, [activeConv?.messages, isAutoScroll, scrollToBottom]);

    // Scroll-to-bottom FAB visibility
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;
        const handleScroll = () => {
            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            const isNearBottom = distanceFromBottom < 200;
            setShowScrollBtn(!isNearBottom && container.scrollHeight > container.clientHeight + 100);
            setIsAutoScroll(isNearBottom);
        };
        container.addEventListener('scroll', handleScroll);
        return () => container.removeEventListener('scroll', handleScroll);
    }, []);

    // On mount: clean up stale streaming states
    useEffect(() => {
        const state = useChatStore.getState();
        state.conversations.forEach((conv) => {
            conv.messages.forEach((msg) => {
                if (msg.isStreaming) {
                    updateMessage(conv.id, msg.id, {
                        isStreaming: false, isReasoningStreaming: false,
                        content: msg.content || '⚠️ Response was interrupted. Click retry to regenerate.',
                    });
                }
            });
        });
    }, [updateMessage]);

    // Clear workspace artifact when switching conversations
    const clearArtifact = useArtifactStore((s) => s.clearArtifact);
    useEffect(() => {
        clearArtifact();
    }, [activeConversationId, clearArtifact]);

    useEffect(() => {
        if (!pendingMainComposerPrefill) return;
        setPrefillValue(pendingMainComposerPrefill);
        setPrefillCounter((c) => c + 1);
        consumePendingMainComposerPrefill();
    }, [pendingMainComposerPrefill, consumePendingMainComposerPrefill]);

    // Clear prefill when switching conversations so it doesn't reappear in new chat
    useEffect(() => {
        setPrefillValue('');
        setPrefillCounter(0);
    }, [activeConversationId]);

    const isStreaming = activeConv?.messages.some((m) => m.isStreaming) || false;

    // ─── Stream helpers ───
    const doStreamResponse = async (convId: string, assistantMsgId: string) => {
        const controller = new AbortController();
        abortRef.current = controller;
        const contextMessages = getContextMessages(convId);

        // Local buffering to reduce render thrash during streaming.
        let chunkBuffer = '';
        let lastFlushTs = 0;

        const flushBuffer = () => {
            if (!chunkBuffer) return;
            const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
            const msg = conv?.messages.find((m) => m.id === assistantMsgId);
            updateMessage(convId, assistantMsgId, {
                content: (msg?.content || '') + chunkBuffer,
                isReasoningStreaming: false,
            });
            chunkBuffer = '';
            lastFlushTs = Date.now();
        };

        await streamChat(contextMessages, {
            onChunk: (chunk) => {
                chunkBuffer += chunk;
                const now = Date.now();
                // Flush at most every ~60ms to keep UI smooth but responsive.
                if (!lastFlushTs || now - lastFlushTs > 60) {
                    flushBuffer();
                }
            },
            onReasoning: (reasoning) => {
                const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
                const msg = conv?.messages.find((m) => m.id === assistantMsgId);
                updateMessage(convId, assistantMsgId, { reasoning: (msg?.reasoning || '') + reasoning });
            },
            onDone: (truncated) => {
                // Flush any remaining buffered chunks.
                flushBuffer();
                updateMessage(convId, assistantMsgId, {
                    isStreaming: false,
                    isReasoningStreaming: false,
                    isTruncated: truncated || false,
                });
                abortRef.current = null;
                // Sync credit balance from server after deduction
                useCreditsStore.getState().syncFromServer();
            },
            onError: (error) => { updateMessage(convId, assistantMsgId, { content: `⚠️ Error: ${error}`, isStreaming: false, isReasoningStreaming: false }); abortRef.current = null; useCreditsStore.getState().syncFromServer(); },
            onWebSearchUsed: () => updateMessage(convId, assistantMsgId, { webSearchUsed: true }),
            onClarificationNeeded: (question) => {
                flushBuffer();
                updateMessage(convId, assistantMsgId, {
                    content: `_Search paused. I need a bit more info to get you the right results:_\n\n**${question}**`,
                    isStreaming: false,
                    isReasoningStreaming: false,
                });
                abortRef.current = null;
            },
        }, { signal: controller.signal, webSearchEnabled, conversationId: convId });
    };

    // ─── Continue truncated response ───
    const handleContinue = async (assistantMsgId: string) => {
        if (!activeConversationId) return;
        const convId = activeConversationId;

        updateMessage(convId, assistantMsgId, { isStreaming: true, isTruncated: false });

        const controller = new AbortController();
        abortRef.current = controller;

        const contextMessages = getContextMessages(convId);
        contextMessages.push({
            id: 'continue-instruction',
            role: 'user',
            content: 'Continue from where you left off. Do not repeat what you already said. Continue directly.',
            // eslint-disable-next-line react-hooks/purity
            timestamp: Date.now(),
        });

        await streamChat(contextMessages, {
            onChunk: (chunk) => {
                const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
                const msg = conv?.messages.find((m) => m.id === assistantMsgId);
                updateMessage(convId, assistantMsgId, { content: (msg?.content || '') + chunk });
            },
            onReasoning: () => { /* skip reasoning for continuation */ },
            onDone: (truncated) => {
                updateMessage(convId, assistantMsgId, {
                    isStreaming: false,
                    isTruncated: truncated || false,
                });
                abortRef.current = null;
            },
            onError: (error) => {
                updateMessage(convId, assistantMsgId, {
                    content: useChatStore.getState().conversations.find((c) => c.id === convId)?.messages.find((m) => m.id === assistantMsgId)?.content + `\n\n⚠️ Error continuing: ${error}`,
                    isStreaming: false,
                });
                abortRef.current = null;
            },
            onWebSearchUsed: () => updateMessage(convId, assistantMsgId, { webSearchUsed: true }),
            onClarificationNeeded: (question) => {
                const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
                const msg = conv?.messages.find((m) => m.id === assistantMsgId);
                updateMessage(convId, assistantMsgId, {
                    content: (msg?.content || '') + `\n\n_Search paused._\n\n**${question}**`,
                    isStreaming: false,
                    isReasoningStreaming: false,
                });
                abortRef.current = null;
            },
        }, { signal: controller.signal, webSearchEnabled, conversationId: convId });
    };

    const handleSend = async (content: string, attachments?: FileAttachment[]) => {
        if (!hasEnoughCredits()) return;
        let convId = activeConversationId;
        if (!convId) convId = createConversation();

        addMessage(convId, {
            // eslint-disable-next-line react-hooks/purity
            id: uuidv4(), role: 'user', content, timestamp: Date.now(),
            attachments: attachments || undefined,
        });

        const assistantMsgId = uuidv4();
        addMessage(convId, {
            id: assistantMsgId, role: 'assistant', content: '', reasoning: '',
            // eslint-disable-next-line react-hooks/purity
            timestamp: Date.now(), isStreaming: true, isReasoningStreaming: model.supportsReasoning,
        });
        await doStreamResponse(convId, assistantMsgId);
    };

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current++;
        if (e.dataTransfer.types.includes('Files')) {
            setIsDragOver(true);
        }
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) {
            setIsDragOver(false);
        }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        dragCounterRef.current = 0;
        const files = e.dataTransfer.files;
        if (files.length === 0) return;
        const { attachments, errors } = await processFiles(files);
        if (errors.length > 0) console.warn('Drop warnings:', errors);
        if (attachments.length > 0) setDroppedFiles(attachments);
    }, []);

    const handleDroppedFilesConsumed = useCallback(() => {
        setDroppedFiles([]);
    }, []);

    const handleStop = () => {
        abortRef.current?.abort();
        abortRef.current = null;
        if (activeConversationId && activeConv) {
            activeConv.messages.forEach((msg) => {
                if (msg.isStreaming) {
                    updateMessage(activeConversationId, msg.id, {
                        isStreaming: false, isReasoningStreaming: false,
                        content: msg.content || '⏹ Response stopped.',
                    });
                }
            });
        }
    };

    const handleHaltAndEdit = useCallback(() => {
        if (!activeConversationId || !activeConv) return;
        abortRef.current?.abort();
        abortRef.current = null;
        const msgs = activeConv.messages;
        let lastUserMsg: typeof msgs[0] | null = null;
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'user') {
                lastUserMsg = msgs[i];
                break;
            }
        }
        if (!lastUserMsg) return;
        const savedPrompt = lastUserMsg.content;
        deleteMessagePair(activeConversationId, lastUserMsg.id);
        // No client-side credit refund — server deduction only happens after stream completes
        setPrefillValue(savedPrompt);
        setPrefillCounter((c) => c + 1);
    }, [activeConversationId, activeConv, deleteMessagePair]);

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isStreaming) {
                e.preventDefault();
                handleHaltAndEdit();
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isStreaming, handleHaltAndEdit]);

    const handleDelete = (msgId: string) => {
        if (!activeConversationId) return;
        setHighlightedPairId(null);
        
        const conv = useChatStore.getState().conversations.find(c => c.id === activeConversationId);
        const idx = conv?.messages.findIndex(m => m.id === msgId);
        
        if (conv && idx !== undefined && idx !== -1) {
            const msg = conv.messages[idx];
            removeInjectedMessage(msg.id);
            
            if (msg.role === 'user') {
                if (idx + 1 < conv.messages.length && conv.messages[idx + 1].role === 'assistant') {
                    removeInjectedMessage(conv.messages[idx + 1].id);
                }
            } else if (msg.role === 'assistant') {
                if (idx - 1 >= 0 && conv.messages[idx - 1].role === 'user') {
                    removeInjectedMessage(conv.messages[idx - 1].id);
                }
            }
        }

        deleteMessagePair(activeConversationId, msgId);
    };

    const handleToggleLink = (message: Message) => {
        if (!activeConversationId) return;
        
        const conv = useChatStore.getState().conversations.find(c => c.id === activeConversationId);
        const idx = conv?.messages.findIndex(m => m.id === message.id);
        
        if (conv && idx !== undefined && idx !== -1) {
            const msg = conv.messages[idx];
            let pairPartner: Message | undefined;
            
            if (msg.role === 'user') {
                if (idx + 1 < conv.messages.length && conv.messages[idx + 1].role === 'assistant') {
                    pairPartner = conv.messages[idx + 1];
                }
            } else if (msg.role === 'assistant') {
                if (idx - 1 >= 0 && conv.messages[idx - 1].role === 'user') {
                    pairPartner = conv.messages[idx - 1];
                }
            }

            const wasInContext = injectedContext.some(m => m.id === message.id);
            
            // EXCHANGE-AWARE NOTIFICATION: Check if this exchange has images
            const pair = [msg];
            if (pairPartner) pair.push(pairPartner);
            const hasImages = pair.some(m => m.attachments?.some(a => a.type === 'image'));
            
            if (!wasInContext && hasImages) {
                alert("Note: Images are not supported in Side Chat context. Only message text and document content will be imported.");
            }

            // Toggle both together
            toggleInjectedMessage(msg);
            if (pairPartner) {
                const isPartnerIn = injectedContext.some(m => m.id === pairPartner!.id);
                if (wasInContext === isPartnerIn) {
                    toggleInjectedMessage(pairPartner);
                }
            }

            if (!wasInContext) {
                setSideChatOpen(true);
            }
        }
    };

    const handleRetry = (assistantMsgId: string) => {
        if (!activeConversationId || !activeConv) return;
        updateMessage(activeConversationId, assistantMsgId, {
            content: '', reasoning: '', isStreaming: true, isReasoningStreaming: model.supportsReasoning,
        });
        doStreamResponse(activeConversationId, assistantMsgId);
    };

    const handlePin = (msgId: string) => {
        if (!activeConversationId) return;
        togglePinMessage(activeConversationId, msgId);
    };

    const scrollToMessage = (msgId: string) => {
        const el = messagesContainerRef.current?.querySelector(`[data-msg-id="${msgId}"]`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setIsAutoScroll(false);
        }
    };

    const getHighlightedMatchElements = useCallback(() => {
        const q = searchQuery.trim();
        if (!q || q.length < 2) return [];
        const container = messagesContainerRef.current;
        if (!container) return [];
        const qLower = q.toLowerCase();
        const nodes = Array.from(container.querySelectorAll('mark.search-highlight'));
        return nodes.filter((el) => (el.textContent || '').toLowerCase() === qLower);
    }, [searchQuery]);

    const matchingIds = useMemo(() => {
        const qTrim = searchQuery.trim();
        if (!activeConv || !qTrim || qTrim.length < 2) return new Set<string>();
        const q = qTrim.toLowerCase();
        return new Set(
            activeConv.messages
                .filter((m) => m.content.toLowerCase().includes(q))
                .map((m) => m.id)
        );
    }, [searchQuery, activeConv]);

    // Keeps `matchCount` and `activeMatchMsgId` in sync with the rendered <mark> elements.
    useEffect(() => {
        if (!searchOpen) return;
        const elements = getHighlightedMatchElements();
        setMatchCount(elements.length);

        if (elements.length === 0) {
            setActiveMatchMsgId(null);
            if (activeMatchIndex !== 0) setActiveMatchIndex(0);
            return;
        }

        if (activeMatchIndex >= elements.length) setActiveMatchIndex(0);

        const el = elements[activeMatchIndex] || elements[0];
        const msgId = el.closest('[data-msg-id]')?.getAttribute('data-msg-id') || null;
        setActiveMatchMsgId(msgId);
    }, [searchOpen, getHighlightedMatchElements, activeMatchIndex, activeConv?.messages]);

    // Scroll to the exact highlighted substring (not just the whole message).
    useEffect(() => {
        if (!searchOpen) return;
        const elements = getHighlightedMatchElements();
        const el = elements[activeMatchIndex] || elements[0];
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [activeMatchIndex, searchOpen, getHighlightedMatchElements, activeConv?.messages]);

    const goNextMatch = () => {
        const elements = getHighlightedMatchElements();
        if (elements.length === 0) return;
        setActiveMatchIndex((i) => (i + 1) % elements.length);
    };

    const goPrevMatch = () => {
        const elements = getHighlightedMatchElements();
        if (elements.length === 0) return;
        setActiveMatchIndex((i) => (i - 1 + elements.length) % elements.length);
    };

    const handleSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) goPrevMatch();
            else goNextMatch();
        }
        if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); }
    };

    const hasMessages = activeConv && activeConv.messages.length > 0;

    const renderMessages = () => {
        if (!activeConv) return null;
        const msgs = activeConv.messages;
        const elements: React.ReactNode[] = [];
        let lastAssistantMsgId: string | null = null;
        for (let j = msgs.length - 1; j >= 0; j--) {
            if (msgs[j].role === 'assistant') {
                lastAssistantMsgId = msgs[j].id;
                break;
            }
        }

        for (let i = 0; i < msgs.length; i++) {
            const msg = msgs[i];
            if (msg.role === 'user') {
                const nextMsg = i + 1 < msgs.length && msgs[i + 1].role === 'assistant' ? msgs[i + 1] : null;
                const pairHighlighted = highlightedPairId === msg.id;
                const isDimmed = searchQuery && !matchingIds.has(msg.id) && !(nextMsg && matchingIds.has(nextMsg.id));
                const isActiveMatch = activeMatchMsgId === msg.id || activeMatchMsgId === nextMsg?.id;
                const hasReasoning = nextMsg?.reasoning || nextMsg?.isReasoningStreaming;
                const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

                elements.push(
                    <div
                        key={msg.id}
                        className={`msg-exchange ${pairHighlighted ? 'msg-exchange--danger' : ''} ${isActiveMatch ? 'msg-exchange--active-match' : ''} ${isDimmed ? 'msg-exchange--dimmed' : ''} ${msg.isPinned || nextMsg?.isPinned ? 'msg-exchange--pinned' : ''}`}
                    >
                        <div className="msg-timestamp">
                            <span>{timeStr}</span>
                            <span className="msg-timestamp__you">You</span>
                        </div>
                        <div className="msg-user-row" data-msg-id={msg.id}>
                            <div className="msg-user-bubble">
                                {searchQuery.trim()
                                    ? highlightText(msg.content, searchQuery.trim())
                                    : msg.content}
                                {msg.attachments && msg.attachments.length > 0 && (
                                    <div className="msg-attachments">
                                        {msg.attachments.map((att) => (
                                            att.type === 'image' && att.dataUrl ? (
                                                <img 
                                                    key={att.id} 
                                                    src={att.dataUrl} 
                                                    alt={att.name} 
                                                    className="msg-attachment-img clickable" 
                                                    onClick={() => {
                                                        setViewerFile({
                                                            id: att.id,
                                                            name: att.name,
                                                            type: 'image',
                                                            url: att.dataUrl
                                                        });
                                                        setViewerOpen(true);
                                                    }}
                                                />
                                            ) : (
                                                <span 
                                                    key={att.id} 
                                                    className="msg-attachment-file clickable"
                                                    onClick={() => {
                                                        setViewerFile({
                                                            id: att.id,
                                                            name: att.name,
                                                            type: att.type,
                                                            textContent: att.textContent,
                                                            aiDescription: att.aiDescription
                                                        });
                                                        setViewerOpen(true);
                                                    }}
                                                >
                                                    📄 {att.name}
                                                </span>
                                            )
                                        ))}
                                    </div>
                                )}
                            </div>
                            <MessageBubble
                                message={msg}
                                showDelete={false}
                                actionsOnly
                            />
                        </div>
                        {nextMsg && (
                            <div className="msg-ai-row" data-msg-id={nextMsg.id}>
                                <div className="msg-ai-icon"><Logo size={16} /></div>
                                <div className="msg-ai-content">
                                    <div className="msg-ai-header">
                                        <span className="msg-ai-name">Lucen AI</span>
                                        {hasReasoning && <span className="msg-reasoning-badge">Reasoning</span>}
                                    </div>
                                    <MessageBubble
                                        message={nextMsg}
                                        onRetry={handleRetry}
                                        onContinue={handleContinue}
                                        onToggleLink={handleToggleLink}
                                        onPin={handlePin}
                                        isLinked={injectedContext.some(m => m.id === nextMsg.id)}
                                        showRetry={nextMsg.id === lastAssistantMsgId}
                                        searchQuery={searchQuery.trim() || undefined}
                                        showDelete
                                        onDelete={(ignoredMsgId: string) => { void ignoredMsgId; handleDelete(msg.id); }}
                                        onDeleteHover={(h) => setHighlightedPairId(h ? msg.id : null)}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                );
                if (nextMsg) i++;
            } else {
                const isDimmed = searchQuery && !matchingIds.has(msg.id);
                const isActiveMatch = activeMatchMsgId === msg.id;
                elements.push(
                    <div key={msg.id} className={`msg-exchange ${isActiveMatch ? 'msg-exchange--active-match' : ''} ${isDimmed ? 'msg-exchange--dimmed' : ''}`}>
                        <div className="msg-ai-row" data-msg-id={msg.id}>
                            <div className="msg-ai-icon"><Logo size={16} /></div>
                            <div className="msg-ai-content">
                                <div className="msg-ai-header">
                                    <span className="msg-ai-name">Lucen AI</span>
                                </div>
                                <MessageBubble
                                    message={msg}
                                    onRetry={handleRetry}
                                    onContinue={handleContinue}
                                    onToggleLink={handleToggleLink}
                                    onPin={handlePin}
                                    isLinked={injectedContext.some(m => m.id === msg.id)}
                                    showRetry={msg.id === lastAssistantMsgId}
                                    searchQuery={searchQuery.trim() || undefined}
                                    showDelete={false}
                                />
                            </div>
                        </div>
                    </div>
                );
            }
        }
        return elements;
    };

    return (
        <div
            className="chat-area"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            <div className="pin-track-container">
                {(() => {
                    const markers: React.ReactNode[] = [];
                    if (!activeConv) return null;
                    const msgs = activeConv.messages;

                    for (let i = 0; i < msgs.length; i++) {
                        const msg = msgs[i];
                        const nextMsg = i + 1 < msgs.length && msgs[i + 1].role === 'assistant' ? msgs[i + 1] : null;

                        // Check if either the user msg or its paired assistant msg is pinned
                        if (msg.isPinned || (nextMsg && nextMsg.isPinned)) {
                            const topPercent = (i / msgs.length) * 100;
                            const previewText = (nextMsg?.content || msg.content).slice(0, 40);

                            markers.push(
                                <div 
                                    key={`pin-exchange-${msg.id}`}
                                    className="pin-marker"
                                    style={{ top: `${topPercent}%` }}
                                    onClick={() => scrollToMessage(msg.id)}
                                >
                                    <div className="pin-marker-tooltip">
                                        {previewText}...
                                    </div>
                                </div>
                            );
                        }
                        if (nextMsg) i++; // Skip assistant message in next iteration
                    }
                    return markers;
                })()}
            </div>

            {isDragOver && (
                <div className="drop-zone-overlay">
                    <div className="drop-zone-content">
                        <Upload size={36} />
                        <span className="drop-zone-label">Drop files to attach</span>
                        <span className="drop-zone-hint">Images, PDFs, CSVs, or text files</span>
                    </div>
                </div>
            )}
            {hasMessages && (
                <div className="chat-search-wrapper">
                    <div className={`chat-search-bar ${searchOpen ? 'chat-search-bar--open' : ''}`}>
                        {searchOpen ? (
                            <>
                                <Search size={16} className="chat-search-icon" />
                                <input
                                    type="text" className="chat-search-input" placeholder="Search messages..."
                                    value={searchQuery} autoFocus
                                    onChange={(e) => { setSearchQuery(e.target.value); setActiveMatchIndex(0); }}
                                    onKeyDown={handleSearchKeyDown}
                                />
                                {searchQuery && matchCount > 0 && <span className="chat-search-count">{activeMatchIndex + 1}/{matchCount}</span>}
                                {searchQuery && matchCount === 0 && <span className="chat-search-count chat-search-no-match">No results</span>}
                                {matchCount > 1 && (
                                    <>
                                        <button className="chat-search-nav" onClick={goPrevMatch} title="Previous"><ChevronUp size={15} /></button>
                                        <button className="chat-search-nav" onClick={goNextMatch} title="Next"><ChevronDown size={15} /></button>
                                    </>
                                )}
                                <button className="chat-search-close" onClick={() => { setSearchOpen(false); setSearchQuery(''); }}><X size={15} /></button>
                            </>
                        ) : (
                            <button className="chat-search-trigger" onClick={() => setSearchOpen(true)} title="Search messages"><Search size={15} /></button>
                        )}
                    </div>
                </div>
            )}
            <div className="messages-container" ref={messagesContainerRef}>
                {isMessageLoading ? (
                    <div className="messages-list">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="msg-exchange" style={{ opacity: 0.6, animation: 'pulse 1.5s infinite ease-in-out' }}>
                                <div className="msg-user-row">
                                    <div className="msg-user-bubble" style={{ width: '40%', height: '40px', background: 'var(--bg-surface)', color: 'transparent', borderRadius: 'var(--r-md)' }}>...</div>
                                </div>
                                <div className="msg-ai-row">
                                    <div className="msg-ai-icon" style={{ background: 'var(--bg-surface)' }}><Logo size={16} /></div>
                                    <div className="msg-ai-content">
                                        <div className="msg-user-bubble" style={{ width: '80%', height: '80px', background: 'var(--bg-surface)', borderRadius: 'var(--r-md)', marginTop: '8px' }} />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : !hasMessages ? (
                    <div className="welcome-screen">
                        <div className="welcome-icon"><Logo size={48} /></div>
                        <h1 className="welcome-title">Welcome to Lucen</h1>
                        <p className="welcome-subtitle">Your intelligent AI assistant. Start a conversation below.</p>
                        <div className="welcome-suggestions">
                            {['Explain quantum computing simply', 'Write a Python sorting algorithm', 'Help me draft an email', 'What are the best coding practices?'].map((s) => (
                                <button key={s} className="suggestion-chip" onClick={() => handleSend(s)}>{s}</button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="messages-list">
                        {renderMessages()}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>
            {showScrollBtn && (
                <button className="scroll-bottom-btn" onClick={scrollToBottom}><ArrowDown size={18} /></button>
            )}
            <SelectionMenu
                containerRef={messagesContainerRef}
                onPrefill={(content: string) => {
                    setPrefillValue(content);
                    setPrefillCounter((c) => c + 1);
                }}
            />
            <MessageInput
                onSend={handleSend} onStop={handleStop} onHaltAndEdit={handleHaltAndEdit}
                isStreaming={isStreaming} disabled={!hasEnoughCredits()}
                prefillValue={prefillCounter > 0 ? prefillValue : undefined}
                onPrefillConsumed={() => {
                    setPrefillValue(''); // Don't reset prefillCounter — that would remount input and clear user's text
                }}
                droppedFiles={droppedFiles.length > 0 ? droppedFiles : undefined}
                onDroppedFilesConsumed={handleDroppedFilesConsumed}
                key={`input-${activeConversationId}-${prefillCounter}`}
                initialValue={activeConversationId ? getDraft(activeConversationId) : ''}
                onInputChange={(val) => {
                    if (activeConversationId) setDraft(activeConversationId, val);
                }}
                webSearchEnabled={webSearchEnabled}
                onToggleWebSearch={setWebSearchEnabled}
            />
        </div>
    );
};

export default ChatArea;
