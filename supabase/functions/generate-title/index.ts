// ============================================================================
// Generate a short (1-3 word) chat title from the first exchange.
//
// Triggered once per new conversation, right after the first assistant reply
// lands. Uses the cheap intent model by default (WEB_INTENT_MODEL) so cost is
// negligible. Every call is logged to usage_logs with call_kind='title_gen'.
//
// Hard rules enforced on the output:
//   - 1–3 words, max ~28 chars
//   - Title Case
//   - No trailing punctuation
//   - No emojis / quotes / markdown
//   - Fallback to 'New Chat' if the model returns something invalid
// ============================================================================

import { getCorsHeaders } from '../_shared/cors.ts';
import { recordUsage } from '../_shared/usage.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const TITLE_MODEL = Deno.env.get('TITLE_MODEL') || Deno.env.get('WEB_INTENT_MODEL') || 'openai/gpt-4o-mini';

const TITLE_INPUT_COST_PER_1M = Number(
    Deno.env.get('TITLE_INPUT_COST_PER_1M') ?? Deno.env.get('WEB_INTENT_INPUT_COST_PER_1M') ?? '0',
);
const TITLE_OUTPUT_COST_PER_1M = Number(
    Deno.env.get('TITLE_OUTPUT_COST_PER_1M') ?? Deno.env.get('WEB_INTENT_OUTPUT_COST_PER_1M') ?? '0',
);

const SYSTEM = `You name chat conversations for a product UI.

Given the first user message (and optionally the assistant's reply), return a VERY SHORT title that captures the topic.

Strict rules:
- 1 to 3 words maximum. Prefer 2 words.
- Title Case. No quotes. No emojis. No markdown. No trailing punctuation.
- No filler like "Chat about", "Question on", "Discussion of". Just the topic.
- No personal names unless the user explicitly made them the subject.
- Reply with JUST the title. Nothing else.

Examples:
- user: "explain bubble sort in python" -> "Bubble Sort"
- user: "help me write a resume for a frontend dev role" -> "Frontend Resume"
- user: "who won el clasico yesterday" -> "El Clasico"
- user: "i feel sad today" -> "Feeling Sad"
- user: "build me a todo app with react and supabase" -> "React Todo App"`;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const base64 = token.split('.')[1];
        const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
        return JSON.parse(json);
    } catch {
        return null;
    }
}

function sanitizeTitle(raw: string): string | null {
    if (!raw) return null;
    let t = raw.trim();
    // Strip wrapping quotes / backticks / asterisks.
    t = t.replace(/^['"`*_]+|['"`*_]+$/g, '');
    // Remove trailing punctuation.
    t = t.replace(/[.!?,:;]+$/, '');
    // Collapse whitespace.
    t = t.replace(/\s+/g, ' ').trim();
    // Remove common emoji ranges (rough — we don't need perfection here).
    t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
    if (!t) return null;
    const words = t.split(' ').filter(Boolean);
    if (words.length === 0) return null;
    // Hard cap 3 words / 28 chars.
    const clipped = words.slice(0, 3).join(' ');
    const final = clipped.length > 28 ? clipped.slice(0, 28).trim() : clipped;
    if (final.length < 2) return null;
    return final;
}

Deno.serve(async (req: Request) => {
    const cors = getCorsHeaders(req);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

    const startedAt = Date.now();
    let userId = 'unknown';
    let conversationId: string | null = null;
    let requestId: string | null = null;

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            await recordUsage({
                userId,
                callKind: 'title_gen',
                status: 'auth_error',
                errorMessage: 'Unauthorized',
                modelId: TITLE_MODEL,
                durationMs: Date.now() - startedAt,
            });
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (!token || token.split('.').length !== 3) {
            await recordUsage({
                userId,
                callKind: 'title_gen',
                status: 'auth_error',
                errorMessage: 'Invalid token format',
                modelId: TITLE_MODEL,
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
        if (!claimUserId || (expiry && expiry < Math.floor(Date.now() / 1000))) {
            await recordUsage({
                userId: claimUserId ?? 'unknown',
                callKind: 'title_gen',
                status: 'auth_error',
                errorMessage: claimUserId ? 'Token expired' : 'JWT missing sub',
                modelId: TITLE_MODEL,
                durationMs: Date.now() - startedAt,
            });
            return new Response(JSON.stringify({ error: 'Invalid token' }), {
                status: 401,
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }
        userId = claimUserId;

        const body = await req.json().catch(() => ({}));
        conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : null;
        requestId = typeof body?.request_id === 'string' ? body.request_id : null;
        const userMessage: string = typeof body?.user_message === 'string' ? body.user_message : '';
        const assistantMessage: string = typeof body?.assistant_message === 'string' ? body.assistant_message : '';

        if (!userMessage.trim()) {
            await recordUsage({
                userId,
                conversationId,
                requestId,
                callKind: 'title_gen',
                status: 'client_error',
                errorMessage: 'user_message required',
                modelId: TITLE_MODEL,
                durationMs: Date.now() - startedAt,
            });
            return new Response(JSON.stringify({ error: 'user_message required' }), {
                status: 400,
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        const openrouterApiKey = Deno.env.get('OPENROUTER_API_KEY');
        if (!openrouterApiKey) {
            await recordUsage({
                userId,
                conversationId,
                requestId,
                callKind: 'title_gen',
                status: 'client_error',
                errorMessage: 'OPENROUTER_API_KEY not set',
                modelId: TITLE_MODEL,
                durationMs: Date.now() - startedAt,
            });
            return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
                status: 500,
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        // Keep the prompt tiny — first 400 chars of user + 200 of assistant is plenty.
        const userSnippet = userMessage.slice(0, 400);
        const assistantSnippet = assistantMessage.slice(0, 200);

        const orPayload = {
            model: TITLE_MODEL,
            messages: [
                { role: 'system', content: SYSTEM },
                {
                    role: 'user',
                    content: assistantSnippet
                        ? `User: ${userSnippet}\n\nAssistant: ${assistantSnippet}\n\nTitle:`
                        : `User: ${userSnippet}\n\nTitle:`,
                },
            ],
            max_tokens: 16,
            stream: false,
            temperature: 0.2,
        };

        const orResponse = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openrouterApiKey}` },
            body: JSON.stringify(orPayload),
        });

        if (!orResponse.ok) {
            const errText = await orResponse.text().catch(() => '');
            await recordUsage({
                userId,
                conversationId,
                requestId,
                callKind: 'title_gen',
                status: 'upstream_error',
                statusReason: `HTTP ${orResponse.status}`,
                errorMessage: errText.slice(0, 500),
                modelId: TITLE_MODEL,
                durationMs: Date.now() - startedAt,
                inputCostPer1M: TITLE_INPUT_COST_PER_1M,
                outputCostPer1M: TITLE_OUTPUT_COST_PER_1M,
            });
            return new Response(JSON.stringify({ title: null, fallback: 'New Chat' }), {
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        const data = await orResponse.json();
        const usage = data?.usage || {};
        const promptTokens = Number(usage.prompt_tokens) || 0;
        const completionTokens = Number(usage.completion_tokens) || 0;

        const raw = String(data?.choices?.[0]?.message?.content || '');
        const title = sanitizeTitle(raw) || 'New Chat';

        // Persist the title on the conversation row if the user hasn't edited yet.
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        if (supabaseUrl && serviceKey && conversationId && title !== 'New Chat') {
            try {
                const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
                // Only update while title_auto is still true (user hasn't renamed).
                await admin
                    .from('conversations')
                    .update({ title })
                    .eq('id', conversationId)
                    .eq('user_id', userId)
                    .eq('title_auto', true);
            } catch (err) {
                console.warn('[generate-title] DB update failed (non-fatal):', err);
            }
        }

        await recordUsage({
            userId,
            conversationId,
            requestId,
            callKind: 'title_gen',
            status: 'completed',
            statusReason: `title="${title}"`,
            modelId: TITLE_MODEL,
            durationMs: Date.now() - startedAt,
            promptTokens,
            completionTokens,
            inputCostPer1M: TITLE_INPUT_COST_PER_1M,
            outputCostPer1M: TITLE_OUTPUT_COST_PER_1M,
        });

        return new Response(JSON.stringify({ title }), {
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'unknown';
        await recordUsage({
            userId,
            conversationId,
            requestId,
            callKind: 'title_gen',
            status: 'upstream_error',
            errorMessage: errMsg,
            modelId: TITLE_MODEL,
            durationMs: Date.now() - startedAt,
            inputCostPer1M: TITLE_INPUT_COST_PER_1M,
            outputCostPer1M: TITLE_OUTPUT_COST_PER_1M,
        });
        return new Response(JSON.stringify({ title: null, fallback: 'New Chat', error: errMsg }), {
            status: 500,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    }
});
