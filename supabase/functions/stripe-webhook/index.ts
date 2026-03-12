// ============================================
// Supabase Edge Function: stripe-webhook
// ============================================
// Listen to Stripe Events securely. Requires STRIPE_WEBHOOK_SECRET
// and STRIPE_SECRET_KEY to be set in Supabase Secrets.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@12.0.0?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
    apiVersion: '2022-11-15',
    httpClient: Stripe.createFetchHttpClient(),
});

const cryptoProvider = Stripe.createSubtleCryptoProvider();

serve(async (req: Request) => {
    // Webhooks don't need CORS as they are server-to-server

    try {
        const signature = req.headers.get('stripe-signature');
        const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

        if (!signature || !webhookSecret) {
            return new Response('Webhook secret or signature missing', { status: 400 });
        }

        const body = await req.text();
        let event;

        try {
            // Verify signature using Web Crypto API (Deno compatible)
            event = await stripe.webhooks.constructEventAsync(
                body,
                signature,
                webhookSecret,
                undefined,
                cryptoProvider
            );
        } catch (err: any) {
            console.error(`Webhook signature verification failed: ${err.message}`);
            return new Response(`Webhook Error: ${err.message}`, { status: 400 });
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        // Handle the event
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;

                // Get the user_id we passed in client_reference_id during checkout creation
                const userId = session.client_reference_id;
                const customerId = session.customer as string;

                if (!userId) {
                    console.error('No user_id found in client_reference_id');
                    return new Response('OK', { status: 200 }); // Still return 200 to Stripe
                }

                // Add 10,000 credits for the Pro plan ($15)
                const creditsToAdd = 10000;

                // Atomic transaction to add credits and update status
                const { data: creditRow, error: fetchErr } = await supabaseAdmin
                    .from('user_credits')
                    .select('remaining_credits')
                    .eq('user_id', userId)
                    .single();

                if (fetchErr && fetchErr.code !== 'PGRST116') {
                    throw new Error(`Error fetching user credits: ${fetchErr.message}`);
                }

                const currentCredits = creditRow ? creditRow.remaining_credits : 0;

                const { error: updateErr } = await supabaseAdmin
                    .from('user_credits')
                    .upsert({
                        user_id: userId,
                        remaining_credits: currentCredits + creditsToAdd,
                        stripe_customer_id: customerId,
                        subscription_status: 'active',
                    }, { onConflict: 'user_id' });

                if (updateErr) {
                    throw new Error(`Failed to update credits: ${updateErr.message}`);
                }

                console.log(`Successfully provisioned ${creditsToAdd} credits for user ${userId}`);
                break;
            }

            case 'invoice.payment_succeeded': {
                // Monthly renewal
                const invoice = event.data.object as Stripe.Invoice;
                const customerId = invoice.customer as string;

                // Find user by stripe_customer_id
                const { data: user, error: userErr } = await supabaseAdmin
                    .from('user_credits')
                    .select('user_id, remaining_credits')
                    .eq('stripe_customer_id', customerId)
                    .single();

                if (userErr || !user) {
                    console.error('Could not find user for renewal invoice:', customerId);
                    return new Response('OK', { status: 200 });
                }

                // Renew credits
                const creditsToAdd = 10000;
                await supabaseAdmin
                    .from('user_credits')
                    .update({
                        remaining_credits: user.remaining_credits + creditsToAdd,
                        subscription_status: 'active'
                    })
                    .eq('user_id', user.user_id);

                console.log(`Successfully renewed ${creditsToAdd} credits for user ${user.user_id}`);
                break;
            }

            case 'customer.subscription.deleted':
            case 'customer.subscription.past_due': {
                const subscription = event.data.object as Stripe.Subscription;
                const customerId = subscription.customer as string;

                // Mark status as past_due or canceled
                await supabaseAdmin
                    .from('user_credits')
                    .update({ subscription_status: event.type.includes('deleted') ? 'free' : 'past_due' })
                    .eq('stripe_customer_id', customerId);

                break;
            }

            default:
                console.log(`Unhandled event type ${event.type}`);
        }

        return new Response(JSON.stringify({ received: true }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });

    } catch (err: any) {
        console.error('Webhook error:', err);
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
});
