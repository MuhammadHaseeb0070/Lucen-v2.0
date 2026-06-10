import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { isKillSwitched } from '../_shared/featureFlags.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { getModelConfig } from '../_shared/models.ts';

function decodeJwtPayload(token: string): Record<string, unknown> {
    const base64 = token.split('.')[1];
    const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
}

Deno.serve(async (req: Request) => {
    const cors = getCorsHeaders(req);
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: cors });
    }

    // Feature flag kill switch
    if (isKillSwitched('GET_MODEL_CONFIG')) {
        return new Response(JSON.stringify({ error: 'Service temporarily unavailable.' }), {
            status: 503,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    }

    // Edge-level rate limiting — 60 req/min per IP
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rlResult = await checkRateLimit(`get-model-config:${clientIp}`, 60, 60_000);
    if (!rlResult.allowed) {
        const retryAfterSec = Math.ceil((rlResult.retryAfterMs ?? 60_000) / 1000);
        return new Response(JSON.stringify({ error: 'Too many requests. Please slow down.' }), {
            status: 429,
            headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSec) },
        });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
                status: 401,
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        // S1 fix: verify JWT signature via Supabase instead of local decode
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) {
            return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
                status: 401,
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }
        const userId = user.id;

        // Resolve active main model from fallback chain
        const mainChatChain = [
            Deno.env.get('MAIN_CHAT_MODEL_PRIMARY'),
            Deno.env.get('MAIN_CHAT_MODEL_SECONDARY'),
            Deno.env.get('MAIN_CHAT_MODEL_TERTIARY'),
            Deno.env.get('MAIN_CHAT_MODEL')
        ].filter((m): m is string => !!m && m.trim().length > 0);

        const activeMainModelId = mainChatChain[0] || 'minimax/minimax-01';
        const defaultMainConfig = getModelConfig(activeMainModelId);

        // Safe model configuration payload
        const mainDisplayName = Deno.env.get('MAIN_CHAT_MODEL_NAME') ?? defaultMainConfig.modelDisplayName;
        const mainSupportsReasoning = Deno.env.get('MAIN_CHAT_SUPPORTS_REASONING')
            ? Deno.env.get('MAIN_CHAT_SUPPORTS_REASONING') === 'true'
            : defaultMainConfig.supportsReasoning;
        const mainContextWindow = Number(Deno.env.get('MAIN_CHAT_CONTEXT_WINDOW') ?? defaultMainConfig.contextWindowTokens);
        const mainMaxOutput = Number(Deno.env.get('MAIN_CHAT_MAX_OUTPUT') ?? defaultMainConfig.maxOutputTokens);
        const mainTokensPerSecond = Number(Deno.env.get('MAIN_CHAT_TOKENS_PER_SECOND') ?? Deno.env.get('VITE_MAIN_CHAT_TOKENS_PER_SECOND') ?? defaultMainConfig.tokensPerSecond);
        const platformMaxStreamSeconds = Number(Deno.env.get('PLATFORM_MAX_STREAM_SECONDS') ?? Deno.env.get('VITE_PLATFORM_MAX_STREAM_SECONDS') ?? '140');

        // Resolve active side model from fallback chain
        const sideChatChain = [
            Deno.env.get('SIDE_CHAT_MODEL_PRIMARY'),
            Deno.env.get('SIDE_CHAT_MODEL_SECONDARY'),
            Deno.env.get('SIDE_CHAT_MODEL_TERTIARY'),
            Deno.env.get('SIDE_CHAT_MODEL')
        ].filter((m): m is string => !!m && m.trim().length > 0);

        const activeSideModelId = sideChatChain[0] || 'openai/gpt-4o-mini';
        const defaultSideConfig = getModelConfig(activeSideModelId);

        const sideDisplayName = Deno.env.get('SIDE_CHAT_MODEL_NAME') ?? defaultSideConfig.modelDisplayName;
        const sideSupportsReasoning = Deno.env.get('SIDE_CHAT_SUPPORTS_REASONING')
            ? Deno.env.get('SIDE_CHAT_SUPPORTS_REASONING') === 'true'
            : defaultSideConfig.supportsReasoning;
        const sideContextWindow = Number(Deno.env.get('SIDE_CHAT_CONTEXT_WINDOW') ?? defaultSideConfig.contextWindowTokens);
        const sideMaxOutput = Number(Deno.env.get('SIDE_CHAT_MAX_OUTPUT') ?? defaultSideConfig.maxOutputTokens);
        const sideTokensPerSecond = Number(Deno.env.get('SIDE_CHAT_TOKENS_PER_SECOND') ?? defaultSideConfig.tokensPerSecond);

        const lsVariantRegular = Deno.env.get('LS_VARIANT_REGULAR') ?? '';
        const lsVariantPro = Deno.env.get('LS_VARIANT_PRO') ?? '';

        const adminEmailsRaw = Deno.env.get('ADMIN_EMAILS') ?? '';
        const adminEmails = adminEmailsRaw.split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);

        return new Response(
            JSON.stringify({
                mainConfig: {
                    modelDisplayName: mainDisplayName,
                    supportsReasoning: mainSupportsReasoning,
                    contextWindowTokens: mainContextWindow,
                    maxOutputTokens: mainMaxOutput,
                    tokensPerSecond: mainTokensPerSecond,
                    platformMaxStreamSeconds: platformMaxStreamSeconds,
                },
                sideConfig: {
                    modelDisplayName: sideDisplayName,
                    supportsReasoning: sideSupportsReasoning,
                    contextWindowTokens: sideContextWindow,
                    maxOutputTokens: sideMaxOutput,
                    tokensPerSecond: sideTokensPerSecond,
                    platformMaxStreamSeconds: platformMaxStreamSeconds,
                },
                lsVariantRegular,
                lsVariantPro,
                adminEmails,
            }),
            {
                headers: { ...cors, 'Content-Type': 'application/json' },
            }
        );
    } catch (err) {
        console.error('[get-model-config] error:', err);
        return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
            {
                status: 500,
                headers: { ...cors, 'Content-Type': 'application/json' },
            }
        );
    }
});
