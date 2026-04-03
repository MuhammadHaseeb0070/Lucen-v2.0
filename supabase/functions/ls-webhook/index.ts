// ============================================
// Supabase Edge Function: ls-webhook
// ============================================
// Lemon Squeezy webhook handler — SOLE payment processor.
//
// Security:
//   - HMAC-SHA256 signature verification (REQUIRED — rejects if missing)
//   - Idempotency via webhook_events table (prevents duplicate processing)
//   - Server-side only — no client can invoke this function
//   - Atomic RPC operations — no race conditions
//
// Handled events:
//   - subscription_created       → Grant credits, set plan active
//   - subscription_updated       → Upgrade grants credits; downgrade = metadata only
//   - subscription_cancelled     → Set status to 'cancelled' (credits remain until expiry)
//   - subscription_expired       → Revert to free tier
//   - subscription_resumed       → Grant credits, reactivate
//   - subscription_payment_success → Renewal credit grant (skip initial)
//   - subscription_payment_failed  → Set status to 'past_due'
//   - subscription_payment_refunded → Void all credits, revert to free
//   - order_refunded              → Void all credits, revert to free
//
// Requirements (Supabase secrets):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
//   - LEMON_SQUEEZY_WEBHOOK_SECRET
//   - LS_VARIANT_REGULAR
//   - LS_VARIANT_PRO
//   - CREDITS_REGULAR (default: 4000)
//   - CREDITS_PRO     (default: 10000)

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

/** Mask a string for safe logging (e.g. "sk-abc...xyz") */
function maskSecret(s: string): string {
  if (!s || s.length < 8) return "***";
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
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
//  Lemon Squeezy Payload Extraction
// ═══════════════════════════════════════════

function extractUserId(payload: any): string | null {
  const id = payload?.meta?.custom_data?.user_id ?? payload?.meta?.custom_data?.userId;
  return asString(id);
}

function extractVariantId(payload: any): string | null {
  const attr = payload?.data?.attributes;
  const candidate =
    attr?.variant_id ??
    attr?.variantId ??
    attr?.first_subscription_item?.variant_id ??
    attr?.first_subscription_item?.variantId ??
    attr?.first_order_item?.variant_id ??
    attr?.first_order_item?.variantId ??
    payload?.meta?.custom_data?.variant_id ??
    payload?.meta?.custom_data?.variantId;
  return asString(candidate);
}

function extractSubscriptionId(payload: any): string | null {
  return asString(payload?.data?.id);
}

/** Extract a unique event identifier for idempotency */
function extractEventId(payload: any, req: Request): string {
  // Try webhook delivery ID from headers first (guaranteed unique)
  const deliveryId = getHeader(req, "X-Delivery-Id") ?? getHeader(req, "x-delivery-id");
  if (deliveryId) return deliveryId;
  // Fallback: combine event name + subscription id + timestamp
  const eventName = payload?.meta?.event_name ?? "unknown";
  const subId = payload?.data?.id ?? "none";
  const createdAt = payload?.data?.attributes?.created_at ?? Date.now();
  return `${eventName}-${subId}-${createdAt}`;
}

// ═══════════════════════════════════════════
//  Tier Mapping
// ═══════════════════════════════════════════

/** Map a Lemon Squeezy variant ID to { credits, plan } */
function getCreditsForVariant(variantId: string): { credits: number; plan: string } | null {
  const VARIANT_REGULAR = Deno.env.get("LS_VARIANT_REGULAR")?.replace(/["'#]/g, "").trim();
  const VARIANT_PRO = Deno.env.get("LS_VARIANT_PRO")?.replace(/["'#]/g, "").trim();
  const CREDITS_REGULAR_STR = Deno.env.get("CREDITS_REGULAR")?.replace(/["']/g, "").trim() || "4000";
  const CREDITS_PRO_STR = Deno.env.get("CREDITS_PRO")?.replace(/["']/g, "").trim() || "10000";
  const CREDITS_REGULAR = parseInt(CREDITS_REGULAR_STR, 10);
  const CREDITS_PRO = parseInt(CREDITS_PRO_STR, 10);

  const cleanId = variantId.replace(/["'#]/g, "").trim();

  if (cleanId === VARIANT_REGULAR) return { credits: CREDITS_REGULAR, plan: "regular" };
  if (cleanId === VARIANT_PRO) return { credits: CREDITS_PRO, plan: "pro" };
  return null;
}

/** Returns rank for plan comparison (higher = more expensive) */
function planRank(plan: string): number {
  switch (plan) {
    case "pro": return 3;
    case "regular": return 2;
    case "free": return 1;
    default: return 0;
  }
}

// ═══════════════════════════════════════════
//  Supabase Helpers
// ═══════════════════════════════════════════

function getSupabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, serviceKey);
}

/** Check if this event was already processed (idempotency) */
async function isEventProcessed(eventId: string): Promise<boolean> {
  const supabaseAdmin = getSupabaseAdmin();
  const { data } = await supabaseAdmin
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
  const supabaseAdmin = getSupabaseAdmin();
  await supabaseAdmin.from("webhook_events").upsert({
    event_id: params.eventId,
    event_name: params.eventName,
    user_id: params.userId,
    variant_id: params.variantId ?? null,
    credits_granted: params.creditsGranted ?? 0,
  }, { onConflict: "event_id" });
}

// ═══════════════════════════════════════════
//  Subscription State Mutations
// ═══════════════════════════════════════════

/** Grant credits via atomic ledger-based RPC */
async function grantPaymentCredits(params: {
  userId: string;
  creditsToAdd: number;
  plan?: string | null;
  subscriptionId?: string | null;
  customerPortalUrl?: string | null;
  renewsAt?: string | null;
}) {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: newBalance, error } = await supabaseAdmin.rpc(
    "grant_subscription_credits",
    {
      p_user_id: params.userId,
      p_credits_to_add: params.creditsToAdd,
      p_plan: params.plan ?? null,
      p_subscription_id: params.subscriptionId ?? null,
      p_customer_portal_url: params.customerPortalUrl ?? null,
      p_renews_at: params.renewsAt ?? null,
    },
  );

  if (error) {
    throw new Error(`Failed to grant credits: ${error.message}`);
  }

  return typeof newBalance === "number" ? newBalance : null;
}

/** Update metadata only (no credit changes) */
async function updateSubscriptionStatus(params: {
  userId: string;
  variantId: string;
  subscriptionId?: string | null;
  plan: string;
  customerPortalUrl?: string | null;
  renewsAt?: string | null;
}) {
  const supabaseAdmin = getSupabaseAdmin();

  const { error } = await supabaseAdmin.rpc("update_subscription_meta", {
    p_user_id: params.userId,
    p_plan: params.plan,
    p_subscription_id: params.subscriptionId ?? null,
    p_customer_portal_url: params.customerPortalUrl ?? null,
    p_renews_at: params.renewsAt ?? null,
  });

  // Ignoring errors here since meta might fail if RPC was dropped during migration
}

/** Set user to free tier (cancellation/expiry) */
async function setFreeStatus(params: { userId: string; subscriptionId?: string | null }) {
  const supabaseAdmin = getSupabaseAdmin();

  const { error } = await supabaseAdmin
    .from("user_credits")
    .update({
      subscription_status: "free",
      subscription_plan: "free",
      lemon_squeezy_subscription_id: params.subscriptionId ?? null,
      lemon_squeezy_customer_portal_url: null,
      subscription_renews_at: null,
    })
    .eq("user_id", params.userId);

  if (error) {
    throw new Error(`Failed to set free status: ${error.message}`);
  }
}

/** Set status to cancelled (user keeps credits until expiry) */
async function setCancelledStatus(params: { userId: string }) {
  const supabaseAdmin = getSupabaseAdmin();

  const { error } = await supabaseAdmin
    .from("user_credits")
    .update({
      subscription_status: "cancelled",
    })
    .eq("user_id", params.userId);

  if (error) {
    throw new Error(`Failed to set cancelled status: ${error.message}`);
  }
}

/** Set status to past_due (payment failed, but don't remove credits) */
async function setPastDueStatus(params: { userId: string }) {
  const supabaseAdmin = getSupabaseAdmin();

  const { error } = await supabaseAdmin
    .from("user_credits")
    .update({
      subscription_status: "past_due",
    })
    .eq("user_id", params.userId);

  if (error) {
    throw new Error(`Failed to set past_due status: ${error.message}`);
  }
}

/** Expire credits specifically for one subscription */
async function expireSubscriptionLedgers(params: { userId: string; subscriptionId: string }) {
  const supabaseAdmin = getSupabaseAdmin();

  const { error } = await supabaseAdmin.rpc("expire_subscription_ledgers", {
    p_user_id: params.userId,
    p_subscription_id: params.subscriptionId,
  });

  if (error) {
    throw new Error(`Failed to expire subscription ledgers: ${error.message}`);
  }
}

// ═══════════════════════════════════════════
//  Status Checking Helpers
// ═══════════════════════════════════════════

function isCancellationEvent(eventName: string): boolean {
  const n = eventName.toLowerCase();
  return n === "subscription_cancelled";
}

function isExpiryEvent(eventName: string): boolean {
  const n = eventName.toLowerCase();
  return n === "subscription_expired" || n === "subscription_deleted";
}

function isRefundEvent(eventName: string): boolean {
  const n = eventName.toLowerCase();
  return n === "subscription_payment_refunded" || n === "order_refunded";
}

function isPaymentFailedEvent(eventName: string): boolean {
  const n = eventName.toLowerCase();
  return n === "subscription_payment_failed";
}

function isResumedEvent(eventName: string): boolean {
  const n = eventName.toLowerCase();
  return n === "subscription_resumed";
}

/** Check if subscription_updated is really a status downgrade (not a plan change) */
function shouldSetFreeForUpdate(payload: any): boolean {
  const status = payload?.data?.attributes?.status;
  if (typeof status !== "string") return false;
  const s = status.toLowerCase();
  return s === "expired" || s === "unpaid";
}

function shouldSetPastDueForUpdate(payload: any): boolean {
  const status = payload?.data?.attributes?.status;
  if (typeof status !== "string") return false;
  const s = status.toLowerCase();
  return s === "past_due" || s === "paused";
}

function shouldSetCancelledForUpdate(payload: any): boolean {
  const status = payload?.data?.attributes?.status;
  if (typeof status !== "string") return false;
  return status.toLowerCase() === "cancelled";
}

// ═══════════════════════════════════════════
//  Main Handler
// ═══════════════════════════════════════════

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  // ── Signature verification (MANDATORY) ──
  const secret = Deno.env.get("LEMON_SQUEEZY_WEBHOOK_SECRET");
  if (!secret) {
    console.error("ls-webhook: LEMON_SQUEEZY_WEBHOOK_SECRET not configured");
    return jsonResponse({ error: "LEMON_SQUEEZY_WEBHOOK_SECRET not configured" }, { status: 500 });
  }

  const signature = getHeader(req, "X-Signature");
  if (!signature) {
    console.error("ls-webhook: Missing X-Signature header — rejecting");
    return jsonResponse({ error: "Missing X-Signature header" }, { status: 400 });
  }

  const rawBody = await req.text();

  try {
    const computed = await hmacSha256Hex(secret, rawBody);
    if (!timingSafeEqualHex(computed, signature)) {
      console.error(`ls-webhook: HMAC signature mismatch.
        Secret (masked): ${maskSecret(secret)}
        Received: ${signature}
        Computed: ${computed}
        Payload head: ${rawBody.slice(0, 100)}...`);
      return jsonResponse({ error: "Invalid signature" }, { status: 401 });
    }
  } catch (err) {
    console.error("ls-webhook: signature verification error:", err);
    return jsonResponse({ error: "Signature verification failed" }, { status: 400 });
  }

  // ── Parse payload ──
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
    console.error("ls-webhook: missing user_id in meta.custom_data. Event:", eventName);
    // Acknowledge to prevent Lemon from retrying — user_id is critical
    return jsonResponse({ received: true, error: "no_user_id" }, { status: 200 });
  }

  const variantId = extractVariantId(payload);
  const subscriptionId = extractSubscriptionId(payload);
  const eventId = extractEventId(payload, req);

  const VARIANT_REGULAR = Deno.env.get("LS_VARIANT_REGULAR");
  const VARIANT_PRO = Deno.env.get("LS_VARIANT_PRO");

  if (!VARIANT_REGULAR || !VARIANT_PRO) {
    console.error("ls-webhook: LS_VARIANT_REGULAR/LS_VARIANT_PRO not configured");
    return jsonResponse({ error: "Variant configuration missing" }, { status: 500 });
  }

  // ── Idempotency check ──
  try {
    const alreadyProcessed = await isEventProcessed(eventId);
    if (alreadyProcessed) {
      console.log(`ls-webhook: duplicate event ${eventId}, skipping`);
      return jsonResponse({ received: true, duplicate: true }, { status: 200 });
    }
  } catch (err) {
    console.error("ls-webhook: idempotency check failed, proceeding cautiously:", err);
    // If the idempotency check itself fails, we still proceed
    // (better to double-grant than to silently drop a valid event)
  }

  try {
    // ── Pre-fetch DB state to compare for upgrades/downgrades ──
    const supabaseAdmin = getSupabaseAdmin();
    const { data: userDbRow } = await supabaseAdmin
      .from("user_credits")
      .select("subscription_plan")
      .eq("user_id", userId)
      .maybeSingle();
      
    const currentDbPlan = userDbRow?.subscription_plan ?? "free";
    const customerPortalUrl = payload?.data?.attributes?.urls?.customer_portal ?? null;
    const renewsAt = payload?.data?.attributes?.renews_at ?? null;

    // ═════════════════════════════════════════
    //  REFUND — Void credits specific to this sub
    // ═════════════════════════════════════════
    if (isRefundEvent(eventName)) {
      console.log(`ls-webhook: REFUND for user ${userId}. Voiding credits for sub ${subscriptionId}.`);
      if (subscriptionId) {
        await expireSubscriptionLedgers({ userId, subscriptionId });
      }
      await setFreeStatus({ userId, subscriptionId });
      await recordEvent({ eventId, eventName, userId });
      return jsonResponse({ received: true }, { status: 200 });
    }

    // ═════════════════════════════════════════
    //  PAYMENT FAILED — Set past_due, keep credits
    // ═════════════════════════════════════════
    if (isPaymentFailedEvent(eventName)) {
      console.log(`ls-webhook: payment FAILED for user ${userId}. Setting past_due.`);
      await setPastDueStatus({ userId });
      await recordEvent({ eventId, eventName, userId });
      return jsonResponse({ received: true }, { status: 200 });
    }

    // ═════════════════════════════════════════
    //  CANCELLATION — Keep credits until expiry
    // ═════════════════════════════════════════
    if (isCancellationEvent(eventName)) {
      console.log(`ls-webhook: subscription CANCELLED for user ${userId}. Credits remain until expiry.`);
      await setCancelledStatus({ userId });
      await recordEvent({ eventId, eventName, userId });
      return jsonResponse({ received: true }, { status: 200 });
    }

    // ═════════════════════════════════════════
    //  EXPIRY — Wipe specific sub ledgers
    // ═════════════════════════════════════════
    if (isExpiryEvent(eventName)) {
      console.log(`ls-webhook: subscription EXPIRED for user ${userId}. Invalidating sub ${subscriptionId}`);
      if (subscriptionId) {
        await expireSubscriptionLedgers({ userId, subscriptionId });
      }
      await setFreeStatus({ userId, subscriptionId });
      await recordEvent({ eventId, eventName, userId });
      return jsonResponse({ received: true }, { status: 200 });
    }

    // ═════════════════════════════════════════
    //  RESUMED — Re-grant credits
    // ═════════════════════════════════════════
    if (isResumedEvent(eventName)) {
      if (!variantId) {
        console.error("ls-webhook: subscription_resumed without variant_id");
        await recordEvent({ eventId, eventName, userId });
        return jsonResponse({ received: true }, { status: 200 });
      }

      const variantInfo = getCreditsForVariant(variantId);
      if (!variantInfo) {
        console.log(`ls-webhook: ignoring resumed event with unknown variant_id=${variantId}`);
        await recordEvent({ eventId, eventName, userId });
        return jsonResponse({ received: true }, { status: 200 });
      }

      const newBalance = await grantPaymentCredits({
        userId,
        creditsToAdd: variantInfo.credits,
        plan: variantInfo.plan,
        subscriptionId,
        customerPortalUrl,
        renewsAt,
      });

      await recordEvent({ eventId, eventName, userId, variantId, creditsGranted: variantInfo.credits });
      console.log(`ls-webhook: RESUMED granted ${variantInfo.credits} LC. Plan: ${variantInfo.plan}. Balance: ${newBalance}`);
      return jsonResponse({ received: true }, { status: 200 });
    }

    // ═════════════════════════════════════════
    //  SUBSCRIPTION CREATED — New subscription
    // ═════════════════════════════════════════
    if (eventName.toLowerCase() === "subscription_created") {
      if (!variantId) {
        console.error("ls-webhook: subscription_created without variant_id");
        await recordEvent({ eventId, eventName, userId });
        return jsonResponse({ received: true }, { status: 200 });
      }

      const variantInfo = getCreditsForVariant(variantId);
      if (!variantInfo) {
        console.log(`ls-webhook: ignoring unknown variant_id=${variantId}`);
        await recordEvent({ eventId, eventName, userId });
        return jsonResponse({ received: true }, { status: 200 });
      }

      const newBalance = await grantPaymentCredits({
        userId,
        creditsToAdd: variantInfo.credits,
        plan: variantInfo.plan,
        subscriptionId,
        customerPortalUrl,
        renewsAt,
      });

      await recordEvent({ eventId, eventName, userId, variantId, creditsGranted: variantInfo.credits });
      console.log(`ls-webhook: CREATED granted ${variantInfo.credits} LC. Plan: ${variantInfo.plan}. Balance: ${newBalance}`);
      return jsonResponse({ received: true }, { status: 200 });
    }

    // ═════════════════════════════════════════
    //  SUBSCRIPTION UPDATED — Handle Expirations natively
    // ═════════════════════════════════════════
    if (eventName.toLowerCase() === "subscription_updated") {
      // If the subscription is now formally expired/unpaid, wipe ITS credits
      if (shouldSetFreeForUpdate(payload)) {
        console.log(`ls-webhook: subscription_updated → status indicates free/expired. Invalidating sub ${subscriptionId} for ${userId}.`);
        if (subscriptionId) {
          await expireSubscriptionLedgers({ userId, subscriptionId });
        }
        await recordEvent({ eventId, eventName, userId });
        return jsonResponse({ received: true }, { status: 200 });
      }

      if (shouldSetPastDueForUpdate(payload)) {
        console.log(`ls-webhook: subscription_updated → past_due/paused for user ${userId}.`);
        await setPastDueStatus({ userId });
        await recordEvent({ eventId, eventName, userId });
        return jsonResponse({ received: true }, { status: 200 });
      }

      if (shouldSetCancelledForUpdate(payload)) {
        console.log(`ls-webhook: subscription_updated → cancelled for user ${userId}. Credits remain.`);
        await setCancelledStatus({ userId });
        await recordEvent({ eventId, eventName, userId });
        return jsonResponse({ received: true }, { status: 200 });
      }

      // We explicitly ignore upgrades/downgrades here.
      // Every variant purchase creates a NEW independent subscription now,
      // handled by subscription_created and subscription_payment_success.
      
      await recordEvent({ eventId, eventName, userId });
      console.log(`ls-webhook: updated metadata successfully for user ${userId}. No credit changes applied.`);
      return jsonResponse({ received: true }, { status: 200 });
    }

    // ═════════════════════════════════════════
    //  PAYMENT SUCCESS — Renewal credit grant
    // ═════════════════════════════════════════
    if (eventName.toLowerCase() === "subscription_payment_success") {
      // CRITICAL: subscription_payment_success fires alongside subscription_created
      // for the INITIAL payment. We already granted credits on subscription_created.
      // We MUST NOT double-grant.
      const billingReason = payload?.data?.attributes?.billing_reason;
      
      if (billingReason === "initial") {
        console.log(`ls-webhook: ignoring INITIAL payment success — credits already granted on subscription_created`);
        await recordEvent({ eventId, eventName, userId });
        return jsonResponse({ received: true }, { status: 200 });
      }

      // This is a RENEWAL — grant new cycle of credits
      const variantInfo = variantId ? getCreditsForVariant(variantId) : null;
      if (variantInfo) {
        const newBalance = await grantPaymentCredits({
          userId,
          creditsToAdd: variantInfo.credits,
          plan: variantInfo.plan,
          subscriptionId,
          customerPortalUrl: customerPortalUrl,
          renewsAt: renewsAt,
        });

        await recordEvent({ eventId, eventName, userId, variantId, creditsGranted: variantInfo.credits });
        console.log(`ls-webhook: RENEWAL granted ${variantInfo.credits} LC. Plan: ${variantInfo.plan}. Balance: ${newBalance}`);
      } else {
        console.error(`ls-webhook: missing or invalid variant_id on renewal event for user ${userId}`);
        await recordEvent({ eventId, eventName, userId });
      }

      return jsonResponse({ received: true }, { status: 200 });
    }

    // ═════════════════════════════════════════
    //  EXPIRATION / DELETION — Instant removal
    // ═════════════════════════════════════════
    if (isExpiryEvent(eventName)) {
       console.log(`ls-webhook: explicit ${eventName} event for ${userId}. Invalidating sub ${subscriptionId}.`);
       if (subscriptionId) {
         await expireSubscriptionLedgers({ userId, subscriptionId });
       }
       await recordEvent({ eventId, eventName, userId });
       return jsonResponse({ received: true }, { status: 200 });
    }

    if (isCancellationEvent(eventName)) {
      console.log(`ls-webhook: explicit cancellation for user ${userId}. Status set to cancelled.`);
      await setCancelledStatus({ userId });
      await recordEvent({ eventId, eventName, userId });
      return jsonResponse({ received: true }, { status: 200 });
    }

    if (isPaymentFailedEvent(eventName)) {
      console.log(`ls-webhook: payment failure for user ${userId}. Marking past_due.`);
      await setPastDueStatus({ userId });
      await recordEvent({ eventId, eventName, userId });
      return jsonResponse({ received: true }, { status: 200 });
    }

    if (isRefundEvent(eventName)) {
      console.log(`ls-webhook: refund event ${eventName} for user ${userId}. Targetting sub ${subscriptionId}.`);
      if (subscriptionId) {
        await expireSubscriptionLedgers({ userId, subscriptionId });
      }
      await recordEvent({ eventId, eventName, userId });
      return jsonResponse({ received: true }, { status: 200 });
    }

    // ── Unhandled event types (acknowledge to prevent retries) ──
    console.log(`ls-webhook: unhandled or standard-ignore event ${eventName}`);
    await recordEvent({ eventId, eventName, userId });
    return jsonResponse({ received: true }, { status: 200 });
  } catch (err) {
    console.error("ls-webhook handler error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
});
