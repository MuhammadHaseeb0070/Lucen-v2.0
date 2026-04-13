import { getCorsHeaders } from '../_shared/cors.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const INTENT_MODEL = 'google/gemini-2.0-flash-lite-001';

const SYSTEM_PROMPT = `You are a web search intent classifier for a chat assistant. Analyze the conversation and decide if the latest user message needs a real-time web search.

Respond ONLY with raw JSON. No markdown. No explanation. No backticks. Just the JSON object.

Return exactly one of these three formats:

{"state":"search","query":"the ideal search query using full conversation context"}
{"state":"skip","query":null}
{"state":"clarify","query":null,"question":"one short specific question to ask user"}

Rules:
- state=search: current events, live scores, schedules, prices, weather, news, real-time data, recent releases
- state=skip: greetings, math, code help, creative writing, explanations, things already answered in conversation history, follow-ups that don't need fresh data
- state=clarify: ONLY when a critical detail is genuinely missing that would make any search query useless. Not for minor details — make a reasonable assumption and search instead.
- The query MUST reflect full conversation context. "Try again" alone means nothing — look at what was being discussed and build the correct query.
- Never output anything except the JSON object.`;

Deno.serve(async (req: Request) => {
    const cors = getCorsHeaders(req);
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: cors });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
            });
        }

        const openrouterApiKey = Deno.env.get('OPENROUTER_API_KEY');
        if (!openrouterApiKey) {
            return new Response(JSON.stringify({ error: 'API key missing' }), {
                status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
            });
        }

        const { messages } = await req.json();
        if (!Array.isArray(messages) || messages.length === 0) {
            return new Response(JSON.stringify({ state: 'skip', query: null }), {
                headers: { ...cors, 'Content-Type': 'application/json' }
            });
        }

        const extractText = (content: unknown): string => {
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) {
                return (content as Array<Record<string, unknown>>)
                    .filter((p) => p && p.type === 'text')
                    .map((p) => String(p.text || ''))
                    .join(' ');
            }
            return '';
        };

        // Take last 6 messages only for context
        const contextWindow = messages.slice(-6);
        const conversationText = contextWindow
            .filter((m: Record<string, unknown>) => m.role === 'user' || m.role === 'assistant')
            .map((m: Record<string, unknown>) =>
                `${m.role === 'user' ? 'User' : 'Assistant'}: ${extractText(m.content).slice(0, 400)}`
            )
            .join('\n');

        const orResponse = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openrouterApiKey}`,
            },
            body: JSON.stringify({
                model: INTENT_MODEL,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: `Conversation:\n${conversationText}\n\nClassify the intent.` }
                ],
                max_tokens: 120,
                stream: false,
                temperature: 0,
            }),
        });

        if (!orResponse.ok) {
            return new Response(JSON.stringify({ state: 'search', query: null }), {
                headers: { ...cors, 'Content-Type': 'application/json' }
            });
        }

        const data = await orResponse.json();
        const raw = data?.choices?.[0]?.message?.content || '';
        const cleaned = raw.replace(/```json|```/g, '').trim();

        try {
            const parsed = JSON.parse(cleaned);
            const validStates = ['search', 'skip', 'clarify'];
            if (!validStates.includes(parsed.state)) {
                return new Response(JSON.stringify({ state: 'search', query: null }), {
                    headers: { ...cors, 'Content-Type': 'application/json' }
                });
            }
            return new Response(JSON.stringify(parsed), {
                headers: { ...cors, 'Content-Type': 'application/json' }
            });
        } catch {
            return new Response(JSON.stringify({ state: 'search', query: null }), {
                headers: { ...cors, 'Content-Type': 'application/json' }
            });
        }

    } catch {
        return new Response(JSON.stringify({ state: 'search', query: null }), {
            status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
        });
    }
});
