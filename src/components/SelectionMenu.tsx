import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
    Copy,
    MessageSquarePlus,
    FileText,
    HelpCircle,
    ChevronRight,
} from 'lucide-react';
import { useSideChatStore } from '../store/sideChatStore';
import { useUIStore } from '../store/uiStore';

interface SelectionMenuProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    onPrefill: (content: string) => void;
}

interface MenuPosition {
    x: number;
    y: number;
}

interface SelectionState {
    text: string;
    position: MenuPosition;
}

interface QuickAction {
    id: string;
    label: string;
    icon: React.FC<any>;
    formatPrompt?: (text: string) => string;
    isCopy?: boolean;
}

const QUICK_ACTIONS: QuickAction[] = [
    {
        id: 'paste',
        label: 'Paste to Input',
        icon: MessageSquarePlus,
        formatPrompt: (text) => text,
    },
    {
        id: 'summarize',
        label: 'Summarize',
        icon: FileText,
        formatPrompt: (text) => `Please summarize the following text: \n\n"""\n${text}\n"""`,
    },
    {
        id: 'explain',
        label: 'Explain',
        icon: HelpCircle,
        formatPrompt: (text) => `Please explain the following text in detail: \n\n"""\n${text}\n"""`,
    },
    {
        id: 'copy',
        label: 'Copy',
        icon: Copy,
        isCopy: true,
    },
];

const SelectionMenu: React.FC<SelectionMenuProps> = ({ containerRef, onPrefill }) => {
    const [selection, setSelection] = useState<SelectionState | null>(null);
    const [copied, setCopied] = useState(false);
    const setSideChatPendingMessage = useSideChatStore((state) => state.setPendingMessage);
    const setSideChatOpen = useUIStore((state) => state.setSideChatOpen);
    const menuRef = useRef<HTMLDivElement>(null);

    const hideMenu = useCallback(() => {
        setSelection(null);
        setCopied(false);
    }, []);

    // Listen for text selection inside the container
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleMouseUp = () => {
            // Small delay so the selection finalises
            requestAnimationFrame(() => {
                const sel = window.getSelection();
                const text = sel?.toString().trim();

                if (!text || text.length < 3) {
                    // Don't hide immediately — user might be clicking the menu
                    return;
                }

                // Get the bounding rect of the selection
                const range = sel?.getRangeAt(0);
                if (!range) return;
                const rect = range.getBoundingClientRect();

                // Position the menu above the selection, centered
                const menuWidth = 380; // Approximate width of the menu
                let x = rect.left + rect.width / 2 - menuWidth / 2;
                const y = rect.top - 52; // Position above selection

                // Clamp to viewport
                x = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, x));
                const clampedY = Math.max(8, y);

                setSelection({ text, position: { x, y: clampedY } });
            });
        };

        const handleMouseDown = (e: MouseEvent) => {
            // If clicking outside the menu, hide it
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                hideMenu();
            }
        };

        container.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('mousedown', handleMouseDown);
        return () => {
            container.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('mousedown', handleMouseDown);
        };
    }, [containerRef, hideMenu]);

    // Hide on scroll
    useEffect(() => {
        const container = containerRef.current;
        if (!container || !selection) return;
        const handleScroll = () => hideMenu();
        container.addEventListener('scroll', handleScroll, true);
        return () => container.removeEventListener('scroll', handleScroll, true);
    }, [containerRef, selection, hideMenu]);

    // Handle action click
    const handleAction = useCallback(
        (action: QuickAction, e: React.MouseEvent) => {
            if (!selection) return;

            if (action.isCopy) {
                // Just copy to clipboard and close
                navigator.clipboard.writeText(selection.text);
                setCopied(true);
                setTimeout(() => {
                    setCopied(false);
                    setSelection(null);
                    window.getSelection()?.removeAllRanges();
                }, 1500);
                return;
            }

            const prompt = action.formatPrompt ? action.formatPrompt(selection.text) : selection.text;

            if (e.shiftKey) {
                // Send to Side Chat
                setSideChatPendingMessage(prompt);
                setSideChatOpen(true);
            } else {
                // Prefill Main Chat
                onPrefill(prompt);
            }

            setSelection(null);
            window.getSelection()?.removeAllRanges();
        },
        [selection, onPrefill, setSideChatPendingMessage, setSideChatOpen]
    );

    if (!selection) return null;

    return (
        <div
            ref={menuRef}
            className="selection-menu"
            style={{ left: selection.position.x, top: selection.position.y }}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div className="selection-menu-content">
                <div className="selection-menu-actions">
                    {QUICK_ACTIONS.map((action) => (
                        <button
                            key={action.id}
                            className={`selection-action-btn ${action.isCopy && copied ? 'copied' : ''}`}
                            onClick={(e) => handleAction(action, e)}
                            title={action.isCopy ? 'Copy to clipboard' : `Shift + Click to paste into Side Chat`}
                        >
                            <action.icon size={14} />
                            <span>{action.isCopy && copied ? 'Copied!' : action.label}</span>
                        </button>
                    ))}
                </div>
            </div>
            {/* Visual Hint */}
            <div className="selection-menu-hint" style={{
                fontSize: '11px',
                color: 'var(--text-tertiary)',
                textAlign: 'center',
                marginTop: '6px',
                backgroundColor: 'var(--surface-color)',
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}>
                <span style={{ opacity: 0.8 }}>💡 <b>Shift + Click</b> to paste into Side Chat</span>
            </div>
        </div>
    );
};

export default SelectionMenu;
