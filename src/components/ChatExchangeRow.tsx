import React from 'react';
import MessageBubble from './MessageBubble';
import Logo from './Logo';
import FileIcon, { getFileKindLabel } from './FileIcon';
import { highlightText } from '../lib/searchHighlight';
import type { Message } from '../types';

export type ExchangeRow =
    | { kind: 'pair'; user: Message; assistant: Message | null }
    | { kind: 'solo-assistant'; msg: Message };

export function buildExchangeRows(messages: Message[]): ExchangeRow[] {
    const rows: ExchangeRow[] = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (msg.role === 'user') {
            const assistant =
                i + 1 < messages.length && messages[i + 1].role === 'assistant'
                    ? messages[i + 1]
                    : null;
            rows.push({ kind: 'pair', user: msg, assistant });
            if (assistant) i++;
        } else {
            rows.push({ kind: 'solo-assistant', msg });
        }
    }
    return rows;
}

export function buildMsgIdToRowIndex(rows: ExchangeRow[]): Map<string, number> {
    const m = new Map<string, number>();
    rows.forEach((row, idx) => {
        if (row.kind === 'pair') {
            m.set(row.user.id, idx);
            if (row.assistant) m.set(row.assistant.id, idx);
        } else {
            m.set(row.msg.id, idx);
        }
    });
    return m;
}

export type ChatExchangeRowProps = {
    row: ExchangeRow;
    searchQuery: string;
    matchingIds: Set<string>;
    activeMatchMsgId: string | null;
    highlightedPairId: string | null;
    lastAssistantMsgId: string | null;
    injectedContext: Message[];
    setViewerFile: (file: Record<string, unknown>) => void;
    setViewerOpen: (open: boolean) => void;
    handleRetry: (assistantMsgId: string) => void;
    handleContinue: (assistantMsgId: string) => void;
    handleFork: (msgId: string) => void;
    handleToggleLink: (message: Message) => void;
    handlePin: (msgId: string) => void;
    handleDelete: (msgId: string) => void;
    setHighlightedPairId: (id: string | null) => void;
};

const ChatExchangeRow: React.FC<ChatExchangeRowProps> = ({
    row,
    searchQuery,
    matchingIds,
    activeMatchMsgId,
    highlightedPairId,
    lastAssistantMsgId,
    injectedContext,
    setViewerFile,
    setViewerOpen,
    handleRetry,
    handleContinue,
    handleFork,
    handleToggleLink,
    handlePin,
    handleDelete,
    setHighlightedPairId,
}) => {
    const q = searchQuery.trim();

    if (row.kind === 'pair') {
        const msg = row.user;
        const nextMsg = row.assistant;
        const pairHighlighted = highlightedPairId === msg.id;
        const isDimmed = searchQuery && !matchingIds.has(msg.id) && !(nextMsg && matchingIds.has(nextMsg.id));
        const isActiveMatch = activeMatchMsgId === msg.id || activeMatchMsgId === nextMsg?.id;
        const hasReasoning = !!(nextMsg?.reasoning || nextMsg?.isReasoningStreaming);
        const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

        return (
            <div
                className={`msg-exchange ${pairHighlighted ? 'msg-exchange--danger' : ''} ${isActiveMatch ? 'msg-exchange--active-match' : ''} ${isDimmed ? 'msg-exchange--dimmed' : ''} ${msg.isPinned || nextMsg?.isPinned ? 'msg-exchange--pinned' : ''}`}
            >
                <div className="msg-timestamp">
                    <span>{timeStr}</span>
                    <span className="msg-timestamp__you">You</span>
                </div>
                <div className="msg-user-row" data-msg-id={msg.id}>
                    <div className="msg-user-bubble">
                        {q ? highlightText(msg.content, q) : msg.content}
                        {msg.attachments && msg.attachments.length > 0 ? (
                            <div className="msg-attachments">
                                {msg.attachments.map((att) =>
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
                                                    url: att.dataUrl,
                                                });
                                                setViewerOpen(true);
                                            }}
                                        />
                                    ) : (
                                        <button
                                            key={att.id}
                                            type="button"
                                            className="msg-attachment-file clickable"
                                            onClick={() => {
                                                setViewerFile({
                                                    id: att.id,
                                                    name: att.name,
                                                    type: att.type,
                                                    textContent: att.textContent,
                                                    aiDescription: att.aiDescription,
                                                });
                                                setViewerOpen(true);
                                            }}
                                            title={att.name}
                                        >
                                            <FileIcon name={att.name} type={att.type} size={24} badge />
                                            <span className="msg-attachment-file-meta">
                                                <span className="msg-attachment-file-name">{att.name}</span>
                                                <span className="msg-attachment-file-sub">{getFileKindLabel(att.name, att.type)}</span>
                                            </span>
                                        </button>
                                    ),
                                )}
                            </div>
                        ) : null}
                    </div>
                    <MessageBubble message={msg} showDelete={false} actionsOnly />
                </div>
                {nextMsg ? (
                    <div className="msg-ai-row" data-msg-id={nextMsg.id}>
                        <div className="msg-ai-icon">
                            <Logo size={16} />
                        </div>
                        <div className="msg-ai-content">
                            <div className="msg-ai-header">
                                <span className="msg-ai-name">Lucen AI</span>
                                {hasReasoning ? <span className="msg-reasoning-badge">Reasoning</span> : null}
                            </div>
                            <MessageBubble
                                message={nextMsg}
                                onRetry={handleRetry}
                                onContinue={handleContinue}
                                onFork={handleFork}
                                onToggleLink={handleToggleLink}
                                onPin={handlePin}
                                isLinked={injectedContext.some((m) => m.id === nextMsg.id)}
                                showRetry={nextMsg.id === lastAssistantMsgId}
                                searchQuery={q || undefined}
                                showDelete
                                onDelete={() => handleDelete(msg.id)}
                                onDeleteHover={(h) => setHighlightedPairId(h ? msg.id : null)}
                            />
                        </div>
                    </div>
                ) : null}
            </div>
        );
    }

    const msg = row.msg;
    const isDimmed = searchQuery && !matchingIds.has(msg.id);
    const isActiveMatch = activeMatchMsgId === msg.id;
    return (
        <div className={`msg-exchange ${isActiveMatch ? 'msg-exchange--active-match' : ''} ${isDimmed ? 'msg-exchange--dimmed' : ''}`}>
            <div className="msg-ai-row" data-msg-id={msg.id}>
                <div className="msg-ai-icon">
                    <Logo size={16} />
                </div>
                <div className="msg-ai-content">
                    <div className="msg-ai-header">
                        <span className="msg-ai-name">Lucen AI</span>
                    </div>
                    <MessageBubble
                        message={msg}
                        onRetry={handleRetry}
                        onContinue={handleContinue}
                        onFork={handleFork}
                        onToggleLink={handleToggleLink}
                        onPin={handlePin}
                        isLinked={injectedContext.some((m) => m.id === msg.id)}
                        showRetry={msg.id === lastAssistantMsgId}
                        searchQuery={q || undefined}
                        showDelete={false}
                    />
                </div>
            </div>
        </div>
    );
};

export default ChatExchangeRow;
