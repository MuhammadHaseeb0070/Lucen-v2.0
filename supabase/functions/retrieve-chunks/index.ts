import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { recordUsage, type UsageStatus } from '../_shared/usage.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/embeddings';
// Embedding model — env-driven. Must match EMBEDDING_MODEL used by the
// `embed` function so queries and chunks live in the same vector space.
const EMBED_MODEL = Deno.env.get('EMBEDDING_MODEL') || 'google/gemini-embedding-001';
const EMBED_INPUT_COST_PER_1M = Number(
    Deno.env.get('EMBEDDING_INPUT_COST_PER_1M') ?? '0',
);

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
        await recordUsage({
            userId: accounting.userId ?? 'unknown',
            conversationId: accounting.conversationId,
            messageId: accounting.messageId,
            requestId: accounting.requestId,
            parentRequestId: accounting.parentRequestId,
            callKind: 'retrieve',
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
        accounting.userId = userId;

        const body = await req.json();
        const { query, conversation_id, top_k = 5, message_id, request_id, parent_request_id } = body ?? {};

        if (typeof conversation_id === 'string') accounting.conversationId = conversation_id;
        if (typeof message_id === 'string') accounting.messageId = message_id;
        if (typeof request_id === 'string') accounting.requestId = request_id;
        if (typeof parent_request_id === 'string') accounting.parentRequestId = parent_request_id;

        if (!query || !conversation_id) {
            return await logAndReturn(
                new Response(JSON.stringify({ error: 'Missing query or conversation_id' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }),
                'client_error',
                null,
                'Missing query or conversation_id',
            );
        }

        // Embed the query
        const embedResponse = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openrouterApiKey}`,
            },
            body: JSON.stringify({ model: EMBED_MODEL, input: [query] }),
        });

        if (!embedResponse.ok) {
            const errBody = await embedResponse.text().catch(() => '');
            return await logAndReturn(
                new Response(JSON.stringify({ error: `Embedding failed: ${embedResponse.status}`, chunks: [] }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }),
                'upstream_error',
                `HTTP ${embedResponse.status}`,
                errBody.slice(0, 500),
            );
        }
        const embedData = await embedResponse.json();
        const queryEmbedding = embedData.data[0].embedding;
        accounting.promptTokens = Number(embedData?.usage?.prompt_tokens) || 0;

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        // Vector similarity search
        const { data: chunks, error } = await supabaseAdmin.rpc('match_document_chunks', {
            p_query_embedding: queryEmbedding,
            p_conversation_id: conversation_id,
            p_user_id: userId,
            p_top_k: top_k,
        });

        if (error) throw error;

        return await logAndReturn(
            new Response(JSON.stringify({ chunks: chunks || [] }), {
                headers: { ...cors, 'Content-Type': 'application/json' },
            }),
            'completed',
            `top_k=${top_k}`,
        );

    } catch (err) {
        console.error('[retrieve-chunks] error:', err);
        return await logAndReturn(
            new Response(JSON.stringify({ error: String(err), chunks: [] }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }),
            'upstream_error',
            null,
            err instanceof Error ? err.message : String(err),
        );
    }
});
