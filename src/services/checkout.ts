import { supabase, ensureFreshSession } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';

// ═══════════════════════════════════════════
//  Payment Provider Detection
// ═══════════════════════════════════════════

export type PaymentProvider = 'gumroad' | 'lemonsqueezy';

export function getPaymentProvider(): PaymentProvider {
    const provider = (import.meta.env.VITE_PAYMENT_PROVIDER || 'lemonsqueezy').toLowerCase().trim();
    if (provider === 'gumroad') return 'gumroad';
    return 'lemonsqueezy';
}

// ═══════════════════════════════════════════
//  Gumroad Checkout (direct link — no edge function needed)
// ═══════════════════════════════════════════

/**
 * Redirect to Gumroad checkout for a tiered membership.
 * Gumroad uses direct product URLs with URL params to pass custom data.
 * The `user_id` custom field must exist on the Gumroad product.
 *
 * @param productUrl – full Gumroad product URL (e.g. https://haseebmuhammad23.gumroad.com/l/xnpzvs)
 * @param tierName – the tier/variant to pre-select (e.g. "Regular" or "Pro")
 * @param redirectUrl – optional URL to redirect to after purchase
 */
export async function startGumroadCheckout(
    productUrl: string,
    tierName: string,
): Promise<void> {
    // Ensure the user is authenticated
    const ok = await ensureFreshSession();
    if (!ok) {
        throw new Error('Session expired. Please sign in again.');
    }

    const user = useAuthStore.getState().user;
    if (!user) {
        throw new Error('You must be signed in to subscribe.');
    }

    const url = new URL(productUrl);
    // Pre-fill the user_id custom field (must be created on Gumroad product)
    url.searchParams.set('user_id', user.id);
    // Pre-fill email for convenience
    url.searchParams.set('email', user.email);
    // Pre-select the tier/option
    url.searchParams.set('option', tierName);
    // Skip the product page, go straight to checkout
    url.searchParams.set('wanted', 'true');

    // Note: Gumroad handles the redirect via product settings (Content → Redirect URL).
    // We can't pass redirectUrl dynamically like Lemon Squeezy.
    // The redirect URL must be configured on the Gumroad product itself.

    window.location.href = url.toString();
}

// ═══════════════════════════════════════════
//  Lemon Squeezy Checkout (existing — preserved for rollback)
// ═══════════════════════════════════════════

/** Non-2xx Edge Function responses still include JSON `{ error: string }` on the body; the JS client only surfaces a generic message unless we read it. */
async function messageFromFunctionsInvoke(
    error: unknown,
    response: Response | undefined,
): Promise<string> {
    if (response) {
        try {
            const ct = response.headers.get('Content-Type') ?? '';
            if (ct.includes('application/json')) {
                const body = (await response.json()) as { error?: string; message?: string };
                const msg = body.error ?? body.message;
                if (typeof msg === 'string' && msg.trim()) {
                    return msg.trim();
                }
            } else {
                const text = await response.text();
                if (text.trim()) {
                    return text.trim().slice(0, 800);
                }
            }
        } catch {
            /* fall through */
        }
    }
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return 'Failed to start checkout';
}

export async function startLemonCheckout(variantId: string, redirectUrl?: string): Promise<void> {
    if (!supabase) {
        throw new Error('Supabase is not configured');
    }
    if (!variantId) {
        throw new Error('Missing variantId');
    }

    const ok = await ensureFreshSession();
    if (!ok) {
        throw new Error('Session expired. Please sign in again.');
    }

    const { data, error, response } = await supabase.functions.invoke('ls-checkout', {
        body: { variantId, redirectUrl },
    });

    if (error) {
        const msg = await messageFromFunctionsInvoke(error, response);
        throw new Error(msg);
    }

    const url = (data as { url?: string })?.url;
    if (typeof url !== 'string' || !url) {
        throw new Error('Checkout URL missing from server response');
    }

    window.location.href = url;
}

// ═══════════════════════════════════════════
//  Provider-Aware Checkout Wrapper
// ═══════════════════════════════════════════

/**
 * Start checkout for the given plan tier.
 * Automatically uses the correct payment provider based on VITE_PAYMENT_PROVIDER.
 *
 * @param tierConfig – { variantId, gumroadProductUrl, gumroadTierName }
 * @param redirectUrl – optional redirect after purchase
 */
export async function startCheckout(
    tierConfig: {
        variantId?: string;        // Lemon Squeezy variant ID
        gumroadProductUrl?: string; // Gumroad product URL
        gumroadTierName?: string;   // Gumroad tier name ("Regular" or "Pro")
    },
    redirectUrl?: string,
): Promise<void> {
    const provider = getPaymentProvider();

    if (provider === 'gumroad') {
        if (!tierConfig.gumroadProductUrl) {
            throw new Error('Missing VITE_GUMROAD_PRODUCT_URL. Set it in your environment variables.');
        }
        await startGumroadCheckout(
            tierConfig.gumroadProductUrl,
            tierConfig.gumroadTierName || 'Regular',
        );
    } else {
        if (!tierConfig.variantId) {
            throw new Error('Missing Lemon Squeezy variant ID. Set VITE_LS_VARIANT_* in your environment variables.');
        }
        await startLemonCheckout(tierConfig.variantId, redirectUrl);
    }
}
