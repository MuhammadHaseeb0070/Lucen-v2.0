// Shared CORS headers for Edge Functions.
// Restricts Access-Control-Allow-Origin when VITE_APP_URL is set in Supabase secrets.
// VITE_APP_URL can be comma-separated: https://www.lucen.space,https://lucen.space
// When not set, allows all origins (falls back to '*').

const APP_URLS = (Deno.env.get('VITE_APP_URL') || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
const ALLOWED_ORIGINS = [
    ...APP_URLS,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
].filter(Boolean) as string[];

/** Returns CORS headers. When VITE_APP_URL is set, restricts to allowed list; otherwise uses '*'. */
export function getCorsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get('Origin') || '';
    let allowOrigin = '*';
    if (APP_URLS.length > 0 && ALLOWED_ORIGINS.length > 0) {
        const isAllowed = origin && ALLOWED_ORIGINS.some(
            (allowed) => origin === allowed || (allowed && origin.startsWith(allowed))
        );
        allowOrigin = isAllowed ? origin : (ALLOWED_ORIGINS[0] ?? '*');
    }
    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
}

/** @deprecated Use getCorsHeaders(req) for production. Kept for backwards compatibility. */
export const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
