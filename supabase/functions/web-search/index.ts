import { getCorsHeaders } from '../_shared/cors.ts';
import { recordUsage, type UsageStatus } from '../_shared/usage.ts';

const TAVILY_URL = 'https://api.tavily.com/search';
const TAVILY_USD_PER_1K_SEARCHES = 4;

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

    const startedAt = Date.now();
    const searchReqId = `web_search_${startedAt}_${Math.random().toString(36).slice(2)}`;
    
    let userId: string | null = null;
    
    try {
        const authHeader = req.headers.get('Authorization');
        if (authHeader) {
            const token = authHeader.replace(/^Bearer\s+/i, '').trim();
            // S1 fix: verify JWT signature via Supabase instead of local decode
            const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
            const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
            if (supabaseUrl && serviceKey) {
                const supabaseAdmin = createClient(supabaseUrl, serviceKey);
                const { data: { user } } = await supabaseAdmin.auth.getUser(token);
                if (user) userId = user.id;
            }
        }

        const body = await req.json().catch(() => ({}));
        const query = body?.query;
        const maxResults = Math.min(Math.max(1, Number(body?.max_results ?? 5)), 5);

        if (!query || typeof query !== 'string') {
            return new Response(JSON.stringify({ error: 'query is required' }), {
                status: 400,
                headers: { ...cors, 'Content-Type': 'application/json' }
            });
        }

        const tavilyApiKey = Deno.env.get('TAVILY_API_KEY');
        if (!tavilyApiKey) {
            console.error('[web-search] TAVILY_API_KEY is not set');
            return new Response(JSON.stringify({ error: 'Tavily API key is not configured on the server.' }), {
                status: 500,
                headers: { ...cors, 'Content-Type': 'application/json' }
            });
        }

        const tavilyPayload = {
            api_key: tavilyApiKey.replace(/['"]/g, '').trim(),
            query: query,
            search_depth: "basic",
            include_answer: true,
            max_results: maxResults,
        };

        const res = await fetch(TAVILY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tavilyPayload),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Tavily HTTP error ${res.status}: ${errText}`);
        }

        const searchData = await res.json();
        const organic = (searchData.results || []).map((r: any) => ({
            title: r.title,
            snippet: r.content,
            link: r.url,
        }));

        const answerBox = searchData.answer ? { answer: searchData.answer } : null;
        
        const organicText = organic.map((r: any, i: number) => 
            `[${i + 1}] Source: ${r.link}\nTitle: ${r.title}\nContent: ${r.snippet}`
        ).join('\n\n');
        
        const answerBoxText = answerBox?.answer ? `Direct Answer Box: ${answerBox.answer}\n\n` : '';
        const rawContentText = `${answerBoxText}Organic Search Results:\n${organicText}`;

        const usdCost = (maxResults / 1000) * TAVILY_USD_PER_1K_SEARCHES;

        await recordUsage({
            userId: userId ?? 'unknown',
            requestId: searchReqId,
            callKind: 'web_search',
            status: 'completed',
            statusReason: `results=${organic.length}`,
            modelId: 'tavily',
            provider: 'tavily',
            durationMs: Date.now() - startedAt,
            fixedUsdCost: usdCost,
            webSearchEnabled: true,
            webSearchEngine: 'tavily',
            webSearchMaxResults: maxResults,
            webSearchResultsBilled: maxResults,
        });

        return new Response(JSON.stringify({
            content: rawContentText,
            organic,
            answerBox,
            query
        }), {
            headers: { ...cors, 'Content-Type': 'application/json' }
        });

    } catch (err: any) {
        console.error('[web-search] error:', err);
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...cors, 'Content-Type': 'application/json' }
        });
    }
});
