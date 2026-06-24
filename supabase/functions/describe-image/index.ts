import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { recordUsage, type UsageStatus } from '../_shared/usage.ts';
import { isKillSwitched } from '../_shared/featureFlags.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { buildModelProfile, buildRequestBody } from '../_shared/modelAdapter.ts';

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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunk) {
        const sub = bytes.subarray(i, i + chunk);
        binary += String.fromCharCode.apply(null, sub as any);
    }
    return btoa(binary);
}

async function computeSha256(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
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

    // Feature flag kill switch — return 503 if describe-image is disabled
    if (isKillSwitched('DESCRIBE_IMAGE')) {
        return new Response(JSON.stringify({ error: 'Service temporarily unavailable.' }), {
            status: 503,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    }

    // Edge-level rate limiting — 60 req/min per IP
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rlResult = await checkRateLimit(`describe-image:${clientIp}`, 60, 60_000);
    if (!rlResult.allowed) {
        const retryAfterSec = Math.ceil((rlResult.retryAfterMs ?? 60_000) / 1000);
        return new Response(JSON.stringify({ error: 'Too many requests. Please slow down.' }), {
            status: 429,
            headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSec) },
        });
    }

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
        // S1 fix: verify JWT signature via Supabase instead of local decode
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) return await fail('auth_error', 401, 'Invalid or expired token');
        const userId = user.id;
        accounting.userId = userId;

        // ─── Parse body ──────────────────────────────────────────────────────
        const body = await req.json();
        let imageIds = body?.image_ids;
        let filePath = body?.file_path;
        let question = body?.question;
        
        let isLegacy = false;
        let images: IncomingImage[] = [];
        
        if (filePath) {
            isLegacy = false;
        } else if (Array.isArray(imageIds) && imageIds.length > 0) {
            isLegacy = false;
        } else {
            const rawImages: IncomingImage[] = Array.isArray(body?.images) ? body.images : [];
            images = rawImages
                .filter((img) => img && typeof img.dataUrl === 'string' && img.dataUrl.startsWith('data:'))
                .slice(0, MAX_IMAGES_PER_CALL);
            if (images.length > 0) {
                isLegacy = true;
            } else {
                return await fail('client_error', 400, 'image_ids or file_path or images array is required');
            }
        }

        const qHash = await computeSha256(question || 'general_description');

        if (!isLegacy) {
            if (filePath) {
                const { data: cached, error: cacheErr } = await supabaseAdmin
                    .from('file_attachments')
                    .select('ai_description')
                    .eq('storage_path', filePath)
                    .eq('user_id', user.id)
                    .eq('question_hash', qHash)
                    .maybeSingle();

                if (cached?.ai_description) {
                    accounting.finalized = true;
                    return new Response(
                        JSON.stringify({
                            description: cached.ai_description,
                            cached: true,
                            credits_used: 0
                        }),
                        { headers: { ...cors, 'Content-Type': 'application/json' } }
                    );
                }
            }

            // If not cached, download all images
            if (Array.isArray(imageIds) && imageIds.length > 0) {
                const successes: IncomingImage[] = [];
                let lastErrorMsg = '';

                for (const imgId of imageIds) {
                    try {
                        const { data: attachRecord, error: attachErr } = await supabaseAdmin
                            .from('file_attachments')
                            .select('storage_path')
                            .eq('id', imgId)
                            .eq('user_id', user.id)
                            .single();
                            
                        if (attachErr || !attachRecord?.storage_path) {
                            throw new Error(`Image attachment with ID ${imgId} not found in database: ${attachErr?.message ?? ''}`);
                        }

                        const curPath = attachRecord.storage_path;
                        const { data: fileData, error: downloadErr } = await supabaseAdmin
                            .storage
                            .from('attachments')
                            .download(curPath);
                        
                        if (downloadErr || !fileData) {
                            throw new Error(`Failed to download file from storage: ${downloadErr?.message ?? 'Not found'}`);
                        }

                        const buffer = await fileData.arrayBuffer();
                        const base64Str = arrayBufferToBase64(buffer);
                        const contentType = fileData.type || 'image/png';
                        const dataUrl = `data:${contentType};base64,${base64Str}`;

                        successes.push({ dataUrl, name: curPath.split('/').pop() });
                    } catch (err: any) {
                        console.warn(`[describe-image] Skipping image ID ${imgId} due to error:`, err.message);
                        lastErrorMsg = err.message;
                    }
                }

                if (successes.length === 0) {
                    return await fail('client_error', 404, `All image attachments failed to load. Last error: ${lastErrorMsg}`);
                }

                images = successes;
            } else {
                // Verify ownership of the storage path before attempting to download
                const { data: existsRecord } = await supabaseAdmin
                    .from('file_attachments')
                    .select('id')
                    .eq('storage_path', filePath)
                    .eq('user_id', user.id)
                    .limit(1)
                    .maybeSingle();

                if (!existsRecord) {
                    return await fail('auth_error', 404, 'File path unauthorized or not found');
                }

                // Single filePath fallback (legacy or manual payload)
                const { data: fileData, error: downloadErr } = await supabaseAdmin
                    .storage
                    .from('attachments')
                    .download(filePath);
                
                if (downloadErr || !fileData) {
                    return await fail('client_error', 404, `Failed to download file from storage: ${downloadErr?.message ?? 'Not found'}`);
                }

                const buffer = await fileData.arrayBuffer();
                const base64Str = arrayBufferToBase64(buffer);
                const contentType = fileData.type || 'image/png';
                const dataUrl = `data:${contentType};base64,${base64Str}`;

                images = [{ dataUrl, name: filePath.split('/').pop() }];
            }
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
        const rawRecent: IncomingMessage[] = Array.isArray(body?.recent_messages) ? body.recent_messages : [];
        const userText: string = typeof body?.user_text === 'string' ? body.user_text : '';

        const systemPrompt = question
            ? `You are a vision-perception helper. You will receive an image and a specific question about it. Your job is to analyze the image and answer the question in concise, rich, factual detail. Write in first-person perception ("I see...", "The image shows..."). Do not mention that you are a helper or tool. Return ONLY the direct answer/description.`
            : VISION_SYSTEM_PROMPT;

        // Bug 2b fix: when a specific question is provided (the normal tool-call path),
        // do NOT include recent conversation history. The vision model only needs
        // the question + image. History was unnecessarily inflating input tokens.
        const textPreamble = question
            ? `Answer this question about the image: ${question}\n\nImage filename: ${filePath ? filePath.split('/').pop() : (images[0]?.name || 'image')}\n\nReturn ONLY the direct answer/description.`
            : (rawRecent.length > 0 || userText
                ? (rawRecent.length > 0 ? `Recent conversation (for context only):\n${rawRecent.map(m => `${m.role}: ${extractText(m.content)}`).join('\n')}\n\n` : '') +
                  (userText ? `User's current message accompanying the image(s):\n${userText}\n\n` : '') +
                  `Images to describe:\n${images.map((img, i) => `- Image ${i + 1}${img.name ? `: ${img.name}` : ''}`).join('\n')}\n\nReturn ONLY the description.`
                : `Describe this image in detail. Filename: ${images[0].name || 'image.png'}`);

        const userContent: Array<Record<string, unknown>> = [
            { type: 'text', text: textPreamble },
        ];
        images.forEach((img, i) => {
            userContent.push({ type: 'text', text: `\nImage ${i + 1}:` });
            userContent.push({
                type: 'image_url',
                // Use auto detail to allow high-res tiles when text reading is necessary.
                image_url: { url: img.dataUrl as string, detail: 'auto' },
            });
        });

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
        ];
        const visionProfile = buildModelProfile('VISION');
        const requestBody = buildRequestBody(visionProfile, messages, [], 1024, false);
        requestBody.stream = false;
        requestBody.include_usage = true;

        const openrouterResponse = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openrouterApiKey}`,
                'HTTP-Referer': supabaseUrl,
                'X-Title': 'Lucen (vision helper)',
            },
            body: JSON.stringify(requestBody),
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

        const data = await openrouterResponse.json();
        const content = data?.choices?.[0]?.message?.content
          ?? data?.content?.[0]?.text
          ?? data?.candidates?.[0]?.content?.parts?.[0]?.text
          ?? '';
        const description = String(content).trim();
        if (!description) {
            return await fail('upstream_error', 502, 'Vision helper returned empty description');
        }

        // ─── Credit accounting ───────────────────────────────────────────────
        const usage = data?.usage || {};
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

        if (!isLegacy) {
            // Bug 2c fix: update the EXISTING attachment row (by UUID when available,
            // storage_path otherwise) instead of inserting a new duplicate row.
            // INSERT was creating orphan rows that broke the cache lookup on next call.
            if (Array.isArray(imageIds) && imageIds.length > 0) {
                // H13 fix: parse per-image descriptions from the combined response.
                // The vision model returns descriptions separated by "Image N:" markers.
                // We parse those and write each image's individual description.
                const imageDescMap = new Map<string, string>();
                if (imageIds.length > 1) {
                    // Try to split by "Image N:" markers
                    const parts = description.split(/\n*(?:Image\s+\d+[:.]\s*)/i).filter(Boolean);
                    if (parts.length >= imageIds.length) {
                        imageIds.forEach((imgId, idx) => {
                            if (imgId && parts[idx]) {
                                imageDescMap.set(imgId, parts[idx].trim());
                            }
                        });
                    }
                }
                // Fallback: if we couldn't split, use the full description for all
                // (better than nothing — the user gets the combined description)

                for (const imgId of imageIds) {
                    if (imgId) {
                        const descForImage = imageDescMap.get(imgId) || description;
                        await supabaseAdmin
                            .from('file_attachments')
                            .update({
                                ai_description: descForImage,
                                question_hash: qHash,
                                token_estimate: Math.ceil(descForImage.length / 4)
                            })
                            .eq('id', imgId);
                    }
                }
            } else {
                await supabaseAdmin
                    .from('file_attachments')
                    .upsert({
                        storage_path: filePath,
                        ai_description: description,
                        question_hash: qHash,
                        file_type: 'image',
                        file_name: (filePath as string).split('/').pop() || 'image.png',
                        token_estimate: Math.ceil(description.length / 4)
                    }, { onConflict: 'storage_path,question_hash' });
            }
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
