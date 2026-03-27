// ============================================
// Supabase Edge Function: ls-webhook
// ============================================
// Lemon Squeezy webhook handler with signature verification.
//
// Requirements (Supabase secrets):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - LEMON_SQUEEZY_WEBHOOK_SECRET
//   - LS_VARIANT_REGULAR
//   - LS_VARIANT_PRO
//
// Event handling:
//   - subscription_created / subscription_updated:
//       if variant_id == LS_VARIANT_REGULAR => add 4,000 credits + status active
//       if variant_id == LS_VARIANT_PRO     => add 10,000 credits + status active
//   - subscription_cancelled (and best-effort "past due" signals):
//       set status free
//
// Custom user binding:
//   - Extracts user_id from payload meta.custom_data.user_id (passed via checkout_data.custom.user_id)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

function jsonResponse(body: Json, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {}),
    },
  });
}

function getHeader(req: Request, name: string): string | null {
  // Header matching is case-insensitive, but we normalize anyway.
  return req.headers.get(name) ?? req.headers.get(name.toLowerCase());
}

function toUtf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  const a = aHex.trim();
  const b = bHex.trim();
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

async function hmacSha256Hex(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toUtf8Bytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, toUtf8Bytes(rawBody));
  return hexEncode(new Uint8Array(sig));
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function extractUserId(payload: any): string | null {
  // Per docs: meta.custom_data contains checkout custom data.
  const id = payload?.meta?.custom_data?.user_id ?? payload?.meta?.custom_data?.userId;
  return asString(id);
}

function extractVariantId(payload: any): string | null {
  // Subscription object typically contains variant_id as an attribute.
  const attr = payload?.data?.attributes;
  const candidate =
    attr?.variant_id ??
    attr?.variantId ??
    attr?.first_subscription_item?.variant_id ??
    attr?.first_subscription_item?.variantId ??
    // Some events embed order item under first_order_item
    attr?.first_order_item?.variant_id ??
    attr?.first_order_item?.variantId;
  return asString(candidate);
}

function extractSubscriptionId(payload: any): string | null {
  return asString(payload?.data?.id);
}

function isCancellationEvent(eventName: string): boolean {
  // You requested subscription_cancelled; we also treat deleted/cancelled variants defensively.
  const n = eventName.toLowerCase();
  return n === "subscription_cancelled" || n === "subscription_deleted" || n === "subscription_expired";
}

function shouldSetFreeForUpdate(payload: any): boolean {
  // Best-effort: some "updated" events include a status attribute.
  const status = payload?.data?.attributes?.status;
  if (typeof status !== "string") return false;
  const s = status.toLowerCase();
  return s === "cancelled" || s === "expired" || s === "unpaid" || s === "past_due" || s === "paused";
}

async function addCreditsAndActivate(params: {
  userId: string;
  variantId: string;
  subscriptionId?: string | null;
  creditsToAdd: number;
}) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceKey);

  const { data: creditRow, error: fetchErr } = await supabaseAdmin
    .from("user_credits")
    .select("remaining_credits")
    .eq("user_id", params.userId)
    .maybeSingle();

  if (fetchErr) {
    throw new Error(`Error fetching user credits: ${fetchErr.message}`);
  }

  const currentCredits = typeof creditRow?.remaining_credits === "number" ? creditRow.remaining_credits : 0;

  const { error: upsertErr } = await supabaseAdmin
    .from("user_credits")
    .upsert(
      {
        user_id: params.userId,
        remaining_credits: currentCredits + params.creditsToAdd,
        subscription_status: "active",
        lemon_squeezy_subscription_id: params.subscriptionId ?? null,
      },
      { onConflict: "user_id" },
    );

  if (upsertErr) {
    throw new Error(`Failed to update credits: ${upsertErr.message}`);
  }
}

async function setFreeStatus(params: { userId: string; subscriptionId?: string | null }) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAdmin = createClient(supabaseUrl, serviceKey);

  const { error } = await supabaseAdmin
    .from("user_credits")
    .update({
      subscription_status: "free",
      lemon_squeezy_subscription_id: params.subscriptionId ?? null,
    })
    .eq("user_id", params.userId);

  if (error) {
    throw new Error(`Failed to set free status: ${error.message}`);
  }
}

serve(async (req: Request) => {
  // Webhooks are server-to-server; no CORS.
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const secret = Deno.env.get("LEMON_SQUEEZY_WEBHOOK_SECRET");
  if (!secret) {
    return jsonResponse({ error: "LEMON_SQUEEZY_WEBHOOK_SECRET not configured" }, { status: 500 });
  }

  const signature = getHeader(req, "X-Signature");
  if (!signature) {
    return jsonResponse({ error: "Missing X-Signature header" }, { status: 400 });
  }

  const rawBody = await req.text();

  try {
    const computed = await hmacSha256Hex(secret, rawBody);
    if (!timingSafeEqualHex(computed, signature)) {
      return jsonResponse({ error: "Invalid signature" }, { status: 401 });
    }
  } catch (err) {
    console.error("ls-webhook signature verification error:", err);
    return jsonResponse({ error: "Signature verification failed" }, { status: 400 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
  }

  const eventName =
    (getHeader(req, "X-Event-Name") ?? asString(payload?.meta?.event_name) ?? "unknown").toString();

  const userId = extractUserId(payload);
  if (!userId) {
    console.error("ls-webhook: missing user_id in meta.custom_data");
    return jsonResponse({ received: true }, { status: 200 });
  }

  const variantId = extractVariantId(payload);
  const subscriptionId = extractSubscriptionId(payload);

  const VARIANT_REGULAR = Deno.env.get("LS_VARIANT_REGULAR");
  const VARIANT_PRO = Deno.env.get("LS_VARIANT_PRO");

  if (!VARIANT_REGULAR || !VARIANT_PRO) {
    console.error("ls-webhook: LS_VARIANT_REGULAR/LS_VARIANT_PRO not configured");
    return jsonResponse({ error: "Variant configuration missing" }, { status: 500 });
  }

  try {
    if (isCancellationEvent(eventName) || (eventName.toLowerCase() === "subscription_updated" && shouldSetFreeForUpdate(payload))) {
      await setFreeStatus({ userId, subscriptionId });
      return jsonResponse({ received: true }, { status: 200 });
    }

    if (eventName.toLowerCase() === "subscription_created" || eventName.toLowerCase() === "subscription_updated") {
      if (!variantId) {
        console.error("ls-webhook: missing variant_id in subscription payload");
        return jsonResponse({ received: true }, { status: 200 });
      }

      let creditsToAdd: number | null = null;
      if (variantId === VARIANT_REGULAR) creditsToAdd = 4000;
      if (variantId === VARIANT_PRO) creditsToAdd = 10000;

      if (creditsToAdd === null) {
        console.log(`ls-webhook: ignoring unknown variant_id=${variantId}`);
        return jsonResponse({ received: true }, { status: 200 });
      }

      await addCreditsAndActivate({ userId, variantId, subscriptionId, creditsToAdd });
      return jsonResponse({ received: true }, { status: 200 });
    }

    console.log(`ls-webhook: unhandled event ${eventName}`);
    return jsonResponse({ received: true }, { status: 200 });
  } catch (err) {
    console.error("ls-webhook handler error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
});

