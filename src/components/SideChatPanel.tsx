import React, { useRef, useCallback, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
    X,
    GripHorizontal,
    Link,
    Unlink,
    Trash2,
    Minimize2,
    Upload,
    CheckSquare,
    Square,
} from 'lucide-react';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import SelectionMenu from './SelectionMenu';
import { useSideChatStore, createMessage } from '../store/sideChatStore';
import { useChatStore } from '../store/chatStore';
import { useUIStore } from '../store/uiStore';
import { streamChat } from '../services/openrouter';
import { processFiles } from '../services/fileProcessor';
import { SIDE_CHAT_SYSTEM_PROMPT } from '../config/prompts';
import type { Message, FileAttachment } from '../types';
import Logo from './Logo';

const SideChatPanel: React.FC = () => {
    const {
        messages,
        injectedContext,
        isContextEnabled,
        pendingMessage,
        addMessage,
        updateMessage,
        clearMessages,
        clearContext,
        injectMainChatContext,
        getApiMessages,
        getContextBlock,
        clearPendingMessage,
    } = useSideChatStore();

    const { getActiveConversation, getDraft, setDraft } = useChatStore();

    const {
        sideChatOpen,
        setSideChatOpen,
        sideChatPosition,
        setSideChatPosition,
        sideChatSize,
        setSideChatSize,
    } = useUIStore();

    const panelRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);

    const [showContextModal, setShowContextModal] = useState(false);
    const [selectedContextMsgs, setSelectedContextMsgs] = useState<Set<string>>(new Set());

    const isStreaming = messages.some((m) => m.isStreaming);
    const [isDragOver, setIsDragOver] = useState(false);
    const [droppedFiles, setDroppedFiles] = useState<FileAttachment[]>([]);
    const dragCounterRef = useRef(0);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // ---------- Drag Logic ----------
    const handleDragStart = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            const startX = e.clientX - sideChatPosition.x;
            const startY = e.clientY - sideChatPosition.y;

            const handleMouseMove = (e: MouseEvent) => {
                const newX = Math.max(0, Math.min(window.innerWidth - sideChatSize.width, e.clientX - startX));
                const newY = Math.max(0, Math.min(window.innerHeight - 100, e.clientY - startY));
                setSideChatPosition({ x: newX, y: newY });
            };

            const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            };

            document.body.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        },
        [sideChatPosition, sideChatSize.width, setSideChatPosition]
    );

    // ---------- Resize Logic (all 4 edges + corners) ----------
    const handleResizeStart = useCallback(
        (e: React.MouseEvent, direction: string) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startY = e.clientY;
            const startW = sideChatSize.width;
            const startH = sideChatSize.height;
            const startPosX = sideChatPosition.x;
            const startPosY = sideChatPosition.y;

            const handleMouseMove = (e: MouseEvent) => {
                let newW = startW;
                let newH = startH;
                let newX = startPosX;
                let newY = startPosY;

                if (direction.includes('e')) newW = startW + (e.clientX - startX);
                if (direction.includes('s')) newH = startH + (e.clientY - startY);
                if (direction.includes('w')) {
                    newW = startW - (e.clientX - startX);
                    newX = startPosX + (e.clientX - startX);
                }
                if (direction.includes('n')) {
                    newH = startH - (e.clientY - startY);
                    newY = startPosY + (e.clientY - startY);
                }

                setSideChatSize({ width: newW, height: newH });
                if (direction.includes('w') || direction.includes('n')) {
                    setSideChatPosition({ x: newX, y: newY });
                }
            };

            const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            };

            document.body.style.cursor =
                direction === 'e' || direction === 'w' ? 'ew-resize' :
                    direction === 'n' || direction === 's' ? 'ns-resize' :
                        direction === 'se' || direction === 'nw' ? 'nwse-resize' : 'nesw-resize';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        },
        [sideChatSize, sideChatPosition, setSideChatSize, setSideChatPosition]
    );

    // ---------- Send Message ----------
    const handleSend = async (content: string, attachments?: FileAttachment[]) => {
        const userMsg = createMessage('user', content);
        if (attachments && attachments.length > 0) {
            userMsg.attachments = attachments;
        }
        addMessage(userMsg);

        const assistantMsgId = uuidv4();
        const assistantMsg: Message = {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            reasoning: '',
            timestamp: Date.now(),
            isStreaming: true,
        };
        addMessage(assistantMsg);

        const controller = new AbortController();
        abortRef.current = controller;

        const apiMessages = getApiMessages();
        // Prepend the context block to the user message so it is always
        // visible to the model, even when streamChat uses a systemPromptOverride
        // (which would otherwise discard any injected system messages).
        const contextBlock = getContextBlock();
        const userContentWithContext = contextBlock ? `${contextBlock}${content}` : content;
        
        // Extract native sidechat attachments + any attachments imported from the main chat context
        const injectedAttachments = isContextEnabled ? injectedContext.flatMap(m => m.attachments || []) : [];
        const finalAttachments = [...(attachments || []), ...injectedAttachments];

        apiMessages.push({ 
            role: 'user', 
            content: userContentWithContext,
            attachments: finalAttachments.length > 0 ? finalAttachments : undefined
        });

        const messagesToSend: Message[] = apiMessages.map((m, i) => ({
            id: String(i),
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
            timestamp: Date.now(),
            attachments: m.attachments,
        }));

        await streamChat(
            messagesToSend,
            {
                onChunk: (chunk) => {
                    const msg = useSideChatStore.getState().messages.find((m) => m.id === assistantMsgId);
                    updateMessage(assistantMsgId, {
                        content: (msg?.content || '') + chunk,
                    });
                },
                onReasoning: (reasoning) => {
                    // Side chat intentionally does not display/store reasoning.
                    // Ignore streamed reasoning to keep UI consistent.
                    void reasoning;
                },
                onDone: () => {
                    updateMessage(assistantMsgId, { isStreaming: false });
                    abortRef.current = null;
                },
                onError: (error) => {
                    updateMessage(assistantMsgId, {
                        content: `⚠️ Error: ${error}`,
                        isStreaming: false,
                    });
                    abortRef.current = null;
                },
            },
            { systemPromptOverride: SIDE_CHAT_SYSTEM_PROMPT, signal: controller.signal, isSideChat: true }
        );
    };

    const handleStop = () => {
        abortRef.current?.abort();
    };

    // ---------- Drop Zone ----------
    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current++;
        if (e.dataTransfer.types.includes('Files')) setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) setIsDragOver(false);
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
        if (errors.length > 0) console.warn('Side chat drop warnings:', errors);
        if (attachments.length > 0) setDroppedFiles(attachments);
    }, []);

    const handleDroppedFilesConsumed = useCallback(() => {
        setDroppedFiles([]);
    }, []);

    // ---------- Context Import ----------
    const handleImportContext = () => {
        const activeConv = getActiveConversation();
        if (!activeConv || activeConv.messages.length === 0) return;
        setSelectedContextMsgs(new Set());
        setShowContextModal(true);
    };

    const toggleMsgSelection = (id: string) => {
        setSelectedContextMsgs((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAllMessages = () => {
        const activeConv = getActiveConversation();
        if (!activeConv) return;
        const allIds = new Set(activeConv.messages.filter((m) => !m.isStreaming).map((m) => m.id));
        setSelectedContextMsgs(allIds);
    };

    const deselectAllMessages = () => {
        setSelectedContextMsgs(new Set());
    };

    const confirmImportContext = () => {
        const activeConv = getActiveConversation();
        if (!activeConv) return;
        const selected = activeConv.messages.filter((m) => selectedContextMsgs.has(m.id));
        injectMainChatContext(selected);
        setShowContextModal(false);
    };

    const importAllContext = () => {
        const activeConv = getActiveConversation();
        if (!activeConv) return;
        injectMainChatContext(activeConv.messages.filter((m) => !m.isStreaming));
        setShowContextModal(false);
    };

    if (!sideChatOpen) return null;

    const allMainMsgs = getActiveConversation()?.messages.filter((m) => !m.isStreaming) || [];
    const allSelected = allMainMsgs.length > 0 && selectedContextMsgs.size === allMainMsgs.length;

    return (
        <>
            <div
                ref={panelRef}
                className="side-chat-panel"
                style={{
                    left: sideChatPosition.x,
                    top: sideChatPosition.y,
                    width: sideChatSize.width,
                    height: sideChatSize.height,
                }}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                {/* Drop zone overlay */}
                {isDragOver && (
                    <div className="drop-zone-overlay drop-zone-overlay--panel">
                        <div className="drop-zone-content">
                            <Upload size={28} />
                            <span className="drop-zone-label">Drop to attach</span>
                        </div>
                    </div>
                )}
                {/* Resize edges */}
                <div className="resize-edge resize-n" onMouseDown={(e) => handleResizeStart(e, 'n')} />
                <div className="resize-edge resize-s" onMouseDown={(e) => handleResizeStart(e, 's')} />
                <div className="resize-edge resize-e" onMouseDown={(e) => handleResizeStart(e, 'e')} />
                <div className="resize-edge resize-w" onMouseDown={(e) => handleResizeStart(e, 'w')} />
                <div className="resize-corner resize-nw" onMouseDown={(e) => handleResizeStart(e, 'nw')} />
                <div className="resize-corner resize-ne" onMouseDown={(e) => handleResizeStart(e, 'ne')} />
                <div className="resize-corner resize-sw" onMouseDown={(e) => handleResizeStart(e, 'sw')} />
                <div className="resize-corner resize-se" onMouseDown={(e) => handleResizeStart(e, 'se')} />

                {/* Header / Drag handle */}
                <div className="side-chat-header" onMouseDown={window.innerWidth > 768 ? handleDragStart : undefined}>
                    <div className="side-chat-header-left">
                        <GripHorizontal size={16} className="drag-icon" />
                        <span className="side-chat-title">Side Chat</span>
                    </div>
                    <div className="side-chat-header-actions">
                        <button
                            className={`side-chat-action-btn ${isContextEnabled ? 'context-active' : ''}`}
                            onClick={isContextEnabled ? clearContext : handleImportContext}
                            title={isContextEnabled ? 'Remove context' : 'Select context from main chat'}
                        >
                            {isContextEnabled ? <Unlink size={14} /> : <Link size={14} />}
                        </button>
                        <button
                            className="side-chat-action-btn"
                            onClick={clearMessages}
                            title="Clear side chat"
                        >
                            <Trash2 size={14} />
                        </button>
                        <button
                            className="side-chat-action-btn"
                            onClick={() => setSideChatOpen(false)}
                            title="Close"
                        >
                            <X size={14} />
                        </button>
                    </div>
                </div>

                {/* Context indicator */}
                {isContextEnabled && injectedContext.length > 0 && (
                    <div className="context-indicator">
                        <Link size={12} />
                        <span>{injectedContext.length} messages linked</span>
                        <button onClick={clearContext} className="context-toggle-btn">
                            Clear
                        </button>
                    </div>
                )}

                {/* Messages */}
                <div className="side-chat-messages" ref={messagesContainerRef}>
                    {messages.length === 0 ? (
                        <div className="side-chat-empty">
                            <Minimize2 size={24} />
                            <p>Side notepad for quick questions</p>
                            <p className="side-chat-empty-hint">
                                Use the <Link size={12} /> button to link main chat context
                            </p>
                        </div>
                    ) : (
                        <div className="sc-messages-list">
                            {(() => {
                                const elements: React.ReactNode[] = [];
                                for (let i = 0; i < messages.length; i++) {
                                    const msg = messages[i];
                                    if (msg.role === 'user') {
                                        const nextMsg = i + 1 < messages.length && messages[i + 1].role === 'assistant' ? messages[i + 1] : null;
                                        const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

                                        elements.push(
                                            <div key={msg.id} className="sc-exchange">
                                                <div className="sc-timestamp">
                                                    <span>{timeStr}</span>
                                                    <span className="sc-timestamp__you">You</span>
                                                </div>
                                                <div className="sc-user-row">
                                                    <div className="sc-user-bubble">{msg.content}</div>
                                                </div>
                                                {nextMsg && (
                                                    <>
                                                        {nextMsg.isStreaming && !nextMsg.content && !nextMsg.reasoning ? (
                                                            <div className="sc-ai-row">
                                                                <div className="sc-ai-icon"><Logo size={12} /></div>
                                                                <div className="sc-ai-content">
                                                                    <div className="sc-ai-drafting">Drafting...</div>
                                                                    <div className="msg-drafting-shimmer" style={{ width: '80%', marginBottom: 6 }} />
                                                                    <div className="msg-drafting-shimmer" style={{ width: '55%' }} />
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="sc-ai-row">
                                                                <div className="sc-ai-icon"><Logo size={12} /></div>
                                                                <div className="sc-ai-content">
                                                                    <div className="sc-ai-header">
                                                                        <span className="sc-ai-name">Lucen AI</span>
                                                                    </div>
                                                                    <div className="sc-response">
                                                                        <MessageBubble
                                                                            message={nextMsg}
                                                                            showDelete={false}
                                                                            disableReasoning
                                                                            disableArtifacts
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        );
                                        if (nextMsg) i++;
                                    } else {
                                        elements.push(
                                            <div key={msg.id} className="sc-exchange">
                                                <div className="sc-ai-row">
                                                    <div className="sc-ai-icon"><Logo size={12} /></div>
                                                    <div className="sc-ai-content">
                                                        <div className="sc-ai-header">
                                                            <span className="sc-ai-name">Lucen AI</span>
                                                        </div>
                                                        <div className="sc-response">
                                                            <MessageBubble
                                                                message={msg}
                                                                showDelete={false}
                                                                disableReasoning
                                                                disableArtifacts
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }
                                }
                                return elements;
                            })()}
                            <div ref={messagesEndRef} />
                        </div>
                    )}
                </div>

                {/* Selection menu for side chat */}
                <SelectionMenu
                    containerRef={messagesContainerRef}
                    onPrefill={(content) => {
                        const userMsg = createMessage('user', content);
                        addMessage(userMsg);
                    }}
                    isSideChat={true}
                />

                {/* Input */}
                <MessageInput
                    onSend={handleSend}
                    onStop={handleStop}
                    isStreaming={isStreaming}
                    placeholder="Quick question..."
                    droppedFiles={droppedFiles.length > 0 ? droppedFiles : undefined}
                    onDroppedFilesConsumed={handleDroppedFilesConsumed}
                    prefillValue={pendingMessage || ''}
                    onPrefillConsumed={clearPendingMessage}
                    initialValue={getDraft('side-chat')}
                    onInputChange={(val) => setDraft('side-chat', val)}
                />
            </div>

            {/* Context Import Modal - Revamped UI */}
            {showContextModal && (
                <div className="modal-overlay" onClick={() => setShowContextModal(false)}>
                    <div className="context-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="context-modal-header">
                            <div>
                                <h3>Select Context from Main Chat</h3>
                                <p className="context-modal-subtitle">
                                    Choose specific messages to help Lucen understand your Side Chat question.
                                </p>
                            </div>
                            <button className="context-modal-close" onClick={() => setShowContextModal(false)}>
                                <X size={16} />
                            </button>
                        </div>

                        {/* Bulk actions */}
                        <div className="context-modal-bulk">
                            <button className="context-bulk-btn" onClick={importAllContext}>
                                Import All ({allMainMsgs.length})
                            </button>
                            <button
                                className="context-bulk-btn context-bulk-secondary"
                                onClick={allSelected ? deselectAllMessages : selectAllMessages}
                            >
                                {allSelected ? (
                                    <><Square size={14} /> Deselect All</>
                                ) : (
                                    <><CheckSquare size={14} /> Select All</>
                                )}
                            </button>
                            {selectedContextMsgs.size > 0 && (
                                <span className="context-bulk-count">
                                    {selectedContextMsgs.size} selected
                                </span>
                            )}
                        </div>

                        <div className="context-modal-list">
                            {allMainMsgs.map((msg) => (
                                <div
                                    key={msg.id}
                                    className={`context-msg-item ${selectedContextMsgs.has(msg.id) ? 'selected' : ''}`}
                                    onClick={() => toggleMsgSelection(msg.id)}
                                >
                                    <div className="context-msg-checkbox">
                                        {selectedContextMsgs.has(msg.id) && <CheckSquare size={16} className="context-checked" />}
                                        {!selectedContextMsgs.has(msg.id) && <Square size={16} className="context-unchecked" />}
                                    </div>
                                    <div className="context-msg-content">
                                        <span className={`context-msg-role ${msg.role === 'user' ? 'role-user' : 'role-assistant'}`}>
                                            {msg.role}
                                        </span>
                                        <span className="context-msg-text">
                                            {msg.content}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="context-modal-footer">
                            <button
                                className="context-modal-cancel"
                                onClick={() => setShowContextModal(false)}
                            >
                                Cancel
                            </button>
                            <button
                                className="context-modal-confirm"
                                onClick={confirmImportContext}
                                disabled={selectedContextMsgs.size === 0}
                            >
                                Import ({selectedContextMsgs.size})
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default SideChatPanel;
