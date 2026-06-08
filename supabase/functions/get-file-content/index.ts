import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from '../_shared/cors.ts';
import { isKillSwitched } from '../_shared/featureFlags.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

function decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const base64 = token.split('.')[1];
        const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
        return JSON.parse(json);
    } catch {
        return null;
    }
}

Deno.serve(async (req: Request) => {
    const cors = getCorsHeaders(req);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

    // Feature flag kill switch
    if (isKillSwitched('GET_FILE_CONTENT')) {
        return new Response(JSON.stringify({ error: 'Service temporarily unavailable.' }), {
            status: 503,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    }

    // Edge-level rate limiting — 60 req/min per IP
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rlResult = await checkRateLimit(`get-file-content:${clientIp}`, 60, 60_000);
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
            return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
                status: 401,
                headers: { ...cors, 'Content-Type': 'application/json' }
            });
        }

        const body = await req.json().catch(() => ({}));
        let fileId = body?.file_id;
        let filePath = body?.file_path;
        const maxChars = Math.min(Math.max(100, Number(body?.max_chars ?? 30000)), 150000);

        if (!fileId && !filePath) {
            return new Response(JSON.stringify({ error: 'file_id or file_path is required' }), {
                status: 400,
                headers: { ...cors, 'Content-Type': 'application/json' }
            });
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        // S1 fix: verify JWT signature via Supabase instead of local decode
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) {
            return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
                status: 401,
                headers: { ...cors, 'Content-Type': 'application/json' }
            });
        }

        let textContent = null;
        if (fileId) {
            const { data: dbRecord, error: dbError } = await supabaseAdmin
                .from('file_attachments')
                .select('extracted_text, storage_path')
                .eq('id', fileId)
                .maybeSingle();

            if (dbError) {
                return new Response(JSON.stringify({ error: `Attachment with ID ${fileId} not found: ${dbError.message}` }), {
                    status: 404,
                    headers: { ...cors, 'Content-Type': 'application/json' }
                });
            }
            textContent = dbRecord?.extracted_text;
            filePath = dbRecord?.storage_path;
        } else if (filePath) {
            const { data: dbRecord, error: dbError } = await supabaseAdmin
                .from('file_attachments')
                .select('extracted_text')
                .eq('storage_path', filePath)
                .not('extracted_text', 'is', null)
                .limit(1)
                .maybeSingle();
            textContent = dbRecord?.extracted_text;
        }

        if (!textContent && filePath) {
            const { data: fileData, error: downloadError } = await supabaseAdmin
                .storage
                .from('attachments')
                .download(filePath);

            if (downloadError || !fileData) {
                return new Response(JSON.stringify({ error: `File not found in storage: ${downloadError?.message ?? ''}` }), {
                    status: 404,
                    headers: { ...cors, 'Content-Type': 'application/json' }
                });
            }

            textContent = await fileData.text();
            
            if (fileId) {
                await supabaseAdmin
                    .from('file_attachments')
                    .update({ extracted_text: textContent })
                    .eq('id', fileId)
                    .then(() => {});
            } else {
                await supabaseAdmin
                    .from('file_attachments')
                    .update({ extracted_text: textContent })
                    .eq('storage_path', filePath)
                    .then(() => {});
            }
        }

        let content = textContent || '';
        let isTruncated = false;
        if (content.length > maxChars) {
            content = content.slice(0, maxChars);
            isTruncated = true;
        }

        return new Response(JSON.stringify({
            content,
            is_truncated: isTruncated,
            length: content.length,
            total_length: textContent?.length ?? 0
        }), {
            headers: { ...cors, 'Content-Type': 'application/json' }
        });

    } catch (err: any) {
        console.error('[get-file-content] error:', err);
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...cors, 'Content-Type': 'application/json' }
        });
    }
});
