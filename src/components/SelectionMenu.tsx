import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
    Copy,
    MessageSquarePlus,
    FileText,
    HelpCircle,
    MessageSquare,
    PanelRight,
} from 'lucide-react';
import { useSideChatStore } from '../store/sideChatStore';
import { useUIStore } from '../store/uiStore';
import { useComposerStore } from '../store/composerStore';

interface SelectionMenuProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    onPrefill: (content: string) => void;
    isSideChat?: boolean;
}

interface MenuPosition {
    x: number;
    y: number;
    placement: 'top' | 'bottom';
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

const SelectionMenu: React.FC<SelectionMenuProps> = ({ containerRef, onPrefill, isSideChat = false }) => {
    const [selection, setSelection] = useState<SelectionState | null>(null);
    const [copied, setCopied] = useState(false);
    const [isVertical, setIsVertical] = useState(false);
    
    const setSideChatPendingMessage = useSideChatStore((state) => state.setPendingMessage);
    const setSideChatOpen = useUIStore((state) => state.setSideChatOpen);
    const setPendingMainComposerPrefill = useComposerStore((s) => s.setPendingMainComposerPrefill);
    
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

                if (!text || text.length < 3) return;

                const range = sel?.getRangeAt(0);
                if (!range) return;
                const rect = range.getBoundingClientRect();

                // Vertical threshold: Switch to vertical if container is narrow or viewport is small
                const containerWidth = container.getBoundingClientRect().width;
                const useVertical = isSideChat || containerWidth < 450 || window.innerWidth < 650;
                setIsVertical(useVertical);

                // Dimensions (estimates for initial placement, CSS will finalize)
                const menuWidth = useVertical ? 200 : 380;
                const menuHeight = useVertical ? 180 : 85; 
                const offset = 12;

                // Y calculation (Prefer Top)
                // We use a safe threshold (e.g. 100px) to ensure the menu isn't cut off by the header
                let y = rect.top - menuHeight - offset;
                let placement: 'top' | 'bottom' = 'top';
                
                // If the top position would be above the viewport (with a margin for navbar)
                if (y < 60) {
                    y = rect.bottom + offset;
                    placement = 'bottom';
                }

                // X calculation (Center on selection, then clamp)
                let x = rect.left + rect.width / 2 - menuWidth / 2;
                const xMargin = 16;
                x = Math.max(xMargin, Math.min(window.innerWidth - menuWidth - xMargin, x));

                setSelection({ text, position: { x, y, placement } });
            });
        };

        const handleMouseDown = (e: MouseEvent) => {
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
    }, [containerRef, hideMenu, isSideChat]);

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
            const isShift = e.shiftKey;

            // Logique Inversion:
            // If Side Chat: Normal Click -> Side Chat (onPrefill), Shift+Click -> Main Chat (setPendingMainComposerPrefill)
            // If Main Chat: Normal Click -> Main Chat (onPrefill), Shift+Click -> Side Chat (setSideChatPendingMessage)
            
            if (isSideChat) {
                if (isShift) {
                    setPendingMainComposerPrefill(prompt);
                } else {
                    onPrefill(prompt);
                }
            } else {
                if (isShift) {
                    setSideChatPendingMessage(prompt);
                    setSideChatOpen(true);
                } else {
                    onPrefill(prompt);
                }
            }

            setSelection(null);
            window.getSelection()?.removeAllRanges();
        },
        [selection, onPrefill, isSideChat, setSideChatPendingMessage, setSideChatOpen, setPendingMainComposerPrefill]
    );

    if (!selection) return null;

    const hintText = isSideChat 
        ? "Shift + Click for Main Chat"
        : "Shift + Click for Side Chat";

    // Mobile check to adjust tooltip and show destination icons
    const isMobile = window.innerWidth < 768;

    return (
        <div
            ref={menuRef}
            className={`selection-menu ${isVertical ? 'selection-menu--vertical' : ''}`}
            style={{ 
                left: selection.position.x, 
                top: selection.position.y,
            }}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div className="selection-menu-content">
                <div className="selection-menu-actions">
                    {QUICK_ACTIONS.map((action) => (
                        <button
                            key={action.id}
                            className={`selection-action-btn ${action.isCopy && copied ? 'copied' : ''}`}
                            onClick={(e) => handleAction(action, e)}
                            title={action.isCopy ? 'Copy to clipboard' : hintText}
                        >
                            <div className="flex items-center gap-2">
                                {action.isCopy && copied ? null : <action.icon size={14} />}
                                <span>{action.isCopy && copied ? 'Copied!' : action.label}</span>
                            </div>

                            {/* Mobile/Vertical Destination Indicator */}
                            {(isVertical || isMobile) && !action.isCopy && (
                                <div className="selection-action-indicator" title={hintText}>
                                    {isSideChat ? <MessageSquare size={12} /> : <PanelRight size={12} />}
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            </div>
            
            {/* Visual Hint - Only on Desktop horizontal mode */}
            {!isVertical && !isMobile && (
                <div className="selection-menu-hint">
                    <span>💡 {hintText}</span>
                </div>
            )}
        </div>
    );
};

export default SelectionMenu;
