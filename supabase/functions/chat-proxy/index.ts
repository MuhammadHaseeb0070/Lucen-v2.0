import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { recordUsage, type UsageStatus, type UsageCallKind } from '../_shared/usage.ts';
import { TOOLS, getOpenRouterTools } from '../_shared/toolRegistry.ts';

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

function detectAttachments(messages: any[]): { hasImage: boolean; hasFile: boolean } {
    let hasImage = false;
    let hasFile = false;
    for (const msg of messages) {
        if (!msg || typeof msg !== 'object') continue;
        const content = msg.content;
        const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
        if (
            contentStr.includes('[Attached Image:') || 
            contentStr.includes('image: ') || 
            contentStr.includes('type: "image_url"') || 
            contentStr.includes('image_url')
        ) {
            hasImage = true;
        }
        if (contentStr.includes('[Attached File:') || contentStr.includes('file: ')) {
            hasFile = true;
        }
    }
    return { hasImage, hasFile };
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
            max_completion_tokens,
            mode,
            is_reasoning,
            stream,
            plugins,
            response_format,
            provider,
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

        let effectiveModel = model as string;
        if (model === 'main-chat-model') {
            effectiveModel = Deno.env.get('MAIN_CHAT_MODEL') ?? 'minimax/minimax-01';
        } else if (model === 'side-chat-model') {
            effectiveModel = Deno.env.get('SIDE_CHAT_MODEL') ?? 'openai/gpt-4o-mini';
        }
        accounting.modelId = effectiveModel;

        const isSideChat = model === 'side-chat-model';
        const modelPrefix = isSideChat ? 'SIDE_CHAT_' : 'MAIN_CHAT_';
        const defaultName = isSideChat ? 'GPT-4o mini' : 'Lucen M2.7';
        const defaultReasoning = isSideChat ? 'false' : 'true';
        const defaultContext = isSideChat ? '128000' : '131072';
        const defaultMaxOutput = isSideChat ? '16384' : '32768';
        const defaultTps = isSideChat ? '60' : '40';

        const configHeaders: Record<string, string> = {
            'x-model-name': Deno.env.get(`${modelPrefix}MODEL_NAME`) ?? defaultName,
            'x-supports-reasoning': Deno.env.get(`${modelPrefix}SUPPORTS_REASONING`) ?? defaultReasoning,
            'x-context-window': Deno.env.get(`${modelPrefix}CONTEXT_WINDOW`) ?? defaultContext,
            'x-max-output': Deno.env.get(`${modelPrefix}MAX_OUTPUT`) ?? defaultMaxOutput,
            'x-tokens-per-second': Deno.env.get(isSideChat ? 'SIDE_CHAT_TOKENS_PER_SECOND' : 'VITE_MAIN_CHAT_TOKENS_PER_SECOND') ?? Deno.env.get(`${modelPrefix}TOKENS_PER_SECOND`) ?? defaultTps,
            'Access-Control-Expose-Headers': 'x-model-name, x-supports-reasoning, x-context-window, x-max-output, x-tokens-per-second',
        };

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

        const { hasImage, hasFile } = detectAttachments(messages);
        const toolsToPass: any[] = [];
        if (webSearchRequested) {
            toolsToPass.push(TOOLS.web_search);
        }
        if (hasImage) {
            toolsToPass.push(TOOLS.analyze_image);
        }
        if (hasFile) {
            toolsToPass.push(TOOLS.process_file);
        }

        // Decide the effective upstream model.
        // Default: use the resolved effectiveModel.
        // Only swap when we're in explicit fallback mode AND the env var is
        // configured — otherwise stay on the main model so the user gets a
        // consistent voice regardless of whether web search kicked in.
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
                Math.max(MIN_OUTPUT, Number(max_completion_tokens ?? max_tokens) || 4096),
                ABSOLUTE_OUTPUT_CEILING,
            );

        const shouldStream = stream !== false;

        // ─── Non-stream mode (generate-title, bg calls, etc.) ───────────
        // Only fires for explicit stream:false requests. All normal chat
        // requests use the streaming agentic loop below.
        if (!shouldStream) {
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
                    stream: false,
                    max_tokens: resolvedMaxTokens,
                    max_completion_tokens: resolvedMaxTokens,
                    include_usage: true,
                    ...(response_format ? { response_format } : {}),
                    ...(provider ? { provider } : {}),
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

            const json = await openrouterResponse.json();
            const finishReason = json?.choices?.[0]?.finish_reason
                ? String(json.choices[0].finish_reason)
                : null;
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
            accounting.status = finishReason === 'length' ? 'truncated' : 'completed';
            accounting.statusReason = finishReason ? `finish_reason=${finishReason}` : null;
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
                status: accounting.status,
                statusReason: accounting.statusReason,
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
                headers: { ...cors, ...configHeaders, 'Content-Type': 'application/json' },
            });
        }

        // ─── Stream mode ────────────────────────────────────────────────
        const responseStream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                const decoder = new TextDecoder();
                
                let currentMessages = [...messages];
                let rounds = 0;
                const maxRounds = 4;
                
                // Track total accumulated metrics across all rounds
                let totalPromptTokens = 0;
                let totalCompletionTokens = 0;
                let totalReasoningTokens = 0;
                let totalSearchCost = 0;
                let finalStatus: UsageStatus = 'completed';
                let finalStatusReason: string | null = null;
                let finalStreamError: string | null = null;
                let finalSawDone = false;
                let finishReason: string | null = null;
                
                // Tools executed history for logging and client receipt
                const toolsExecuted: Array<{
                    id: string;
                    name: string;
                    arguments: string;
                    status: 'completed' | 'failed';
                    durationMs: number;
                }> = [];

                const callSiblingFunction = async (name: string, payload: any) => {
                    const endpoint = `${supabaseUrl}/functions/v1/${name}`;
                    const res = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': authHeader,
                            'apikey': supabaseServiceKey,
                        },
                        body: JSON.stringify(payload),
                    });
                    if (!res.ok) {
                        const errText = await res.text().catch(() => '');
                        throw new Error(`Status ${res.status}: ${errText}`);
                    }
                    return await res.json();
                };

                try {
                    while (rounds < maxRounds) {
                        const requestBody: any = {
                            model: effectiveModel,
                            messages: currentMessages,
                            stream: true,
                            max_tokens: resolvedMaxTokens,
                            max_completion_tokens: resolvedMaxTokens,
                            include_usage: true,
                            ...(response_format ? { response_format } : {}),
                            ...(provider ? { provider } : {}),
                            ...(is_reasoning ? { reasoning: { enabled: true } } : {}),
                        };

                        if (toolsToPass.length > 0 && rounds < maxRounds - 1) {
                            requestBody.tools = toolsToPass;
                        } else {
                            requestBody.tool_choice = 'none';
                        }

                        const openrouterResponse = await fetch(OPENROUTER_URL, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${openrouterApiKey}`,
                                'HTTP-Referer': supabaseUrl,
                                'X-Title': 'Lucen',
                            },
                            body: JSON.stringify(requestBody),
                        });

                        if (!openrouterResponse.ok) {
                            const errBody = await openrouterResponse.text().catch(() => '');
                            throw new Error(`OpenRouter upstream error ${openrouterResponse.status}: ${errBody}`);
                        }

                        const reader = openrouterResponse.body!.getReader();
                        
                        let isToolCall = false;
                        const firstChunks: Uint8Array[] = [];
                        let accumulatedText = '';
                        let chunkCount = 0;

                        outerLoop: while (true) {
                            if (chunkCount >= 200) {
                                isToolCall = false;
                                break;
                            }

                            const { done, value } = await reader.read();
                            if (done) break;
                            if (value) {
                                chunkCount++;
                                firstChunks.push(value);
                                const text = decoder.decode(value, { stream: true });
                                accumulatedText += text;

                                const lines = text.split('\n');
                                for (const line of lines) {
                                    const trimmed = line.trim();
                                    if (!trimmed.startsWith('data: ')) continue;
                                    const dataStr = trimmed.slice(6);
                                    if (dataStr === '[DONE]') continue;
                                    try {
                                        const parsed = JSON.parse(dataStr);
                                        const choice = parsed.choices?.[0];
                                        if (choice) {
                                            if (choice.delta?.tool_calls && Array.isArray(choice.delta.tool_calls) && choice.delta.tool_calls.length > 0) {
                                                isToolCall = true;
                                                break outerLoop;
                                            }
                                            if (typeof choice.delta?.content === 'string' && choice.delta.content.length > 0) {
                                                isToolCall = false;
                                                break outerLoop;
                                            }
                                            const fr = choice.finish_reason;
                                            if (fr !== null && fr !== undefined) {
                                                isToolCall = (fr === 'tool_calls');
                                                break outerLoop;
                                            }
                                        }
                                    } catch { /* skip */ }
                                }
                            }
                        }

                        if (isToolCall) {
                            // Fix 2: Flush all buffered reasoning chunks to the client via SSE
                            for (const chunk of firstChunks) {
                                controller.enqueue(chunk);
                            }

                            const toolCallsMap = new Map<number, {
                                id?: string;
                                name?: string;
                                arguments: string;
                            }>();

                            const parseText = (txt: string) => {
                                const lines = txt.split('\n');
                                for (const line of lines) {
                                    const trimmed = line.trim();
                                    if (!trimmed.startsWith('data: ')) continue;
                                    const dataStr = trimmed.slice(6);
                                    if (dataStr === '[DONE]') continue;
                                    try {
                                        const parsed = JSON.parse(dataStr);
                                        if (parsed.usage) {
                                            totalPromptTokens += parsed.usage.prompt_tokens || 0;
                                            totalCompletionTokens += parsed.usage.completion_tokens || 0;
                                            totalReasoningTokens += getReasoningTokens(parsed.usage) || 0;
                                        }
                                        const delta = parsed.choices?.[0]?.delta;
                                        if (delta?.tool_calls) {
                                            for (const tc of delta.tool_calls) {
                                                const index = tc.index;
                                                if (!toolCallsMap.has(index)) {
                                                    toolCallsMap.set(index, { id: tc.id, name: tc.function?.name, arguments: '' });
                                                }
                                                const existing = toolCallsMap.get(index)!;
                                                if (tc.id) existing.id = tc.id;
                                                if (tc.function?.name) existing.name = tc.function?.name;
                                                if (tc.function?.arguments) existing.arguments += tc.function?.arguments;
                                            }
                                        }
                                    } catch { /* skip */ }
                                }
                            };

                            parseText(accumulatedText);

                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                if (value) {
                                    const text = decoder.decode(value, { stream: true });
                                    parseText(text);
                                }
                            }

                            const toolCalls = Array.from(toolCallsMap.values());

                            if (toolCalls.length > 0) {
                                for (const tc of toolCalls) {
                                    let parsedArgs: any = {};
                                    try { parsedArgs = JSON.parse(tc.arguments); } catch { /* ignore */ }

                                    let label = '';
                                    if (tc.name === 'analyze_image') {
                                        label = parsedArgs.analysis_title || 'Analyzing image';
                                    } else if (tc.name === 'process_file') {
                                        label = parsedArgs.extraction_title || 'Reading file';
                                    } else if (tc.name === 'web_search') {
                                        label = parsedArgs.search_title || 'Searching the web';
                                    } else {
                                        const def = TOOLS[tc.name ?? ''];
                                        label = def?.userFacingLabel ?? `Running ${tc.name}`;
                                    }

                                    const eventPayload = {
                                        id: tc.id,
                                        tool: tc.name,
                                        status: 'running',
                                        label,
                                        args: parsedArgs
                                    };
                                    controller.enqueue(encoder.encode(`event: tool_activity\ndata: ${JSON.stringify(eventPayload)}\n\n`));
                                }

                                const parallelCalls = toolCalls.filter(tc => TOOLS[tc.name ?? '']?.parallelizable);
                                const sequentialCalls = toolCalls.filter(tc => !TOOLS[tc.name ?? '']?.parallelizable);

                                const toolResults: any[] = [];

                                const runTool = async (tc: any) => {
                                    const start = Date.now();
                                    let output = '';
                                    let success = true;
                                    let parsedArgs: any = {};
                                    try { parsedArgs = JSON.parse(tc.arguments); } catch { /* ignore */ }

                                    let timerId: any;
                                    try {
                                        let siblingName = tc.name;
                                        if (tc.name === 'analyze_image') siblingName = 'describe-image';
                                        if (tc.name === 'process_file') siblingName = 'get-file-content';
                                        if (tc.name === 'web_search') siblingName = 'web-search';

                                        const executionPromise = callSiblingFunction(siblingName, parsedArgs);
                                        const timeoutPromise = new Promise<never>((_, reject) => {
                                            timerId = setTimeout(() => reject(new Error('timeout')), 12000);
                                        });

                                        const res = await Promise.race([executionPromise, timeoutPromise]);
                                        output = res.description ?? res.content ?? res.text ?? JSON.stringify(res);
                                    } catch (err: any) {
                                        success = false;
                                        if (err.message === 'timeout') {
                                            output = 'Tool execution timed out. Please try again.';
                                        } else {
                                            output = `Error executing tool ${tc.name}: ${err.message}`;
                                        }
                                    } finally {
                                        if (timerId) clearTimeout(timerId);
                                    }

                                    const durationMs = Date.now() - start;
                                    toolsExecuted.push({
                                        id: tc.id!,
                                        name: tc.name!,
                                        arguments: tc.arguments,
                                        status: success ? 'completed' : 'failed',
                                        durationMs
                                    });

                                    if (tc.name === 'web_search') {
                                        const maxResults = Number(parsedArgs.max_results ?? WEBSEARCH_DEFAULT_MAX_RESULTS);
                                        totalSearchCost += computeWebSearchCredits(maxResults);
                                    }

                                    let label = '';
                                    if (tc.name === 'analyze_image') {
                                        label = parsedArgs.analysis_title || 'Analyzing image';
                                    } else if (tc.name === 'process_file') {
                                        label = parsedArgs.extraction_title || 'Reading file';
                                    } else if (tc.name === 'web_search') {
                                        label = parsedArgs.search_title || 'Searching the web';
                                    } else {
                                        const def = TOOLS[tc.name ?? ''];
                                        label = def?.userFacingLabel ?? `Running ${tc.name}`;
                                    }

                                    const eventPayload = {
                                        id: tc.id,
                                        tool: tc.name,
                                        status: success ? 'completed' : 'failed',
                                        label,
                                        args: parsedArgs,
                                        durationMs,
                                        output: output.slice(0, 400)
                                    };
                                    controller.enqueue(encoder.encode(`event: tool_activity\ndata: ${JSON.stringify(eventPayload)}\n\n`));

                                    // Fix 4: Truncate oversized tool results before returning
                                    let finalOutput = output;
                                    if (output.length > 3000) {
                                        console.warn(`[chat-proxy] Tool result for ${tc.name} truncated from ${output.length} characters.`);
                                        finalOutput = output.slice(0, 3000) + '\n\n[Result truncated for length]';
                                    }

                                    return {
                                        tool_call_id: tc.id,
                                        role: 'tool',
                                        name: tc.name,
                                        content: finalOutput
                                    };
                                };

                                const parallelResults = await Promise.all(parallelCalls.map(runTool));
                                toolResults.push(...parallelResults);

                                for (const tc of sequentialCalls) {
                                    const res = await runTool(tc);
                                    toolResults.push(res);
                                }

                                currentMessages.push({
                                    role: 'assistant',
                                    // Bug 3 fix: use "" not null — many models (MiniMax, etc.)
                                    // reject null content in the assistant tool_calls turn and
                                    // return an empty response on the next round.
                                    content: '',
                                    tool_calls: toolCalls.map(tc => ({
                                        id: tc.id,
                                        type: 'function',
                                        function: {
                                            name: tc.name,
                                            arguments: tc.arguments
                                        }
                                    }))
                                });
                                currentMessages.push(...toolResults);
                            }
                            rounds++;
                            continue;
                        } else {
                            // Bug 1 fix: emit a content_start sentinel before forwarding the
                            // final content stream. This tells the frontend that any delta.reasoning
                            // chunks in this round are the model's actual answer, not internal thinking.
                            // MiniMax Nitro (and similar models) put their post-tool-call answer in
                            // delta.reasoning even though it's the response, not a thought.
                            if (rounds > 0) {
                                controller.enqueue(encoder.encode(`event: content_start\ndata: ${JSON.stringify({ after_tool_calls: true })}\n\n`));
                            }

                            for (const chunk of firstChunks) {
                                controller.enqueue(chunk);
                            }

                            const parseUsageAndStream = (chunkVal: Uint8Array) => {
                                controller.enqueue(chunkVal);
                                const text = decoder.decode(chunkVal, { stream: true });
                                const lines = text.split('\n');
                                for (const line of lines) {
                                    const trimmed = line.trim();
                                    if (!trimmed.startsWith('data: ')) continue;
                                    const dataStr = trimmed.slice(6);
                                    if (dataStr === '[DONE]') {
                                        finalSawDone = true;
                                        continue;
                                    }
                                    try {
                                        const parsed = JSON.parse(dataStr);
                                        if (parsed.usage) {
                                            totalPromptTokens += parsed.usage.prompt_tokens || 0;
                                            totalCompletionTokens += parsed.usage.completion_tokens || 0;
                                            totalReasoningTokens += getReasoningTokens(parsed.usage) || 0;
                                        }
                                        const choice = parsed.choices?.[0];
                                        if (choice?.finish_reason) {
                                            finishReason = choice.finish_reason;
                                        }
                                        if (parsed?.error) {
                                            finalStreamError = typeof parsed.error === 'string'
                                                ? parsed.error
                                                : (parsed.error?.message ?? 'stream error');
                                        }
                                    } catch { /* skip */ }
                                }
                            };

                            const lines = accumulatedText.split('\n');
                            for (const line of lines) {
                                const trimmed = line.trim();
                                if (!trimmed.startsWith('data: ')) continue;
                                const dataStr = trimmed.slice(6);
                                if (dataStr === '[DONE]') {
                                    finalSawDone = true;
                                    continue;
                                }
                                try {
                                    const parsed = JSON.parse(dataStr);
                                    if (parsed.usage) {
                                        totalPromptTokens += parsed.usage.prompt_tokens || 0;
                                        totalCompletionTokens += parsed.usage.completion_tokens || 0;
                                        totalReasoningTokens += getReasoningTokens(parsed.usage) || 0;
                                    }
                                } catch { /* skip */ }
                            }

                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                if (value) {
                                    parseUsageAndStream(value);
                                }
                            }

                            break;
                        }
                    }

                    if (finalStreamError) {
                        finalStatus = 'upstream_error';
                        finalStatusReason = finalStreamError.slice(0, 500);
                    } else if (finishReason === 'length') {
                        finalStatus = 'truncated';
                        finalStatusReason = 'finish_reason=length';
                    } else if (finishReason === 'stop' && finalSawDone) {
                        finalStatus = 'completed';
                    } else if (finishReason) {
                        finalStatus = 'completed';
                        finalStatusReason = `finish_reason=${finishReason}`;
                    } else if (!finalSawDone) {
                        finalStatus = 'aborted';
                        finalStatusReason = 'eof_without_done';
                    } else {
                        finalStatus = 'completed';
                    }

                    const totalTokensNum = totalPromptTokens + totalCompletionTokens;
                    const textCost = (totalTokensNum / 1000) * CREDITS_PER_1K_TOKENS;
                    const actualWebSearchHappened = totalSearchCost > 0;
                    const shouldCharge =
                        finalStatus === 'completed' || finalStatus === 'truncated' || totalTokensNum > 0;
                    const totalCost = shouldCharge ? (textCost + totalSearchCost) : 0;

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

                    const receiptPayload = {
                        tools_used: toolsExecuted,
                        prompt_tokens: totalPromptTokens,
                        completion_tokens: totalCompletionTokens,
                        reasoning_tokens: totalReasoningTokens,
                        total_credits: totalCost,
                        search_credits: totalSearchCost
                    };
                    controller.enqueue(encoder.encode(`event: usage_receipt\ndata: ${JSON.stringify(receiptPayload)}\n\n`));

                    accounting.finalized = true;
                    accounting.status = finalStatus;
                    accounting.statusReason = finalStatusReason;
                    accounting.errorMessage = finalStreamError;
                    accounting.promptTokens = totalPromptTokens;
                    accounting.completionTokens = totalCompletionTokens;
                    accounting.reasoningTokens = totalReasoningTokens;
                    accounting.textCredits = textCost;
                    accounting.imageCredits = 0;
                    accounting.webSearchCredits = totalSearchCost;
                    accounting.totalCredits = totalCost;
                    accounting.webSearchResultsBilled = actualWebSearchHappened ? (totalSearchCost / (LC_PER_USD * (WEBSEARCH_USD_PER_1K_RESULTS / 1000))) : null;

                    await recordUsage({
                        userId: user.id,
                        conversationId: accounting.conversationId,
                        messageId: accounting.messageId,
                        callKind: accounting.callKind,
                        status: finalStatus,
                        statusReason: finalStatusReason,
                        errorMessage: finalStreamError,
                        requestId: accounting.requestId,
                        parentRequestId: accounting.parentRequestId,
                        modelId: accounting.modelId,
                        durationMs: Date.now() - startedAt,
                        promptTokens: totalPromptTokens,
                        completionTokens: totalCompletionTokens,
                        reasoningTokens: totalReasoningTokens,
                        imageTokens: 0,
                        textCredits: textCost,
                        imageCredits: 0,
                        webSearchCredits: totalSearchCost,
                        totalCreditsDeducted: totalCost,
                        inputCostPer1M: accounting.inputCostPer1M,
                        outputCostPer1M: accounting.outputCostPer1M,
                        webSearchEnabled: webSearchRequested,
                        webSearchEngine: accounting.webSearchEngine,
                        webSearchMaxResults: accounting.webSearchMaxResults,
                        webSearchResultsBilled: accounting.webSearchResultsBilled,
                    });

                } catch (e: any) {
                    console.error('[chat-proxy] Stream internal execution error:', e);
                    try {
                        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`));
                    } catch { /* skip */ }
                } finally {
                    try {
                        controller.close();
                    } catch { /* ignore */ }
                }
            }
        });

        return new Response(responseStream, {
            headers: {
                ...cors,
                ...configHeaders,
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
