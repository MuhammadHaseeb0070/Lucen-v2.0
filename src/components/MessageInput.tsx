import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Send, Square, RotateCcw, Paperclip, X, FileText, Image as ImageIcon, Quote, Globe } from 'lucide-react';
import { processFiles, formatFileSize } from '../services/fileProcessor';
import type { FileAttachment } from '../types';


interface MessageInputProps {
    onSend: (message: string, attachments?: FileAttachment[]) => void;
    onStop?: () => void;
    onHaltAndEdit?: () => void;
    isStreaming?: boolean;
    disabled?: boolean;
    placeholder?: string;
    maxLength?: number;
    prefillValue?: string;
    /** Attachments injected from parent (e.g. via drop zone) */
    droppedFiles?: FileAttachment[];
    onDroppedFilesConsumed?: () => void;
    /** Called when the prefillValue is successfully loaded into the input */
    onPrefillConsumed?: () => void;
    /** Initial drafted value upon mounting */
    initialValue?: string;
    /** Fired when input changes to allow parent to persist the draft */
    onInputChange?: (value: string) => void;
    /** If true, request web search augmentation (online mode) */
    webSearchEnabled?: boolean;
    /** Toggle web search on/off */
    onToggleWebSearch?: (enabled: boolean) => void;
}

const MessageInput: React.FC<MessageInputProps> = ({
    onSend,
    onStop,
    onHaltAndEdit,
    isStreaming = false,
    disabled = false,
    placeholder = 'Message Lucen...',
    maxLength,
    prefillValue,
    droppedFiles,
    onDroppedFilesConsumed,
    onPrefillConsumed,
    initialValue = '',
    onInputChange,
    webSearchEnabled = false,
    onToggleWebSearch,
}) => {
    const [input, setInput] = useState(initialValue);
    const [quoteText, setQuoteText] = useState<string | null>(null);
    const [attachments, setAttachments] = useState<FileAttachment[]>([]);
    const [processingFiles, setProcessingFiles] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const getPlaceholder = () => {
        if (placeholder !== 'Message Lucen...') return placeholder; // respect overrides
        return 'Message Lucen...';
    };

    // Prefill input when ChatArea injects a value (Halt & Edit) or SideChat gets a selection
    useEffect(() => {
        if (prefillValue !== undefined && prefillValue !== '') {
            // Check if prefillValue is a perfectly formatted Selection quick action quote:
            // "Please explain... :\n\n\"\"\"\n${text}\n\"\"\""
            const quoteMatch = prefillValue.match(/^(.*?)(:\s*\n\n"""\n)([\s\S]*?)(\n""")$/);

            if (quoteMatch) {
                const instruction = quoteMatch[1] + ":";
                const text = quoteMatch[3];
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setInput(instruction);
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setQuoteText(text);
                if (onInputChange) onInputChange(instruction);
            } else {
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setInput(prefillValue);
                // eslint-disable-next-line react-hooks/set-state-in-effect
                setQuoteText(null);
                if (onInputChange) onInputChange(prefillValue);
            }

            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.focus();
                    textareaRef.current.selectionStart = textareaRef.current.value.length;
                    textareaRef.current.selectionEnd = textareaRef.current.value.length;
                }
                if (onPrefillConsumed) onPrefillConsumed();
            });
        }
    }, [prefillValue]); // Removed onPrefillConsumed and onInputChange to prevent infinite re-renders

    // Accept files dropped from parent (drop zone)
    useEffect(() => {
        if (droppedFiles && droppedFiles.length > 0) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setAttachments((prev) => [...prev, ...droppedFiles]);
            onDroppedFilesConsumed?.();
            // Focus input after drop
            requestAnimationFrame(() => textareaRef.current?.focus());
        }
    }, [droppedFiles, onDroppedFilesConsumed]);

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
        }
    }, [input]);

    const handleSend = useCallback(() => {
        let finalInput = input.trim();

        if (quoteText) {
            finalInput = `${finalInput}\n\n"""\n${quoteText}\n"""`;
        }

        if ((!finalInput && attachments.length === 0) || disabled) return;

        onSend(finalInput, attachments.length > 0 ? attachments : undefined);

        setInput('');
        onInputChange?.('');
        setQuoteText(null);
        setAttachments([]);

        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
    }, [input, quoteText, attachments, disabled, onSend, onInputChange]);



    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (isStreaming) return;
            handleSend();
        }
    };

    // ─── File picking ───
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        setProcessingFiles(true);
        try {
            const { attachments: newAttachments, errors } = await processFiles(files);
            if (errors.length > 0) console.warn('File processing warnings:', errors);
            setAttachments((prev) => [...prev, ...newAttachments]);
        } catch (err) {
            console.error('Failed to process files:', err);
        }
        setProcessingFiles(false);
        // Reset file input so the same file can be selected again
        if (fileInputRef.current) fileInputRef.current.value = '';
        textareaRef.current?.focus();
    };

    const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        if (disabled || processingFiles) return;

        const items = Array.from(e.clipboardData?.items || []);
        if (items.length === 0) return;

        const imageFiles: File[] = items
            .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
            .map((item) => item.getAsFile())
            .filter((file): file is File => Boolean(file));

        if (imageFiles.length === 0) return; // Keep default text paste behavior

        // Prevent dumping binary clipboard data into the textarea when image paste is intended.
        e.preventDefault();
        setProcessingFiles(true);
        try {
            const normalizedFiles = imageFiles.map((file, index) => {
                if (file.name && file.name.trim() && file.name !== 'image.png') return file;
                const ext = (file.type.split('/')[1] || 'png').toLowerCase();
                return new File([file], `pasted-image-${Date.now()}-${index + 1}.${ext}`, { type: file.type || 'image/png' });
            });
            const { attachments: newAttachments, errors } = await processFiles(normalizedFiles);
            if (errors.length > 0) console.warn('Clipboard image processing warnings:', errors);
            setAttachments((prev) => [...prev, ...newAttachments]);
        } catch (err) {
            console.error('Failed to process pasted image(s):', err);
        } finally {
            setProcessingFiles(false);
        }
    };

    const removeAttachment = (id: string) => {
        setAttachments((prev) => prev.filter((a) => a.id !== id));
    };

    const hasContent = input.trim().length > 0 || attachments.length > 0 || quoteText !== null;

    return (
        <div className="message-input-container">
            {/* Halt & Edit bar — only visible while streaming */}
            {isStreaming && (
                <div className="halt-edit-bar">
                    <button className="halt-edit-btn" onClick={onHaltAndEdit} title="Stop generation, remove the response, and re-edit your prompt (Esc)">
                        <RotateCcw size={15} />
                        <span>Halt & Edit</span>
                        <kbd className="halt-edit-kbd">Esc</kbd>
                    </button>
                    <button className="halt-stop-btn" onClick={onStop} title="Stop generating but keep the partial response">
                        <Square size={13} />
                        <span>Stop</span>
                    </button>
                </div>
            )}

            <div className="message-input-wrapper">
                {/* Attachment preview strip */}
                {attachments.length > 0 && (
                    <div className="attachment-strip">
                        {attachments.map((att) => (
                            <div key={att.id} className={`attachment-chip attachment-chip--${att.type}`}>
                                {att.type === 'image' && att.dataUrl ? (
                                    <img src={att.dataUrl} alt={att.name} className="attachment-chip-thumb" />
                                ) : (
                                    <span className="attachment-chip-icon">
                                        {att.type === 'image' ? <ImageIcon size={14} /> : <FileText size={14} />}
                                    </span>
                                )}
                                <span className="attachment-chip-name">{att.name}</span>
                                <span className="attachment-chip-size">{formatFileSize(att.size)}</span>
                                <button
                                    className="attachment-chip-remove"
                                    onClick={() => removeAttachment(att.id)}
                                    title="Remove"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Quote Block */}
                {quoteText && (
                    <div className="quote-block-wrapper">
                        <div className="quote-block-header">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Quote size={12} color="var(--accent)" />
                                <span className="quote-block-title">Quote Attachment</span>
                            </div>
                            <button className="quote-block-close" onClick={() => setQuoteText(null)} title="Remove quote block">
                                <X size={14} />
                            </button>
                        </div>
                        <div className="quote-block-text">{quoteText}</div>
                    </div>
                )}

                <div className="input-row">
                    {/* Paperclip / attach button */}
                    <button
                        className="attach-btn"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={disabled || processingFiles}
                        title="Attach files or images"
                    >
                        <Paperclip size={17} />
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/*,.pdf,.csv,.txt,.md,.json,.xml,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.h,.hpp,.cs,.go,.rs,.rb,.php,.sql,.sh,.bash,.bat,.ps1,.yaml,.yml,.toml,.ini,.cfg,.env,.conf,.css,.scss,.less,.sass,.html,.htm,.vue,.svelte,.log,.tsv,.jsonl,.ndjson,.r,.m,.swift,.kt,.kts,.dart,.lua,.pl,.pm,.ex,.exs,.erl,.hs,.ml,.clj,.scala,.groovy,.tf,.dockerfile,.makefile,.cmake,.graphql,.gql,.proto,.docx,.doc,.xlsx,.xls,.pptx,.ppt"
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                    />

                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => {
                            const rawValue = e.target.value;
                            const val = typeof maxLength === 'number' ? rawValue.slice(0, maxLength) : rawValue;
                            setInput(val);
                            onInputChange?.(val);
                        }}
                        onPaste={handlePaste}
                        onKeyDown={handleKeyDown}
                        placeholder={processingFiles ? 'Processing files...' : getPlaceholder()}
                        disabled={disabled || processingFiles}
                        rows={1}
                        className="message-textarea"
                    />
                    <div className="input-actions">
                        <div className="input-metrics">
                            {input.length > 0 && (
                                <span className="char-count" title="Characters">
                                    {typeof maxLength === 'number' ? `${input.length}/${maxLength}` : input.length}
                                </span>
                            )}
                        </div>
                        {onToggleWebSearch && (
                            <div className="websearch-toggle-wrap">
                                <button
                                    type="button"
                                    className={`websearch-toggle ${webSearchEnabled ? 'websearch-toggle--on' : ''}`}
                                    onClick={() => onToggleWebSearch(!webSearchEnabled)}
                                    disabled={disabled || processingFiles || isStreaming}
                                    aria-pressed={webSearchEnabled}
                                    title={webSearchEnabled ? 'Web search enabled (costs more credits)' : 'Enable web search (costs more credits)'}
                                >
                                    <Globe size={14} />
                                    <span>Web</span>
                                </button>
                                {webSearchEnabled && (
                                    <span className="websearch-cost-hint" title="Web search costs more credits">
                                        Costs more credits
                                    </span>
                                )}
                            </div>
                        )}
                        {isStreaming ? (
                            <button className="stop-btn" onClick={onStop} title="Stop generating">
                                <Square size={16} />
                            </button>
                        ) : (
                            <button
                                className="send-btn"
                                onClick={handleSend}
                                disabled={!hasContent || disabled}
                                title="Send message"
                            >
                                <Send size={16} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

        </div>
    );
};

export default MessageInput;
