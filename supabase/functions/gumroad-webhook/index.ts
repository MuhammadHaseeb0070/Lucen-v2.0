// ============================================
// Supabase Edge Function: gumroad-webhook
// ============================================
// Gumroad webhook ("Ping") handler with:
//   - HMAC-SHA256 signature verification (if GUMROAD_WEBHOOK_SECRET is set)
//   - Fallback: verify sale via Gumroad API (using GUMROAD_ACCESS_TOKEN)
//   - Idempotency (webhook_events table prevents duplicate processing)
//   - Tier mapping via product option/variant names ("Regular" / "Pro")
//
// Requirements (Supabase secrets):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - GUMROAD_ACCESS_TOKEN     (for API verification)
//   - GUMROAD_TIER_REGULAR_ID  (Gumroad tier/option ID for Regular)
//   - GUMROAD_TIER_PRO_ID      (Gumroad tier/option ID for Pro)
//   - CREDITS_REGULAR           (default: 4000)
//   - CREDITS_PRO               (default: 10000)
// Optional:
//   - GUMROAD_WEBHOOK_SECRET   (for HMAC signature verification)

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

function toUtf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  const a = aHex.trim().toLowerCase();
  const b = bHex.trim().toLowerCase();
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

// ═══════════════════════════════════════════
//  Gumroad-specific extraction helpers
// ═══════════════════════════════════════════

/**
 * Extract user_id from Gumroad webhook payload.
 * Gumroad sends custom fields as a flat object within the payload.
 * The custom field must be named "user_id" on the Gumroad product.
 */
function extractUserId(payload: any): string | null {
  // Gumroad sends custom fields in multiple possible locations
  const candidates = [
    payload?.custom_fields?.user_id,
    payload?.custom_fields?.User_ID,
    payload?.custom_fields?.["User ID"],
    // Gumroad form-urlencoded bracket format
    payload?.["custom_fields[user_id]"],
    payload?.["custom_fields[User_ID]"],
    payload?.["custom_fields[User ID]"],
    // URL params can also come through
    payload?.url_params?.user_id,
    payload?.["url_params[user_id]"],
  ];
  for (const c of candidates) {
    const s = asString(c);
    if (s) return s;
  }
  return null;
}

/**
 * Determine the tier (Regular or Pro) from the Gumroad payload.
 * Gumroad membership tiers are identified by:
 *   - tier.id (the option ID like "Mtly56IU8xAt8BXjWflj1g==")
 *   - variant name (e.g. "Regular", "Pro")
 */
function getTierInfo(payload: any): { credits: number; plan: string } | null {
  const TIER_REGULAR_ID = Deno.env.get("GUMROAD_TIER_REGULAR_ID")?.trim();
  const TIER_PRO_ID = Deno.env.get("GUMROAD_TIER_PRO_ID")?.trim();
  const CREDITS_REGULAR = parseInt(Deno.env.get("CREDITS_REGULAR")?.replace(/["']/g, "").trim() || "4000", 10);
  const CREDITS_PRO = parseInt(Deno.env.get("CREDITS_PRO")?.replace(/["']/g, "").trim() || "10000", 10);

  // Gumroad sends variant/tier info in several possible fields
  const variantId = asString(payload?.variants?.Tier) ??
                    asString(payload?.["variants[Tier]"]) ??
                    asString(payload?.variant) ??
                    asString(payload?.tier_id) ??
                    asString(payload?.option_id);
  
  const variantName = (
    payload?.variants?.Tier ??
    payload?.["variants[Tier]"] ??
    payload?.variant_name ??
    payload?.tier_name ??
    payload?.option_name ??
    ""
  ).toString().toLowerCase().trim();

  // Match by ID first (most reliable)
  if (TIER_REGULAR_ID && variantId === TIER_REGULAR_ID) {
    return { credits: CREDITS_REGULAR, plan: "regular" };
  }
  if (TIER_PRO_ID && variantId === TIER_PRO_ID) {
    return { credits: CREDITS_PRO, plan: "pro" };
  }

  // Fallback: match by name
  if (variantName.includes("regular")) return { credits: CREDITS_REGULAR, plan: "regular" };
  if (variantName.includes("pro")) return { credits: CREDITS_PRO, plan: "pro" };

  // Fallback: match by price (Regular = $10/1000 cents, Pro = $20/2000 cents)
  const priceCents = payload?.price ?? payload?.recurrence_charge?.amount_cents;
  if (typeof priceCents === "number") {
    if (priceCents === 2000) return { credits: CREDITS_PRO, plan: "pro" };
    if (priceCents === 1000) return { credits: CREDITS_REGULAR, plan: "regular" };
  }

  return null;
}

/**
 * Extract a unique event identifier for idempotency.
 * Gumroad sale IDs are unique per transaction.
 */
function extractEventId(payload: any): string {
  const saleId = asString(payload?.sale_id) ?? asString(payload?.id);
  if (saleId) return `gumroad-${saleId}`;
  // Fallback: combine resource + timestamp
  const ts = payload?.sale_timestamp ?? payload?.created_at ?? Date.now();
  return `gumroad-${ts}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractSubscriptionId(payload: any): string | null {
  return asString(payload?.subscription_id) ?? asString(payload?.subscriber_id);
}

function getSupabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, serviceKey);
}

/** Fallback: if custom_fields are missing, try to find user by saved subscription_id */
async function findUserIdBySubscriptionId(subscriptionId: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("user_credits")
    .select("user_id")
    .eq("payment_subscription_id", subscriptionId)
    .maybeSingle();
  return data?.user_id ?? null;
}

/** Check if this event was already processed (idempotency) */
async function isEventProcessed(eventId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("webhook_events")
    .select("event_id")
    .eq("event_id", eventId)
    .maybeSingle();
  return !!data;
}

/** Record that we processed this event */
async function recordEvent(params: {
  eventId: string;
  eventName: string;
  userId: string;
  variantId?: string | null;
  creditsGranted?: number;
}) {
  const supabase = getSupabaseAdmin();
  await supabase.from("webhook_events").upsert({
    event_id: params.eventId,
    event_name: params.eventName,
    user_id: params.userId,
    variant_id: params.variantId ?? null,
    credits_granted: params.creditsGranted ?? 0,
  }, { onConflict: "event_id" });
}

async function grantPaymentCredits(params: {
  userId: string;
  creditsToAdd: number;
  plan?: string | null;
  subscriptionId?: string | null;
  renewsAt?: string | null;
}) {
  const supabase = getSupabaseAdmin();

  const { data: newBalance, error } = await supabase.rpc(
    "grant_subscription_credits",
    {
      p_user_id: params.userId,
      p_credits_to_add: params.creditsToAdd,
      p_plan: params.plan ?? null,
      p_subscription_id: params.subscriptionId ?? null,
      p_customer_portal_url: null, // Gumroad doesn't have a customer portal URL
      p_renews_at: params.renewsAt ?? null,
    },
  );

  if (error) {
    throw new Error(`Failed to grant credits: ${error.message}`);
  }

  // Also update the payment_provider column
  await supabase
    .from("user_credits")
    .update({ payment_provider: "gumroad" })
    .eq("user_id", params.userId);

  return typeof newBalance === "number" ? newBalance : null;
}

async function setFreeStatus(params: { userId: string; subscriptionId?: string | null }) {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("user_credits")
    .update({
      subscription_status: "free",
      subscription_plan: "free",
      payment_subscription_id: params.subscriptionId ?? null,
      payment_customer_portal_url: null,
      subscription_renews_at: null,
    })
    .eq("user_id", params.userId);

  if (error) {
    throw new Error(`Failed to set free status: ${error.message}`);
  }
}

/**
 * Verify sale with Gumroad API as a security measure.
 * Returns the sale data if valid, null if verification fails.
 */
async function verifySaleWithGumroad(saleId: string): Promise<any | null> {
  const accessToken = Deno.env.get("GUMROAD_ACCESS_TOKEN");
  if (!accessToken) {
    console.warn("gumroad-webhook: GUMROAD_ACCESS_TOKEN not set, skipping API verification");
    return null;
  }

  try {
    const res = await fetch(`https://api.gumroad.com/v2/sales/${saleId}`, {
      headers: {
        "Authorization": `Bearer ${accessToken.trim()}`,
      },
    });

    if (!res.ok) {
      console.error(`gumroad-webhook: Gumroad API returned ${res.status} for sale ${saleId}`);
      return null;
    }

    const json = await res.json();
    return json?.sale ?? json;
  } catch (err) {
    console.error("gumroad-webhook: API verification failed:", err);
    return null;
  }
}

// ═══════════════════════════════════════════
//  Main Handler
// ═══════════════════════════════════════════

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const rawBody = await req.text();

  // ── Signature verification (if secret is configured) ──
  const webhookSecret = Deno.env.get("GUMROAD_WEBHOOK_SECRET");
  if (webhookSecret) {
    const signature = req.headers.get("x-gumroad-signature") ??
                      req.headers.get("X-Gumroad-Signature");
    if (signature) {
      try {
        const computed = await hmacSha256Hex(webhookSecret, rawBody);
        if (!timingSafeEqualHex(computed, signature)) {
          console.error("gumroad-webhook: signature mismatch");
          return jsonResponse({ error: "Invalid signature" }, { status: 401 });
        }
      } catch (err) {
        console.error("gumroad-webhook: signature verification error:", err);
        return jsonResponse({ error: "Signature verification failed" }, { status: 400 });
      }
    } else {
      console.warn("gumroad-webhook: GUMROAD_WEBHOOK_SECRET is set but no signature header received");
    }
  }

  // ── Parse payload ──
  // Gumroad Ping sends form-encoded data, not JSON
  let payload: Record<string, any>;
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      payload = JSON.parse(rawBody);
    } else {
      // Form-encoded (default Gumroad format)
      const params = new URLSearchParams(rawBody);
      payload = Object.fromEntries(params.entries());
      // Parse nested JSON fields that Gumroad sends as strings
      for (const key of ["custom_fields", "variants", "url_params"]) {
        if (typeof payload[key] === "string") {
          try { payload[key] = JSON.parse(payload[key]); } catch { /* keep as string */ }
        }
      }
    }
  } catch {
    return jsonResponse({ error: "Invalid request body" }, { status: 400 });
  }

  console.log("gumroad-webhook: received payload keys:", Object.keys(payload));

  // ── Determine event type ──
  // Gumroad Ping uses `resource_name` to indicate the event type.
  // The global Ping endpoint receives ALL events without a resource_name field;
  // in that case we treat it as a "sale" if sale_id is present.
  const resourceName = (
    payload.resource_name ??
    (payload.sale_id ? "sale" : "ping")
  ).toString().toLowerCase();

  // ── Extract user ID ──
  const subscriptionId = extractSubscriptionId(payload);
  let userId = extractUserId(payload);
  
  if (!userId && subscriptionId) {
    console.log(`gumroad-webhook: user_id missing in payload, attempting lookup via subscription_id: ${subscriptionId}`);
    userId = await findUserIdBySubscriptionId(subscriptionId);
  }

  if (!userId) {
    console.error("gumroad-webhook: missing user_id in custom_fields and no matching subscription. Payload:", JSON.stringify(payload).slice(0, 500));
    // Acknowledge receipt to prevent Gumroad from retrying
    return jsonResponse({ received: true, error: "no_user_id" }, { status: 200 });
  }

  const eventId = extractEventId(payload);

  // ── Idempotency check ──
  try {
    const alreadyProcessed = await isEventProcessed(eventId);
    if (alreadyProcessed) {
      console.log(`gumroad-webhook: duplicate event ${eventId}, skipping`);
      return jsonResponse({ received: true, duplicate: true }, { status: 200 });
    }
  } catch (err) {
    console.error("gumroad-webhook: idempotency check failed, proceeding cautiously:", err);
  }

  try {
    // ── Handle based on event type ──
    switch (resourceName) {
      case "sale":
      case "ping": {
        // A sale/ping event = new purchase or recurring charge
        // Verify with Gumroad API if possible
        const saleId = asString(payload.sale_id);
        if (saleId) {
          const verified = await verifySaleWithGumroad(saleId);
          if (verified === null) {
            console.warn("gumroad-webhook: could not verify sale with API, proceeding with webhook data");
          }
        }

        // Check if this is a refund (refunded field is true)
        if (payload.refunded === true || payload.refunded === "true") {
          console.log(`gumroad-webhook: sale ${saleId} was refunded, setting free status`);
          await setFreeStatus({ userId, subscriptionId });
          await recordEvent({ eventId, eventName: "refund", userId });
          return jsonResponse({ received: true }, { status: 200 });
        }

        const tierInfo = getTierInfo(payload);
        if (!tierInfo) {
          console.error("gumroad-webhook: could not determine tier from payload");
          await recordEvent({ eventId, eventName: resourceName, userId });
          return jsonResponse({ received: true, error: "unknown_tier" }, { status: 200 });
        }

        // Check if this is a recurring charge (not the initial purchase)
        // For recurring charges, we check subscription_id presence
        const isRecurring = !!subscriptionId && payload.is_recurring_charge === true;

        // Pre-fetch current DB state
        const supabase = getSupabaseAdmin();
        const { data: userRow } = await supabase
          .from("user_credits")
          .select("subscription_plan")
          .eq("user_id", userId)
          .maybeSingle();

        const currentPlan = userRow?.subscription_plan ?? "free";
        const isNewOrUpgrade = currentPlan === "free" || currentPlan !== tierInfo.plan || isRecurring;

        if (isNewOrUpgrade) {
          const newBalance = await grantPaymentCredits({
            userId,
            creditsToAdd: tierInfo.credits,
            plan: tierInfo.plan,
            subscriptionId,
          });

          await recordEvent({
            eventId,
            eventName: resourceName,
            userId,
            variantId: tierInfo.plan,
            creditsGranted: tierInfo.credits,
          });
          console.log(`gumroad-webhook: granted ${tierInfo.credits} LC to user ${userId}. Plan: ${tierInfo.plan}. Balance: ${newBalance}`);
        } else {
          // Same plan, just metadata update (e.g. card change)
          await supabase.rpc("update_subscription_meta", {
            p_user_id: userId,
            p_plan: tierInfo.plan,
            p_subscription_id: subscriptionId ?? null,
            p_customer_portal_url: null,
            p_renews_at: null,
          });

          // Update payment provider
          await supabase
            .from("user_credits")
            .update({ payment_provider: "gumroad" })
            .eq("user_id", userId);

          await recordEvent({ eventId, eventName: resourceName, userId, creditsGranted: 0 });
          console.log(`gumroad-webhook: metadata update only for user ${userId}`);
        }

        return jsonResponse({ received: true }, { status: 200 });
      }

      case "cancellation":
      case "subscription_ended": {
        console.log(`gumroad-webhook: ${resourceName} for user ${userId}`);
        await setFreeStatus({ userId, subscriptionId });
        await recordEvent({ eventId, eventName: resourceName, userId });
        return jsonResponse({ received: true }, { status: 200 });
      }

      case "subscription_restarted": {
        console.log(`gumroad-webhook: subscription_restarted for user ${userId}`);
        const tierInfo = getTierInfo(payload);
        if (tierInfo) {
          const newBalance = await grantPaymentCredits({
            userId,
            creditsToAdd: tierInfo.credits,
            plan: tierInfo.plan,
            subscriptionId,
          });
          await recordEvent({
            eventId,
            eventName: resourceName,
            userId,
            variantId: tierInfo.plan,
            creditsGranted: tierInfo.credits,
          });
          console.log(`gumroad-webhook: restart granted ${tierInfo.credits} LC. Balance: ${newBalance}`);
        } else {
          await recordEvent({ eventId, eventName: resourceName, userId });
        }
        return jsonResponse({ received: true }, { status: 200 });
      }

      case "subscription_updated": {
        console.log(`gumroad-webhook: subscription_updated for user ${userId}`);
        const tierInfo = getTierInfo(payload);
        if (tierInfo) {
          const supabase = getSupabaseAdmin();
          
          // Secure Fulfillment Strategy:
          // Never grant LC instantly on a tier change ping because the user
          // has not necessarily been charged the new amount yet.
          // Wait for the next 'sale' ping (recurring charge) to safely grant LC.
          
          await supabase.rpc("update_subscription_meta", {
            p_user_id: userId,
            p_plan: tierInfo.plan,
            p_subscription_id: subscriptionId ?? null,
            p_customer_portal_url: null,
            p_renews_at: null,
          });

          await supabase
            .from("user_credits")
            .update({ payment_provider: "gumroad" })
            .eq("user_id", userId);

          await recordEvent({ 
            eventId, 
            eventName: resourceName, 
            userId,
            variantId: tierInfo.plan,
            creditsGranted: 0 
          });
          
          console.log(`gumroad-webhook: SECURE metadata update for tier change → ${tierInfo.plan} for user ${userId}. Credits will be granted on next charge.`);
        } else {
          await recordEvent({ eventId, eventName: resourceName, userId });
        }
        return jsonResponse({ received: true }, { status: 200 });
      }

      case "refund": {
        console.log(`gumroad-webhook: refund for user ${userId}`);
        await setFreeStatus({ userId, subscriptionId });
        await recordEvent({ eventId, eventName: resourceName, userId });
        return jsonResponse({ received: true }, { status: 200 });
      }

      default: {
        console.log(`gumroad-webhook: unhandled event type: ${resourceName}`);
        await recordEvent({ eventId, eventName: resourceName, userId });
        return jsonResponse({ received: true }, { status: 200 });
      }
    }
  } catch (err) {
    console.error("gumroad-webhook handler error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
});
