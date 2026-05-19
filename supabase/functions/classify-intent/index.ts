import { getCorsHeaders } from '../_shared/cors.ts';
import { recordUsage, type UsageStatus } from '../_shared/usage.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TAVILY_URL = 'https://api.tavily.com/search';
// Intent classifier model — env-driven. Set WEB_INTENT_MODEL in Supabase
// function secrets to any capable OpenRouter model (small/cheap preferred).
const INTENT_MODEL = Deno.env.get('WEB_INTENT_MODEL') || 'openai/gpt-4o-mini';

// Optional per-1M rates for the intent model so real USD cost is tracked.
// If unset we still log the row but `usd_cost` will be 0.
const INTENT_INPUT_COST_PER_1M = Number(
    Deno.env.get('WEB_INTENT_INPUT_COST_PER_1M') ?? '0',
);
const INTENT_OUTPUT_COST_PER_1M = Number(
    Deno.env.get('WEB_INTENT_OUTPUT_COST_PER_1M') ?? '0',
);

// Tavily is billed $4 per 1,000 searches. One row per search.
const TAVILY_USD_PER_1K_SEARCHES = 4;
const TAVILY_MAX_RESULTS = 5;
const WEBSEARCH_DEBUG = (Deno.env.get('WEBSEARCH_DEBUG') || '').toLowerCase() === 'true';

const INTENT_SYSTEM = `You are a highly intelligent web search intent classifier. The user has enabled Web Search. Your job is to analyze the conversation history and generate the optimal search query or ask a clarifying question.

### Rules for Deciding the State:
1. "search": Return this when the request can be resolved with a web search. You must construct a high-quality, specific query in the "query" field.
2. "skip": Return this only for truly trivial messages (pure greetings/thanks, "ok", "cool") or purely personal/subjective queries where web search adds no value.
3. "clarify": Return this when the user's request is extremely ambiguous or missing a critical keyword (e.g., they ask "what's the price?" but don't specify the product) such that you cannot construct any meaningful search query.

### Conversational Intelligence & Clarification Handling:
1. If the conversation history shows that you (the assistant) already asked a clarifying question, and the user is responding to it:
   - If the user's response is a broad/general term (e.g., "everything", "all of it", "technical details", "all details", "any"), DO NOT ask for clarification again. Doing so creates an infinite loop. Instead, realize they want a comprehensive query, set state to "search", and generate a high-quality broad query covering the entire topic (e.g., "chatbot deep context memory implementation details vector database architecture").
   - If the user provides a specific answer (e.g., "Pinecone"), synthesize this with the original request and generate a specific query: "implement deep context memory Pinecone vector db".
2. If you return "clarify", the "question" field must contain a polite, human-like question (e.g., "Could you specify which product or model you are asking about?"). Never mention system internals, "web search", "intent", or "JSON".

### Query Writing Standards:
- Generate a highly optimized search query that retrieves the best possible web results.
- Synthesize all relevant conversation history into the query (do not just use the user's last message if it depends on previous context).
- DO NOT use lazy shorthands. Expand terms if helpful.

Respond ONLY with raw JSON in this format:
{"state":"search","query":"optimal search query","question":null}
or
{"state":"skip","query":null,"question":null}
or
{"state":"clarify","query":null,"question":"polite clarifying question"}`;

function extractText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return (content as Array<Record<string, unknown>>)
            .filter((p) => !!p && p.type === 'text')
            .map((p) => String(p.text || ''))
            .join(' ');
    }
    return '';
}

function truncate(text: string, max: number): string {
    const t = (text || '').trim();
    if (t.length <= max) return t;
    return t.slice(0, max) + '…';
}

function isTrivialGreeting(text: string): boolean {
    const t = (text || '').trim().toLowerCase();
    if (!t) return true;
    return /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|great|cool|perfect|lol|haha|done|stop|wait|go ahead|continue|agreed|nice|awesome)[\s!.?]*$/.test(t);
}

function hasExplicitSearchRequest(text: string): boolean {
    const t = (text || '').toLowerCase();
    return /\b(use web|use the web|web search|search the web|search online|google|find real reviews|real reviews|reviews|sources|citations|latest|current|today|this week|2026|price in|availability|where to buy|news)\b/.test(t);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const base64 = token.split('.')[1];
        const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
        return JSON.parse(json);
    } catch {
        return null;
    }
}

Deno.serve(async (req: Request) => {
    const cors = getCorsHeaders(req);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

    // Accounting for the classify_intent call itself.
    const startedAt = Date.now();
    const intentAccounting = {
        finalized: false,
        userId: null as string | null,
        requestId: null as string | null,
        parentRequestId: null as string | null,
        conversationId: null as string | null,
        messageId: null as string | null,
        status: 'completed' as UsageStatus,
        statusReason: null as string | null,
        errorMessage: null as string | null,
        promptTokens: 0,
        completionTokens: 0,
    };

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            intentAccounting.finalized = true;
            intentAccounting.status = 'auth_error';
            intentAccounting.errorMessage = 'Unauthorized';
            await recordUsage({
                userId: 'unknown',
                callKind: 'classify_intent',
                status: 'auth_error',
                errorMessage: 'Unauthorized',
                modelId: INTENT_MODEL,
                durationMs: Date.now() - startedAt,
            });
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (!token || token.split('.').length !== 3) {
            intentAccounting.finalized = true;
            await recordUsage({
                userId: 'unknown',
                callKind: 'classify_intent',
                status: 'auth_error',
                errorMessage: 'Invalid token format',
                modelId: INTENT_MODEL,
                durationMs: Date.now() - startedAt,
            });
            return new Response(JSON.stringify({ error: 'Invalid token' }), {
                status: 401,
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        const claims = decodeJwtPayload(token);
        const claimUserId = (claims?.sub as string | undefined) ?? null;
        const expiry = (claims?.exp as number | undefined) ?? 0;
        if (!claimUserId) {
            intentAccounting.finalized = true;
            await recordUsage({
                userId: 'unknown',
                callKind: 'classify_intent',
                status: 'auth_error',
                errorMessage: 'JWT missing sub',
                modelId: INTENT_MODEL,
                durationMs: Date.now() - startedAt,
            });
            return new Response(JSON.stringify({ error: 'Invalid token' }), {
                status: 401,
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }
        if (expiry && expiry < Math.floor(Date.now() / 1000)) {
            intentAccounting.finalized = true;
            await recordUsage({
                userId: claimUserId,
                callKind: 'classify_intent',
                status: 'auth_error',
                errorMessage: 'Token expired',
                modelId: INTENT_MODEL,
                durationMs: Date.now() - startedAt,
            });
            return new Response(JSON.stringify({ error: 'Token expired' }), {
                status: 401,
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        // Validate against Supabase admin to make sure the JWT really belongs
        // to a live user (revoked tokens still decode).
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        let userId: string | null = claimUserId;
        if (supabaseUrl && serviceKey) {
            try {
                const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
                const { data, error } = await admin.auth.admin.getUserById(claimUserId);
                if (error || !data?.user) {
                    userId = null;
                }
            } catch (err) {
                console.warn('[classify-intent] admin.getUserById failed:', err);
                // Fall through with decoded userId — logging still uses it.
            }
        }
        if (!userId) {
            intentAccounting.finalized = true;
            await recordUsage({
                userId: claimUserId,
                callKind: 'classify_intent',
                status: 'auth_error',
                errorMessage: 'User not found',
                modelId: INTENT_MODEL,
                durationMs: Date.now() - startedAt,
            });
            return new Response(JSON.stringify({ error: 'User not found' }), {
                status: 401,
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }
        intentAccounting.userId = userId;

        const openrouterApiKey = Deno.env.get('OPENROUTER_API_KEY');
        const tavilyApiKey = Deno.env.get('TAVILY_API_KEY');

        const body = await req.json().catch(() => ({}));
        const {
            messages,
            request_id,
            parent_request_id,
            conversation_id,
            message_id,
            search_request_id,
        } = body ?? {};

        const searchReqId = search_request_id || request_id;

        if (typeof request_id === 'string') intentAccounting.requestId = request_id;
        if (typeof parent_request_id === 'string') intentAccounting.parentRequestId = parent_request_id;
        if (typeof conversation_id === 'string') intentAccounting.conversationId = conversation_id;
        if (typeof message_id === 'string') intentAccounting.messageId = message_id;

        if (!Array.isArray(messages) || messages.length === 0) {
            intentAccounting.finalized = true;
            intentAccounting.status = 'completed';
            intentAccounting.statusReason = 'empty_messages_skipped';
            await recordUsage({
                userId: userId ?? 'unknown',
                conversationId: intentAccounting.conversationId,
                messageId: intentAccounting.messageId,
                requestId: intentAccounting.requestId,
                parentRequestId: intentAccounting.parentRequestId,
                callKind: 'classify_intent',
                status: 'completed',
                statusReason: 'empty_messages_skipped',
                modelId: INTENT_MODEL,
                durationMs: Date.now() - startedAt,
            });
            return new Response(JSON.stringify({ state: 'skip', query: null }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        // Increase context window to the last 10 messages (5 turns) to capture the original request and clarification flow.
        const contextWindow = messages.slice(-10);
        const lastUserMsg = [...contextWindow].reverse().find((m: any) => m?.role === 'user');
        const lastUserText = truncate(extractText(lastUserMsg?.content).trim(), 1200);
        const explicitSearch = hasExplicitSearchRequest(lastUserText);

        // Deterministic gates BEFORE model call.
        if (isTrivialGreeting(lastUserText)) {
            const payload = WEBSEARCH_DEBUG ? {
                state: 'skip',
                query: null,
                _debug: {
                    reason: 'trivial_greeting',
                    lastUserText: truncate(lastUserText, 200),
                },
            } : { state: 'skip', query: null };
            return new Response(JSON.stringify(payload), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }
        const forcedIntent: Record<string, unknown> | null = explicitSearch
            ? { state: 'search', query: lastUserText }
            : null;

        // Check if the assistant recently asked a clarifying question
        let alreadyClarified = false;
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (m && m.role === 'assistant') {
                const text = extractText(m.content);
                if (text.includes('Search paused') || text.includes('I need a bit more info') || text.includes('Clarification needed')) {
                    alreadyClarified = true;
                    break;
                }
            }
        }

        // Increase character slice to 1200 characters per message to capture details while remaining token-efficient.
        const conversationText = contextWindow
            .filter((m: any) => m.role === 'user' || m.role === 'assistant')
            .map((m: any) => (m.role === 'user' ? 'User: ' : 'Assistant: ') + extractText(m.content).slice(-1200))
            .join('\n');

        const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        // Phase 1: classify intent
        console.log('[DEBUG] Classify Intent Input Context:', conversationText);

        let intent: Record<string, unknown> = forcedIntent ?? { state: 'search', query: null };
        let cleaned = '';

        if (!forcedIntent) {
            let systemPrompt = INTENT_SYSTEM + "\nToday's exact date is: " + currentDate + ". If the user asks for upcoming events, YOU MUST explicitly include the current month and year in your query output (e.g. 'April 2026 real madrid fixtures').";
            if (alreadyClarified) {
                systemPrompt += "\n\nCRITICAL WARNING: You have already asked a clarifying question in this conversation. You are STRICTLY FORBIDDEN from returning 'clarify' on this turn. You MUST choose 'search' (synthesizing the user's latest response with context into a broad query) or 'skip'.";
            }

            const orPayload = {
                model: INTENT_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: 'Conversation:\n' + conversationText + '\n\nClassify intent.' }
                ],
                max_tokens: 120,
                stream: false,
                temperature: 0,
            };
            console.log('[DEBUG] OpenRouter Intent Payload:', JSON.stringify(orPayload));

            const orResponse = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openrouterApiKey}` },
                body: JSON.stringify(orPayload),
            });

            if (!orResponse.ok) {
                const errText = await orResponse.text().catch(() => '');
                intentAccounting.finalized = true;
                intentAccounting.status = 'upstream_error';
                intentAccounting.errorMessage = `HTTP ${orResponse.status}`;
                intentAccounting.statusReason = errText.slice(0, 500);
                await recordUsage({
                    userId: userId ?? 'unknown',
                    conversationId: intentAccounting.conversationId,
                    messageId: intentAccounting.messageId,
                    requestId: intentAccounting.requestId,
                    parentRequestId: intentAccounting.parentRequestId,
                    callKind: 'classify_intent',
                    status: 'upstream_error',
                    statusReason: intentAccounting.statusReason,
                    errorMessage: intentAccounting.errorMessage,
                    modelId: INTENT_MODEL,
                    durationMs: Date.now() - startedAt,
                    inputCostPer1M: INTENT_INPUT_COST_PER_1M,
                    outputCostPer1M: INTENT_OUTPUT_COST_PER_1M,
                });
                // Fall back to a permissive response so caller can proceed.
                return new Response(JSON.stringify({
                    state: 'search', query: null, results: null,
                    _debug: { error: `OpenRouter Intent API failed: HTTP ${orResponse.status} ${errText.slice(0, 200)}` }
                }), {
                    headers: { ...cors, 'Content-Type': 'application/json' },
                });
            }

            const orData = await orResponse.json();
            console.log('[DEBUG] OpenRouter RAW Response:', JSON.stringify(orData));

            const usage = orData?.usage || {};
            intentAccounting.promptTokens = Number(usage.prompt_tokens) || 0;
            intentAccounting.completionTokens = Number(usage.completion_tokens) || 0;

            const raw = orData?.choices?.[0]?.message?.content || '';
            cleaned = raw.replace(/```json|```/g, '').trim();

            try {
                intent = JSON.parse(cleaned);
                console.log('[DEBUG] Parsed Intent State:', JSON.stringify(intent));
                
                // Code-level safety fallback: if already clarified but model still returned clarify, override
                if (alreadyClarified && intent.state === 'clarify') {
                    console.log('[DEBUG] Loop prevention: already clarified once. Overriding clarify to search.');
                    intent = {
                        state: 'search',
                        query: lastUserText
                    };
                }
            } catch {
                console.log('[DEBUG] Failed to parse intent JSON, defaulting to search');
                intent = { state: 'search', query: null };
            }
        } else {
            // Forced search trigger: treat as a completed classifier decision.
            intentAccounting.promptTokens = 0;
            intentAccounting.completionTokens = 0;
        }

        // Log the classify_intent row now, BEFORE potentially kicking off the
        // Tavily call (so even if Tavily fails we still have the intent row).
        intentAccounting.finalized = true;
        intentAccounting.status = 'completed';
        intentAccounting.statusReason = forcedIntent ? `state=${intent.state}(forced_trigger)` : `state=${intent.state}`;
        await recordUsage({
            userId: userId ?? 'unknown',
            conversationId: intentAccounting.conversationId,
            messageId: intentAccounting.messageId,
            requestId: intentAccounting.requestId,
            parentRequestId: intentAccounting.parentRequestId,
            callKind: 'classify_intent',
            status: 'completed',
            statusReason: intentAccounting.statusReason,
            modelId: INTENT_MODEL,
            durationMs: Date.now() - startedAt,
            promptTokens: intentAccounting.promptTokens,
            completionTokens: intentAccounting.completionTokens,
            inputCostPer1M: INTENT_INPUT_COST_PER_1M,
            outputCostPer1M: INTENT_OUTPUT_COST_PER_1M,
        });

        const debugBlock = WEBSEARCH_DEBUG ? {
            intentModel: INTENT_MODEL,
            conversationTextLen: conversationText.length,
            lastUserText: truncate(lastUserText, 420),
            intentRawContent: truncate(cleaned, 600),
            intentParsed: intent,
            searchRequestId: searchReqId,
        } : undefined;

        // If skip or clarify, return immediately — no search
        if (intent.state !== 'search') {
            const payload = debugBlock ? { ...(intent as any), _debug: debugBlock } : intent;
            return new Response(JSON.stringify(payload), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        // Phase 2: if state=search and tavily available, do the actual search here
        const query = String(intent.query || lastUserText || '');

        if (!tavilyApiKey) {
            await recordUsage({
                userId: userId ?? 'unknown',
                conversationId: intentAccounting.conversationId,
                messageId: intentAccounting.messageId,
                requestId: searchReqId,
                parentRequestId: intentAccounting.requestId,
                callKind: 'web_search',
                status: 'internal_error',
                statusReason: 'TAVILY_API_KEY missing',
                errorMessage: 'Tavily API key is not configured in Supabase secrets.',
                modelId: 'tavily',
                provider: 'tavily',
                durationMs: Date.now() - startedAt,
                webSearchEnabled: true,
            });
            return new Response(JSON.stringify({
                state: 'search', query, results: null,
                _debug: { error: 'TAVILY_API_KEY is not configured on the server.' }
            }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        console.log('[DEBUG] Firing Tavily SEARCH. Query:', query);

        const tavilyPayload = {
            api_key: tavilyApiKey.replace(/['"]/g, '').trim(),
            query: query,
            search_depth: "basic",
            include_answer: true,
            max_results: TAVILY_MAX_RESULTS,
        };

        const tavilyStartedAt = Date.now();
        const searchResponse = await fetch(TAVILY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tavilyPayload),
        });

        console.log('[Tavily] status:', searchResponse.status);
        const searchRaw = await searchResponse.text();

        if (!searchResponse.ok) {
            console.error('[Tavily] failed with status:', searchResponse.status, searchRaw);
            await recordUsage({
                userId: userId ?? 'unknown',
                conversationId: intentAccounting.conversationId,
                messageId: intentAccounting.messageId,
                requestId: searchReqId,
                parentRequestId: intentAccounting.requestId,
                callKind: 'web_search',
                status: 'upstream_error',
                statusReason: `HTTP ${searchResponse.status}`,
                errorMessage: searchRaw.slice(0, 500),
                modelId: 'tavily',
                provider: 'tavily',
                durationMs: Date.now() - tavilyStartedAt,
                webSearchEnabled: true,
                webSearchEngine: 'tavily',
                webSearchMaxResults: TAVILY_MAX_RESULTS,
                webSearchResultsBilled: 0,
            });
            return new Response(JSON.stringify({
                state: 'search', query, results: null,
                _debug: {
                    searchRequestId: searchReqId,
                    tavilyPayload,
                    tavilyResponse: searchRaw,
                    error: `HTTP ${searchResponse.status}`
                }
            }), {
                headers: { ...cors, 'Content-Type': 'application/json' }
            });
        }

        const searchData = JSON.parse(searchRaw);

        // Extract clean results
        const organic = (searchData.results || []).map((r: Record<string, unknown>) => ({
            title: r.title,
            snippet: r.content,
            link: r.url,
        }));

        const answerBox = searchData.answer ? { answer: searchData.answer } : null;

        // Real USD cost for Tavily: max_results / 1000 * $4.
        const tavilyUsdCost = (TAVILY_MAX_RESULTS / 1000) * TAVILY_USD_PER_1K_SEARCHES;

        await recordUsage({
            userId: userId ?? 'unknown',
            conversationId: intentAccounting.conversationId,
            messageId: intentAccounting.messageId,
            requestId: searchReqId,
            parentRequestId: intentAccounting.requestId,
            callKind: 'web_search',
            status: 'completed',
            statusReason: `results=${organic.length}`,
            modelId: 'tavily',
            provider: 'tavily',
            durationMs: Date.now() - tavilyStartedAt,
            // Tavily is a per-search product, not token-based. We bypass the
            // tokens × rates computation by passing the USD cost directly.
            fixedUsdCost: tavilyUsdCost,
            webSearchEnabled: true,
            webSearchEngine: 'tavily',
            webSearchMaxResults: TAVILY_MAX_RESULTS,
            webSearchResultsBilled: TAVILY_MAX_RESULTS,
            // Note: chat-proxy is what actually deducts LC for web search;
            // this row is purely observational.
            webSearchCredits: 0,
        });

        return new Response(JSON.stringify({
            state: 'search',
            query,
            results: { organic, answerBox, knowledgeGraph: null },
            _debug: {
                searchRequestId: searchReqId,
                tavilyPayload,
                tavilyResponse: searchData
            }
        }), { headers: { ...cors, 'Content-Type': 'application/json' } });

    } catch (err) {
        if (!intentAccounting.finalized) {
            intentAccounting.finalized = true;
            intentAccounting.status = 'upstream_error';
            intentAccounting.errorMessage = err instanceof Error ? err.message : 'unknown';
            await recordUsage({
                userId: intentAccounting.userId ?? 'unknown',
                conversationId: intentAccounting.conversationId,
                messageId: intentAccounting.messageId,
                requestId: intentAccounting.requestId,
                parentRequestId: intentAccounting.parentRequestId,
                callKind: 'classify_intent',
                status: 'upstream_error',
                errorMessage: intentAccounting.errorMessage,
                modelId: INTENT_MODEL,
                durationMs: Date.now() - startedAt,
                inputCostPer1M: INTENT_INPUT_COST_PER_1M,
                outputCostPer1M: INTENT_OUTPUT_COST_PER_1M,
            });
            return new Response(JSON.stringify({ error: intentAccounting.errorMessage }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
        } else {
            // Phase 2 crashed
            console.error('[classify-intent] Phase 2 crash:', err);
            return new Response(JSON.stringify({
                state: 'search', query: null, results: null,
                _debug: { error: `Phase 2 crash: ${err instanceof Error ? err.message : 'unknown'}` }
            }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }
    }
});
