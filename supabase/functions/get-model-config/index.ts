import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';

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

        // Safe model configuration payload
        const mainDisplayName = Deno.env.get('MAIN_CHAT_MODEL_NAME') ?? 'Lucen M2.7';
        const mainSupportsReasoning = Deno.env.get('MAIN_CHAT_SUPPORTS_REASONING') === 'true';
        const mainContextWindow = Number(Deno.env.get('MAIN_CHAT_CONTEXT_WINDOW') ?? '131072');
        const mainMaxOutput = Number(Deno.env.get('MAIN_CHAT_MAX_OUTPUT') ?? '32768');
        const mainTokensPerSecond = Number(Deno.env.get('MAIN_CHAT_TOKENS_PER_SECOND') ?? Deno.env.get('VITE_MAIN_CHAT_TOKENS_PER_SECOND') ?? '40');
        const platformMaxStreamSeconds = Number(Deno.env.get('PLATFORM_MAX_STREAM_SECONDS') ?? Deno.env.get('VITE_PLATFORM_MAX_STREAM_SECONDS') ?? '140');

        const sideDisplayName = Deno.env.get('SIDE_CHAT_MODEL_NAME') ?? 'Lucen Helper';
        const sideSupportsReasoning = Deno.env.get('SIDE_CHAT_SUPPORTS_REASONING') === 'true';
        const sideContextWindow = Number(Deno.env.get('SIDE_CHAT_CONTEXT_WINDOW') ?? '128000');
        const sideMaxOutput = Number(Deno.env.get('SIDE_CHAT_MAX_OUTPUT') ?? '16384');
        const sideTokensPerSecond = Number(Deno.env.get('SIDE_CHAT_TOKENS_PER_SECOND') ?? '60');

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
