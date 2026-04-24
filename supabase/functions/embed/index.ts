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

const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 50;

function chunkText(text: string): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const chunks: string[] = [];
    let i = 0;
    while (i < words.length) {
        const chunk = words.slice(i, i + CHUNK_SIZE).join(' ');
        if (chunk.trim()) chunks.push(chunk.trim());
        i += CHUNK_SIZE - CHUNK_OVERLAP;
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
        if (!authHeader) {
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
            const base64 = token.split('.')[1];
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

        const body = await req.json();
        const { text, file_name, message_id, conversation_id, request_id, parent_request_id } = body ?? {};

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

        // Chunk the text
        const chunks = chunkText(text);
        if (chunks.length === 0) {
            return await logAndReturn(
                new Response(JSON.stringify({ success: true, chunks: 0 }), { headers: { ...cors, 'Content-Type': 'application/json' } }),
                'completed',
                'no_chunks',
            );
        }

        // Embed in batches of 20
        const BATCH_SIZE = 20;
        const allEmbeddings: number[][] = [];
        let totalPromptTokens = 0;
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            const { embeddings, promptTokens } = await embedTexts(batch, openrouterApiKey);
            allEmbeddings.push(...embeddings);
            totalPromptTokens += promptTokens;
        }
        accounting.promptTokens = totalPromptTokens;

        // Store chunks with embeddings
        const rows = chunks.map((content, index) => ({
            user_id: userId,
            conversation_id,
            message_id,
            file_name,
            chunk_index: index,
            content,
            token_estimate: Math.ceil(content.length / 4),
            embedding: JSON.stringify(allEmbeddings[index]),
        }));

        const { error: insertError } = await supabaseAdmin
            .from('document_chunks')
            .insert(rows);

        if (insertError) throw insertError;

        return await logAndReturn(
            new Response(JSON.stringify({ success: true, chunks: chunks.length }), {
                headers: { ...cors, 'Content-Type': 'application/json' },
            }),
            'completed',
            `chunks=${chunks.length}`,
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
