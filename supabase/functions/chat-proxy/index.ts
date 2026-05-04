import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { recordUsage, type UsageStatus, type UsageCallKind } from '../_shared/usage.ts';

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

// ─── Server-side output policy ──────────────────────────────────────────
// Mirrors src/services/outputBudget.ts + src/config/models.ts so a malicious
// client can't request more tokens than our platform can safely serve.
// ABSOLUTE_OUTPUT_CEILING is the hard safety cap regardless of model.
const ABSOLUTE_OUTPUT_CEILING = Number(
    Deno.env.get('ABSOLUTE_OUTPUT_CEILING') ?? '32768',
);
const MIN_OUTPUT = 512;

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

    const engine = WEBSEARCH_DEFAULT_ENGINE;

    const include_domains = sanitizeDomainList(raw.include_domains, 10);
    const exclude_domains = sanitizeDomainList(raw.exclude_domains, 10);

    const plugin: Record<string, unknown> = { id: WEB_PLUGIN_ID, engine, max_results };
    if (include_domains) plugin.include_domains = include_domains;
    if (exclude_domains) plugin.exclude_domains = exclude_domains;

    return [plugin];
}

function computeWebSearchCredits(maxResults: number): number {
    const usd = (Math.max(0, maxResults) / 1000) * WEBSEARCH_USD_PER_1K_RESULTS;
    return usd * LC_PER_USD;
}

// ─── Main handler ────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
    const cors = getCorsHeaders(req);
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: cors });
    }

    // Every exit path populates this shared `accounting` object; a single
    // `recordUsage` call at the very end writes it. Streaming responses set
    // `accounting.finalized = true` from inside the async pump so we don't
    // double-log from the outer finally.
    const accounting = {
        finalized: false,
        status: 'completed' as UsageStatus,
        statusReason: null as string | null,
        errorMessage: null as string | null,
        callKind: 'chat' as UsageCallKind,
        userId: null as string | null,
        requestId: null as string | null,
        parentRequestId: null as string | null,
        conversationId: null as string | null,
        messageId: null as string | null,
        modelId: null as string | null,
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        imageTokens: 0,
        textCredits: 0,
        imageCredits: 0,
        webSearchCredits: 0,
        totalCredits: 0,
        inputCostPer1M: 0,
        outputCostPer1M: 0,
        webSearchEnabled: false,
        webSearchEngine: null as string | null,
        webSearchMaxResults: null as number | null,
        webSearchResultsBilled: null as number | null,
    };
    const startedAt = Date.now();

    // Helper: short-circuit with a JSON error AND record the usage row.
    const fail = async (
        status: UsageStatus,
        httpStatus: number,
        message: string,
        statusReason: string | null = null,
    ): Promise<Response> => {
        accounting.finalized = true;
        accounting.status = status;
        accounting.errorMessage = message;
        accounting.statusReason = statusReason;
        await recordUsage({
            userId: accounting.userId ?? 'unknown',
            conversationId: accounting.conversationId,
            messageId: accounting.messageId,
            callKind: accounting.callKind,
            status,
            statusReason,
            errorMessage: message,
            requestId: accounting.requestId,
            parentRequestId: accounting.parentRequestId,
            modelId: accounting.modelId,
            durationMs: Date.now() - startedAt,
            inputCostPer1M: accounting.inputCostPer1M,
            outputCostPer1M: accounting.outputCostPer1M,
        });
        return new Response(JSON.stringify({ error: message }), {
            status: httpStatus,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    };

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return await fail('auth_error', 401, 'Missing Authorization header');
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const openrouterApiKey = Deno.env.get('OPENROUTER_API_KEY');

        if (!openrouterApiKey) {
            return await fail('client_error', 500, 'OpenRouter API key not configured on server');
        }

        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (!token || token.split('.').length !== 3) {
            return await fail('auth_error', 401, 'Invalid token format');
        }

        let claims: Record<string, unknown>;
        try {
            claims = decodeJwtPayload(token);
        } catch {
            return await fail('auth_error', 401, 'Malformed JWT');
        }

        const userId = claims.sub as string;
        const expiry = claims.exp as number;
        if (!userId) {
            return await fail('auth_error', 401, 'JWT missing sub claim');
        }
        accounting.userId = userId;
        if (expiry && expiry < Math.floor(Date.now() / 1000)) {
            return await fail('auth_error', 401, 'Token expired');
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const { data: adminUser, error: adminError } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (adminError || !adminUser?.user) {
            return await fail('auth_error', 401, 'User not found');
        }
        const user = adminUser.user;

        // ─── Parse request body ───
        const body = await req.json();
        const {
            messages,
            model,
            max_tokens,
            mode,
            is_reasoning,
            stream,
            plugins,
            __bg_description,
            // Web search signals from client (authoritative):
            //   web_search_enabled            — user toggled web search on
            //   web_search_used               — classify-intent ran Tavily
            //                                   successfully; results already
            //                                   injected into `messages`
            //   web_search_fallback_requested — classify-intent CRASHED; we
            //                                   may switch to OPENROUTER_
            //                                   ONLINE_MODEL as a last resort
            web_search_enabled,
            web_search_used,
            web_search_fallback_requested,
            // Accounting metadata (all optional, client-generated):
            request_id,
            parent_request_id,
            conversation_id,
            message_id,
            call_kind,
            input_cost_per_1m,
            output_cost_per_1m,
        } = body ?? {};

        if (typeof request_id === 'string') accounting.requestId = request_id;
        if (typeof parent_request_id === 'string') accounting.parentRequestId = parent_request_id;
        if (typeof conversation_id === 'string') accounting.conversationId = conversation_id;
        if (typeof message_id === 'string') accounting.messageId = message_id;
        if (typeof call_kind === 'string') {
            accounting.callKind = call_kind as UsageCallKind;
        }
        if (typeof input_cost_per_1m === 'number' && Number.isFinite(input_cost_per_1m)) {
            accounting.inputCostPer1M = input_cost_per_1m;
        }
        if (typeof output_cost_per_1m === 'number' && Number.isFinite(output_cost_per_1m)) {
            accounting.outputCostPer1M = output_cost_per_1m;
        }

        if (!messages || !Array.isArray(messages)) {
            return await fail('client_error', 400, 'Invalid request: messages array required');
        }
        if (!model || typeof model !== 'string') {
            return await fail('client_error', 400, 'model is required');
        }

        accounting.modelId = model;

        const imageCount = countImagesInMessages(messages);
        accounting.imageTokens = imageCount;

        // ── Web search policy ──────────────────────────────────────────
        // Client is authoritative for modern flow:
        //   - classify-intent + Tavily happen before chat-proxy
        //   - main model answers using injected search context
        //   - NO OpenRouter plugin forwarding unless explicit fallback flag
        //
        // We still inspect legacy `plugins` only for observability (warnings),
        // never as a trigger for fallback/model swap.
        const legacyPluginRequested = hasWebPlugin(plugins);
        const webSearchRequested = !!web_search_enabled;
        const webSearchFallback = !!web_search_fallback_requested;
        const webSearchUsed = !!web_search_used;

        const sanitizedWebPlugins = webSearchFallback && legacyPluginRequested
            ? sanitizeWebPlugins(plugins)
            : undefined;
        const webSearchMaxResults = webSearchRequested
            ? (sanitizedWebPlugins && sanitizedWebPlugins[0] && typeof sanitizedWebPlugins[0].max_results === 'number'
                ? (sanitizedWebPlugins[0].max_results as number)
                : WEBSEARCH_DEFAULT_MAX_RESULTS)
            : 0;
        const webSearchEngine = webSearchRequested
            ? (sanitizedWebPlugins && sanitizedWebPlugins[0] && typeof sanitizedWebPlugins[0].engine === 'string'
                ? (sanitizedWebPlugins[0].engine as string)
                : WEBSEARCH_DEFAULT_ENGINE)
            : '';

        accounting.webSearchEnabled = webSearchRequested;
        accounting.webSearchEngine = webSearchRequested ? webSearchEngine : null;
        accounting.webSearchMaxResults = webSearchRequested ? webSearchMaxResults : null;
        if (legacyPluginRequested && !webSearchFallback) {
            console.warn('[chat-proxy] ignoring legacy plugins field without explicit web_search_fallback_requested=true');
            if (!accounting.statusReason) {
                accounting.statusReason = 'ignored_legacy_plugins_without_fallback';
            }
        }

        // Decide the effective upstream model.
        // Default: use the client-requested model (MAIN chat model).
        // Only swap when we're in explicit fallback mode AND the env var is
        // configured — otherwise stay on the main model so the user gets a
        // consistent voice regardless of whether web search kicked in.
        let effectiveModel = model as string;
        if (webSearchFallback) {
            const onlineModel = Deno.env.get('OPENROUTER_ONLINE_MODEL');
            if (onlineModel) {
                effectiveModel = onlineModel;
                accounting.modelId = effectiveModel;
                accounting.statusReason = 'web_search_fallback_online_model';
                console.warn('[chat-proxy] web_search_fallback_requested — switching to', onlineModel);
            } else {
                // No fallback configured — log a warning but still serve the
                // turn with the main model. Search results are already in
                // the messages array (classify-intent succeeded partially)
                // or missing entirely.
                console.warn('[chat-proxy] fallback requested but OPENROUTER_ONLINE_MODEL is not set; using main model');
            }
        }

        // ─── Pre-flight: fetch subscription + balance ───────────────────
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
            return await fail('upstream_error', 500, 'Failed to load user credits');
        }

        const subscriptionStatus = (creditsRow.subscription_status || 'free') as string;
        const remainingCredits = typeof creditsRow.remaining_credits === 'number' ? creditsRow.remaining_credits : 0;
        const freeSearchesUsed = typeof (creditsRow as Record<string, unknown>).free_searches_used === 'number'
            ? ((creditsRow as Record<string, unknown>).free_searches_used as number)
            : 0;

        if (remainingCredits <= 0 && !__bg_description) {
            return await fail('insufficient_credits', 402, 'Insufficient credits');
        }

        // Only forward plugins to OpenRouter in the explicit fallback path.
        // In the normal path, classify-intent already ran Tavily and the
        // results are injected as a system message — forwarding the plugin
        // would trigger a SECOND Tavily call and inflate the user's bill.
        const effectivePlugins: unknown = webSearchFallback ? sanitizedWebPlugins : undefined;
        if (subscriptionStatus === 'free') {
            forceImageDetailLow(messages);
            if (webSearchRequested && freeSearchesUsed >= FREE_TIER_MAX_SEARCHES) {
                return await fail(
                    'insufficient_credits',
                    402,
                    'Free tier web search limit reached. Upgrade to Regular or Pro for unlimited web search.',
                    'FREE_SEARCH_LIMIT_REACHED',
                );
            }
        }

        // ─── Per-call output cap ────────────────────────────────────────
        // Client is source of truth for the per-mode cap (it has the
        // model's real spec). We only enforce the absolute safety ceiling
        // here so a malicious client can't demand 500k tokens.
        const resolvedMaxTokens = __bg_description
            ? 200
            : Math.min(
                Math.max(MIN_OUTPUT, Number(max_tokens) || 4096),
                ABSOLUTE_OUTPUT_CEILING,
            );

        const shouldStream = stream !== false;

        // ─── Dispatch to OpenRouter ─────────────────────────────────────
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
                stream: shouldStream,
                max_tokens: resolvedMaxTokens,
                include_usage: true,
                // Only forward plugins when we're in the explicit fallback
                // path. In the normal path the main model reads the injected
                // search results as plain system context.
                ...(webSearchFallback && effectivePlugins ? { plugins: effectivePlugins } : {}),
                ...(is_reasoning ? { reasoning: { enabled: true } } : {}),
            }),
        });

        if (!openrouterResponse.ok) {
            const errBody = await openrouterResponse.text();
            console.error(`[OpenRouter Error] ${openrouterResponse.status}:`, errBody);
            return await fail(
                'upstream_error',
                openrouterResponse.status,
                `OpenRouter API Error ${openrouterResponse.status}`,
                errBody.slice(0, 500),
            );
        }

        // ─── Non-stream mode ─────────────────────────────────────────────
        if (!shouldStream) {
            const json = await openrouterResponse.json();
            const usage = json?.usage || {};
            const promptTokens = usage?.prompt_tokens || 0;
            const completionTokens = usage?.completion_tokens || 0;
            const reasoningTokens = getReasoningTokens(usage);
            const totalTokens = usage?.total_tokens ?? (promptTokens + completionTokens);
            const totalTokensNum = typeof totalTokens === 'number' && Number.isFinite(totalTokens)
                ? totalTokens
                : (promptTokens + completionTokens);

            const textCost = (totalTokensNum / 1000) * CREDITS_PER_1K_TOKENS;
            const imageCost = imageCount * CREDITS_PER_IMAGE;
            const actualWebSearchHappened = webSearchUsed || webSearchFallback;
            const searchCost = actualWebSearchHappened ? computeWebSearchCredits(webSearchMaxResults) : 0;
            const totalCost = textCost + imageCost + searchCost;

            try {
                await supabaseAdmin.rpc('deduct_user_credits', {
                    p_user_id: user.id,
                    p_amount: totalCost,
                });

                if (subscriptionStatus === 'free' && actualWebSearchHappened) {
                    await supabaseAdmin
                        .from('user_credits')
                        .update({ free_searches_used: freeSearchesUsed + 1 })
                        .eq('user_id', user.id);
                }
            } catch (dbErr) {
                console.error('Failed to deduct credits:', dbErr);
            }

            accounting.finalized = true;
            accounting.status = 'completed';
            accounting.promptTokens = promptTokens;
            accounting.completionTokens = completionTokens;
            accounting.reasoningTokens = reasoningTokens;
            accounting.textCredits = textCost;
            accounting.imageCredits = imageCost;
            accounting.webSearchCredits = searchCost;
            accounting.totalCredits = totalCost;
            accounting.webSearchResultsBilled = actualWebSearchHappened ? webSearchMaxResults : null;

            await recordUsage({
                userId: user.id,
                conversationId: accounting.conversationId,
                messageId: accounting.messageId,
                callKind: accounting.callKind,
                status: 'completed',
                requestId: accounting.requestId,
                parentRequestId: accounting.parentRequestId,
                modelId: accounting.modelId,
                durationMs: Date.now() - startedAt,
                promptTokens,
                completionTokens,
                reasoningTokens,
                imageTokens: imageCount,
                textCredits: textCost,
                imageCredits: imageCost,
                webSearchCredits: searchCost,
                totalCreditsDeducted: totalCost,
                inputCostPer1M: accounting.inputCostPer1M,
                outputCostPer1M: accounting.outputCostPer1M,
                webSearchEnabled: webSearchRequested,
                webSearchEngine: accounting.webSearchEngine,
                webSearchMaxResults: accounting.webSearchMaxResults,
                webSearchResultsBilled: accounting.webSearchResultsBilled,
            });

            return new Response(JSON.stringify(json), {
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        // ─── Stream mode ────────────────────────────────────────────────
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const reader = openrouterResponse.body!.getReader();
        const decoder = new TextDecoder();

        let promptTokens = 0;
        let completionTokens = 0;
        let reasoningTokens = 0;
        let totalTokensNum = 0;
        let finishReason: string | null = null;
        let sawDone = false;
        let streamError: string | null = null;

        (async () => {
            let lastChunkTime = Date.now();
            const keepaliveInterval = setInterval(async () => {
                try {
                    if (Date.now() - lastChunkTime > 8000) {
                        const keepalive = new TextEncoder().encode(': keepalive\n\n');
                        await writer.write(keepalive);
                    }
                } catch {
                    clearInterval(keepaliveInterval);
                }
            }, 8000);

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    lastChunkTime = Date.now();
                    await writer.write(value);

                    const text = decoder.decode(value, { stream: true });
                    const lines = text.split('\n');
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed.startsWith('data: ')) continue;
                        const dataStr = trimmed.slice(6);
                        if (dataStr === '[DONE]') {
                            sawDone = true;
                            continue;
                        }
                        try {
                            const parsed = JSON.parse(dataStr);
                            if (parsed.usage) {
                                totalTokensNum = parsed.usage.total_tokens || totalTokensNum;
                                promptTokens = parsed.usage.prompt_tokens || promptTokens;
                                completionTokens = parsed.usage.completion_tokens || completionTokens;
                                reasoningTokens = getReasoningTokens(parsed.usage) || reasoningTokens;
                            }
                            const choice = parsed?.choices?.[0];
                            if (choice?.finish_reason) {
                                finishReason = String(choice.finish_reason);
                            }
                            if (parsed?.error) {
                                streamError = typeof parsed.error === 'string'
                                    ? parsed.error
                                    : (parsed.error?.message ?? 'stream error');
                            }
                        } catch {
                            // Non-JSON SSE line — skip.
                        }
                    }
                }
            } catch (e) {
                streamError = e instanceof Error ? e.message : 'stream pump failed';
            } finally {
                clearInterval(keepaliveInterval);
                try { await writer.close(); } catch { /* already closed */ }

                totalTokensNum = totalTokensNum > 0 ? totalTokensNum : (promptTokens + completionTokens);

                // Derive status from stream end state.
                let status: UsageStatus;
                let statusReason: string | null = null;
                if (streamError) {
                    status = 'upstream_error';
                    statusReason = streamError.slice(0, 500);
                } else if (finishReason === 'length') {
                    status = 'truncated';
                    statusReason = 'finish_reason=length';
                } else if (finishReason === 'stop' && sawDone) {
                    status = 'completed';
                } else if (finishReason) {
                    status = 'completed';
                    statusReason = `finish_reason=${finishReason}`;
                } else if (!sawDone) {
                    // Stream ended without [DONE] — treat as aborted (client cut
                    // or upstream hung up).
                    status = 'aborted';
                    statusReason = 'eof_without_done';
                } else {
                    status = 'completed';
                }

                const textCost = (totalTokensNum / 1000) * CREDITS_PER_1K_TOKENS;
                const imageCost = imageCount * CREDITS_PER_IMAGE;
                const actualWebSearchHappened = webSearchUsed || webSearchFallback;
                const searchCost = actualWebSearchHappened ? computeWebSearchCredits(webSearchMaxResults) : 0;
                const shouldCharge =
                    status === 'completed' || status === 'truncated' || (promptTokens + completionTokens) > 0;
                const totalCost = shouldCharge ? (textCost + imageCost + searchCost) : 0;

                try {
                    if (shouldCharge && totalCost > 0) {
                        await supabaseAdmin.rpc('deduct_user_credits', {
                            p_user_id: user.id,
                            p_amount: totalCost,
                        });
                    }

                    if (shouldCharge && subscriptionStatus === 'free' && actualWebSearchHappened) {
                        await supabaseAdmin
                            .from('user_credits')
                            .update({ free_searches_used: freeSearchesUsed + 1 })
                            .eq('user_id', user.id);
                    }
                } catch (dbErr) {
                    console.error('Failed to deduct stream credits:', dbErr);
                }

                accounting.finalized = true;
                accounting.status = status;
                accounting.statusReason = statusReason;
                accounting.errorMessage = streamError;
                accounting.promptTokens = promptTokens;
                accounting.completionTokens = completionTokens;
                accounting.reasoningTokens = reasoningTokens;
                accounting.textCredits = textCost;
                accounting.imageCredits = imageCost;
                accounting.webSearchCredits = searchCost;
                accounting.totalCredits = totalCost;
                accounting.webSearchResultsBilled = actualWebSearchHappened ? webSearchMaxResults : null;

                await recordUsage({
                    userId: user.id,
                    conversationId: accounting.conversationId,
                    messageId: accounting.messageId,
                    callKind: accounting.callKind,
                    status,
                    statusReason,
                    errorMessage: streamError,
                    requestId: accounting.requestId,
                    parentRequestId: accounting.parentRequestId,
                    modelId: accounting.modelId,
                    durationMs: Date.now() - startedAt,
                    promptTokens,
                    completionTokens,
                    reasoningTokens,
                    imageTokens: imageCount,
                    textCredits: textCost,
                    imageCredits: imageCost,
                    webSearchCredits: searchCost,
                    totalCreditsDeducted: totalCost,
                    inputCostPer1M: accounting.inputCostPer1M,
                    outputCostPer1M: accounting.outputCostPer1M,
                    webSearchEnabled: webSearchRequested,
                    webSearchEngine: accounting.webSearchEngine,
                    webSearchMaxResults: accounting.webSearchMaxResults,
                    webSearchResultsBilled: accounting.webSearchResultsBilled,
                });
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
        if (!accounting.finalized) {
            accounting.finalized = true;
            accounting.status = 'upstream_error';
            accounting.errorMessage = err instanceof Error ? err.message : 'Internal server error';
            await recordUsage({
                userId: accounting.userId ?? 'unknown',
                conversationId: accounting.conversationId,
                messageId: accounting.messageId,
                callKind: accounting.callKind,
                status: accounting.status,
                statusReason: accounting.statusReason,
                errorMessage: accounting.errorMessage,
                requestId: accounting.requestId,
                parentRequestId: accounting.parentRequestId,
                modelId: accounting.modelId,
                durationMs: Date.now() - startedAt,
                inputCostPer1M: accounting.inputCostPer1M,
                outputCostPer1M: accounting.outputCostPer1M,
            });
        }
        return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
            { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
    }
});
