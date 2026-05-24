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
        if (!token || token.split('.').length !== 3) {
            return new Response(JSON.stringify({ error: 'Invalid token format' }), {
                status: 401,
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        let claims: Record<string, unknown>;
        try {
            claims = decodeJwtPayload(token);
        } catch {
            return new Response(JSON.stringify({ error: 'Malformed token payload' }), {
                status: 401,
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        const userId = claims.sub as string;
        if (!userId) {
            return new Response(JSON.stringify({ error: 'Invalid token subject' }), {
                status: 401,
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        // Verify the user exists via admin client to reject revoked sessions
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        const { data: adminUser, error: adminError } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (adminError || !adminUser?.user) {
            return new Response(JSON.stringify({ error: 'User not found or revoked' }), {
                status: 401,
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }

        // Safe model configuration payload
        const modelDisplayName = Deno.env.get('MAIN_CHAT_MODEL_NAME') ?? 'Lucen M2.7';
        const supportsReasoning = Deno.env.get('MAIN_CHAT_SUPPORTS_REASONING') === 'true';
        const contextWindowTokens = Number(Deno.env.get('MAIN_CHAT_CONTEXT_WINDOW') ?? '131072');
        const maxOutputTokens = Number(Deno.env.get('MAIN_CHAT_MAX_OUTPUT') ?? '32768');
        const tokensPerSecond = Number(Deno.env.get('VITE_MAIN_CHAT_TOKENS_PER_SECOND') ?? '40');
        const platformMaxStreamSeconds = Number(Deno.env.get('VITE_PLATFORM_MAX_STREAM_SECONDS') ?? '140');

        return new Response(
            JSON.stringify({
                modelDisplayName,
                supportsReasoning,
                contextWindowTokens,
                maxOutputTokens,
                tokensPerSecond,
                platformMaxStreamSeconds,
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
