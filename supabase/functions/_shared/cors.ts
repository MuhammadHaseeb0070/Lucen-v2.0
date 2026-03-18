// Shared CORS headers for Edge Functions.
// Restricts Access-Control-Allow-Origin when VITE_APP_URL is set in Supabase secrets.
// VITE_APP_URL can be comma-separated: https://www.lucen.space,https://lucen.space
// Local dev origins on localhost/127.0.0.1 are always allowed for any port.

// Normalize: strip trailing slashes (browser Origin never has trailing slash)
const norm = (s: string) => s.replace(/\/+$/, '');
const APP_URLS = (Deno.env.get('VITE_APP_URL') || '')
    .split(',')
    .map((u) => norm(u.trim()))
    .filter(Boolean);
const isLocalDevOrigin = (origin: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const ALLOWED_ORIGINS = [...APP_URLS].filter(Boolean) as string[];

/** Returns CORS headers. When VITE_APP_URL is set, restricts to allowed list + *.vercel.app; otherwise uses '*'. */
export function getCorsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get('Origin') || '';
    const originNorm = norm(origin);
    let allowOrigin = '*';
    if (APP_URLS.length > 0 && ALLOWED_ORIGINS.length > 0) {
        const isInAllowedList = originNorm && ALLOWED_ORIGINS.some(
            (allowed) => originNorm === allowed || (allowed && originNorm.startsWith(allowed))
        );
        const isVercelPreview = origin.startsWith('https://') && origin.endsWith('.vercel.app');
        const isAllowed = isInAllowedList || isVercelPreview || isLocalDevOrigin(originNorm);
        // Echo the actual Origin header — CORS requires exact match
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
