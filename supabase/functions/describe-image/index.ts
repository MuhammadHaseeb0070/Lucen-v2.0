import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

// ============================================================================
// describe-image
// Silent vision helper. Takes one or more images and recent conversation
// context, returns a rich first-person description that is injected into the
// main assistant's context so it can reply as if it saw the image itself.
//
// Model is fully env-driven (never hardcoded) so it can be swapped freely.
//   VISION_HELPER_MODEL — e.g. google/gemini-2.0-flash-001
// ============================================================================

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CREDITS_PER_1K_TOKENS = 1;
const CREDITS_PER_IMAGE = 2;
const MAX_IMAGES_PER_CALL = 10;
const MAX_RECENT_MESSAGES = 10;       // last ~5 exchanges
const MAX_RECENT_CHARS_PER_MSG = 1200; // trim noisy long messages

const VISION_SYSTEM_PROMPT = `You are a vision-perception helper working silently behind the scenes for another AI assistant. You will receive image(s) the user attached to their current message, plus recent conversation context.

Your job: describe what you see in rich, factual detail, written in first-person perception ("I see…", "The image shows…"). Your output is injected into the main assistant's context so it can respond to the user as if it saw the image itself.

Write a description that:
1. Covers ALL visible content: objects, text, UI elements, code, diagrams, colors, layout, expressions, data, charts, handwriting, etc.
2. Transcribes important visible text verbatim.
3. Uses recent conversation context to focus on what is most relevant to the user's current question, but stays comprehensive enough that the main assistant can answer even an adjacent follow-up.
4. Describes multiple images separately and labels each (by filename or position: "Image 1", "Image 2", …).
5. Is detailed but efficient — enough for the main assistant to answer fully without ever needing to see the image.

Do NOT:
- Answer the user's question or give advice.
- Mention that you are a separate model, helper, tool, or that this is a description.
- Address "the user" or "the assistant" by name — just describe.
- Use markdown headers or preamble. Return plain descriptive text only.`;

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

function extractText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return (content as Array<Record<string, unknown>>)
            .filter((p) => p && (p as { type?: unknown }).type === 'text')
            .map((p) => String((p as { text?: unknown }).text ?? ''))
            .join(' ');
    }
    return '';
}

interface IncomingImage {
    dataUrl?: string;
    name?: string;
}

interface IncomingMessage {
    role?: string;
    content?: unknown;
}

Deno.serve(async (req: Request) => {
    const cors = getCorsHeaders(req);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

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
        const visionModel = Deno.env.get('VISION_HELPER_MODEL');

        if (!openrouterApiKey) {
            return new Response(
                JSON.stringify({ error: 'OpenRouter API key not configured on server' }),
                { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }
        if (!visionModel) {
            return new Response(
                JSON.stringify({ error: 'VISION_HELPER_MODEL is not configured on the server' }),
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

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const { data: adminUser, error: adminError } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (adminError || !adminUser?.user) {
            return new Response(
                JSON.stringify({ error: 'User not found' }),
                { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }
        const user = adminUser.user;

        // ─── Parse body ──────────────────────────────────────────────────────
        const body = await req.json();
        const rawImages: IncomingImage[] = Array.isArray(body?.images) ? body.images : [];
        const rawRecent: IncomingMessage[] = Array.isArray(body?.recent_messages) ? body.recent_messages : [];
        const userText: string = typeof body?.user_text === 'string' ? body.user_text : '';

        const images = rawImages
            .filter((img) => img && typeof img.dataUrl === 'string' && img.dataUrl.startsWith('data:'))
            .slice(0, MAX_IMAGES_PER_CALL);

        if (images.length === 0) {
            return new Response(
                JSON.stringify({ error: 'No valid images provided' }),
                { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        // ─── Credit gate ─────────────────────────────────────────────────────
        await supabaseAdmin.rpc('ensure_user_credits', {
            p_user_id: user.id,
            p_initial_credits: 100,
        });
        const { data: creditsRow, error: creditsErr } = await supabaseAdmin
            .from('user_credits')
            .select('remaining_credits')
            .eq('user_id', user.id)
            .single();
        if (creditsErr || !creditsRow) {
            return new Response(
                JSON.stringify({ error: 'Failed to load user credits' }),
                { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }
        if (typeof creditsRow.remaining_credits === 'number' && creditsRow.remaining_credits <= 0) {
            return new Response(
                JSON.stringify({ error: 'Insufficient credits' }),
                { status: 402, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        // ─── Build prompt for vision model ───────────────────────────────────
        const trimmedRecent = rawRecent
            .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
            .slice(-MAX_RECENT_MESSAGES)
            .map((m) => {
                const text = extractText(m.content).slice(0, MAX_RECENT_CHARS_PER_MSG).trim();
                return text ? `${m.role === 'user' ? 'User' : 'Assistant'}: ${text}` : '';
            })
            .filter(Boolean)
            .join('\n');

        const labelLines = images.map((img, i) => `- Image ${i + 1}${img.name ? `: ${img.name}` : ''}`).join('\n');
        const textPreamble =
            (trimmedRecent
                ? `Recent conversation (for context only):\n${trimmedRecent}\n\n`
                : '') +
            (userText
                ? `User's current message accompanying the image(s):\n${userText}\n\n`
                : '') +
            `Images to describe:\n${labelLines}\n\nReturn ONLY the description.`;

        const userContent: Array<Record<string, unknown>> = [
            { type: 'text', text: textPreamble },
            ...images.map((img) => ({
                type: 'image_url',
                image_url: { url: img.dataUrl as string },
            })),
        ];

        const openrouterResponse = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openrouterApiKey}`,
                'HTTP-Referer': supabaseUrl,
                'X-Title': 'Lucen (vision helper)',
            },
            body: JSON.stringify({
                model: visionModel,
                messages: [
                    { role: 'system', content: VISION_SYSTEM_PROMPT },
                    { role: 'user', content: userContent },
                ],
                stream: false,
                max_tokens: 900,
                include_usage: true,
            }),
        });

        if (!openrouterResponse.ok) {
            const errBody = await openrouterResponse.text();
            console.error(`[describe-image] OpenRouter error ${openrouterResponse.status}:`, errBody.slice(0, 500));
            return new Response(
                JSON.stringify({ error: `Vision API Error ${openrouterResponse.status}` }),
                { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        const json = await openrouterResponse.json();
        const description = String(json?.choices?.[0]?.message?.content || '').trim();
        if (!description) {
            return new Response(
                JSON.stringify({ error: 'Vision helper returned empty description' }),
                { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        // ─── Credit accounting ───────────────────────────────────────────────
        const usage = json?.usage || {};
        const promptTokens = usage?.prompt_tokens || 0;
        const completionTokens = usage?.completion_tokens || 0;
        const reasoningTokens = getReasoningTokens(usage);
        const totalTokens = usage?.total_tokens ?? (promptTokens + completionTokens);
        const totalTokensNum = typeof totalTokens === 'number' && Number.isFinite(totalTokens)
            ? totalTokens
            : (promptTokens + completionTokens);

        const textCost = (totalTokensNum / 1000) * CREDITS_PER_1K_TOKENS;
        const imageCost = images.length * CREDITS_PER_IMAGE;
        const totalCost = textCost + imageCost;

        try {
            await supabaseAdmin.rpc('deduct_user_credits', {
                p_user_id: user.id,
                p_amount: totalCost,
            });
            await supabaseAdmin.from('usage_logs').insert({
                user_id: user.id,
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                reasoning_tokens: reasoningTokens,
                total_credits_deducted: totalCost,
                model_id: visionModel,
                web_search_enabled: false,
                web_search_engine: null,
                web_search_max_results: null,
                web_search_results_billed: null,
                text_credits: textCost,
                image_credits: imageCost,
                web_search_credits: 0,
            });
        } catch (dbErr) {
            console.error('[describe-image] credit accounting failed:', dbErr);
        }

        return new Response(
            JSON.stringify({
                description,
                model: visionModel,
                image_count: images.length,
                credits_used: totalCost,
            }),
            { headers: { ...cors, 'Content-Type': 'application/json' } }
        );
    } catch (err) {
        console.error('describe-image error:', err);
        return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
            { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
    }
});
