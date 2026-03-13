// Shared CORS headers for Edge Functions.
// Restricts Access-Control-Allow-Origin to allowed origins in production.
// Set VITE_APP_URL in Supabase secrets to your production URL (e.g. https://your-app.vercel.app).

const ALLOWED_ORIGINS = [
    Deno.env.get('VITE_APP_URL'),
    'http://localhost:5173',
    'http://127.0.0.1:5173',
].filter(Boolean) as string[];

/** Returns CORS headers. If VITE_APP_URL is set, restricts origin to allowed list; otherwise allows all. */
export function getCorsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get('Origin') || '';
    let allowOrigin = '*';
    if (ALLOWED_ORIGINS.length > 0) {
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
