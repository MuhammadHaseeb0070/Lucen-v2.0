import { supabase, ensureFreshSession } from '../lib/supabase';

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

    const { data, error, response } = await supabase.functions.invoke('ls-checkout', {
        body: { variantId },
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

