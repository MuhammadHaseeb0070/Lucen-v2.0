import { getCorsHeaders } from '../_shared/cors.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TAVILY_URL = 'https://api.tavily.com/search';
const INTENT_MODEL = 'openai/gpt-4o-mini';

const INTENT_SYSTEM = `You are a web search intent classifier. Analyze the conversation and decide if the latest user message needs a real-time web search.

Respond ONLY with raw JSON. No markdown. No backticks. Just JSON.

Formats:
{"state":"search","query":"ideal search query using full context"}
{"state":"skip","query":null}
{"state":"clarify","query":null,"question":"one specific question"}

Rules:
- search: live scores, schedules, prices, weather, news, current events, real-time data
- skip: greetings, math, code, explanations, things already in conversation
- clarify: ONLY if a critical detail makes any query useless. Otherwise assume and search.
- query MUST reflect full conversation context. "try again" alone = look at previous messages for topic.`;

Deno.serve(async (req: Request) => {
    const cors = getCorsHeaders(req);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });

        const openrouterApiKey = Deno.env.get('OPENROUTER_API_KEY');
        const tavilyApiKey = Deno.env.get('TAVILY_API_KEY');

        const { messages, doSearch } = await req.json();
        if (!Array.isArray(messages) || messages.length === 0) {
            return new Response(JSON.stringify({ state: 'skip', query: null }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        const extractText = (content: unknown): string => {
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) return (content as Array<Record<string, unknown>>).filter(p => !!p && p.type === 'text').map(p => String(p.text || '')).join(' ');
            return '';
        };

        const contextWindow = messages.slice(-6);
        const conversationText = contextWindow
            .filter((m: Record<string, unknown>) => m.role === 'user' || m.role === 'assistant')
            .map((m: Record<string, unknown>) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${extractText(m.content).slice(0, 400)}`)
            .join('\n');

        const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        // Phase 1: classify intent
        console.log('[DEBUG] Classify Intent Input Context:', conversationText);

        const orPayload = {
            model: INTENT_MODEL,
            messages: [
                { role: 'system', content: INTENT_SYSTEM + `\nToday's exact date is: ${currentDate}. If the user asks for upcoming events, YOU MUST explicitly include the current month and year in your query output (e.g. 'April 2026 real madrid fixtures').` },
                { role: 'user', content: `Conversation:\n${conversationText}\n\nClassify intent.` }
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

        const orData = await orResponse.json();
        console.log('[DEBUG] OpenRouter RAW Response:', JSON.stringify(orData));

        const raw = orData?.choices?.[0]?.message?.content || '';
        const cleaned = raw.replace(/```json|```/g, '').trim();

        let intent: Record<string, unknown> = { state: 'search', query: null };
        try {
            intent = JSON.parse(cleaned);
            console.log('[DEBUG] Parsed Intent State:', JSON.stringify(intent));
        } catch {
            console.log('[DEBUG] Failed to parse intent JSON, defaulting to search');
        }

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
            max_results: 5
        };

        const searchResponse = await fetch(TAVILY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tavilyPayload),
        });

        console.log('[Tavily] status:', searchResponse.status);
        const searchRaw = await searchResponse.text();

        if (!searchResponse.ok) {
            console.error('[Tavily] failed with status:', searchResponse.status, searchRaw);
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

        return new Response(JSON.stringify({
            state: 'search',
            query,
            results: { organic, answerBox, knowledgeGraph: null }
        }), { headers: { ...cors, 'Content-Type': 'application/json' } });

    } catch (err) {
        return new Response(JSON.stringify({ state: 'search', query: null, results: null }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
});
