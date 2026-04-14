import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TemplateMode } from '../types';

interface UIStore {
    sidebarCollapsed: boolean;
    sideChatOpen: boolean;
    sidebarWidth: number;
    sideChatPosition: { x: number; y: number };
    sideChatSize: { width: number; height: number };
    templateMode: TemplateMode;
    isAdminView: boolean;
    billingOpen: boolean;
    fileLibraryOpen: boolean;
    viewerOpen: boolean;
    viewerFile: { 
        id: string; 
        name: string; 
        type: string; 
        url?: string; 
        textContent?: string;
        aiDescription?: string;
    } | null;
    pendingMessageJumpId: string | null;

    toggleSidebar: () => void;
    setSidebarCollapsed: (collapsed: boolean) => void;
    setSidebarWidth: (width: number) => void;
    toggleSideChat: () => void;
    setSideChatOpen: (open: boolean) => void;
    setSideChatPosition: (pos: { x: number; y: number }) => void;
    setSideChatSize: (size: { width: number; height: number }) => void;
    setTemplateMode: (mode: TemplateMode) => void;
    setIsAdminView: (isAdmin: boolean) => void;
    setBillingOpen: (open: boolean) => void;
    setFileLibraryOpen: (open: boolean) => void;
    setViewerOpen: (open: boolean) => void;
    setViewerFile: (file: any) => void;
    setPendingMessageJumpId: (id: string | null) => void;
}

export const useUIStore = create<UIStore>()(
    persist(
        (set) => ({
            sidebarCollapsed: false,
            sideChatOpen: false,
            sidebarWidth: 280,
            sideChatPosition: { x: 100, y: 100 },
            sideChatSize: { width: 400, height: 500 },
            templateMode: 'General',
            isAdminView: false,
            billingOpen: false,
            fileLibraryOpen: false,
            viewerOpen: false,
            viewerFile: null,
            pendingMessageJumpId: null,

            toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
            setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
            setSidebarWidth: (width) => set({ sidebarWidth: Math.max(200, Math.min(500, width)) }),
            toggleSideChat: () => set((s) => ({ sideChatOpen: !s.sideChatOpen })),
            setSideChatOpen: (open) => set({ sideChatOpen: open }),
            setSideChatPosition: (pos) => set({ sideChatPosition: pos }),
            setSideChatSize: (size) =>
                set({
                    sideChatSize: {
                        width: Math.max(320, Math.min(800, size.width)),
                        height: Math.max(300, Math.min(800, size.height)),
                    },
                }),
            setTemplateMode: (mode) => set({ templateMode: mode }),
            setIsAdminView: (isAdmin: boolean) => set({ isAdminView: isAdmin }),
            setBillingOpen: (open: boolean) => set({ billingOpen: open }),
            setFileLibraryOpen: (open: boolean) => set({ fileLibraryOpen: open }),
            setViewerOpen: (open: boolean) => set({ viewerOpen: open }),
            setViewerFile: (file: any) => set({ viewerFile: file }),
            setPendingMessageJumpId: (id) => set({ pendingMessageJumpId: id }),
        }),
        {
            name: 'lucen-ui-storage',
        }
    )
);
