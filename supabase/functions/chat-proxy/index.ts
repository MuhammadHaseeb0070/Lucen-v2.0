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
import { corsHeaders } from '../_shared/cors.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

Deno.serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // ─── Auth: Extract and verify JWT ───
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Missing Authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
        const openrouterApiKey = Deno.env.get('OPENROUTER_API_KEY');

        if (!openrouterApiKey) {
            return new Response(
                JSON.stringify({ error: 'OpenRouter API key not configured on server' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Create a client with the Service Role key to verify identity reliably
        // (Sometimes anon-key-based clients have issues with JWT verification in Edge Functions)
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        
        // Extract the token itself (remove "Bearer " prefix)
        const token = authHeader.replace('Bearer ', '');
        
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        
        if (authError || !user) {
            console.error('[Auth Error] Supabase user verification failed:', authError?.message || 'No user found');
            return new Response(
                JSON.stringify({ 
                    error: 'Authentication failed: Invalid or expired token',
                    details: authError?.message 
                }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        console.log(`[Auth Success] User authenticated: ${user.id} (${user.email})`);


        // ─── Credit Check ───

        const { data: creditRow, error: creditError } = await supabaseAdmin
            .from('user_credits')
            .select('remaining_credits')
            .eq('user_id', user.id)
            .single();

        if (creditError && creditError.code === 'PGRST116') {
            // No credit row yet — create one with default credits
            await supabaseAdmin.from('user_credits').insert({
                user_id: user.id,
                remaining_credits: 100,
                total_used: 0,
            });
        } else if (creditRow && creditRow.remaining_credits <= 0) {
            return new Response(
                JSON.stringify({ error: 'Insufficient credits' }),
                { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // ─── Parse request body ───
        const { messages, model, max_tokens, is_reasoning } = await req.json();

        if (!messages || !Array.isArray(messages)) {
            return new Response(
                JSON.stringify({ error: 'Invalid request: messages array required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

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
                model: model || 'x-ai/grok-4.1-fast',
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
                { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // ─── Stream response back to client ───
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const reader = openrouterResponse.body!.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();

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

                // ─── Deduct Exact Credits & Log Usage ───
                // Using exactly $0.50 per 1M tokens -> 500 credits per 1M tokens.
                const COST_PER_MILLION = 500;
                const totalTokens = promptTokens + completionTokens;
                const exactCost = (totalTokens / 1_000_000) * COST_PER_MILLION;

                // Ensure cost is at least 0.0001 to prevent absolute zero
                const creditCost = Math.max(0.0001, exactCost);

                try {
                    // 1. Deduct Credits
                    await supabaseAdmin
                        .from('user_credits')
                        .update({
                            remaining_credits: (creditRow?.remaining_credits || 100) - creditCost,
                            total_used: (creditRow?.total_used || 0) + creditCost,
                            updated_at: new Date().toISOString()
                        })
                        .eq('user_id', user.id);

                    // 2. Log exact usage for dashboard
                    const reqMessages = messages as any[];
                    // Extract conversation_id if passed in future, for now log basic info
                    const lastMsgId = reqMessages[reqMessages.length - 1]?.id || null;

                    await supabaseAdmin.from('usage_logs').insert({
                        user_id: user.id,
                        message_id: lastMsgId,
                        prompt_tokens: promptTokens,
                        completion_tokens: completionTokens,
                        reasoning_tokens: is_reasoning ? completionTokens : 0,
                        total_credits_deducted: creditCost,
                    });

                    console.log(`Deducted ${creditCost.toFixed(4)} credits for ${totalTokens} tokens (User: ${user.id})`);
                } catch (dbErr) {
                    console.error('Failed to deduct exact credits or log usage:', dbErr);
                }
            }
        })();

        return new Response(readable, {
            headers: {
                ...corsHeaders,
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    } catch (err) {
        console.error('chat-proxy error:', err);
        return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
