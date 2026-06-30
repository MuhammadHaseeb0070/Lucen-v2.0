import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { isKillSwitched } from '../_shared/featureFlags.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

Deno.serve(async (req: Request) => {
    const cors = getCorsHeaders(req);
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: cors });
    }

    // Feature flag kill switch
    if (isKillSwitched('DEDUCT_CREDITS')) {
        return new Response(JSON.stringify({ error: 'Service temporarily unavailable.' }), {
            status: 503,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    }

    // Edge-level rate limiting — 60 req/min per IP
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rlResult = await checkRateLimit(`deduct-credits:${clientIp}`, 60, 60_000);
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
            return new Response(
                JSON.stringify({ error: 'Missing Authorization header' }),
                { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        // S1 fix: verify JWT signature via Supabase instead of local decode
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) {
            return new Response(
                JSON.stringify({ error: 'Invalid or expired token' }),
                { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } }
            );
        }
        const { action, amount } = await req.json();

        switch (action) {
            case 'get-balance': {
                const { data, error } = await supabaseAdmin
                    .from('user_credits')
                    .select('remaining_credits, total_used, billing_cycle_usage, subscription_status, subscription_plan, lemon_squeezy_subscription_id, lemon_squeezy_customer_portal_url, subscription_renews_at')
                    .eq('user_id', user.id)
                    .single();

                if (error && error.code === 'PGRST116') {
                    // Use the ledger-aware RPC instead of raw INSERT to avoid
                    // phantom credits that have no backing ledger entry.
                    await supabaseAdmin.rpc('ensure_user_credits', {
                        p_user_id: user.id,
                        p_initial_credits: 100,
                    });
                    const { data: newRow } = await supabaseAdmin
                        .from('user_credits')
                        .select('remaining_credits, total_used, billing_cycle_usage, subscription_status, subscription_plan, lemon_squeezy_subscription_id, lemon_squeezy_customer_portal_url, subscription_renews_at')
                        .eq('user_id', user.id)
                        .single();
                    const { data: newLedgers } = await supabaseAdmin
                        .from('credit_ledgers')
                        .select('id, initial_amount, remaining_amount, valid_from, expires_at, subscription_id, plan_name')
                        .eq('user_id', user.id)
                        .gt('remaining_amount', 0)
                        .gt('expires_at', new Date().toISOString());
                    return new Response(
                        JSON.stringify({ ...newRow, ledgers: newLedgers || [] }),
                        { headers: { ...cors, 'Content-Type': 'application/json' } }
                    );
                }

                // Fetch the active ledgers
                const { data: ledgersData, error: ledgersError } = await supabaseAdmin
                    .from('credit_ledgers')
                    .select('id, initial_amount, remaining_amount, valid_from, expires_at, subscription_id, plan_name')
                    .eq('user_id', user.id)
                    .gt('remaining_amount', 0)
                    .gt('expires_at', new Date().toISOString())
                    .order('expires_at', { ascending: true });

                const responseData = {
                    ...data,
                    ledgers: ledgersError ? [] : ledgersData,
                };

                return new Response(
                    JSON.stringify(responseData),
                    { headers: { ...cors, 'Content-Type': 'application/json' } }
                );
            }

            case 'deduct': {
                const cost = (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) ? amount : 1;

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

            // NOTE: 'add' action REMOVED — only the webhook (server-to-server)
            // should ever add credits. Exposing 'add' to authenticated users
            // was a security vulnerability.

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
