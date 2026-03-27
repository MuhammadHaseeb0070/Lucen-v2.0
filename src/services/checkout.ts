import { supabase, ensureFreshSession } from '../lib/supabase';

export async function startLemonCheckout(variantId: string): Promise<void> {
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

    const { data, error } = await supabase.functions.invoke('ls-checkout', {
        body: { variantId },
    });

    if (error) {
        throw new Error(error.message || 'Failed to start checkout');
    }

    const url = (data as any)?.url;
    if (typeof url !== 'string' || !url) {
        throw new Error('Checkout URL missing from server response');
    }

    window.location.href = url;
}

