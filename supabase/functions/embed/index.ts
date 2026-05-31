import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { recordUsage, type UsageStatus } from '../_shared/usage.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/embeddings';
// Embedding model — env-driven. Set EMBEDDING_MODEL in Supabase function
// secrets to switch providers without redeploying code.
const EMBED_MODEL = Deno.env.get('EMBEDDING_MODEL') || 'google/gemini-embedding-001';
// Optional per-1M cost (embeddings are input-only; only inputCostPer1M is
// meaningful here).
const EMBED_INPUT_COST_PER_1M = Number(
    Deno.env.get('EMBEDDING_INPUT_COST_PER_1M') ?? '0',
);

const CHUNK_SIZE_CHARS = 4000;  // ~1,000 tokens, safe under 2,048
const CHUNK_OVERLAP_CHARS = 400;

function chunkText(text: string): string[] {
    if (!text || typeof text !== 'string') {
        return [];
    }
    const clean = text.trim();
    if (!clean) {
        return [];
    }
    const chunks: string[] = [];
    let start = 0;
    while (start < clean.length) {
        let end = start + CHUNK_SIZE_CHARS;
        if (end < clean.length) {
            // Try to break at a word boundary (space, newline)
            const breakPoint = clean.lastIndexOf(' ', end);
            if (breakPoint > start + CHUNK_SIZE_CHARS / 2) {
                end = breakPoint;
            }
            const chunk = clean.slice(start, end).trim();
            if (chunk) chunks.push(chunk);
            const nextStart = end - CHUNK_OVERLAP_CHARS;
            // Ensure progress is always made
            if (nextStart <= start) {
                start = start + CHUNK_SIZE_CHARS - CHUNK_OVERLAP_CHARS;
            } else {
                start = nextStart;
            }
        } else {
            const chunk = clean.slice(start).trim();
            if (chunk) chunks.push(chunk);
            break;
        }
    }
    return chunks;
}

async function embedTexts(texts: string[], apiKey: string): Promise<{ embeddings: number[][]; promptTokens: number }> {
    const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: EMBED_MODEL,
            input: texts,
            dimensions: 768,
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Embedding API failed: ${response.status} ${err}`);
    }

    const data = await response.json();
    const embeddings = data.data.map((d: Record<string, unknown>) => d.embedding as number[]);
    const promptTokens = Number(data?.usage?.prompt_tokens) || 0;
    return { embeddings, promptTokens };
}

Deno.serve(async (req: Request) => {
    const cors = getCorsHeaders(req);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

    // Validate incoming payload at the very top of request handler.
    // If required fields are missing or empty, return 200 skipped.
    let text = '';
    let file_name = '';
    let message_id = '';
    let conversation_id = '';
    let request_id = '';
    let parent_request_id = '';
    let parsedBody: any = null;

    try {
        parsedBody = await req.clone().json();
        text = parsedBody?.text;
        file_name = parsedBody?.file_name;
        message_id = parsedBody?.message_id;
        conversation_id = parsedBody?.conversation_id;
        request_id = parsedBody?.request_id;
        parent_request_id = parsedBody?.parent_request_id;
    } catch {
        // Silent catch
    }

    if (!text || typeof text !== 'string' || !text.trim() || !file_name || !message_id || !conversation_id) {
        return new Response(
            JSON.stringify({ success: true, skipped: true }),
            { headers: { ...cors, 'Content-Type': 'application/json' } }
        );
    }

    const startedAt = Date.now();
    const accounting = {
        finalized: false,
        userId: null as string | null,
        conversationId: null as string | null,
        messageId: null as string | null,
        requestId: null as string | null,
        parentRequestId: null as string | null,
        status: 'completed' as UsageStatus,
        statusReason: null as string | null,
        errorMessage: null as string | null,
        promptTokens: 0,
    };

    const logAndReturn = async (
        resp: Response,
        status: UsageStatus,
        statusReason: string | null = null,
        errorMessage: string | null = null,
    ): Promise<Response> => {
        if (accounting.finalized) return resp;
        accounting.finalized = true;
        accounting.status = status;
        accounting.statusReason = statusReason;
        accounting.errorMessage = errorMessage;
        await recordUsage({
            userId: accounting.userId ?? 'unknown',
            conversationId: accounting.conversationId,
            messageId: accounting.messageId,
            requestId: accounting.requestId,
            parentRequestId: accounting.parentRequestId,
            callKind: 'embed',
            status,
            statusReason,
            errorMessage,
            modelId: EMBED_MODEL,
            durationMs: Date.now() - startedAt,
            promptTokens: accounting.promptTokens,
            inputCostPer1M: EMBED_INPUT_COST_PER_1M,
        });
        return resp;
    };

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader || typeof authHeader !== 'string') {
            return await logAndReturn(
                new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }),
                'auth_error',
                null,
                'Missing Authorization header',
            );
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const openrouterApiKey = Deno.env.get('OPENROUTER_API_KEY')!;

        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        let userId = '';
        try {
            const parts = token.split('.');
            if (parts.length < 2) {
                throw new Error('Malformed token');
            }
            const base64 = parts[1];
            if (!base64 || typeof base64 !== 'string') {
                throw new Error('Malformed base64 part');
            }
            const claims = JSON.parse(atob(base64.replace(/-/g, '+').replace(/_/g, '/')));
            userId = claims.sub as string;
        } catch {
            return await logAndReturn(
                new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }),
                'auth_error',
                null,
                'Malformed JWT',
            );
        }
        if (!userId) {
            return await logAndReturn(
                new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }),
                'auth_error',
            );
        }
        accounting.userId = userId;

        const body = parsedBody || await req.json().catch(() => ({}));
        const { text: _t, file_name: _fn, message_id: _mi, conversation_id: _ci, request_id: _ri, parent_request_id: _pri } = body ?? {};

        if (typeof conversation_id === 'string') accounting.conversationId = conversation_id;
        if (typeof message_id === 'string') accounting.messageId = message_id;
        if (typeof request_id === 'string') accounting.requestId = request_id;
        if (typeof parent_request_id === 'string') accounting.parentRequestId = parent_request_id;

        if (!text || !file_name || !message_id || !conversation_id) {
            return await logAndReturn(
                new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }),
                'client_error',
                null,
                'Missing required fields',
            );
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        // Delete existing chunks for this file in this message (idempotent)
        await supabaseAdmin
            .from('document_chunks')
            .delete()
            .eq('message_id', message_id)
            .eq('file_name', file_name);

        // Chunk the text with a backend length cap
        const MAX_INPUT_CHARS = 40000;
        const safeText = text.slice(0, MAX_INPUT_CHARS);
        const chunks = chunkText(safeText);
        const safeChunks = chunks.filter(c => c.length <= 5000);

        if (safeChunks.length === 0) {
            return await logAndReturn(
                new Response(JSON.stringify({ success: true, chunks: 0 }), { headers: { ...cors, 'Content-Type': 'application/json' } }),
                'completed',
                'no_chunks',
            );
        }

        // Embed in batches of 5 (down from 20) for token ceiling safety
        const BATCH_SIZE = 5;
        const allRows: any[] = [];
        let totalPromptTokens = 0;
        let successCount = 0;
        let embedErrorOccurred = false;

        for (let i = 0; i < safeChunks.length; i += BATCH_SIZE) {
            const batch = safeChunks.slice(i, i + BATCH_SIZE);
            try {
                const { embeddings, promptTokens } = await embedTexts(batch, openrouterApiKey);
                totalPromptTokens += promptTokens;

                // Build rows dynamically for successfully embedded chunks
                batch.forEach((content, index) => {
                    allRows.push({
                        user_id: userId,
                        conversation_id,
                        message_id,
                        file_name,
                        chunk_index: successCount + index,
                        content,
                        token_estimate: Math.ceil(content.length / 4),
                        embedding: JSON.stringify(embeddings[index]),
                    });
                });
                successCount += batch.length;
            } catch (err) {
                console.error(`[embed] batch starting at index ${i} failed to embed:`, err);
                embedErrorOccurred = true;
            }
        }
        accounting.promptTokens = totalPromptTokens;

        if (allRows.length > 0) {
            const { error: insertError } = await supabaseAdmin
                .from('document_chunks')
                .insert(allRows);

            if (insertError) throw insertError;
        }

        if (embedErrorOccurred) {
            return await logAndReturn(
                new Response(
                    JSON.stringify({
                        success: true,
                        partial: true,
                        chunksEmbedded: successCount,
                        error: 'Some chunks could not be embedded'
                    }),
                    { headers: { ...cors, 'Content-Type': 'application/json' } }
                ),
                'completed',
                `partial_success=${successCount}`,
            );
        }

        return await logAndReturn(
            new Response(JSON.stringify({ success: true, chunks: safeChunks.length }), {
                headers: { ...cors, 'Content-Type': 'application/json' },
            }),
            'completed',
            `chunks=${safeChunks.length}`,
        );

    } catch (err) {
        console.error('[embed] error:', err);
        return await logAndReturn(
            new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }),
            'upstream_error',
            null,
            err instanceof Error ? err.message : String(err),
        );
    }
});
