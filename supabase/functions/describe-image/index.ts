import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { recordUsage, type UsageStatus } from '../_shared/usage.ts';

// ============================================================================
// describe-image
// Silent vision helper. Takes one or more images and recent conversation
// context, returns a rich first-person description that is injected into the
// main assistant's context so it can reply as if it saw the image itself.
//
// Model is fully env-driven (never hardcoded) so it can be swapped freely.
//   VISION_HELPER_MODEL — e.g. google/gemini-2.0-flash-001
//   VISION_HELPER_INPUT_COST_PER_1M   (optional, for real USD cost tracking)
//   VISION_HELPER_OUTPUT_COST_PER_1M  (optional, for real USD cost tracking)
// ============================================================================

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CREDITS_PER_1K_TOKENS = 1;
const CREDITS_PER_IMAGE = 2;
const MAX_IMAGES_PER_CALL = 10;
const MAX_RECENT_MESSAGES = 10;       // last ~5 exchanges
const MAX_RECENT_CHARS_PER_MSG = 1200; // trim noisy long messages

const VISION_INPUT_COST_PER_1M = Number(
    Deno.env.get('VISION_HELPER_INPUT_COST_PER_1M') ?? '0',
);
const VISION_OUTPUT_COST_PER_1M = Number(
    Deno.env.get('VISION_HELPER_OUTPUT_COST_PER_1M') ?? '0',
);

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

    const startedAt = Date.now();
    const accounting = {
        finalized: false,
        userId: null as string | null,
        requestId: null as string | null,
        parentRequestId: null as string | null,
        conversationId: null as string | null,
        messageId: null as string | null,
        modelId: null as string | null,
        status: 'completed' as UsageStatus,
        statusReason: null as string | null,
        errorMessage: null as string | null,
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        imageTokens: 0,
        textCredits: 0,
        imageCredits: 0,
        totalCredits: 0,
    };

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
            requestId: accounting.requestId,
            parentRequestId: accounting.parentRequestId,
            callKind: 'describe_image',
            status,
            statusReason,
            errorMessage: message,
            modelId: accounting.modelId,
            durationMs: Date.now() - startedAt,
            imageTokens: accounting.imageTokens,
            inputCostPer1M: VISION_INPUT_COST_PER_1M,
            outputCostPer1M: VISION_OUTPUT_COST_PER_1M,
        });
        return new Response(JSON.stringify({ error: message }), {
            status: httpStatus,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    };

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return await fail('auth_error', 401, 'Missing Authorization header');

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const openrouterApiKey = Deno.env.get('OPENROUTER_API_KEY');
        const visionModel = Deno.env.get('VISION_HELPER_MODEL');

        if (!openrouterApiKey) return await fail('client_error', 500, 'OpenRouter API key not configured on server');
        if (!visionModel) return await fail('client_error', 500, 'VISION_HELPER_MODEL is not configured on the server');

        accounting.modelId = visionModel;

        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (!token || token.split('.').length !== 3) return await fail('auth_error', 401, 'Invalid token format');

        let claims: Record<string, unknown>;
        try {
            claims = decodeJwtPayload(token);
        } catch {
            return await fail('auth_error', 401, 'Malformed JWT');
        }

        const userId = claims.sub as string;
        const expiry = claims.exp as number;
        if (!userId) return await fail('auth_error', 401, 'JWT missing sub claim');
        accounting.userId = userId;
        if (expiry && expiry < Math.floor(Date.now() / 1000)) {
            return await fail('auth_error', 401, 'Token expired');
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const { data: adminUser, error: adminError } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (adminError || !adminUser?.user) return await fail('auth_error', 401, 'User not found');
        const user = adminUser.user;

        // ─── Parse body ──────────────────────────────────────────────────────
        const body = await req.json();
        const rawImages: IncomingImage[] = Array.isArray(body?.images) ? body.images : [];
        const rawRecent: IncomingMessage[] = Array.isArray(body?.recent_messages) ? body.recent_messages : [];
        const userText: string = typeof body?.user_text === 'string' ? body.user_text : '';

        if (typeof body?.request_id === 'string') accounting.requestId = body.request_id;
        if (typeof body?.parent_request_id === 'string') accounting.parentRequestId = body.parent_request_id;
        if (typeof body?.conversation_id === 'string') accounting.conversationId = body.conversation_id;
        if (typeof body?.message_id === 'string') accounting.messageId = body.message_id;

        const images = rawImages
            .filter((img) => img && typeof img.dataUrl === 'string' && img.dataUrl.startsWith('data:'))
            .slice(0, MAX_IMAGES_PER_CALL);

        if (images.length === 0) {
            return await fail('client_error', 400, 'No valid images provided');
        }
        accounting.imageTokens = images.length;

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
            return await fail('upstream_error', 500, 'Failed to load user credits');
        }
        if (typeof creditsRow.remaining_credits === 'number' && creditsRow.remaining_credits <= 0) {
            return await fail('insufficient_credits', 402, 'Insufficient credits');
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
            return await fail(
                'upstream_error',
                502,
                `Vision API Error ${openrouterResponse.status}`,
                errBody.slice(0, 500),
            );
        }

        const json = await openrouterResponse.json();
        const description = String(json?.choices?.[0]?.message?.content || '').trim();
        if (!description) {
            return await fail('upstream_error', 502, 'Vision helper returned empty description');
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

        accounting.promptTokens = promptTokens;
        accounting.completionTokens = completionTokens;
        accounting.reasoningTokens = reasoningTokens;
        accounting.textCredits = textCost;
        accounting.imageCredits = imageCost;
        accounting.totalCredits = totalCost;

        try {
            await supabaseAdmin.rpc('deduct_user_credits', {
                p_user_id: user.id,
                p_amount: totalCost,
            });
        } catch (dbErr) {
            console.error('[describe-image] credit deduction failed:', dbErr);
        }

        accounting.finalized = true;
        accounting.status = 'completed';
        await recordUsage({
            userId: user.id,
            conversationId: accounting.conversationId,
            messageId: accounting.messageId,
            requestId: accounting.requestId,
            parentRequestId: accounting.parentRequestId,
            callKind: 'describe_image',
            status: 'completed',
            modelId: visionModel,
            durationMs: Date.now() - startedAt,
            promptTokens,
            completionTokens,
            reasoningTokens,
            imageTokens: images.length,
            textCredits: textCost,
            imageCredits: imageCost,
            totalCreditsDeducted: totalCost,
            inputCostPer1M: VISION_INPUT_COST_PER_1M,
            outputCostPer1M: VISION_OUTPUT_COST_PER_1M,
        });

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
        if (!accounting.finalized) {
            accounting.finalized = true;
            accounting.status = 'upstream_error';
            accounting.errorMessage = err instanceof Error ? err.message : 'Internal server error';
            await recordUsage({
                userId: accounting.userId ?? 'unknown',
                conversationId: accounting.conversationId,
                messageId: accounting.messageId,
                requestId: accounting.requestId,
                parentRequestId: accounting.parentRequestId,
                callKind: 'describe_image',
                status: accounting.status,
                errorMessage: accounting.errorMessage,
                modelId: accounting.modelId,
                durationMs: Date.now() - startedAt,
                imageTokens: accounting.imageTokens,
                inputCostPer1M: VISION_INPUT_COST_PER_1M,
                outputCostPer1M: VISION_OUTPUT_COST_PER_1M,
            });
        }
        return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
            { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
    }
});
