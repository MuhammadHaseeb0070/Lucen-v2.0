// ============================================
// Supabase Edge Function: chat-proxy
// ============================================
// Secure proxy for OpenRouter API calls.
// - Validates user JWT
// - Checks credit balance server-side
// - Streams OpenRouter response back to client
// - Deducts credits on completion
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Allowed models to prevent abuse (client cannot force expensive models)
const ALLOWED_MODELS = [
    'deepseek/deepseek-v3.2',
    'deepseek/deepseek-r1',
    'x-ai/grok-4.1-fast',
    'anthropic/claude-sonnet-4',
    'openai/gpt-4o-mini',
];
const DEFAULT_MODEL = 'deepseek/deepseek-v3.2';

Deno.serve(async (req: Request) => {
    const cors = getCorsHeaders(req);
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: cors });
    }

    try {
        // ─── Auth: Extract and verify JWT ───
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Missing Authorization header' }),
                { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
        const openrouterApiKey = Deno.env.get('OPENROUTER_API_KEY');

        if (!openrouterApiKey) {
            return new Response(
                JSON.stringify({ error: 'OpenRouter API key not configured on server' }),
                { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (!token || token.split('.').length !== 3) {
            return new Response(
                JSON.stringify({ error: 'Invalid token format' }),
                { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        const supabaseUser = createClient(supabaseUrl, supabaseAnonKey);
        const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);
        
        if (authError || !user) {
            console.error('[Auth Error] Supabase user verification failed:', authError?.message || 'No user found');
            return new Response(
                JSON.stringify({ 
                    error: 'Authentication failed: Invalid or expired token',
                    details: authError?.message 
                }),
                { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        console.log(`[Auth Success] User authenticated: ${user.id} (${user.email})`);


        // ─── Credit Check (service role to bypass RLS) ───
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        const { data: balance } = await supabaseAdmin.rpc('ensure_user_credits', {
            p_user_id: user.id,
            p_initial_credits: 100,
        });

        if (typeof balance === 'number' && balance <= 0) {
            return new Response(
                JSON.stringify({ error: 'Insufficient credits' }),
                { status: 402, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        // ─── Parse request body ───
        const { messages, model, max_tokens, is_reasoning } = await req.json();

        if (!messages || !Array.isArray(messages)) {
            return new Response(
                JSON.stringify({ error: 'Invalid request: messages array required' }),
                { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        const modelToUse = (model && ALLOWED_MODELS.includes(model)) ? model : DEFAULT_MODEL;

        // ─── Forward to OpenRouter (streaming) ───
        const openrouterResponse = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openrouterApiKey}`,
                'HTTP-Referer': supabaseUrl,
                'X-Title': 'Lucen',
            },
            body: JSON.stringify({
                model: modelToUse,
                messages,
                stream: true,
                max_tokens: max_tokens || 16384,
                include_usage: true, // CRITICAL: Ask OpenRouter for exact token usage
                plugins: []
            }),
        });

        if (!openrouterResponse.ok) {
            const errBody = await openrouterResponse.text();
            console.error(`[OpenRouter Error] Status: ${openrouterResponse.status}, Body:`, errBody);
            
            // Differentiate between 401 from OpenRouter vs 401 from Supabase
            const statusCode = openrouterResponse.status;
            return new Response(
                JSON.stringify({ 
                    error: `OpenRouter API Error ${statusCode}`,
                    details: errBody,
                    source: 'OpenRouter'
                }),
                { status: statusCode, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        // ─── Stream response back to client ───
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const reader = openrouterResponse.body!.getReader();
        const decoder = new TextDecoder();

        let promptTokens = 0;
        let completionTokens = 0;

        // Process the stream in the background
        (async () => {
            try {
                let buffer = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    // Write original chunk to client
                    await writer.write(value);

                    // Decode to look for usage metrics
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || !trimmed.startsWith('data: ')) continue;

                        const dataMsg = trimmed.slice(6);
                        if (dataMsg === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(dataMsg);
                            if (parsed.usage) {
                                promptTokens = parsed.usage.prompt_tokens || 0;
                                completionTokens = parsed.usage.completion_tokens || 0;
                            }
                        } catch {
                            // ignore partial JSON
                        }
                    }
                }
            } catch (e) {
                console.error('Stream error:', e);
            } finally {
                await writer.close();

                const COST_PER_MILLION = 500;
                const totalTokens = promptTokens + completionTokens;
                const exactCost = (totalTokens / 1_000_000) * COST_PER_MILLION;
                const creditCost = Math.max(0.0001, exactCost);

                try {
                    await supabaseAdmin.rpc('deduct_user_credits', {
                        p_user_id: user.id,
                        p_amount: creditCost,
                    });

                    await supabaseAdmin.from('usage_logs').insert({
                        user_id: user.id,
                        prompt_tokens: promptTokens,
                        completion_tokens: completionTokens,
                        reasoning_tokens: is_reasoning ? completionTokens : 0,
                        total_credits_deducted: creditCost,
                    });

                    console.log(`Deducted ${creditCost.toFixed(4)} credits for ${totalTokens} tokens (User: ${user.id})`);
                } catch (dbErr) {
                    console.error('Failed to deduct credits or log usage:', dbErr);
                }
            }
        })();

        return new Response(readable, {
            headers: {
                ...cors,
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    } catch (err) {
        console.error('chat-proxy error:', err);
        return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
            { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
    }
});
