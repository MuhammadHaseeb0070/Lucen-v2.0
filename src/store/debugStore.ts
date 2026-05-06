// ============================================================================
// Debug payload store — browser-only, dev transparency.
//
// Purpose: give developers a way to see the EXACT request payload and
// response body of every AI-related HTTP call (chat-proxy, classify-intent,
// describe-image, embed, retrieve-chunks) so that the Usage tab can
// surface them on click.
//
// Design:
//   • Ring buffer (max 200 entries) to cap memory.
//   • Browser-only, lives in memory, cleared on refresh. This is the simplest
//     possible transparency layer — no server persistence, no DB growth.
//   • Gated by the env flag VITE_DEV_PAYLOAD_CAPTURE. When the flag is not
//     'true', the store is a no-op (entries never get saved, hooks are free).
//   • Payloads are redacted: image dataUrls are truncated so the ring buffer
//     doesn't blow up on screenshots, and auth tokens are stripped.
//   • Indexed by `request_id` so the UsageTab can look up a row quickly.
// ============================================================================

import { create } from 'zustand';

const MAX_ENTRIES = 200;

export const DEBUG_CAPTURE_ENABLED = (import.meta.env.VITE_DEV_PAYLOAD_CAPTURE as string | undefined) === 'true';

export type DebugEntryKind =
    | 'chat'
    | 'chat_continuation'
    | 'patch'
    | 'patch_retry'
    | 'patch_continuation'
    | 'classify_intent'
    | 'describe_image'
    | 'embed'
    | 'retrieve'
    | 'web_search'
    | 'title_gen';

export interface DebugEntry {
    id: string;             // request_id (matches usage_logs.request_id)
    parentId?: string;      // parent_request_id (for grouping)
    kind: DebugEntryKind;
    endpoint: string;       // e.g. "https://.../functions/v1/chat-proxy"
    modelId?: string;       // effective model at the time of call
    request: unknown;       // redacted JSON
    response?: unknown;     // redacted JSON (text or parsed)
    status?: number;        // HTTP status
    durationMs?: number;
    timestamp: number;
    error?: string;
}

interface DebugStore {
    entries: DebugEntry[];  // newest first
    push: (entry: DebugEntry) => void;
    update: (id: string, patch: Partial<DebugEntry>) => void;
    getById: (id: string) => DebugEntry | undefined;
    getByParent: (parentId: string) => DebugEntry[];
    clear: () => void;
}

export const useDebugStore = create<DebugStore>((set, get) => ({
    entries: [],
    push: (entry) => {
        if (!DEBUG_CAPTURE_ENABLED) return;
        set((state) => {
            const next = [entry, ...state.entries];
            if (next.length > MAX_ENTRIES) next.length = MAX_ENTRIES;
            return { entries: next };
        });
    },
    update: (id, patch) => {
        if (!DEBUG_CAPTURE_ENABLED) return;
        set((state) => ({
            entries: state.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        }));
    },
    getById: (id) => get().entries.find((e) => e.id === id),
    getByParent: (parentId) => get().entries.filter((e) => e.parentId === parentId),
    clear: () => set({ entries: [] }),
}));

/**
 * Deep-clone a payload and scrub fields that would be huge or sensitive.
 * - Truncates any string longer than 20 000 chars (covers base64 images).
 * - Drops Authorization / apikey headers outright.
 */
export function redactPayload(value: unknown): unknown {
    const seen = new WeakSet<object>();
    const MAX_STR = 20_000;

    const walk = (v: unknown): unknown => {
        if (v === null || v === undefined) return v;
        if (typeof v === 'string') {
            if (v.length > MAX_STR) {
                return v.slice(0, MAX_STR) + `… [truncated ${v.length - MAX_STR} chars]`;
            }
            return v;
        }
        if (typeof v !== 'object') return v;
        if (seen.has(v as object)) return '[circular]';
        seen.add(v as object);

        if (Array.isArray(v)) return v.map(walk);

        const obj = v as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(obj)) {
            const lk = k.toLowerCase();
            if (lk === 'authorization' || lk === 'apikey' || lk === 'api_key') {
                out[k] = '[redacted]';
                continue;
            }
            if (k === 'image_url' && obj[k] && typeof obj[k] === 'object') {
                const img = obj[k] as { url?: unknown };
                out[k] = {
                    ...img,
                    url: typeof img.url === 'string' && img.url.startsWith('data:')
                        ? img.url.slice(0, 64) + `… [base64 ${img.url.length}ch]`
                        : img.url,
                };
                continue;
            }
            out[k] = walk(obj[k]);
        }
        return out;
    };

    try {
        return walk(value);
    } catch {
        return '[unserializable]';
    }
}

/**
 * Convenience helper: capture the start of a call, return a finalizer that
 * fills in the response/duration/status when done. Usage:
 *
 *     const finalize = captureCall({ id, kind, endpoint, request });
 *     const res = await fetch(endpoint, init);
 *     finalize({ response: await res.clone().text(), status: res.status });
 */
export function captureCall(
    start: Omit<DebugEntry, 'timestamp' | 'response' | 'status' | 'durationMs' | 'error'>,
): (end: Partial<Pick<DebugEntry, 'response' | 'status' | 'durationMs' | 'error'>>) => void {
    if (!DEBUG_CAPTURE_ENABLED) return () => {};

    const startedAt = Date.now();
    const entry: DebugEntry = {
        ...start,
        request: redactPayload(start.request),
        timestamp: startedAt,
    };
    useDebugStore.getState().push(entry);

    return (end) => {
        useDebugStore.getState().update(start.id, {
            response: end.response !== undefined ? redactPayload(end.response) : undefined,
            status: end.status,
            durationMs: end.durationMs ?? Date.now() - startedAt,
            error: end.error,
        });
    };
}
