import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const WEB_PLUGIN_ID = 'web';
const FREE_TIER_MAX_SEARCHES = 3;
const CREDITS_PER_1K_TOKENS = 1;
const CREDITS_PER_IMAGE = 2;

// Cost basis:
// - Exa web plugin costs $4 / 1000 results (OpenRouter official docs)
// - LucenCredits exchange: based on Regular plan ($10 → 4000 LC) ⇒ 400 LC / $1
const LC_PER_USD = 400;
const WEBSEARCH_USD_PER_1K_RESULTS = 4;

const WEBSEARCH_DEFAULT_ENGINE = 'exa';
const WEBSEARCH_DEFAULT_MAX_RESULTS = 5;
const WEBSEARCH_MAX_RESULTS_CAP = 5;

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

function countImagesInMessages(messages: unknown): number {
    if (!Array.isArray(messages)) return 0;
    let count = 0;
    for (const msg of messages) {
        if (!msg || typeof msg !== 'object') continue;
        const content = (msg as Record<string, unknown>).content;
        if (!Array.isArray(content)) continue;
        for (const part of content) {
            if (!part || typeof part !== 'object') continue;
            const p = part as Record<string, unknown>;
            if (p.type === 'image_url' && p.image_url && typeof p.image_url === 'object') {
                const img = p.image_url as Record<string, unknown>;
                if (typeof img.url === 'string' && img.url) count += 1;
            }
        }
    }
    return count;
}

function forceImageDetailLow(messages: unknown): void {
    if (!Array.isArray(messages)) return;
    for (const msg of messages) {
        if (!msg || typeof msg !== 'object') continue;
        const content = (msg as Record<string, unknown>).content;
        if (!Array.isArray(content)) continue;
        for (const part of content) {
            if (!part || typeof part !== 'object') continue;
            const p = part as Record<string, unknown>;
            if (p.type === 'image_url' && p.image_url && typeof p.image_url === 'object') {
                const img = p.image_url as Record<string, unknown>;
                img.detail = 'low';
            }
        }
    }
}

function hasWebPlugin(plugins: unknown): boolean {
    if (!Array.isArray(plugins)) return false;
    return plugins.some((p) => p && typeof p === 'object' && (p as Record<string, unknown>).id === WEB_PLUGIN_ID);
}

function sanitizeDomainList(value: unknown, maxItems: number): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out: string[] = [];
    for (const item of value) {
        if (typeof item !== 'string') continue;
        const trimmed = item.trim();
        if (!trimmed) continue;
        out.push(trimmed);
        if (out.length >= maxItems) break;
    }
    return out.length > 0 ? out : undefined;
}

function sanitizeWebPlugins(plugins: unknown): Array<Record<string, unknown>> | undefined {
    if (!Array.isArray(plugins)) return undefined;
    const raw = plugins.find((p) => p && typeof p === 'object' && (p as Record<string, unknown>).id === WEB_PLUGIN_ID) as Record<string, unknown> | undefined;
    if (!raw) return undefined;

    const maxResultsRaw = raw.max_results;
    const maxResultsNum = typeof maxResultsRaw === 'number' && Number.isFinite(maxResultsRaw)
        ? Math.floor(maxResultsRaw)
        : WEBSEARCH_DEFAULT_MAX_RESULTS;
    const max_results = Math.min(Math.max(1, maxResultsNum), WEBSEARCH_MAX_RESULTS_CAP);

    // Keep accounting deterministic by forcing Exa unless you explicitly want otherwise.
    const engine = WEBSEARCH_DEFAULT_ENGINE;

    const include_domains = sanitizeDomainList(raw.include_domains, 10);
    const exclude_domains = sanitizeDomainList(raw.exclude_domains, 10);

    const plugin: Record<string, unknown> = { id: WEB_PLUGIN_ID, engine, max_results };
    if (include_domains) plugin.include_domains = include_domains;
    if (exclude_domains) plugin.exclude_domains = exclude_domains;

    return [plugin];
}

function computeWebSearchCredits(maxResults: number): number {
    // $4 / 1000 results, then converted to LC via LC_PER_USD
    const usd = (Math.max(0, maxResults) / 1000) * WEBSEARCH_USD_PER_1K_RESULTS;
    return usd * LC_PER_USD;
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

        // ─── Parse request body ───
        const { messages, model, max_tokens, is_reasoning, stream, plugins } = await req.json();

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

        const imageCount = countImagesInMessages(messages);
        const requestedWebSearch = hasWebPlugin(plugins);
        const sanitizedWebPlugins = requestedWebSearch ? sanitizeWebPlugins(plugins) : undefined;
        const webSearchMaxResults =
            (sanitizedWebPlugins && sanitizedWebPlugins[0] && typeof sanitizedWebPlugins[0].max_results === 'number')
                ? (sanitizedWebPlugins[0].max_results as number)
                : (requestedWebSearch ? WEBSEARCH_DEFAULT_MAX_RESULTS : 0);
        const webSearchEngine =
            (sanitizedWebPlugins && sanitizedWebPlugins[0] && typeof sanitizedWebPlugins[0].engine === 'string')
                ? (sanitizedWebPlugins[0].engine as string)
                : (requestedWebSearch ? WEBSEARCH_DEFAULT_ENGINE : '');

        let effectiveModel = model as string;
        if (requestedWebSearch) {
            const onlineModel = Deno.env.get('OPENROUTER_ONLINE_MODEL');
            if (!onlineModel) {
                return new Response(
                    JSON.stringify({ error: 'Server not configured for web search (missing OPENROUTER_ONLINE_MODEL)' }),
                    { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
                );
            }
            effectiveModel = onlineModel;
        }

        // ─── Pre-flight: fetch subscription + balance before OpenRouter ───
        await supabaseAdmin.rpc('ensure_user_credits', {
            p_user_id: user.id,
            p_initial_credits: 100,
        });

        const { data: creditsRow, error: creditsErr } = await supabaseAdmin
            .from('user_credits')
            .select('remaining_credits, subscription_status, free_searches_used')
            .eq('user_id', user.id)
            .single();

        if (creditsErr || !creditsRow) {
            return new Response(
                JSON.stringify({ error: 'Failed to load user credits' }),
                { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        const subscriptionStatus = (creditsRow.subscription_status || 'free') as string;
        const remainingCredits = typeof creditsRow.remaining_credits === 'number' ? creditsRow.remaining_credits : 0;
        const freeSearchesUsed = typeof (creditsRow as Record<string, unknown>).free_searches_used === 'number'
            ? ((creditsRow as Record<string, unknown>).free_searches_used as number)
            : 0;

        if (remainingCredits <= 0) {
            return new Response(
                JSON.stringify({ error: 'Insufficient credits' }),
                { status: 402, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        // ─── Tier 0 (free) constraints ───
        const effectivePlugins: unknown = sanitizedWebPlugins;
        if (subscriptionStatus === 'free') {
            // Vision override: force all images to low detail.
            forceImageDetailLow(messages);

            // Web search limit enforcement.
            if (requestedWebSearch && freeSearchesUsed >= FREE_TIER_MAX_SEARCHES) {
                // Soft error asking for upgrade (do not call OpenRouter).
                return new Response(
                    JSON.stringify({
                        error: 'Free tier web search limit reached. Upgrade to Regular or Pro for unlimited web search.',
                        code: 'FREE_SEARCH_LIMIT_REACHED',
                    }),
                    { status: 402, headers: { ...cors, 'Content-Type': 'application/json' } }
                );
            }
        }

        // If we want to silently strip the plugin instead of blocking:
        // effectivePlugins = subscriptionStatus === 'free' ? stripWebPlugin(effectivePlugins) : effectivePlugins;

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
                model: effectiveModel,
                messages,
                ...(effectivePlugins ? { plugins: effectivePlugins } : {}),
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

        // ─── Non-stream mode ───
        if (!shouldStream) {
            const json = await openrouterResponse.json();
            const usage = json?.usage || {};
            const promptTokens = usage?.prompt_tokens || 0;
            const completionTokens = usage?.completion_tokens || 0;
            const reasoningTokens = getReasoningTokens(usage);
            const totalTokens = usage?.total_tokens ?? (promptTokens + completionTokens);
            const totalTokensNum = typeof totalTokens === 'number' && Number.isFinite(totalTokens) ? totalTokens : (promptTokens + completionTokens);

            const textCost = (totalTokensNum / 1000) * CREDITS_PER_1K_TOKENS;
            const imageCost = imageCount * CREDITS_PER_IMAGE;
            const searchCost = requestedWebSearch ? computeWebSearchCredits(webSearchMaxResults) : 0;
            const totalCost = textCost + imageCost + searchCost;

            try {
                await supabaseAdmin.rpc('deduct_user_credits', {
                    p_user_id: user.id,
                    p_amount: totalCost,
                });

                if (subscriptionStatus === 'free' && requestedWebSearch) {
                    await supabaseAdmin
                        .from('user_credits')
                        .update({ free_searches_used: freeSearchesUsed + 1 })
                        .eq('user_id', user.id);
                }

                await supabaseAdmin.from('usage_logs').insert({
                    user_id: user.id,
                    prompt_tokens: promptTokens,
                    completion_tokens: completionTokens,
                    reasoning_tokens: reasoningTokens,
                    total_credits_deducted: totalCost,
                    model_id: effectiveModel,
                    web_search_enabled: requestedWebSearch,
                    web_search_engine: requestedWebSearch ? webSearchEngine : null,
                    web_search_max_results: requestedWebSearch ? webSearchMaxResults : null,
                    web_search_results_billed: requestedWebSearch ? webSearchMaxResults : null,
                    text_credits: textCost,
                    image_credits: imageCost,
                    web_search_credits: searchCost,
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
        let totalTokens = 0;

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
                                totalTokens = parsed.usage.total_tokens || (promptTokens + completionTokens);
                            }
                        } catch { /* ignore partial JSON */ }
                    }
                }
            } catch (e) {
                console.error('Stream error:', e);
            } finally {
                await writer.close();

                const totalTokensNum = typeof totalTokens === 'number' && Number.isFinite(totalTokens) && totalTokens > 0
                    ? totalTokens
                    : (promptTokens + completionTokens);

                const textCost = (totalTokensNum / 1000) * CREDITS_PER_1K_TOKENS;
                const imageCost = imageCount * CREDITS_PER_IMAGE;
                const searchCost = requestedWebSearch ? computeWebSearchCredits(webSearchMaxResults) : 0;
                const totalCost = textCost + imageCost + searchCost;

                try {
                    await supabaseAdmin.rpc('deduct_user_credits', {
                        p_user_id: user.id,
                        p_amount: totalCost,
                    });

                    if (subscriptionStatus === 'free' && requestedWebSearch) {
                        await supabaseAdmin
                            .from('user_credits')
                            .update({ free_searches_used: freeSearchesUsed + 1 })
                            .eq('user_id', user.id);
                    }

                    await supabaseAdmin.from('usage_logs').insert({
                        user_id: user.id,
                        prompt_tokens: promptTokens,
                        completion_tokens: completionTokens,
                        reasoning_tokens: reasoningTokens,
                        total_credits_deducted: totalCost,
                        model_id: effectiveModel,
                        web_search_enabled: requestedWebSearch,
                        web_search_engine: requestedWebSearch ? webSearchEngine : null,
                        web_search_max_results: requestedWebSearch ? webSearchMaxResults : null,
                        web_search_results_billed: requestedWebSearch ? webSearchMaxResults : null,
                        text_credits: textCost,
                        image_credits: imageCost,
                        web_search_credits: searchCost,
                    });

                    console.log(`Deducted ${totalCost.toFixed(4)} credits for ${totalTokensNum} tokens (User: ${user.id})`);
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
