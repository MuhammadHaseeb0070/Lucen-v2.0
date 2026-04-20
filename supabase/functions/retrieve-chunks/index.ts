import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/embeddings';
// Embedding model — env-driven. Must match EMBEDDING_MODEL used by the
// `embed` function so queries and chunks live in the same vector space.
const EMBED_MODEL = Deno.env.get('EMBEDDING_MODEL') || 'google/gemini-embedding-001';

Deno.serve(async (req: Request) => {
    const cors = getCorsHeaders(req);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const openrouterApiKey = Deno.env.get('OPENROUTER_API_KEY')!;

        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        const base64 = token.split('.')[1];
        const claims = JSON.parse(atob(base64.replace(/-/g, '+').replace(/_/g, '/')));
        const userId = claims.sub as string;

        const { query, conversation_id, top_k = 5 } = await req.json();

        if (!query || !conversation_id) {
            return new Response(JSON.stringify({ error: 'Missing query or conversation_id' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
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

        if (!embedResponse.ok) throw new Error(`Embedding failed: ${embedResponse.status}`);
        const embedData = await embedResponse.json();
        const queryEmbedding = embedData.data[0].embedding;

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        // Vector similarity search
        const { data: chunks, error } = await supabaseAdmin.rpc('match_document_chunks', {
            p_query_embedding: queryEmbedding,
            p_conversation_id: conversation_id,
            p_user_id: userId,
            p_top_k: top_k,
        });

        if (error) throw error;

        return new Response(JSON.stringify({ chunks: chunks || [] }), {
            headers: { ...cors, 'Content-Type': 'application/json' }
        });

    } catch (err) {
        console.error('[retrieve-chunks] error:', err);
        return new Response(JSON.stringify({ error: String(err), chunks: [] }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
});
