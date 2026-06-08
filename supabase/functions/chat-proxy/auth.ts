import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkRateLimit } from '../_shared/rateLimit.ts';

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const base64 = token.split('.')[1];
  const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json);
}

export interface AuthResult {
  success: boolean;
  userId?: string;
  expiry?: number;
  user?: any;
  supabaseAdmin?: SupabaseClient;
  token?: string;
  errorResponse?: Response;
  errorReason?: string;
  errorStatus?: 'auth_error' | 'client_error' | 'upstream_error';
}

export async function handleAuthAndRateLimit(
  req: Request,
  log: any,
  cors: Record<string, string>,
  fail: (status: any, httpStatus: number, message: string, reason?: string | null) => Promise<Response>
): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    const res = await fail('auth_error', 401, 'Missing Authorization header');
    return { success: false, errorResponse: res, errorStatus: 'auth_error', errorReason: 'Missing Authorization header' };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const openrouterApiKey = Deno.env.get('OPENROUTER_API_KEY');

  if (!openrouterApiKey) {
    const res = await fail('client_error', 500, 'OpenRouter API key not configured on server');
    return { success: false, errorResponse: res, errorStatus: 'client_error', errorReason: 'OpenRouter API key not configured on server' };
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token || token.split('.').length !== 3) {
    const res = await fail('auth_error', 401, 'Invalid token format');
    return { success: false, errorResponse: res, errorStatus: 'auth_error', errorReason: 'Invalid token format' };
  }

  let claims: Record<string, unknown>;
  try {
    claims = decodeJwtPayload(token);
  } catch {
    const res = await fail('auth_error', 401, 'Malformed JWT');
    return { success: false, errorResponse: res, errorStatus: 'auth_error', errorReason: 'Malformed JWT' };
  }

  const userId = claims.sub as string;
  const expiry = claims.exp as number;
  if (!userId) {
    const res = await fail('auth_error', 401, 'JWT missing sub claim');
    return { success: false, errorResponse: res, errorStatus: 'auth_error', errorReason: 'JWT missing sub claim' };
  }

  // Rate limit: 30 requests per minute per user
  const rateLimitResult = checkRateLimit(`chat:${userId}`, 30, 60_000);
  if (!rateLimitResult.allowed) {
    log.warn('Rate limit exceeded', { userId, retryAfterMs: rateLimitResult.retryAfterMs });
    const res = await fail('client_error', 429, 'Too many requests. Please wait a moment and try again.');
    return { success: false, errorResponse: res, errorStatus: 'client_error', errorReason: 'Too many requests. Please wait a moment and try again.' };
  }
  if (expiry && expiry < Math.floor(Date.now() / 1000)) {
    const res = await fail('auth_error', 401, 'Token expired');
    return { success: false, errorResponse: res, errorStatus: 'auth_error', errorReason: 'Token expired' };
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
  const { data: adminUser, error: adminError } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (adminError || !adminUser?.user) {
    const res = await fail('auth_error', 401, 'User not found');
    return { success: false, errorResponse: res, errorStatus: 'auth_error', errorReason: 'User not found' };
  }
  const user = adminUser.user;

  return {
    success: true,
    userId,
    expiry,
    user,
    supabaseAdmin,
    token
  };
}
