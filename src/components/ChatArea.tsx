import React, { useRef, useEffect, useCallback, useState, useMemo, useDeferredValue } from 'react';
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { v4 as uuidv4 } from 'uuid';
import { Search, X, ChevronUp, ChevronDown, ArrowDown, Upload, Pencil, Check, Loader2 } from 'lucide-react';
import MessageInput from './MessageInput';
import SelectionMenu from './SelectionMenu';
import { useChatStore } from '../store/chatStore';
import { useShallow } from 'zustand/react/shallow';
import { useCreditsStore } from '../store/creditsStore';
import { useSideChatStore } from '../store/sideChatStore';
import Logo from './Logo';
import { useArtifactStore } from '../store/artifactStore';
import { useComposerStore } from '../store/composerStore';
import { streamChat } from '../services/openrouter';
import { getActiveModel } from '../config/models';
import { processFiles } from '../services/fileProcessor';
import type { Artifact, FileAttachment, Message } from '../types';
import { useUIStore } from '../store/uiStore';
import { saveArtifact, updateArtifactContent } from '../services/artifactDb';
import { createPatchedVersion, ensureLineageId } from '../services/artifactVersionDb';
import { parsePatches } from '../lib/artifactPatchParser';
import { applyPatch } from '../lib/artifactPatcher';
import ArtifactUpdateBinding from './ArtifactUpdateBinding';
import ChatExchangeRow, { buildExchangeRows, buildMsgIdToRowIndex } from './ChatExchangeRow';

// Max attempts to recover from a patch that failed to match (NFR1.3).
// Counted starting at 0 (first failure), so MAX_PATCH_RETRIES = 3 means
// the model gets the original turn + 3 retry passes before we give up.
const MAX_PATCH_RETRIES = 3;

const ChatArea: React.FC = () => {
    const activeConversationId = useChatStore((s) => s.activeConversationId);
    const activeConv = useChatStore(
        useShallow((s) => {
            const id = s.activeConversationId;
            if (!id) return undefined;
            return s.conversations.find((c) => c.id === id);
        })
    );
    const isMessageLoading = useChatStore((s) => s.isMessageLoading);

    const {
        createConversation,
        addMessage,
        updateMessage,
        deleteMessagePair,
        getContextMessages,
        getDraft,
        setDraft,
        togglePinMessage,
        forkConversation,
        setActiveConversation,
    } = useChatStore(
        useShallow((s) => ({
            createConversation: s.createConversation,
            addMessage: s.addMessage,
            updateMessage: s.updateMessage,
            deleteMessagePair: s.deleteMessagePair,
            getContextMessages: s.getContextMessages,
            getDraft: s.getDraft,
            setDraft: s.setDraft,
            togglePinMessage: s.togglePinMessage,
            forkConversation: s.forkConversation,
            setActiveConversation: s.setActiveConversation,
        }))
    );

    const { hasEnoughCredits } = useCreditsStore();
    const { 
        injectedContext, 
        toggleInjectedMessage, 
        removeInjectedMessage
    } = useSideChatStore();

    const { 
        setSideChatOpen, 
        setViewerOpen, 
        setViewerFile,
        pendingMessageJumpId,
        setPendingMessageJumpId
    } = useUIStore();

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const pinTrackRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    // @ts-ignore: Suppress Vercel unused error if it builds differently
    const model = getActiveModel();

    const pendingMainComposerPrefill = useComposerStore((s) => s.pendingMainComposerPrefill);
    const consumePendingMainComposerPrefill = useComposerStore((s) => s.consumePendingMainComposerPrefill);
    const pendingAutoSend = useComposerStore((s) => s.pendingAutoSend);
    const consumePendingAutoSend = useComposerStore((s) => s.consumePendingAutoSend);

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
    const [pinLabelsByConversation, setPinLabelsByConversation] = useState<Record<string, Record<string, string>>>({});
    const [editingPinId, setEditingPinId] = useState<string | null>(null);
    const [pinLabelDraft, setPinLabelDraft] = useState('');
    const [pinMarkers, setPinMarkers] = useState<Array<{ id: string; topPx: number; targetMsgId: string; previewText: string }>>([]);
    const [searchMarkers, setSearchMarkers] = useState<Array<{ id: string; topPx: number }>>([]);
    const [isForking, setIsForking] = useState(false);
    const dragCounterRef = useRef(0);
    const hasJumpedRef = useRef(false);
    /** After jump-to-message / search hit, ignore scroll-based isAutoScroll for a few frames so we don't
     *  fight the jump (at max scroll, "near bottom" stays true while smooth-scroll animates). */
    const pinJumpLockUntilRef = useRef(0);

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

    // Scroll-to-bottom FAB visibility + "follow stream" flag.
    // Do NOT set isAutoScroll from scroll while a programmatic jump to a pin/search hit is in progress,
    // or the handler will re-enable autoscroll while still "near" the bottom and yank the view back.
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;
        const handleScroll = () => {
            if (Date.now() < pinJumpLockUntilRef.current) return;
            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            const isNearBottom = distanceFromBottom < 200;
            setShowScrollBtn(!isNearBottom && container.scrollHeight > container.clientHeight + 100);
            setIsAutoScroll(isNearBottom);
        };
        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, []);

    // On mount: clean up stale streaming states.
    //
    // Distinguish "fresh" (<5 min old) from "stale" (>= 5 min). Fresh messages
    // were almost certainly interrupted by a page refresh or tab close mid-
    // generation — we flip them to truncated so the existing Continue button
    // lets the user resume with a single tap (same handleContinue path).
    // Stale messages show the hard "Response was interrupted" marker since
    // resuming hours-old context rarely produces coherent output.
    useEffect(() => {
        const FRESH_WINDOW_MS = 5 * 60 * 1000;
        const now = Date.now();
        const state = useChatStore.getState();
        state.conversations.forEach((conv) => {
            conv.messages.forEach((msg) => {
                if (!msg.isStreaming) return;
                const age = now - (msg.timestamp || 0);
                if (age < FRESH_WINDOW_MS && msg.content && msg.content.trim().length > 0) {
                    // Recoverable: mark truncated so the existing Continue UI appears.
                    updateMessage(conv.id, msg.id, {
                        isStreaming: false,
                        isReasoningStreaming: false,
                        isTruncated: true,
                    });
                } else {
                    updateMessage(conv.id, msg.id, {
                        isStreaming: false,
                        isReasoningStreaming: false,
                        content: msg.content || '⚠️ Response was interrupted. Click retry to regenerate.',
                    });
                }
            });
        });
    }, [updateMessage]);

    // Clear workspace artifact + dismissal memory when switching conversations
    const clearArtifact = useArtifactStore((s) => s.clearArtifact);
    const resetDismissedArtifacts = useArtifactStore((s) => s.resetDismissed);
    useEffect(() => {
        clearArtifact();
        resetDismissedArtifacts();
    }, [activeConversationId, clearArtifact, resetDismissedArtifacts]);

    useEffect(() => {
        if (!pendingMainComposerPrefill) return;
        setPrefillValue(pendingMainComposerPrefill);
        setPrefillCounter((c) => c + 1);
        consumePendingMainComposerPrefill();
    }, [pendingMainComposerPrefill, consumePendingMainComposerPrefill]);

    // Self-heal auto-submit: when ArtifactErrorBanner sets a payload,
    // fire it through handleSend so the existing patch flow takes over.
    // We deliberately wait until handleSend is defined before consuming
    // (handleSend is hoisted via closure, so it's always callable here).
    const handleSendRef = useRef<((c: string) => void) | null>(null);
    useEffect(() => {
        if (!pendingAutoSend) return;
        const payload = consumePendingAutoSend();
        if (!payload) return;
        // Tiny delay so any binding-state update from the banner click
        // settles before handleSend reads useChatStore.getState().
        const t = window.setTimeout(() => {
            handleSendRef.current?.(payload);
        }, 30);
        return () => window.clearTimeout(t);
    }, [pendingAutoSend, consumePendingAutoSend]);

    // Clear prefill when switching conversations so it doesn't reappear in new chat
    useEffect(() => {
        setPrefillValue('');
        setPrefillCounter(0);
    }, [activeConversationId]);

    const isStreaming = activeConv?.messages.some((m) => m.isStreaming) || false;
    const deferredActiveConv = useDeferredValue(activeConv);
    /** Defer heavy list reconciliation when idle; stay on the live conversation while tokens stream. */
    const conversationForMessageList = isStreaming ? activeConv : deferredActiveConv;
    const listConv = conversationForMessageList ?? activeConv;
    const exchangeRows = useMemo(
        () => buildExchangeRows(listConv?.messages ?? []),
        [listConv?.messages],
    );
    const msgIdToRowIndex = useMemo(() => buildMsgIdToRowIndex(exchangeRows), [exchangeRows]);
    const searchActive = searchOpen && searchQuery.trim().length >= 2;
    const virtActive =
        !isMessageLoading &&
        !isStreaming &&
        !searchActive &&
        exchangeRows.length >= 36;
    const virtualizer = useVirtualizer({
        count: exchangeRows.length,
        getScrollElement: () => messagesContainerRef.current,
        estimateSize: () => 200,
        overscan: 8,
    });
    const virtActiveRef = useRef(false);
    const msgIdToRowIndexRef = useRef(new Map<string, number>());
    const virtualizerRef = useRef<Virtualizer<HTMLDivElement, Element> | null>(null);
    virtActiveRef.current = virtActive;
    msgIdToRowIndexRef.current = msgIdToRowIndex;
    virtualizerRef.current = virtualizer;
    const lastAssistantMsgId = useMemo(() => {
        const msgs = listConv?.messages;
        if (!msgs) return null;
        for (let j = msgs.length - 1; j >= 0; j--) {
            if (msgs[j].role === 'assistant') return msgs[j].id;
        }
        return null;
    }, [listConv?.messages]);

    // Auto-scroll only when user is near the bottom (isAutoScroll = true).
    useEffect(() => {
        if (!isAutoScroll) return;
        if (virtActive && exchangeRows.length > 0) {
            virtualizer.scrollToIndex(exchangeRows.length - 1, { align: 'end' });
        } else {
            scrollToBottom();
        }
    }, [activeConv?.messages, isAutoScroll, virtActive, exchangeRows.length, scrollToBottom, virtualizer]);

    // ─── Stream helpers ───
    //
    // Both fresh sends and manual continuations use the same chunk-buffering
    // strategy (60ms flush window) so the UX is identical — no "continue"
    // button skips the buffer and forces re-renders on every token.
    const runStream = async (
        convId: string,
        assistantMsgId: string,
        options: {
            continuation?: { priorAssistantText: string };
            trackReasoning: boolean;
            // Patching engine: when set, the assistant message is expected to
            // emit <lucen_patch> blocks. After stream completion we run the
            // patch engine instead of saving a fresh artifact row.
            targetedArtifact?: import('../types').Artifact;
            patchHint?: string;
            // NFR1.3 retry counter — bounded by MAX_PATCH_RETRIES upstream.
            patchRetryCount?: number;
        },
    ) => {
        const controller = new AbortController();
        abortRef.current = controller;
        const contextMessages = getContextMessages(convId);

        // Upstream SSE can arrive in bursty packets (network/proxy coalescing),
        // which feels "chunky" even when streaming is technically enabled.
        // We smooth bursts on the client by draining queued text once per frame.
        // This keeps rendering continuous without spamming React updates.
        let pendingText = '';
        let flushRaf: number | null = null;
        let renderedContent =
            useChatStore
                .getState()
                .conversations.find((c) => c.id === convId)
                ?.messages.find((m) => m.id === assistantMsgId)
                ?.content || '';

        const appendContent = (delta: string) => {
            if (!delta) return;
            renderedContent += delta;
            updateMessage(convId, assistantMsgId, {
                content: renderedContent,
                isReasoningStreaming: false,
            });
        };

        const drainFrame = () => {
            flushRaf = null;
            if (!pendingText) return;

            // Adaptive per-frame slice:
            // - small queue: tiny slices for smoothness
            // - large queue: bigger slices to catch up quickly
            const queueLen = pendingText.length;
            const charsThisFrame = Math.max(12, Math.min(220, Math.ceil(queueLen * 0.2)));
            const delta = pendingText.slice(0, charsThisFrame);
            pendingText = pendingText.slice(charsThisFrame);
            appendContent(delta);

            if (pendingText) scheduleFlush();
        };

        const scheduleFlush = () => {
            if (flushRaf !== null) return;
            flushRaf = window.requestAnimationFrame(() => {
                drainFrame();
            });
        };

        const flushAllPending = () => {
            if (!pendingText) return;
            appendContent(pendingText);
            pendingText = '';
        };

        await streamChat(contextMessages, {
            onChunk: (chunk) => {
                pendingText += chunk;
                scheduleFlush();
            },
            onReasoning: (reasoning) => {
                if (!options.trackReasoning) return;
                const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
                const msg = conv?.messages.find((m) => m.id === assistantMsgId);
                updateMessage(convId, assistantMsgId, {
                    reasoning: (msg?.reasoning || '') + reasoning,
                });
            },
            onDone: (truncated) => {
                if (flushRaf !== null) {
                    cancelAnimationFrame(flushRaf);
                    flushRaf = null;
                }
                flushAllPending();
                updateMessage(convId, assistantMsgId, {
                    isStreaming: false,
                    isReasoningStreaming: false,
                    isTruncated: truncated || false,
                });
                abortRef.current = null;
                useCreditsStore.getState().syncFromServer();

                // ── Patching engine: if this turn was bound to an existing
                // artifact, we expect <lucen_patch> blocks in the response.
                // Apply them via the deterministic patch engine and create
                // a new version row. On failure, kick off the NFR1.3 retry.
                if (options.targetedArtifact) {
                    void finalizePatchTurn(convId, assistantMsgId, options).catch((err) => {
                        console.warn('[Patch] finalize failed:', err);
                    });
                    return;
                }

                // ── Auto-save artifact to DB (fire-and-forget) ──
                // We read the artifact store AFTER the streaming update above
                // so we get the final content. setDbId() patches the store once
                // the async DB write completes — zero impact on streaming perf.
                const finishedArtifact = useArtifactStore.getState().activeArtifact;
                if (finishedArtifact && !finishedArtifact.isStreaming) {
                    const existingDbId = finishedArtifact.dbId
                        ?? useArtifactStore.getState().getDbId(finishedArtifact.id);
                    if (existingDbId) {
                        // Already saved — just update content in case it changed
                        updateArtifactContent(existingDbId, finishedArtifact.content, finishedArtifact.title)
                            .catch(() => {});
                    } else {
                        saveArtifact({
                            clientId: finishedArtifact.id,
                            conversationId: convId,
                            messageId: assistantMsgId,
                            type: finishedArtifact.type,
                            title: finishedArtifact.title,
                            content: finishedArtifact.content,
                        }).then((dbId) => {
                            if (dbId) {
                                useArtifactStore.getState().setDbId(finishedArtifact.id, dbId);
                            }
                        }).catch(() => {});
                    }
                }
            },
            onError: (error) => {
                if (flushRaf !== null) {
                    cancelAnimationFrame(flushRaf);
                    flushRaf = null;
                }
                flushAllPending();
                updateMessage(convId, assistantMsgId, {
                    content: options.continuation
                        ? `${renderedContent}\n\n⚠️ Error continuing: ${error}`
                        : `⚠️ Error: ${error}`,
                    isStreaming: false,
                    isReasoningStreaming: false,
                });
                abortRef.current = null;
                useCreditsStore.getState().syncFromServer();
            },
            onWebSearchUsed: (urls) =>
                updateMessage(convId, assistantMsgId, { webSearchUsed: true, webSearchUrls: urls }),
            onClarificationNeeded: (question) => {
                if (flushRaf !== null) {
                    cancelAnimationFrame(flushRaf);
                    flushRaf = null;
                }
                flushAllPending();
                updateMessage(convId, assistantMsgId, {
                    content: options.continuation
                        ? `${renderedContent}\n\n_Search paused._\n\n**${question}**`
                        : `_Search paused. I need a bit more info to get you the right results:_\n\n**${question}**`,
                    isStreaming: false,
                    isReasoningStreaming: false,
                });
                abortRef.current = null;
            },
        }, {
            signal: controller.signal,
            webSearchEnabled,
            conversationId: convId,
            continuation: options.continuation,
            messageId: assistantMsgId,
            targetedArtifact: options.targetedArtifact,
            patchHint: options.patchHint,
        });
    };

    const doStreamResponse = (convId: string, assistantMsgId: string) =>
        runStream(convId, assistantMsgId, { trackReasoning: true });

    // ─── Patching engine: post-stream finalize ────────────────────────
    // Called from runStream's onDone when this turn was bound to an
    // existing artifact. Parses <lucen_patch> blocks out of the assistant
    // message, runs the deterministic patcher, creates a new version row
    // in DB, and (if the artifact is mermaid) validates with mermaid.parse.
    //
    // On failure we kick a retry loop (up to MAX_PATCH_RETRIES) that
    // re-invokes streamChat with a precise patchHint describing what
    // went wrong (NFR1.3).
    const finalizePatchTurn = async (
        convId: string,
        assistantMsgId: string,
        runOptions: {
            targetedArtifact?: Artifact;
            patchRetryCount?: number;
        },
    ) => {
        const target = runOptions.targetedArtifact;
        if (!target) return;
        const retryCount = runOptions.patchRetryCount ?? 0;

        const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
        const assistantMsg = conv?.messages.find((m) => m.id === assistantMsgId);
        const responseContent = assistantMsg?.content || '';

        const { patches } = parsePatches(responseContent, true);

        if (patches.length === 0) {
            // Model didn't emit any patch blocks. This could be:
            //   1. Refusal / clarification request (legit response).
            //   2. The model regenerated a <lucen_artifact> instead (wrong).
            // Either way, we leave the message as-is and clear the binding.
            // The user sees the assistant's text and can manually re-bind.
            useChatStore.getState().setTargetArtifact(convId, null);
            useArtifactStore.getState().setPatchStatus(target.id, 'idle');
            return;
        }

        useArtifactStore.getState().setPatchStatus(target.id, 'verifying');

        // Apply all blocks across all patches sequentially. If multiple
        // patch tags arrive, treat them as one logical patch (FR6 multi-step).
        const allBlocks = patches.flatMap((p) => p.blocks);
        const patchResult = applyPatch(target.content, allBlocks);

        if (!patchResult.ok) {
            // ── NFR1.3 retry loop ──
            const failedBlock = allBlocks[patchResult.blockIndex];
            const reasonText =
                patchResult.reason === 'no_match'
                    ? `Block ${patchResult.blockIndex + 1} did not match anything in the artifact. The <search> text was not found. Add MORE surrounding context (5-10 lines above and below the change point) so the search becomes unique.`
                    : patchResult.reason === 'multi_match'
                        ? `Block ${patchResult.blockIndex + 1} matched ${patchResult.matchCount} places — the search is ambiguous. Add MORE surrounding context (a unique line or two of nearby code) so it matches exactly once.`
                        : `Block ${patchResult.blockIndex + 1} had an empty <search>. Provide the actual existing text you want to replace.`;

            const hint =
                `Your previous patch attempt FAILED to apply. Reason: ${reasonText}\n` +
                `Failed search excerpt: ${JSON.stringify(patchResult.searchExcerpt.slice(0, 160))}\n` +
                `Original block context if needed: search-block #${patchResult.blockIndex + 1} of ${allBlocks.length}.\n` +
                `Re-emit the FULL <lucen_patch> with corrected blocks. Copy <search> verbatim from the artifact above.`;

            if (retryCount < MAX_PATCH_RETRIES) {
                // Mark current message as failed indicator + spawn a retry message.
                useArtifactStore.getState().setPatchStatus(target.id, 'failed');
                const retryMsgId = uuidv4();
                await addMessage(convId, {
                    id: retryMsgId,
                    role: 'assistant',
                    content: '',
                    reasoning: '',
                    timestamp: Date.now(),
                    isStreaming: true,
                    isReasoningStreaming: false,
                });
                useArtifactStore.getState().setPatchStatus(target.id, 'patching');
                await runStream(convId, retryMsgId, {
                    trackReasoning: true,
                    targetedArtifact: target,
                    patchHint: hint,
                    patchRetryCount: retryCount + 1,
                });
                return;
            }

            // Give up after MAX_PATCH_RETRIES. Leave the artifact
            // untouched, surface the failure to the user, clear the
            // binding so they can decide what to do next.
            useArtifactStore.getState().setPatchStatus(target.id, 'failed');
            useChatStore.getState().setTargetArtifact(convId, null);
            updateMessage(convId, assistantMsgId, {
                content:
                    `${responseContent}\n\n⚠️ Patch failed after ${MAX_PATCH_RETRIES} retries: ${reasonText}\nThe artifact was not modified. You can edit it manually or try rephrasing.`,
            });
            console.warn('[Patch] gave up after retries:', { failedBlock, reason: patchResult.reason });
            return;
        }

        let newContent = patchResult.newContent;

        // Mermaid post-validation (P6.mermaid-validation): if the patched
        // content is invalid mermaid syntax, treat as a patch failure and
        // feed back into the retry loop.
        if (target.type === 'mermaid') {
            try {
                const mermaid = (await import('mermaid')).default;
                mermaid.initialize({
                    startOnLoad: false,
                    theme: 'neutral',
                    securityLevel: 'loose',
                });
                await mermaid.parse(newContent.trim());
            } catch (e) {
                const parseErr = e instanceof Error ? e.message : String(e);
                if (retryCount < MAX_PATCH_RETRIES) {
                    const hint =
                        `Your patch produced INVALID Mermaid syntax. Parser error: ${parseErr.slice(0, 280)}\n` +
                        `Re-emit the <lucen_patch> with corrected blocks that produce valid Mermaid.`;
                    useArtifactStore.getState().setPatchStatus(target.id, 'failed');
                    const retryMsgId = uuidv4();
                    await addMessage(convId, {
                        id: retryMsgId,
                        role: 'assistant',
                        content: '',
                        reasoning: '',
                        timestamp: Date.now(),
                        isStreaming: true,
                        isReasoningStreaming: false,
                    });
                    useArtifactStore.getState().setPatchStatus(target.id, 'patching');
                    await runStream(convId, retryMsgId, {
                        trackReasoning: true,
                        targetedArtifact: target,
                        patchHint: hint,
                        patchRetryCount: retryCount + 1,
                    });
                    return;
                }
                useArtifactStore.getState().setPatchStatus(target.id, 'failed');
                useChatStore.getState().setTargetArtifact(convId, null);
                updateMessage(convId, assistantMsgId, {
                    content: `${responseContent}\n\n⚠️ Patch produced invalid Mermaid syntax (${parseErr.slice(0, 120)}). Artifact unchanged.`,
                });
                return;
            }
        }

        // ── Patch applied successfully — persist the new version. ──
        // Make sure the source artifact has a lineage_id (defensive
        // backfill for artifacts created before the migration ran).
        const parentDbId = target.dbId
            ?? useArtifactStore.getState().getDbId(target.id);
        if (!parentDbId) {
            // Source artifact never made it to the DB — fall back to the
            // legacy save path with the patched content. Clear binding.
            const dbId = await saveArtifact({
                clientId: target.id,
                conversationId: convId,
                messageId: assistantMsgId,
                type: target.type,
                title: target.title,
                content: newContent,
            });
            if (dbId) useArtifactStore.getState().setDbId(target.id, dbId);
            useArtifactStore.getState().patchActiveArtifact({ content: newContent });
            useArtifactStore.getState().setPatchStatus(target.id, 'idle');
            useChatStore.getState().setTargetArtifact(convId, null);
            return;
        }

        const lineageId = target.lineageId
            ?? (await ensureLineageId(parentDbId))
            ?? parentDbId;

        const newVersion = await createPatchedVersion({
            lineageId,
            parentDbId,
            conversationId: convId,
            messageId: assistantMsgId,
            type: target.type,
            title: target.title,
            content: newContent,
        });

        if (!newVersion) {
            // DB write failed — keep the patch in memory so the user still
            // sees their change, but warn so we know something's off.
            console.warn('[Patch] createPatchedVersion failed; keeping change in-memory only.');
            useArtifactStore.getState().patchActiveArtifact({ content: newContent });
        } else {
            // Push the new version into the lineage cache and update the
            // active artifact so the renderer immediately reflects V_n+1.
            useArtifactStore.getState().appendLineageVersion(lineageId, newVersion);
            useArtifactStore.getState().patchActiveArtifact({
                content: newContent,
                dbId: newVersion.dbId,
                version: newVersion.versionNo,
                parentId: newVersion.parentDbId,
                lineageId,
            });
            useArtifactStore.getState().setDbId(target.id, newVersion.dbId);
        }

        // Reset error/heal state on success.
        useArtifactStore.getState().setRuntimeError(target.id, null);
        useArtifactStore.getState().resetHealAttempts(target.id);
        useArtifactStore.getState().setPatchStatus(target.id, 'idle');
        useChatStore.getState().setTargetArtifact(convId, null);
    };

    // ─── Continue truncated response ───
    // Resumes from the message's existing partial content. The
    // streamViaEdgeFunctionWrapper picks up the prior text as an assistant
    // message + a short "continue" user nudge (ChatGPT-style), so the model
    // resumes mid-sentence without re-emitting any opening tag.
    const handleContinue = async (assistantMsgId: string) => {
        if (!activeConversationId) return;
        const convId = activeConversationId;

        // Capture the partial text BEFORE flipping isStreaming, otherwise
        // getContextMessages would filter the message out.
        const partialMsg = useChatStore.getState().conversations
            .find((c) => c.id === convId)
            ?.messages.find((m) => m.id === assistantMsgId);
        const priorAssistantText = partialMsg?.content || '';

        updateMessage(convId, assistantMsgId, { isStreaming: true, isTruncated: false });
        await runStream(convId, assistantMsgId, {
            trackReasoning: false,
            continuation: { priorAssistantText },
        });
    };

    const handleSend = async (content: string, attachments?: FileAttachment[]) => {
        if (!hasEnoughCredits()) return;
        let convId = activeConversationId;
        if (!convId) convId = createConversation();

        // Patching engine: resolve the per-conversation binding to a real
        // Artifact snapshot. If the bound artifact is the active one, we
        // use its in-memory state directly (preserves any unsaved changes).
        const targetArtifactId = useChatStore.getState().getTargetArtifact(convId);
        const activeArt = useArtifactStore.getState().activeArtifact;
        const targetedArtifact: Artifact | undefined =
            targetArtifactId && activeArt && activeArt.id === targetArtifactId
                ? activeArt
                : undefined;

        // Hard-block: artifact too large to safely patch (>100k chars).
        // We surface a synthesized assistant message instead of burning a
        // turn that's almost certain to truncate.
        if (targetedArtifact && targetedArtifact.content.length > 100_000) {
            await addMessage(convId, {
                id: uuidv4(), role: 'user', content, timestamp: Date.now(),
                attachments: attachments || undefined,
            });
            await addMessage(convId, {
                id: uuidv4(),
                role: 'assistant',
                content:
                    `⚠️ This artifact is ${Math.round(targetedArtifact.content.length / 1000)}k chars — too large to patch reliably. Consider rewriting it from scratch (close the update binding and ask for a fresh artifact instead).`,
                timestamp: Date.now(),
            });
            useChatStore.getState().setTargetArtifact(convId, null);
            return;
        }

        await addMessage(convId, {
            // eslint-disable-next-line react-hooks/purity
            id: uuidv4(), role: 'user', content, timestamp: Date.now(),
            attachments: attachments || undefined,
        });

        const assistantMsgId = uuidv4();
        await addMessage(convId, {
            id: assistantMsgId, role: 'assistant', content: '', reasoning: '',
            // eslint-disable-next-line react-hooks/purity
            timestamp: Date.now(), isStreaming: true, isReasoningStreaming: model.supportsReasoning,
        });

        if (targetedArtifact) {
            // Drive the status overlay through its full pipeline. Each phase
            // is set explicitly so the UI doesn't flicker between states.
            useArtifactStore.getState().setPatchStatus(targetedArtifact.id, 'reading');
            // Tiny micro-delay so the user perceives the read step before the
            // model's first token arrives.
            window.setTimeout(() => {
                useArtifactStore.getState().setPatchStatus(targetedArtifact.id, 'patching');
            }, 80);
            await runStream(convId, assistantMsgId, {
                trackReasoning: true,
                targetedArtifact,
                patchRetryCount: 0,
            });
            return;
        }

        await doStreamResponse(convId, assistantMsgId);
    };

    // Expose handleSend to the auto-heal effect above so it can fire a
    // patch turn programmatically without typing.
    handleSendRef.current = (content: string) => { void handleSend(content); };

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

    const handleFork = async (msgId: string) => {
        if (!activeConversationId) return;
        setIsForking(true);
        try {
            const newConvId = await forkConversation(activeConversationId, msgId);
            if (newConvId) {
                setActiveConversation(newConvId);
            }
        } catch (error) {
            console.error('Failed to fork chat:', error);
        } finally {
            setIsForking(false);
        }
    };

    const scrollToMessage = useCallback((msgId: string) => {
        pinJumpLockUntilRef.current = Date.now() + 900;
        setIsAutoScroll(false);

        const run = () => {
            const container = messagesContainerRef.current;
            if (!container) return;

            if (virtActiveRef.current && virtualizerRef.current) {
                const idx = msgIdToRowIndexRef.current.get(msgId);
                if (idx != null) {
                    virtualizerRef.current.scrollToIndex(idx, { align: 'center' });
                    requestAnimationFrame(() => {
                        const el = container.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
                        if (!el) return;
                        el.classList.add('msg-jump-flash');
                        window.setTimeout(() => el.classList.remove('msg-jump-flash'), 1400);
                    });
                    return;
                }
            }

            const el = container.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
            if (!el) return;

            const cRect = container.getBoundingClientRect();
            const eRect = el.getBoundingClientRect();
            const elTopInScroll = container.scrollTop + (eRect.top - cRect.top);
            const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
            const desiredTop = eRect.height > container.clientHeight * 0.9
                ? elTopInScroll - 20
                : elTopInScroll - container.clientHeight / 2 + eRect.height / 2;
            const targetTop = Math.max(0, Math.min(maxScroll, desiredTop));

            // Instant scroll is reliable at max-scroll; smooth + "near bottom" was fighting autoscroll.
            if (Math.abs(container.scrollTop - targetTop) < 1) {
                container.scrollTop = targetTop > 0 ? targetTop - 1 : 0;
            }
            requestAnimationFrame(() => {
                container.scrollTop = targetTop;
                el.classList.add('msg-jump-flash');
                window.setTimeout(() => el.classList.remove('msg-jump-flash'), 1400);
            });
        };

        // Double rAF: layout settled after the pin click / any batched re-render.
        requestAnimationFrame(() => {
            requestAnimationFrame(run);
        });
    }, []);

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
        if (!searchOpen) {
            setActiveMatchMsgId(null);
            setMatchCount(0);
            setActiveMatchIndex(0);
            hasJumpedRef.current = false;
            return;
        }

        const elements = getHighlightedMatchElements();
        setMatchCount(elements.length);

        if (elements.length === 0) {
            setActiveMatchMsgId(null);
            if (activeMatchIndex !== 0) setActiveMatchIndex(0);
            return;
        }

        // Apply is-active class to the current match element
        elements.forEach((el, i) => {
            if (i === activeMatchIndex) el.classList.add('is-active');
            else el.classList.remove('is-active');
        });

        if (activeMatchIndex >= elements.length) {
            setActiveMatchIndex(0);
        }

        const el = elements[activeMatchIndex] || elements[0];
        const msgId = el?.closest('[data-msg-id]')?.getAttribute('data-msg-id') || null;
        setActiveMatchMsgId(msgId);
    }, [searchOpen, getHighlightedMatchElements, activeMatchIndex, activeConv?.messages]);

    // Jump to nearest match on search start
    useEffect(() => {
        if (searchOpen && searchQuery.trim().length >= 2 && !hasJumpedRef.current) {
            const elements = getHighlightedMatchElements();
            if (elements.length > 0) {
                const container = messagesContainerRef.current;
                if (container) {
                    const scrollCenter = container.scrollTop + (container.clientHeight / 2);
                    let minOffset = Infinity;
                    let nearestIdx = 0;

                    elements.forEach((el, i) => {
                        const rect = (el as HTMLElement).offsetTop;
                        const offset = Math.abs(rect - scrollCenter);
                        if (offset < minOffset) {
                            minOffset = offset;
                            nearestIdx = i;
                        }
                    });
                    setActiveMatchIndex(nearestIdx);
                    hasJumpedRef.current = true;
                }
            }
        }
    }, [searchOpen, searchQuery, getHighlightedMatchElements]);

    // Scroll to the exact highlighted substring (not just the whole message).
    useEffect(() => {
        if (!searchOpen) return;
        const elements = getHighlightedMatchElements();
        const el = elements[activeMatchIndex] || elements[0];
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [activeMatchIndex, searchOpen, getHighlightedMatchElements, activeConv?.messages]);

    useEffect(() => {
        if (pendingMessageJumpId && activeConv) {
            // Wait a tiny bit for the current conversation's messages to render if we just switched
            const timer = setTimeout(() => {
                scrollToMessage(pendingMessageJumpId);
                setPendingMessageJumpId(null);
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [pendingMessageJumpId, activeConv, scrollToMessage, setPendingMessageJumpId]);

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

    const pinnedExchangeIds = useMemo(() => {
        if (!activeConv) return new Set<string>();
        const ids = new Set<string>();
        const msgs = activeConv.messages;
        for (let i = 0; i < msgs.length; i++) {
            const msg = msgs[i];
            const nextMsg = i + 1 < msgs.length && msgs[i + 1].role === 'assistant' ? msgs[i + 1] : null;
            if (msg.isPinned || (nextMsg && nextMsg.isPinned)) ids.add(msg.id);
            if (nextMsg) i++;
        }
        return ids;
    }, [activeConv]);

    const activePinLabels = useMemo(() => {
        if (!activeConversationId) return {};
        return pinLabelsByConversation[activeConversationId] || {};
    }, [pinLabelsByConversation, activeConversationId]);

    useEffect(() => {
        if (!activeConversationId) return;
        setPinLabelsByConversation((prev) => {
            const current = prev[activeConversationId] || {};
            const nextForConversation: Record<string, string> = {};
            Object.entries(current).forEach(([id, value]) => {
                if (pinnedExchangeIds.has(id)) nextForConversation[id] = value;
            });
            return { ...prev, [activeConversationId]: nextForConversation };
        });
        if (editingPinId && !pinnedExchangeIds.has(editingPinId)) {
            setEditingPinId(null);
            setPinLabelDraft('');
        }
    }, [pinnedExchangeIds, editingPinId, activeConversationId]);

    const recalculateTrackMarkers = useCallback(() => {
        if (!activeConv) {
            setPinMarkers([]);
            setSearchMarkers([]);
            return;
        }

        const container = messagesContainerRef.current;
        const track = pinTrackRef.current;
        if (!container || !track) return;

        const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 1);
        const trackPadding = 8;
        const trackUsableHeight = Math.max(track.clientHeight - trackPadding * 2, 1);
        const toTopPx = (msgId: string) => {
            if (virtActive && exchangeRows.length > 0) {
                const idx = msgIdToRowIndex.get(msgId);
                if (idx != null) {
                    const ratio = exchangeRows.length <= 1 ? 0 : idx / (exchangeRows.length - 1);
                    return trackPadding + ratio * trackUsableHeight;
                }
            }
            const el = container.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
            if (!el) return null;
            const containerRect = container.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const absoluteTopInScroll = container.scrollTop + (elRect.top - containerRect.top);
            const ratio = Math.max(0, Math.min(1, absoluteTopInScroll / maxScrollTop));
            return trackPadding + (ratio * trackUsableHeight);
        };

        const nextSearchMarkers: Array<{ id: string; topPx: number }> = [];
        if (searchOpen && matchingIds.size > 0) {
            matchingIds.forEach((msgId) => {
                const topPx = toTopPx(msgId);
                if (topPx !== null) nextSearchMarkers.push({ id: msgId, topPx });
            });
        }
        setSearchMarkers(nextSearchMarkers);

        const markers: Array<{ id: string; topPx: number; targetMsgId: string; previewText: string }> = [];
        const msgs = activeConv.messages;
        for (let i = 0; i < msgs.length; i++) {
            const msg = msgs[i];
            const nextMsg = i + 1 < msgs.length && msgs[i + 1].role === 'assistant' ? msgs[i + 1] : null;
            if (msg.isPinned || (nextMsg && nextMsg.isPinned)) {
                const topPx = toTopPx(msg.id);
                if (topPx !== null) {
                    markers.push({
                        id: msg.id,
                        topPx,
                        targetMsgId: msg.id,
                        previewText: (nextMsg?.content || msg.content).trim().slice(0, 56),
                    });
                }
            }
            if (nextMsg) i++;
        }

        // De-overlap markers that land too close together so every pin is
        // individually clickable on short chats / long chats alike.
        markers.sort((a, b) => a.topPx - b.topPx);
        const MIN_GAP = 14;
        for (let i = 1; i < markers.length; i++) {
            if (markers[i].topPx - markers[i - 1].topPx < MIN_GAP) {
                markers[i].topPx = markers[i - 1].topPx + MIN_GAP;
            }
        }
        // Clamp to track bounds.
        const maxTop = trackPadding + trackUsableHeight;
        for (const m of markers) {
            if (m.topPx > maxTop) m.topPx = maxTop;
        }

        setPinMarkers(markers);
    }, [activeConv, matchingIds, searchOpen, virtActive, exchangeRows, msgIdToRowIndex]);

    useEffect(() => {
        const raf = requestAnimationFrame(recalculateTrackMarkers);
        return () => cancelAnimationFrame(raf);
    }, [recalculateTrackMarkers, activeConv?.messages, searchQuery, searchOpen, matchCount]);

    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;

        let scrollRaf = 0;
        const schedulePins = () => {
            if (scrollRaf) return;
            scrollRaf = requestAnimationFrame(() => {
                scrollRaf = 0;
                recalculateTrackMarkers();
            });
        };

        const refresh = () => recalculateTrackMarkers();
        const resizeObserver = new ResizeObserver(refresh);
        resizeObserver.observe(container);
        const list = container.querySelector('.messages-list');
        if (list) resizeObserver.observe(list);

        container.addEventListener('scroll', schedulePins, { passive: true });
        window.addEventListener('resize', refresh);
        return () => {
            if (scrollRaf) cancelAnimationFrame(scrollRaf);
            resizeObserver.disconnect();
            container.removeEventListener('scroll', schedulePins);
            window.removeEventListener('resize', refresh);
        };
    }, [recalculateTrackMarkers]);

    const startPinLabelEdit = (pinId: string, currentLabel: string) => {
        setEditingPinId(pinId);
        setPinLabelDraft(currentLabel);
    };

    const savePinLabel = () => {
        if (!editingPinId || !activeConversationId) return;
        const next = pinLabelDraft.trim();
        setPinLabelsByConversation((prev) => {
            const current = prev[activeConversationId] || {};
            const updated = { ...current };
            if (next) updated[editingPinId] = next;
            else delete updated[editingPinId];
            return { ...prev, [activeConversationId]: updated };
        });
        setEditingPinId(null);
        setPinLabelDraft('');
    };

    return (
        <div
            className="chat-area"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {isForking && (
                <div className="forking-overlay" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(var(--bg-primary-rgb), 0.7)', zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
                    <Loader2 size={40} className="spinner" style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-color)' }} />
                    <p style={{ marginTop: '16px', fontWeight: 500, color: 'var(--text-primary)' }}>Forking chat...</p>
                    <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                </div>
            )}
            <div className="pin-track-container" ref={pinTrackRef}>
                {searchMarkers.map((marker) => (
                    <div
                        key={`search-marker-${marker.id}`}
                        className="search-marker"
                        style={{ top: `${marker.topPx}px` }}
                        onClick={() => scrollToMessage(marker.id)}
                    />
                ))}
                {pinMarkers.map((marker) => {
                    const label = activePinLabels[marker.id]?.trim();
                    const isEditing = editingPinId === marker.id;
                    return (
                        <div
                            key={`pin-exchange-${marker.id}`}
                            className={`pin-marker ${isEditing ? 'is-editing' : ''}`}
                            style={{ top: `${marker.topPx}px` }}
                            onClick={() => scrollToMessage(marker.targetMsgId)}
                        >
                            <div className="pin-marker-dot" />
                            <div className="pin-marker-tooltip" onClick={(e) => e.stopPropagation()}>
                                {isEditing ? (
                                    <div className="pin-marker-tooltip-edit">
                                        <input
                                            className="pin-marker-tooltip-input"
                                            value={pinLabelDraft}
                                            onChange={(e) => setPinLabelDraft(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') savePinLabel();
                                                if (e.key === 'Escape') {
                                                    setEditingPinId(null);
                                                    setPinLabelDraft('');
                                                }
                                            }}
                                            placeholder="Label this pin"
                                            autoFocus
                                        />
                                        <button className="pin-marker-tooltip-btn" onClick={savePinLabel} title="Save label">
                                            <Check size={12} />
                                        </button>
                                        <button
                                            className="pin-marker-tooltip-btn"
                                            onClick={() => {
                                                setEditingPinId(null);
                                                setPinLabelDraft('');
                                            }}
                                            title="Cancel"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="pin-marker-tooltip-row">
                                        <span className="pin-marker-tooltip-text">{label || marker.previewText}</span>
                                        <button
                                            className="pin-marker-tooltip-btn"
                                            onClick={() => startPinLabelEdit(marker.id, label || '')}
                                            title={label ? 'Edit label' : 'Add label'}
                                        >
                                            <Pencil size={11} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
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
                                    onChange={(e) => { 
                                        const newVal = e.target.value;
                                        setSearchQuery(newVal); 
                                        // If we are starting a fresh search (was empty or too short), 
                                        // we'll let the nearest-match Effect handle it.
                                        // Otherwise, we reset index only if current one becomes invalid.
                                    }}
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
                                <button className="chat-search-close" onClick={() => { 
                                    setSearchOpen(false); 
                                    setSearchQuery(''); 
                                    setActiveMatchIndex(0);
                                    setActiveMatchMsgId(null);
                                    setMatchCount(0);
                                }}><X size={15} /></button>
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
                        {virtActive ? (
                            <div
                                style={{
                                    height: virtualizer.getTotalSize(),
                                    position: 'relative',
                                    width: '100%',
                                }}
                            >
                                {virtualizer.getVirtualItems().map((vRow) => {
                                    const row = exchangeRows[vRow.index];
                                    return (
                                        <div
                                            key={vRow.key}
                                            data-index={vRow.index}
                                            ref={virtualizer.measureElement}
                                            style={{
                                                position: 'absolute',
                                                top: 0,
                                                left: 0,
                                                width: '100%',
                                                transform: `translateY(${vRow.start}px)`,
                                            }}
                                        >
                                            <ChatExchangeRow
                                                row={row}
                                                searchQuery={searchQuery}
                                                matchingIds={matchingIds}
                                                activeMatchMsgId={activeMatchMsgId}
                                                highlightedPairId={highlightedPairId}
                                                lastAssistantMsgId={lastAssistantMsgId}
                                                injectedContext={injectedContext}
                                                setViewerFile={setViewerFile}
                                                setViewerOpen={setViewerOpen}
                                                handleRetry={handleRetry}
                                                handleContinue={handleContinue}
                                                handleFork={handleFork}
                                                handleToggleLink={handleToggleLink}
                                                handlePin={handlePin}
                                                handleDelete={handleDelete}
                                                setHighlightedPairId={setHighlightedPairId}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            exchangeRows.map((row) => (
                                <React.Fragment key={row.kind === 'pair' ? row.user.id : row.msg.id}>
                                    <ChatExchangeRow
                                        row={row}
                                        searchQuery={searchQuery}
                                        matchingIds={matchingIds}
                                        activeMatchMsgId={activeMatchMsgId}
                                        highlightedPairId={highlightedPairId}
                                        lastAssistantMsgId={lastAssistantMsgId}
                                        injectedContext={injectedContext}
                                        setViewerFile={setViewerFile}
                                        setViewerOpen={setViewerOpen}
                                        handleRetry={handleRetry}
                                        handleContinue={handleContinue}
                                        handleFork={handleFork}
                                        handleToggleLink={handleToggleLink}
                                        handlePin={handlePin}
                                        handleDelete={handleDelete}
                                        setHighlightedPairId={setHighlightedPairId}
                                    />
                                </React.Fragment>
                            ))
                        )}
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
            <ArtifactUpdateBinding />
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
