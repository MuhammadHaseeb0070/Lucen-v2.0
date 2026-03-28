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
            return new Response(
                JSON.stringify({ error: 'Missing Authorization header' }),
                { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
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
        if (!userId) {
            return new Response(
                JSON.stringify({ error: 'JWT missing sub claim' }),
                { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const { data: adminUser, error: adminError } = await supabaseAdmin.auth.admin.getUserById(userId);

        if (adminError || !adminUser?.user) {
            return new Response(
                JSON.stringify({ error: 'Invalid or expired token' }),
                { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        const user = adminUser.user;
        const { action, amount } = await req.json();

        switch (action) {
            case 'get-balance': {
                const { data, error } = await supabaseAdmin
                    .from('user_credits')
                    .select('remaining_credits, total_used, subscription_status, subscription_plan, lemon_squeezy_subscription_id')
                    .eq('user_id', user.id)
                    .single();

                if (error && error.code === 'PGRST116') {
                    const { data: newRow } = await supabaseAdmin
                        .from('user_credits')
                        .insert({
                            user_id: user.id,
                            remaining_credits: 100,
                            total_used: 0,
                            subscription_status: 'free',
                            subscription_plan: 'free',
                        })
                        .select()
                        .single();
                    return new Response(
                        JSON.stringify(newRow),
                        { headers: { ...cors, 'Content-Type': 'application/json' } }
                    );
                }

                return new Response(
                    JSON.stringify(data),
                    { headers: { ...cors, 'Content-Type': 'application/json' } }
                );
            }

            case 'deduct': {
                const cost = amount || 1;

                const { data: newBalance, error: rpcError } = await supabaseAdmin.rpc('deduct_user_credits', {
                    p_user_id: user.id,
                    p_amount: cost,
                });

                if (rpcError) {
                    return new Response(
                        JSON.stringify({ error: 'Failed to deduct credits' }),
                        { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
                    );
                }

                if (newBalance === -1) {
                    return new Response(
                        JSON.stringify({ error: 'Insufficient credits' }),
                        { status: 402, headers: { ...cors, 'Content-Type': 'application/json' } }
                    );
                }

                const { data: updated } = await supabaseAdmin
                    .from('user_credits')
                    .select('remaining_credits, total_used')
                    .eq('user_id', user.id)
                    .single();

                return new Response(
                    JSON.stringify(updated),
                    { headers: { ...cors, 'Content-Type': 'application/json' } }
                );
            }

            case 'add': {
                const addAmount = amount || 0;
                if (addAmount <= 0) {
                    return new Response(
                        JSON.stringify({ error: 'Amount must be positive' }),
                        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
                    );
                }

                const { data } = await supabaseAdmin
                    .from('user_credits')
                    .select('remaining_credits')
                    .eq('user_id', user.id)
                    .single();

                const { data: updated } = await supabaseAdmin
                    .from('user_credits')
                    .update({ remaining_credits: (data?.remaining_credits || 0) + addAmount })
                    .eq('user_id', user.id)
                    .select()
                    .single();

                return new Response(
                    JSON.stringify(updated),
                    { headers: { ...cors, 'Content-Type': 'application/json' } }
                );
            }

            default:
                return new Response(
                    JSON.stringify({ error: `Unknown action: ${action}` }),
                    { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
                );
        }
    } catch (err) {
        console.error('deduct-credits error:', err);
        return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
            { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
        );
    }
});
