// ============================================
// Supabase Edge Function: deduct-credits
// ============================================
// Server-side credit management.
// Only callable with a valid user JWT.
// Uses service_role to bypass RLS on user_credits.
// ============================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // ─── Auth ───
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Missing Authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

        // Verify user
        const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } },
        });
        const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
        if (authError || !user) {
            return new Response(
                JSON.stringify({ error: 'Invalid or expired token' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // ─── Parse action ───
        const { action, amount } = await req.json();
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        switch (action) {
            case 'get-balance': {
                const { data, error } = await supabaseAdmin
                    .from('user_credits')
                    .select('remaining_credits, total_used')
                    .eq('user_id', user.id)
                    .single();

                if (error && error.code === 'PGRST116') {
                    // First time — create default credits
                    const { data: newRow } = await supabaseAdmin
                        .from('user_credits')
                        .insert({ user_id: user.id, remaining_credits: 100, total_used: 0 })
                        .select()
                        .single();
                    return new Response(
                        JSON.stringify(newRow),
                        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                return new Response(
                    JSON.stringify(data),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            case 'deduct': {
                const cost = amount || 1;

                // Atomic deduct: only succeeds if enough credits
                const { data, error } = await supabaseAdmin
                    .from('user_credits')
                    .select('remaining_credits, total_used')
                    .eq('user_id', user.id)
                    .single();

                if (error || !data) {
                    return new Response(
                        JSON.stringify({ error: 'Credit record not found' }),
                        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                if (data.remaining_credits < cost) {
                    return new Response(
                        JSON.stringify({ error: 'Insufficient credits', remaining: data.remaining_credits }),
                        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                const { data: updated, error: updateError } = await supabaseAdmin
                    .from('user_credits')
                    .update({
                        remaining_credits: data.remaining_credits - cost,
                        total_used: data.total_used + cost,
                    })
                    .eq('user_id', user.id)
                    .select()
                    .single();

                if (updateError) {
                    return new Response(
                        JSON.stringify({ error: 'Failed to deduct credits' }),
                        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                return new Response(
                    JSON.stringify(updated),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            case 'add': {
                const addAmount = amount || 0;
                if (addAmount <= 0) {
                    return new Response(
                        JSON.stringify({ error: 'Amount must be positive' }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                const { data, error } = await supabaseAdmin
                    .from('user_credits')
                    .select('remaining_credits')
                    .eq('user_id', user.id)
                    .single();

                if (error || !data) {
                    return new Response(
                        JSON.stringify({ error: 'Credit record not found' }),
                        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }

                const { data: updated } = await supabaseAdmin
                    .from('user_credits')
                    .update({ remaining_credits: data.remaining_credits + addAmount })
                    .eq('user_id', user.id)
                    .select()
                    .single();

                return new Response(
                    JSON.stringify(updated),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            default:
                return new Response(
                    JSON.stringify({ error: `Unknown action: ${action}` }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
        }
    } catch (err) {
        console.error('deduct-credits error:', err);
        return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
