import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function decodeJwtPayload(token: string): Record<string, unknown> {
    const base64 = token.split('.')[1];
    const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
}

function getReasoningTokens(usage: Record<string, unknown> | undefined): number {
    if (!usage || typeof usage !== 'object') return 0;
    const details = usage.completion_tokens_details as Record<string, unknown> | undefined;
    const value = details?.reasoning_tokens;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

Deno.serve(async (req: Request) => {
    const cors = getCorsHeaders(req);
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: cors });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Missing Authorization header' }),
                { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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

        // Decode JWT and verify claims
        let claims: Record<string, unknown>;
        try {
            claims = decodeJwtPayload(token);
        } catch {
            return new Response(
                JSON.stringify({ error: 'Malformed JWT' }),
                { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        const userId = claims.sub as string;
        const expiry = claims.exp as number;
        if (!userId) {
            return new Response(
                JSON.stringify({ error: 'JWT missing sub claim' }),
                { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }
        if (expiry && expiry < Math.floor(Date.now() / 1000)) {
            return new Response(
                JSON.stringify({ error: 'Token expired' }),
                { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        // Verify user exists via admin API (bypasses the broken getUser(token) flow)
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const { data: adminUser, error: adminError } = await supabaseAdmin.auth.admin.getUserById(userId);

        if (adminError || !adminUser?.user) {
            return new Response(
                JSON.stringify({ error: 'User not found', user_id: userId }),
                { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        const user = adminUser.user;
        console.log(`[Auth OK] ${user.id} (${user.email})`);

        // ─── Credit Check ───
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
        const { messages, model, max_tokens, is_reasoning, stream } = await req.json();

        if (!messages || !Array.isArray(messages)) {
            return new Response(
                JSON.stringify({ error: 'Invalid request: messages array required' }),
                { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        if (!model || typeof model !== 'string') {
            return new Response(
                JSON.stringify({ error: 'model is required' }),
                { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        // ─── Server-side token cap ───
        // Never trust the client value blindly. Cap at a safe server maximum.
        // The client computes a dynamic budget based on actual input size;
        // here we simply enforce an upper bound to prevent abuse.
        const SERVER_MAX_TOKENS_CAP = 32768;
        const resolvedMaxTokens = Math.min(
            Math.max(512, Number(max_tokens) || 16384),
            SERVER_MAX_TOKENS_CAP
        );

        const shouldStream = stream !== false;

        const openrouterResponse = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openrouterApiKey}`,
                'HTTP-Referer': supabaseUrl,
                'X-Title': 'Lucen',
            },
            body: JSON.stringify({
                model,
                messages,
                stream: shouldStream,
                max_tokens: resolvedMaxTokens,
                include_usage: true,
                ...(is_reasoning ? { reasoning: { enabled: true } } : {}),
            }),
        });

        if (!openrouterResponse.ok) {
            const errBody = await openrouterResponse.text();
            console.error(`[OpenRouter Error] ${openrouterResponse.status}:`, errBody);
            return new Response(
                JSON.stringify({ error: `OpenRouter API Error ${openrouterResponse.status}`, details: errBody }),
                { status: openrouterResponse.status, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        // ─── Non-stream mode: return JSON (for reliable reasoning_details) ───
        if (!shouldStream) {
            const json = await openrouterResponse.json();
            const usage = json?.usage || {};
            const promptTokens = usage?.prompt_tokens || 0;
            const completionTokens = usage?.completion_tokens || 0;
            const reasoningTokens = getReasoningTokens(usage);

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
                    reasoning_tokens: reasoningTokens,
                    total_credits_deducted: creditCost,
                });
            } catch (dbErr) {
                console.error('Failed to deduct credits or log usage:', dbErr);
            }

            return new Response(JSON.stringify(json), {
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        // ─── Stream response back to client ───
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const reader = openrouterResponse.body!.getReader();
        const decoder = new TextDecoder();

        let promptTokens = 0;
        let completionTokens = 0;
        let reasoningTokens = 0;

        (async () => {
            try {
                let buffer = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    await writer.write(value);

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
                                reasoningTokens = getReasoningTokens(parsed.usage as Record<string, unknown>);
                            }
                        } catch { /* ignore partial JSON */ }
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
                        reasoning_tokens: reasoningTokens,
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
