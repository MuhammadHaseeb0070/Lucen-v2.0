import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
    Plus,
    Trash2,
    MessageSquarePlus,
    Eraser,
    PanelLeftClose,
    PanelLeftOpen,
    Search,
    Settings,
    Palette,
    Keyboard,
    Info,
    ArrowRight,
    Command,
    MessageSquare,
    Sparkles,
} from 'lucide-react';
import { useChatStore } from '../store/chatStore';
import { useUIStore } from '../store/uiStore';
import { useThemeStore, THEME_PRESETS } from '../store/themeStore';
import { useSideChatStore } from '../store/sideChatStore';

// ─── Types ───
interface PaletteCommand {
    id: string;
    label: string;
    category: string;
    keywords: string[];
    icon: React.ReactNode;
    action: () => void;
    shortcut?: string;
    rightLabel?: string;
}

// ─── Recent-commands persistence ───
const RECENT_KEY = 'lucen-command-palette-recent';
const MAX_RECENT = 5;

function getRecentIds(): string[] {
    try {
        return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    } catch {
        return [];
    }
}

function pushRecentId(id: string) {
    const prev = getRecentIds().filter((r) => r !== id);
    const next = [id, ...prev].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

// ─── Component ───
interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // ─── Stores ───
    const {
        conversations,
        activeConversationId,
        createConversation,
        deleteConversation,
        setActiveConversation,
        getActiveConversation,
    } = useChatStore();

    const {
        sidebarCollapsed,
        sideChatOpen,
        toggleSidebar,
        toggleSideChat,
        setBillingOpen,
    } = useUIStore();

    const {
        setSettingsOpen,
        setSettingsTab,
        setTheme,
        activeThemeId,
        themeSource,
    } = useThemeStore();

    const { clearMessages: clearSideChatMessages } = useSideChatStore();

    // ─── Build static commands ───
    const staticCommands = useMemo<PaletteCommand[]>(() => {
        const cmds: PaletteCommand[] = [];

        // — Chat —
        cmds.push({
            id: 'new-chat',
            label: 'New Chat',
            category: 'Chat',
            keywords: ['create', 'start', 'fresh', 'conversation'],
            icon: <Plus size={16} />,
            shortcut: 'Ctrl+N',
            action: () => createConversation(),
        });

        cmds.push({
            id: 'delete-chat',
            label: 'Delete Current Chat',
            category: 'Chat',
            keywords: ['remove', 'trash', 'conversation'],
            icon: <Trash2 size={16} />,
            action: () => {
                if (activeConversationId) deleteConversation(activeConversationId);
            },
        });

        cmds.push({
            id: 'clear-context',
            label: 'Clear Context',
            category: 'Chat',
            keywords: ['reset', 'messages', 'clear', 'history', 'wipe'],
            icon: <Eraser size={16} />,
            action: () => {
                const conv = getActiveConversation();
                if (conv) {
                    // Delete all messages by deleting the conversation and creating a new one
                    deleteConversation(conv.id);
                    createConversation();
                }
            },
        });

        // — Side Chat —
        cmds.push({
            id: 'toggle-side-chat',
            label: sideChatOpen ? 'Close Side Chat' : 'Open Side Chat',
            category: 'Side Chat',
            keywords: ['panel', 'secondary', 'side', 'chat', 'toggle'],
            icon: <MessageSquarePlus size={16} />,
            action: () => toggleSideChat(),
        });

        cmds.push({
            id: 'clear-side-chat',
            label: 'Clear Side Chat',
            category: 'Side Chat',
            keywords: ['reset', 'wipe', 'side', 'messages'],
            icon: <Eraser size={16} />,
            action: () => clearSideChatMessages(),
        });

        // — Navigation —
        cmds.push({
            id: 'toggle-sidebar',
            label: sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar',
            category: 'Navigation',
            keywords: ['sidebar', 'panel', 'toggle', 'hide', 'show', 'menu'],
            icon: sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />,
            shortcut: 'Ctrl+B',
            action: () => toggleSidebar(),
        });

        cmds.push({
            id: 'search-messages',
            label: 'Search Messages',
            category: 'Navigation',
            keywords: ['find', 'search', 'filter', 'messages', 'text'],
            icon: <Search size={16} />,
            shortcut: 'Ctrl+F',
            action: () => {
                // Click the search trigger button in ChatArea
                const btn = document.querySelector('.chat-search-trigger') as HTMLButtonElement;
                if (btn) btn.click();
            },
        });

        // — Settings —
        cmds.push({
            id: 'open-plans',
            label: 'Plans & credits',
            category: 'Billing',
            keywords: ['upgrade', 'pricing', 'subscription', 'credits', 'lemon', 'pay', 'plan', 'tier', 'billing'],
            icon: <Sparkles size={16} />,
            action: () => { setBillingOpen(true); onClose(); },
        });

        cmds.push({
            id: 'open-settings',
            label: 'Open Settings',
            category: 'Settings',
            keywords: ['preferences', 'config', 'options'],
            icon: <Settings size={16} />,
            action: () => { setSettingsOpen(true); },
        });

        cmds.push({
            id: 'open-appearance',
            label: 'Appearance Settings',
            category: 'Settings',
            keywords: ['theme', 'colors', 'look', 'visual'],
            icon: <Palette size={16} />,
            action: () => { setSettingsOpen(true); setSettingsTab('appearance'); },
        });

        cmds.push({
            id: 'open-shortcuts',
            label: 'Keyboard Shortcuts',
            category: 'Settings',
            keywords: ['keys', 'hotkeys', 'bindings'],
            icon: <Keyboard size={16} />,
            action: () => { setSettingsOpen(true); setSettingsTab('shortcuts'); },
        });

        cmds.push({
            id: 'open-about',
            label: 'About Lucen',
            category: 'Settings',
            keywords: ['version', 'info', 'about'],
            icon: <Info size={16} />,
            action: () => { setSettingsOpen(true); setSettingsTab('about'); },
        });

        // — Themes —
        THEME_PRESETS.forEach((preset) => {
            cmds.push({
                id: `theme-${preset.id}`,
                label: `Switch to ${preset.name}`,
                category: 'Themes',
                keywords: ['theme', preset.category, preset.isDark ? 'dark' : 'light', 'color', 'switch'],
                icon: <span className="command-palette-emoji">{preset.emoji}</span>,
                rightLabel:
                    themeSource === 'preset' && activeThemeId === preset.id ? '✓ Active' : undefined,
                action: () => {
                    setTheme(preset.id);
                },
            });
        });

        return cmds;
    }, [
        activeConversationId, sideChatOpen, sidebarCollapsed, activeThemeId, themeSource,
        createConversation, deleteConversation, getActiveConversation,
        toggleSideChat, clearSideChatMessages, toggleSidebar,
        setBillingOpen, onClose,
        setSettingsOpen, setSettingsTab, setTheme,
    ]);

    // ─── Conversation jump-to results ───
    const conversationResults = useMemo<PaletteCommand[]>(() => {
        if (!query.trim()) return [];
        const q = query.toLowerCase();
        return conversations
            .filter((c) => c.title.toLowerCase().includes(q) && c.id !== activeConversationId)
            .slice(0, 6)
            .map((c) => ({
                id: `jump-${c.id}`,
                label: c.title,
                category: 'Jump to Chat',
                keywords: [],
                icon: <MessageSquare size={16} />,
                rightLabel: new Date(c.updatedAt).toLocaleDateString(),
                action: () => setActiveConversation(c.id),
            }));
    }, [query, conversations, activeConversationId, setActiveConversation]);

    // ─── Filter and rank ───
    const filtered = useMemo(() => {
        if (!query.trim()) {
            // Show recent commands first, then all commands
            const recentIds = getRecentIds();
            const recent = recentIds
                .map((id) => staticCommands.find((c) => c.id === id))
                .filter(Boolean) as PaletteCommand[];

            const rest = staticCommands.filter((c) => !recentIds.includes(c.id));
            return [...recent, ...rest];
        }

        const q = query.toLowerCase();
        const matches = staticCommands.filter((cmd) => {
            const searchStr = [cmd.label, ...cmd.keywords, cmd.category].join(' ').toLowerCase();
            return searchStr.includes(q);
        });

        return [...matches, ...conversationResults];
    }, [query, staticCommands, conversationResults]);

    // ─── Reset on open ───
    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedIndex(0);
            // Focus input on next frame
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [isOpen]);

    // ─── Keep selected index in bounds ───
    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    // ─── Scroll selected item into view ───
    useEffect(() => {
        if (!listRef.current) return;
        const items = listRef.current.querySelectorAll('.command-palette-item');
        const item = items[selectedIndex] as HTMLElement;
        if (item) item.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    // ─── Execute a command ───
    const executeCommand = useCallback((cmd: PaletteCommand) => {
        pushRecentId(cmd.id);
        cmd.action();
        onClose();
    }, [onClose]);

    // ─── Keyboard handler ───
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex((i) => Math.max(i - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (filtered[selectedIndex]) executeCommand(filtered[selectedIndex]);
                break;
            case 'Escape':
                e.preventDefault();
                onClose();
                break;
        }
    }, [filtered, selectedIndex, executeCommand, onClose]);

    if (!isOpen) return null;

    // ─── Group filtered commands by category ───
    const grouped: { category: string; items: PaletteCommand[] }[] = [];
    const seen = new Set<string>();
    for (const cmd of filtered) {
        if (!seen.has(cmd.category)) {
            seen.add(cmd.category);
            grouped.push({ category: cmd.category, items: [] });
        }
        grouped.find((g) => g.category === cmd.category)!.items.push(cmd);
    }

    // Calculate flat index for selection highlighting
    let flatIndex = 0;

    return (
        <div className="command-palette-overlay" onClick={onClose}>
            <div className="command-palette-modal" onClick={(e) => e.stopPropagation()}>
                {/* Search input */}
                <div className="command-palette-header">
                    <Command size={16} className="command-palette-search-icon" />
                    <input
                        ref={inputRef}
                        type="text"
                        className="command-palette-input"
                        placeholder="Type a command or search..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <kbd className="command-palette-esc">ESC</kbd>
                </div>

                {/* Results */}
                <div className="command-palette-list" ref={listRef}>
                    {filtered.length === 0 ? (
                        <div className="command-palette-empty">
                            <Search size={20} />
                            <span>No commands found</span>
                        </div>
                    ) : (
                        grouped.map((group) => (
                            <div key={group.category} className="command-palette-group">
                                <div className="command-palette-category">{group.category}</div>
                                {group.items.map((cmd) => {
                                    const idx = flatIndex++;
                                    return (
                                        <button
                                            key={cmd.id}
                                            className={`command-palette-item ${idx === selectedIndex ? 'command-palette-item--selected' : ''}`}
                                            onClick={() => executeCommand(cmd)}
                                            onMouseEnter={() => setSelectedIndex(idx)}
                                        >
                                            <span className="command-palette-item-icon">{cmd.icon}</span>
                                            <span className="command-palette-item-label">{cmd.label}</span>
                                            {cmd.rightLabel && (
                                                <span className="command-palette-item-right">{cmd.rightLabel}</span>
                                            )}
                                            {cmd.shortcut && (
                                                <kbd className="command-palette-item-shortcut">{cmd.shortcut}</kbd>
                                            )}
                                            <ArrowRight size={12} className="command-palette-item-arrow" />
                                        </button>
                                    );
                                })}
                            </div>
                        ))
                    )}
                </div>

                {/* Footer hint */}
                <div className="command-palette-footer">
                    <span><kbd>↑↓</kbd> navigate</span>
                    <span><kbd>↵</kbd> select</span>
                    <span><kbd>esc</kbd> close</span>
                </div>
            </div>
        </div>
    );
};

export default CommandPalette;
