import React, { useState } from 'react';
import { Trash2, ChevronDown, ChevronRight, Copy, Check, RotateCcw, ChevronLast } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import type { Message } from '../types';

interface MessageBubbleProps {
    message: Message;
    onDelete?: (msgId: string) => void;
    onRetry?: (msgId: string) => void;
    onContinue?: (msgId: string) => void;
    onDeleteHover?: (hovering: boolean) => void;
    showDelete?: boolean;
    showRetry?: boolean;
    /** When true, only render the action buttons — the message text is rendered by the parent */
    actionsOnly?: boolean;
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
}) => {
    const [reasoningOpen, setReasoningOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(message.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // For user messages inside the card header — only show action icons inline
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

    // Full assistant message rendering
    return (
        <div className="msg-response">
            {/* Reasoning */}
            {message.reasoning && (
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
                            <MarkdownRenderer content={message.reasoning} />
                        </div>
                    )}
                </div>
            )}

            {/* Content */}
            {message.isStreaming && !message.content && !message.reasoning ? (
                <div className="streaming-indicator">
                    <span className="dot" /><span className="dot" /><span className="dot" />
                </div>
            ) : (
                <MarkdownRenderer content={message.content} />
            )}

            {/* Truncation notice + Continue button */}
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

            {/* Action buttons */}
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
                </div>
            )}
        </div>
    );
});

MessageBubble.displayName = 'MessageBubble';

export default MessageBubble;
