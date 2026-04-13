import { getCorsHeaders } from '../_shared/cors.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SERPER_URL = 'https://google.serper.dev/search';
const INTENT_MODEL = 'google/gemini-2.0-flash-lite-001';

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
        const serperApiKey = Deno.env.get('SERPER_API_KEY');

        const { messages, doSearch } = await req.json();
        if (!Array.isArray(messages) || messages.length === 0) {
            return new Response(JSON.stringify({ state: 'skip', query: null }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        const extractText = (content: unknown): string => {
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) return (content as Array<Record<string,unknown>>).filter(p => !!p && p.type === 'text').map(p => String(p.text||'')).join(' ');
            return '';
        };

        const contextWindow = messages.slice(-6);
        const conversationText = contextWindow
            .filter((m: Record<string,unknown>) => m.role === 'user' || m.role === 'assistant')
            .map((m: Record<string,unknown>) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${extractText(m.content).slice(0, 400)}`)
            .join('\n');

        // Phase 1: classify intent
        console.log('[DEBUG] Classify Intent Input Context:', conversationText);
        
        const orPayload = {
            model: INTENT_MODEL,
            messages: [
                { role: 'system', content: INTENT_SYSTEM },
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

        // Phase 2: if state=search and serper available, do the actual search here
        const query = String(intent.query || extractText(contextWindow[contextWindow.length-1]?.content));

        if (!serperApiKey) {
            return new Response(JSON.stringify({ state: 'search', query, results: null }), { headers: { ...cors, 'Content-Type': 'application/json' } });
        }

        console.log('[DEBUG] Firing Serper SEARCH. Query:', query);
        
        const serperPayload = { q: query, num: 5 };
        console.log('[DEBUG] Serper Payload IN:', JSON.stringify(serperPayload));

        const serperResponse = await fetch(SERPER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperApiKey },
            body: JSON.stringify(serperPayload),
        });

        const serperData = await serperResponse.json();
        console.log('[DEBUG] Serper RAW Output:', JSON.stringify(serperData).substring(0, 500) + '... (truncated)');

        // Extract clean results
        const organic = (serperData.organic || []).slice(0, 5).map((r: Record<string,unknown>) => ({
            title: r.title,
            snippet: r.snippet,
            link: r.link,
        }));

        const answerBox = serperData.answerBox || null;
        const knowledgeGraph = serperData.knowledgeGraph || null;

        return new Response(JSON.stringify({
            state: 'search',
            query,
            results: { organic, answerBox, knowledgeGraph }
        }), { headers: { ...cors, 'Content-Type': 'application/json' } });

    } catch (err) {
        return new Response(JSON.stringify({ state: 'search', query: null, results: null }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
});
