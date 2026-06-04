import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { recordUsage, type UsageStatus, type UsageCallKind } from '../_shared/usage.ts';
import { TOOLS, getOpenRouterTools } from '../_shared/toolRegistry.ts';
import { createLogger } from '../_shared/logging.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { circuitAllow, circuitSuccess, circuitFailure } from '../_shared/circuitBreaker.ts';
import { isKillSwitched } from '../_shared/featureFlags.ts';

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

interface ValidationResult {
  valid: boolean;
  type: 'plain' | 'final' | 'artifact' | 'raw';
  content: string;
  rawContent: string;
}

function validateModelOutput(raw: string): ValidationResult {
  if (!raw || typeof raw !== 'string') {
    return { valid: false, type: 'raw', content: '', rawContent: raw || '' };
  }

  // Check for lucen_response tags (plain or final)
  const responseMatch = raw.match(
    /<lucen_response\s+type="(plain|final)">([\s\S]*?)<\/lucen_response>/i
  );
  if (responseMatch) {
    const content = responseMatch[2].trim();
    if (content.length >= 15) {
      return { 
        valid: true, 
        type: responseMatch[1] as 'plain' | 'final',
        content,
        rawContent: raw
      };
    }
  }

  // Check for artifact (pass through as-is, handled by frontend)
  if (/<lucen_artifact[\s\S]*?<\/lucen_artifact>/i.test(raw)) {
    return { valid: true, type: 'artifact', content: raw, rawContent: raw };
  }

  // Fallback: if no tags but substantial plain text with no leaked XML
  const hasLeakedXml = /<invoke\s|<tool_call|<minimax:|<query>|<parameter/i.test(raw);
  const cleaned = raw.replace(/<[a-zA-Z_:][^>]*>[\s\S]*?<\/[a-zA-Z_:][^>]*>/g, '')
                     .replace(/<[a-zA-Z_:][^>]*/g, '').trim();
  
  if (!hasLeakedXml && cleaned.length >= 30) {
    return { valid: true, type: 'raw', content: cleaned, rawContent: raw };
  }

  return { valid: false, type: 'raw', content: '', rawContent: raw };
}

function buildResponseFormatContract(hasToolResults: boolean, webSearchEnabled: boolean): string {
  return `## Response Format — MANDATORY

You MUST wrap every response in the correct tag:

**For direct answers** (no tools used this turn):
<lucen_response type="plain">
your response in markdown here
</lucen_response>

**For answers using tool results** (after web search, image analysis, file reading):
<lucen_response type="final">
your response using the gathered information
</lucen_response>

**For code, apps, HTML, Python, SVG, diagrams**:
<lucen_artifact type="[html|python|svg|mermaid|text]" title="[descriptive title]">
code here
</lucen_artifact>

**STRICT RULES**:
- ALWAYS use the correct wrapper tag — no exceptions
- NEVER output <invoke>, <tool_call>, <parameter>, or any XML tool tags
- NEVER show search queries or tool names to the user  
- NEVER say "I was unable to generate a response"
- For artifacts with explanation, output both tags sequentially
${!webSearchEnabled ? '- Web search is DISABLED. If asked about real-time info, say so and suggest enabling web search.' : ''}
${hasToolResults ? '- You have tool results available. Use them to write a complete, helpful answer.\n- If you analyzed multiple images, describe each one individually and reference them by their order (Image 1, Image 2, etc.)' : ''}`;
}

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

    const log = createLogger('chat-proxy');

    // Feature flag kill switch — return 503 if chat is disabled
    if (isKillSwitched('CHAT')) {
        return new Response(JSON.stringify({ error: 'Chat is temporarily unavailable. Please try again later.' }), {
            status: 503,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
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

        // Rate limit: 30 requests per minute per user
        const rateLimitResult = checkRateLimit(`chat:${userId}`, 30, 60_000);
        if (!rateLimitResult.allowed) {
            log.warn('Rate limit exceeded', { userId, retryAfterMs: rateLimitResult.retryAfterMs });
            return await fail('rate_limited', 429, 'Too many requests. Please wait a moment and try again.');
        }
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
            // M4 fix: three key names for backward compat with different client versions.
            // web_search_enabled is canonical, others are legacy aliases.
            web_search_enabled,
            webSearchEnabled,
            enableWebSearch,
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
        const webSearchRequested = !!(web_search_enabled || webSearchEnabled || enableWebSearch);
        const webSearchFallback = !!web_search_fallback_requested;
        const webSearchUsed = !!web_search_used;

        if (!webSearchRequested) {
            const systemMsg = {
                role: 'system',
                content: 'You do not have access to the internet or web search in this conversation. Do not attempt to search the web, generate search queries, or reference real-time information. If asked about current events or live data, honestly tell the user you cannot access the web and suggest they enable web search.'
            };
            const reversedIndex = [...messages].reverse().findIndex(m => m.role === 'user');
            if (reversedIndex !== -1) {
                const targetIndex = messages.length - 1 - reversedIndex;
                messages.splice(targetIndex, 0, systemMsg);
            } else {
                messages.push(systemMsg);
            }
        }

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

        const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
        const { hasImage, hasFile } = detectAttachments(lastUserMessage ? [lastUserMessage] : []);
        const toolsToPass: any[] = [];
        if (hasImage) {
            toolsToPass.push(TOOLS.analyze_image);
        }
        if (hasFile) {
            toolsToPass.push(TOOLS.process_file);
        }

        console.log('[chat-proxy] hasImage:', hasImage, 'hasFile:', hasFile, 
          'toolsToPass count:', toolsToPass.length,
          'lastUserMsg preview:', lastUserMessage?.content?.slice(0, 100));

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

        if (webSearchRequested && remainingCredits > 0) {
            toolsToPass.push(TOOLS.web_search);
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

        // Circuit breaker: block requests if OpenRouter is consistently failing
        if (!circuitAllow('openrouter')) {
            log.warn('Circuit breaker OPEN — OpenRouter unavailable');
            return await fail('upstream_unavailable', 503, 'AI service is temporarily unavailable. Please try again in a moment.');
        }

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
                circuitFailure('openrouter');
                log.error('OpenRouter upstream error', { status: openrouterResponse.status, body: errBody.slice(0, 300) });
            } else {
                circuitSuccess('openrouter');
            }

            if (!openrouterResponse.ok) {
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
                let keepaliveTimer: any = null;
                
                let currentMessages = [...messages];
                let rounds = 0;
                const maxRounds = 3;
                let emergencyRetryUsed = false;
                
                const toolCallCounts: Record<string, number> = {};
                const MAX_CALLS_PER_TOOL: Record<string, number> = { web_search: 3 };
                const analyzedImageIds = new Set<string>();
                const processedFileIds = new Set<string>();
                const searchedQueries = new Set<string>();

                const uploadedImageIds = new Set<string>();
                const uploadedFileIds = new Set<string>();
                for (const msg of messages) {
                    if (msg && typeof msg === 'object') {
                        const content = msg.content;
                        const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
                        
                        const imgRegex = /\[Attached Image:\s*([a-zA-Z0-9-]+)\]/g;
                        let imgMatch;
                        while ((imgMatch = imgRegex.exec(contentStr)) !== null) {
                            uploadedImageIds.add(imgMatch[1]);
                        }
                        
                        const fileRegex = /\[Attached File:\s*([a-zA-Z0-9-]+)\]/g;
                        let fileMatch;
                        while ((fileMatch = fileRegex.exec(contentStr)) !== null) {
                            uploadedFileIds.add(fileMatch[1]);
                        }
                    }
                }
                
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
                        // FIX 5: Missing Mid-Turn Credit Check
                        const { data: loopCreditsRow, error: loopCreditsErr } = await supabaseAdmin
                            .from('user_credits')
                            .select('remaining_credits')
                            .eq('user_id', user.id)
                            .single();
                        
                        const loopRemainingCredits = typeof loopCreditsRow?.remaining_credits === 'number'
                            ? loopCreditsRow.remaining_credits
                            : 0;

                        if (loopCreditsErr || loopRemainingCredits <= 0) {
                            try {
                                controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'Insufficient credits to continue.' })}\n\n`));
                            } catch { /* ignore */ }
                            break;
                        }

                        // M2 fix: tool result compression for rounds > 0
                        // Create new message objects instead of mutating in-place to avoid
                        // inconsistent state if a parallel tool fails after one success.
                        if (rounds > 0) {
                            currentMessages = currentMessages.map((msg) => {
                                if (msg && typeof msg === 'object' && msg.role === 'tool' && typeof msg.content === 'string') {
                                    const limit = msg.name === 'web_search' ? 6000
                                                : msg.name === 'process_file' ? 4000
                                                : 2000; // analyze_image and others
                                    if (msg.content.length > limit) {
                                        console.warn(`[chat-proxy] Tool result for ${msg.name} truncated to ${limit} chars`);
                                        return { ...msg, content: msg.content.slice(0, limit) + '\n[Truncated for efficiency]' };
                                    }
                                }
                                return msg;
                            });
                        }

                        const allLimitsReached = toolsToPass.length > 0 && toolsToPass.every((tool: any) => {
                            const name = tool.function?.name;
                            if (name === 'web_search') {
                                return (toolCallCounts['web_search'] || 0) >= 3;
                            }
                            if (name === 'analyze_image') {
                                return uploadedImageIds.size === 0 || Array.from(uploadedImageIds).every(id => analyzedImageIds.has(id));
                            }
                            if (name === 'process_file') {
                                return uploadedFileIds.size === 0 || Array.from(uploadedFileIds).every(id => processedFileIds.has(id));
                            }
                            return false;
                        });
                        const isLastRound = rounds >= maxRounds - 1;

                        if (allLimitsReached || isLastRound) {
                            currentMessages.push({
                                role: 'system',
                                content: 'FINAL RESPONSE REQUIRED: Generate a complete, helpful response now using only the search results and information already retrieved above. Do not output search queries. Do not reference needing more searches. Write a direct, useful answer to the user.'
                            });
                        }

                        // Remove any previous format contract messages to avoid duplication
                        const filteredMessages = currentMessages.filter(
                          m => !(m.role === 'system' && m.content?.includes('## Response Format — MANDATORY'))
                        );
                        
                        const hasToolResults = rounds > 0;
                        const formatContract = buildResponseFormatContract(hasToolResults, webSearchRequested);
                        
                        // Insert format contract as second-to-last message 
                        // (just before the last user message)
                        const lastUserIdx = [...filteredMessages].map(m => m.role).lastIndexOf('user');
                        if (lastUserIdx !== -1) {
                          filteredMessages.splice(lastUserIdx, 0, {
                            role: 'system',
                            content: formatContract
                          });
                        } else {
                          filteredMessages.push({ role: 'system', content: formatContract });
                        }

                        const requestBody: any = {
                            model: effectiveModel,
                            messages: filteredMessages,
                            stream: true,
                            max_tokens: resolvedMaxTokens,
                            max_completion_tokens: resolvedMaxTokens,
                            include_usage: true,
                            ...(response_format ? { response_format } : {}),
                            ...(provider ? { provider } : {}),
                            ...(is_reasoning ? { reasoning: { enabled: true } } : {}),
                        };

                        if (toolsToPass.length > 0 && rounds < maxRounds - 1 && !allLimitsReached) {
                            requestBody.tools = toolsToPass;
                            requestBody.tool_choice = 'auto';
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
                            circuitFailure('openrouter');
                            log.error('OpenRouter stream error', { status: openrouterResponse.status, body: errBody.slice(0, 300) });
                            throw new Error(`OpenRouter upstream error ${openrouterResponse.status}: ${errBody}`);
                        }
                        circuitSuccess('openrouter');

                        const reader = openrouterResponse.body!.getReader();
                        
                        let isToolCall = false;
                        const firstChunks: Uint8Array[] = [];
                        const flushedChunks: boolean[] = [];
                        let accumulatedText = '';
                        let chunkCount = 0;

                        outerLoop: while (true) {
                            if (chunkCount >= 1000) {
                                isToolCall = false;
                                break;
                            }

                            const { done, value } = await reader.read();
                            if (done) break;
                            if (value) {
                                chunkCount++;
                                firstChunks.push(value);
                                flushedChunks.push(false);
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
                                            if (typeof choice.delta?.content === 'string' && choice.delta.content.trim().length > 0) {
                                                isToolCall = false;
                                                break outerLoop;
                                            }
                                            const reasoning = choice.delta?.reasoning || choice.delta?.reasoning_content;
                                            if (typeof reasoning === 'string' && reasoning.trim().length > 0) {
                                                if (!flushedChunks[flushedChunks.length - 1]) {
                                                    try {
                                                        controller.enqueue(value);
                                                    } catch { /* ignore */ }
                                                    flushedChunks[flushedChunks.length - 1] = true;
                                                }
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
                            // Bug Fix: Remove data: [DONE] so the client doesn't disconnect prematurely!
                            let unflushedText = '';
                            for (let i = 0; i < firstChunks.length; i++) {
                                if (!flushedChunks[i]) {
                                    unflushedText += decoder.decode(firstChunks[i], { stream: true });
                                }
                            }
                            let outputText = unflushedText.replace(/data:\s*\[DONE\][\r\n]*/g, '');
                            if (outputText) {
                                try {
                                    controller.enqueue(encoder.encode(outputText));
                                } catch { /* ignore */ }
                            }

                            // Start keepalive interval to prevent watchdog timeout during tool execution
                            keepaliveTimer = setInterval(() => {
                                try {
                                    controller.enqueue(encoder.encode(": keepalive\n\n"));
                                } catch { /* ignore */ }
                            }, 5000);

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
                                    let text = decoder.decode(value, { stream: true });
                                    parseText(text);
                                    text = text.replace(/data:\s*\[DONE\][\r\n]*/g, '');
                                    if (text) {
                                        try {
                                            controller.enqueue(encoder.encode(text));
                                        } catch { /* ignore */ }
                                    }
                                }
                            }

                            let toolCalls = Array.from(toolCallsMap.values());

                            // Validate and sanitize tool calls (FIX 1)
                            toolCalls = toolCalls.filter((tc) => {
                                if (!tc.name) {
                                    console.warn('[chat-proxy] Skipping tool call: missing function name', tc);
                                    return false;
                                }
                                if (!tc.id || tc.id.trim() === '') {
                                    tc.id = crypto.randomUUID();
                                }
                                return true;
                            });

                            if (toolCalls.length > 0) {
                                for (const tc of toolCalls) {
                                    let parsedArgs: any = {};
                                    let argsParsedSuccessfully = true;
                                    try { 
                                        parsedArgs = JSON.parse(tc.arguments); 
                                    } catch { 
                                        argsParsedSuccessfully = false; 
                                    }

                                    let label = '';
                                    if (argsParsedSuccessfully && parsedArgs && typeof parsedArgs === 'object') {
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
                                    } else {
                                        label = `Running ${tc.name}`;
                                        parsedArgs = {};
                                    }

                                    const eventPayload = {
                                        id: tc.id,
                                        tool: tc.name,
                                        status: 'running',
                                        label,
                                        args: parsedArgs
                                    };
                                    try {
                                        controller.enqueue(encoder.encode(`event: tool_activity\ndata: ${JSON.stringify(eventPayload)}\n\n`));
                                    } catch { /* ignore */ }
                                }

                                const parallelCalls = toolCalls.filter(tc => TOOLS[tc.name ?? '']?.parallelizable);
                                const sequentialCalls = toolCalls.filter(tc => !TOOLS[tc.name ?? '']?.parallelizable);

                                const toolResults: any[] = [];

                                const runTool = async (tc: any) => {
                                    const start = Date.now();
                                    let output = '';
                                    let success = true;
                                    let parsedArgs: any = {};
                                    let argsParsedSuccessfully = true;
                                    try { 
                                        parsedArgs = JSON.parse(tc.arguments); 
                                    } catch { 
                                        argsParsedSuccessfully = false; 
                                    }

                                    let durationMs = 0;

                                    // Old simple limits check removed (moved below arguments validation)

                                    // FIX 3: Malformed Arguments Crash Check
                                    if (!argsParsedSuccessfully) {
                                        success = false;
                                        output = 'Tool execution failed: could not parse tool arguments.';
                                        durationMs = Date.now() - start;

                                        toolsExecuted.push({
                                            id: tc.id!,
                                            name: tc.name!,
                                            arguments: tc.arguments,
                                            status: 'failed',
                                            durationMs
                                        });

                                        const eventPayload = {
                                            id: tc.id,
                                            tool: tc.name,
                                            status: 'failed',
                                            label: `Running ${tc.name}`,
                                            args: {},
                                            durationMs,
                                            output: output.slice(0, 400)
                                        };
                                        try {
                                            controller.enqueue(encoder.encode(`event: tool_activity\ndata: ${JSON.stringify(eventPayload)}\n\n`));
                                        } catch { /* ignore */ }

                                        return {
                                            tool_call_id: tc.id,
                                            role: 'tool',
                                            name: tc.name,
                                            content: output
                                        };
                                    }

                                    // BUG B Check: null/invalid arguments check
                                    if (!parsedArgs || typeof parsedArgs !== 'object') {
                                        success = false;
                                        output = 'Tool execution failed: arguments were null or invalid.';
                                        durationMs = Date.now() - start;

                                        toolsExecuted.push({
                                            id: tc.id!,
                                            name: tc.name!,
                                            arguments: tc.arguments,
                                            status: 'failed',
                                            durationMs
                                        });

                                        const eventPayload = {
                                            id: tc.id,
                                            tool: tc.name,
                                            status: 'failed',
                                            label: `Running ${tc.name}`,
                                            args: {},
                                            durationMs,
                                            output: output.slice(0, 400)
                                        };
                                        try {
                                            controller.enqueue(encoder.encode(`event: tool_activity\ndata: ${JSON.stringify(eventPayload)}\n\n`));
                                        } catch { /* ignore */ }

                                        return {
                                            tool_call_id: tc.id,
                                            role: 'tool',
                                            name: tc.name,
                                            content: output
                                        };
                                    }

                                    // FIX 4: Undefined Tool Name 404 Error Check
                                    const ALLOWED_TOOLS = ['analyze_image', 'process_file', 'web_search'];
                                    if (!ALLOWED_TOOLS.includes(tc.name)) {
                                        success = false;
                                        output = 'Tool execution failed: unknown tool name.';
                                        durationMs = Date.now() - start;

                                        toolsExecuted.push({
                                            id: tc.id!,
                                            name: tc.name!,
                                            arguments: tc.arguments,
                                            status: 'failed',
                                            durationMs
                                        });

                                        const eventPayload = {
                                            id: tc.id,
                                            tool: tc.name,
                                            status: 'failed',
                                            label: `Running ${tc.name}`,
                                            args: parsedArgs,
                                            durationMs,
                                            output: output.slice(0, 400)
                                        };
                                        try {
                                            controller.enqueue(encoder.encode(`event: tool_activity\ndata: ${JSON.stringify(eventPayload)}\n\n`));
                                        } catch { /* ignore */ }

                                        return {
                                            tool_call_id: tc.id,
                                            role: 'tool',
                                            name: tc.name,
                                            content: output
                                        };
                                    }

                                    // Check tool limits & deduplication
                                    const toolName = tc.name;
                                    let isLimitReached = false;
                                    let limitMsg = '';

                                    if (toolName === 'web_search') {
                                        const query = (parsedArgs?.query || '').trim().toLowerCase();
                                        const currentCount = toolCallCounts['web_search'] || 0;
                                        const maxForWebSearch = MAX_CALLS_PER_TOOL['web_search'] ?? 3;

                                        if (currentCount >= maxForWebSearch) {
                                            isLimitReached = true;
                                            limitMsg = 'Search limit reached for this message. Use results already retrieved.';
                                        } else if (query && searchedQueries.has(query)) {
                                            isLimitReached = true;
                                            limitMsg = 'Query already searched. Use results already retrieved.';
                                        }
                                        
                                        if (!isLimitReached) {
                                            toolCallCounts['web_search'] = currentCount + 1;
                                            if (query) {
                                                searchedQueries.add(query);
                                            }
                                        }
                                    } else if (toolName === 'analyze_image') {
                                        const imageIds = parsedArgs?.image_ids || [];
                                        if (Array.isArray(imageIds) && imageIds.length > 0) {
                                            const allAlreadyAnalyzed = imageIds.every((id: string) => analyzedImageIds.has(id));
                                            if (allAlreadyAnalyzed) {
                                                isLimitReached = true;
                                                limitMsg = 'Image already analyzed. Use results already retrieved.';
                                            } else {
                                                imageIds.forEach((id: string) => analyzedImageIds.add(id));
                                            }
                                        }
                                    } else if (toolName === 'process_file') {
                                        const fileId = parsedArgs?.file_id;
                                        if (fileId && typeof fileId === 'string') {
                                            if (processedFileIds.has(fileId)) {
                                                isLimitReached = true;
                                                limitMsg = 'File already processed. Use results already retrieved.';
                                            } else {
                                                processedFileIds.add(fileId);
                                            }
                                        }
                                    } else {
                                        // For any other/unknown tools, default to 1 count limit
                                        const currentCount = toolCallCounts[toolName] || 0;
                                        if (currentCount >= 1) {
                                            isLimitReached = true;
                                            limitMsg = 'Execution limit reached for this tool.';
                                        } else {
                                            toolCallCounts[toolName] = currentCount + 1;
                                        }
                                    }

                                    if (isLimitReached) {
                                        success = false;
                                        output = limitMsg;
                                        durationMs = Date.now() - start;

                                        toolsExecuted.push({
                                            id: tc.id!,
                                            name: tc.name!,
                                            arguments: tc.arguments,
                                            status: 'failed',
                                            durationMs
                                        });

                                        const eventPayload = {
                                            id: tc.id,
                                            tool: tc.name,
                                            status: 'failed',
                                            label: `Running ${tc.name}`,
                                            args: parsedArgs,
                                            durationMs,
                                            output: output.slice(0, 400)
                                        };
                                        try {
                                            controller.enqueue(encoder.encode(`event: tool_activity\ndata: ${JSON.stringify(eventPayload)}\n\n`));
                                        } catch { /* ignore */ }

                                        return {
                                            tool_call_id: tc.id,
                                            role: 'tool',
                                            name: tc.name,
                                            content: output
                                        };
                                    }

                                    let timerId: any;
                                    let res: any = null;
                                    try {
                                        let siblingName = tc.name;
                                        if (tc.name === 'analyze_image') siblingName = 'describe-image';
                                        if (tc.name === 'process_file') siblingName = 'get-file-content';
                                        if (tc.name === 'web_search') siblingName = 'web-search';

                                        const executionPromise = callSiblingFunction(siblingName, parsedArgs);
                                        const timeoutPromise = new Promise<never>((_, reject) => {
                                            timerId = setTimeout(() => reject(new Error('timeout')), 12000);
                                        });

                                        res = await Promise.race([executionPromise, timeoutPromise]);
                                        output = res.description ?? res.content ?? res.text ?? JSON.stringify(res);
                                    } catch (err: any) {
                                        success = false;
                                        if (err.message === 'timeout') {
                                            output = 'Tool execution timed out. Please try again.';
                                        } else {
                                            output = 'The requested information could not be retrieved. Please continue without it.';
                                        }
                                    } finally {
                                        if (timerId) clearTimeout(timerId);
                                    }

                                    durationMs = Date.now() - start;
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
                                    try {
                                        controller.enqueue(encoder.encode(`event: tool_activity\ndata: ${JSON.stringify(eventPayload)}\n\n`));
                                    } catch { /* ignore */ }

                                    if (success && tc.name === 'web_search' && res && res.organic && Array.isArray(res.organic) && res.organic.length > 0) {
                                        const urls = res.organic.map((r: any) => ({
                                            title: r.title,
                                            url: r.link,
                                            snippet: r.snippet
                                        }));
                                        const resultsPayload = {
                                            urls,
                                            query: parsedArgs.query
                                        };
                                        try {
                                            controller.enqueue(encoder.encode(`event: web_search_results\ndata: ${JSON.stringify(resultsPayload)}\n\n`));
                                        } catch { /* ignore */ }
                                    }

                                    // FIX 2: Truncate oversized tool results before returning (12,000 limit)
                                    let finalOutput = output;
                                    if (output.length > 12000) {
                                        console.warn(`[chat-proxy] Tool result for ${tc.name} truncated from ${output.length} characters.`);
                                        finalOutput = output.slice(0, 12000) + '\n\n[Result truncated for length]';
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
                            if (keepaliveTimer) {
                                clearInterval(keepaliveTimer);
                                keepaliveTimer = null;
                            }
                            rounds++;
                            continue;
                        } else {
                            // Collect all final response chunks
                            let accumulatedFinalText = '';
                            const finalChunks: Uint8Array[] = [];
                            
                            const collectChunk = (chunkVal: Uint8Array) => {
                              finalChunks.push(chunkVal);
                              const text = decoder.decode(chunkVal, { stream: true });
                              const lines = text.split('\n');
                              for (const line of lines) {
                                if (!line.trim().startsWith('data: ')) continue;
                                const dataStr = line.trim().slice(6);
                                if (dataStr === '[DONE]') { finalSawDone = true; continue; }
                                try {
                                  const parsed = JSON.parse(dataStr);
                                  if (parsed.usage) {
                                    totalPromptTokens += parsed.usage.prompt_tokens || 0;
                                    totalCompletionTokens += parsed.usage.completion_tokens || 0;
                                    totalReasoningTokens += getReasoningTokens(parsed.usage) || 0;
                                  }
                                  if (parsed.error) {
                                    finalStreamError = parsed.error.message ?? 'stream error';
                                  }
                                  const choice = parsed.choices?.[0];
                                  const delta = choice?.delta;
                                  if (delta) {
                                    accumulatedFinalText += delta.content || delta.reasoning || 
                                                            delta.reasoning_content || '';
                                  }
                                } catch { /* skip */ }
                              }
                            };

                            // Collect firstChunks that weren't already flushed
                            for (let i = 0; i < firstChunks.length; i++) {
                              if (!flushedChunks[i]) collectChunk(firstChunks[i]);
                            }

                            // Collect remaining stream
                            while (true) {
                              const { done, value } = await reader.read();
                              if (done) break;
                              if (value) collectChunk(value);
                            }

                            // Validate output
                            const validation = validateModelOutput(accumulatedFinalText);

                            if (validation.valid) {
                              // Valid output — stream it
                              if (validation.type === 'artifact') {
                                // Artifact: stream raw chunks as-is (frontend handles parsing)
                                controller.enqueue(encoder.encode(
                                  `event: content_start\ndata: ${JSON.stringify({ 
                                    after_tool_calls: rounds > 0, model: effectiveModel 
                                  })}\n\n`
                                ));
                                for (const chunk of finalChunks) {
                                  controller.enqueue(chunk);
                                }
                              } else {
                                // plain/final/raw: synthesize a clean single response chunk
                                controller.enqueue(encoder.encode(
                                  `event: content_start\ndata: ${JSON.stringify({ 
                                    after_tool_calls: rounds > 0, model: effectiveModel 
                                  })}\n\n`
                                ));
                                const cleanChunk = {
                                  choices: [{
                                    delta: { content: validation.content },
                                    finish_reason: 'stop'
                                  }]
                                };
                                controller.enqueue(encoder.encode(
                                  `data: ${JSON.stringify(cleanChunk)}\n\n`
                                ));
                                controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                              }
                              break;

                            } else if (!emergencyRetryUsed && rounds < maxRounds) {
                              // Invalid output — one emergency retry
                              emergencyRetryUsed = true;
                              currentMessages.push({
                                role: 'assistant',
                                content: accumulatedFinalText || '[no response]'
                              });
                              currentMessages.push({
                                role: 'system',
                                content: 'Your previous response did not follow the required format. You MUST wrap your response in <lucen_response type="final">...</lucen_response> tags. Do NOT use any XML tool tags. Write your complete answer now.'
                              });
                              // Do NOT increment rounds — this is a format correction, not a tool call
                              continue;

                            } else {
                              // Both attempts failed — stream neutral fallback
                              controller.enqueue(encoder.encode(
                                `event: content_start\ndata: ${JSON.stringify({ 
                                  after_tool_calls: rounds > 0, model: effectiveModel 
                                })}\n\n`
                              ));
                              const fallbackContent = 'I apologize, but I encountered a formatting issue while generating my response. Please ask your question again and I\'ll try a different approach.';
                              const fallbackChunk = {
                                choices: [{
                                  delta: { content: fallbackContent },
                                  finish_reason: 'stop'
                                }]
                              };
                              controller.enqueue(encoder.encode(
                                `data: ${JSON.stringify(fallbackChunk)}\n\n`
                              ));
                              controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                              break;
                            }
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
                        // H11 fix: log AND alert on deduction failure — don't silently swallow
                        console.error('[chat-proxy] CRITICAL: Failed to deduct stream credits:', dbErr);
                        // Send error event to client so they know billing failed
                        try {
                            controller.enqueue(encoder.encode(
                                `event: error\ndata: ${JSON.stringify({ error: 'Credit deduction failed. Your balance may be inaccurate.', code: 'BILLING_ERROR' })}\n\n`
                            ));
                        } catch { /* stream already closed */ }
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
                    if (keepaliveTimer) {
                        clearInterval(keepaliveTimer);
                    }
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
                'X-Accel-Buffering': 'no',
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
