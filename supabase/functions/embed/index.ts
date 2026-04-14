import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/embeddings';
const EMBED_MODEL = 'google/gemini-embedding-001';
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

async function embedTexts(texts: string[], apiKey: string): Promise<number[][]> {
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
    return data.data.map((d: Record<string, unknown>) => d.embedding as number[]);
}

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
        if (!userId) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });

        const { text, file_name, message_id, conversation_id } = await req.json();

        if (!text || !file_name || !message_id || !conversation_id) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
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
            return new Response(JSON.stringify({ success: true, chunks: 0 }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        // Embed in batches of 20
        const BATCH_SIZE = 20;
        const allEmbeddings: number[][] = [];
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            const embeddings = await embedTexts(batch, openrouterApiKey);
            allEmbeddings.push(...embeddings);
        }

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

        return new Response(JSON.stringify({ success: true, chunks: chunks.length }), {
            headers: { ...cors, 'Content-Type': 'application/json' }
        });

    } catch (err) {
        console.error('[embed] error:', err);
        return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
});
