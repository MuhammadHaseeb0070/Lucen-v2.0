import { getCorsHeaders } from '../_shared/cors.ts';
import { recordUsage, type UsageStatus } from '../_shared/usage.ts';

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

const INTENT_SYSTEM = `You are a web search intent classifier. Analyze the conversation and decide if the latest user message needs a real-time web search.

If a search is needed, you MUST craft a hyper-specific, Google-optimized search query. DO NOT use lazy shorthands (e.g., never use 'real madrid schedule'). Instead, explicitly expand the topic to cast a wide net (e.g., 'Real Madrid upcoming fixture schedule all competitions Champions League La Liga').

Respond ONLY with raw JSON. No markdown. No backticks. Just JSON.

Formats:
{"state":"search","query":"highly descriptive, specific search engine query"}
{"state":"skip","query":null}
{"state":"clarify","query":null,"question":"one specific question"}

Rules:
- search: live scores, schedules, news, realtime data, OR if the user explicitly demands a search, OR if they paste a URL/link. If they paste a URL, the query MUST contain that URL.
- skip: greetings, math, code, explanations, things already in conversation. (WARNING: Do not skip if user pasted a URL or explicitly said 'search for').`;

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
        const claims = token ? decodeJwtPayload(token) : null;
        const userId = (claims?.sub as string | undefined) ?? null;
        if (userId) intentAccounting.userId = userId;

        const openrouterApiKey = Deno.env.get('OPENROUTER_API_KEY');
        const tavilyApiKey = Deno.env.get('TAVILY_API_KEY');

        const body = await req.json().catch(() => ({}));
        const {
            messages,
            request_id,
            parent_request_id,
            conversation_id,
            message_id,
        } = body ?? {};

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

        const extractText = (content: unknown): string => {
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) return (content as Array<Record<string, unknown>>).filter(p => !!p && p.type === 'text').map(p => String(p.text || '')).join(' ');
            return '';
        };

        const contextWindow = messages.slice(-6);
        const conversationText = contextWindow
            .filter((m: any) => m.role === 'user' || m.role === 'assistant')
            .map((m: any) => (m.role === 'user' ? 'User: ' : 'Assistant: ') + extractText(m.content).slice(0, 400))
            .join('\n');

        const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        // Phase 1: classify intent
        console.log('[DEBUG] Classify Intent Input Context:', conversationText);

        const orPayload = {
            model: INTENT_MODEL,
            messages: [
                { role: 'system', content: INTENT_SYSTEM + "\nToday's exact date is: " + currentDate + ". If the user asks for upcoming events, YOU MUST explicitly include the current month and year in your query output (e.g. 'April 2026 real madrid fixtures')." },
                { role: 'user', content: "Conversation:\n" + conversationText + "\n\nClassify intent." }
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
            return new Response(JSON.stringify({ state: 'search', query: null, results: null }), {
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        const orData = await orResponse.json();
        console.log('[DEBUG] OpenRouter RAW Response:', JSON.stringify(orData));

        const usage = orData?.usage || {};
        intentAccounting.promptTokens = Number(usage.prompt_tokens) || 0;
        intentAccounting.completionTokens = Number(usage.completion_tokens) || 0;

        const raw = orData?.choices?.[0]?.message?.content || '';
        const cleaned = raw.replace(/```json|```/g, '').trim();

        let intent: Record<string, unknown> = { state: 'search', query: null };
        try {
            intent = JSON.parse(cleaned);
            console.log('[DEBUG] Parsed Intent State:', JSON.stringify(intent));
        } catch {
            console.log('[DEBUG] Failed to parse intent JSON, defaulting to search');
        }

        // Log the classify_intent row now, BEFORE potentially kicking off the
        // Tavily call (so even if Tavily fails we still have the intent row).
        intentAccounting.finalized = true;
        intentAccounting.status = 'completed';
        intentAccounting.statusReason = `state=${intent.state}`;
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

        // If skip or clarify, return immediately — no search
        if (intent.state !== 'search') {
            return new Response(JSON.stringify(intent), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        // Phase 2: if state=search and tavily available, do the actual search here
        const query = String(intent.query || extractText(contextWindow[contextWindow.length - 1]?.content));

        if (!tavilyApiKey) {
            return new Response(JSON.stringify({ state: 'search', query, results: null }), { headers: { ...cors, 'Content-Type': 'application/json' } });
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
                requestId: intentAccounting.requestId,
                parentRequestId: intentAccounting.parentRequestId,
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
            return new Response(JSON.stringify({ state: 'search', query, results: null }), {
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
            requestId: intentAccounting.requestId,
            parentRequestId: intentAccounting.parentRequestId,
            callKind: 'web_search',
            status: 'completed',
            statusReason: `results=${organic.length}`,
            modelId: 'tavily',
            provider: 'tavily',
            durationMs: Date.now() - tavilyStartedAt,
            // Tavily pricing is per-result so we express it via the
            // inputCostPer1M channel by pre-computing it into the fake rate.
            // Simpler: pass 0 rates but web_search_credits + a manual usdCost
            // override would be cleaner. Since recordUsage computes usd_cost
            // from tokens alone, we log credits only here.
            webSearchEnabled: true,
            webSearchEngine: 'tavily',
            webSearchMaxResults: TAVILY_MAX_RESULTS,
            webSearchResultsBilled: TAVILY_MAX_RESULTS,
            // Note: chat-proxy is what actually deducts LC for web search;
            // this row is purely observational.
            webSearchCredits: 0,
        });
        // Expose real USD cost separately for humans debugging the log.
        console.log(
            '[usage] web_search tavily usd_cost≈',
            tavilyUsdCost.toFixed(6),
            'max_results=',
            TAVILY_MAX_RESULTS,
        );

        return new Response(JSON.stringify({
            state: 'search',
            query,
            results: { organic, answerBox, knowledgeGraph: null }
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
        }
        return new Response(JSON.stringify({ state: 'search', query: null, results: null }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
});
