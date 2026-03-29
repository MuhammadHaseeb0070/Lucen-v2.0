// ============================================
// Supabase Edge Function: ls-webhook
// ============================================
// Lemon Squeezy webhook handler with:
//   - HMAC-SHA256 signature verification
//   - Idempotency (webhook_events table prevents duplicate processing)
//   - Upgrade/downgrade handling
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
  // Try webhook delivery ID from headers first
  const deliveryId = getHeader(req, "X-Delivery-Id") ?? getHeader(req, "x-delivery-id");
  if (deliveryId) return deliveryId;
  // Fallback: combine event name + subscription id + timestamp
  const eventName = payload?.meta?.event_name ?? "unknown";
  const subId = payload?.data?.id ?? "none";
  const createdAt = payload?.data?.attributes?.created_at ?? Date.now();
  return `${eventName}-${subId}-${createdAt}`;
}

function isCancellationEvent(eventName: string): boolean {
  const n = eventName.toLowerCase();
  return n === "subscription_cancelled" || n === "subscription_deleted" || n === "subscription_expired";
}

function shouldSetFreeForUpdate(payload: any): boolean {
  const status = payload?.data?.attributes?.status;
  if (typeof status !== "string") return false;
  const s = status.toLowerCase();
  return s === "cancelled" || s === "expired" || s === "unpaid" || s === "past_due" || s === "paused";
}

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

async function updateSubscriptionStatus(params: {
  userId: string;
  variantId: string;
  subscriptionId?: string | null;
  plan: string;
  customerPortalUrl?: string | null;
  renewsAt?: string | null;
}) {
  const supabaseAdmin = getSupabaseAdmin();

  // Atomic RPC: updates ONLY metadata, NEVER touches remaining_credits.
  // Safe for concurrent execution with grantPaymentCredits.
  const { error } = await supabaseAdmin.rpc("update_subscription_meta", {
    p_user_id: params.userId,
    p_plan: params.plan,
    p_subscription_id: params.subscriptionId ?? null,
    p_customer_portal_url: params.customerPortalUrl ?? null,
    p_renews_at: params.renewsAt ?? null,
  });

  if (error) {
    throw new Error(`Failed to update subscription status: ${error.message}`);
  }
}

async function grantPaymentCredits(params: {
  userId: string;
  creditsToAdd: number;
  plan?: string | null;
  subscriptionId?: string | null;
  customerPortalUrl?: string | null;
  renewsAt?: string | null;
}) {
  const supabaseAdmin = getSupabaseAdmin();

  // Atomic RPC: ensures row exists → increments credits in a SINGLE UPDATE.
  // Also sets subscription metadata so this handler alone is self-sufficient
  // (no dependency on subscription_created arriving first).
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

async function setFreeStatus(params: { userId: string; subscriptionId?: string | null }) {
  const supabaseAdmin = getSupabaseAdmin();

  const { error } = await supabaseAdmin
    .from("user_credits")
    .update({
      subscription_status: "free",
      subscription_plan: "free",
      lemon_squeezy_subscription_id: params.subscriptionId ?? null,
      lemon_squeezy_customer_portal_url: null,
      subscription_renews_at: null
    })
    .eq("user_id", params.userId);

  if (error) {
    throw new Error(`Failed to set free status: ${error.message}`);
  }
}

serve(async (req: Request) => {
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
    // ── Cancellation events ──
    if (isCancellationEvent(eventName) || (eventName.toLowerCase() === "subscription_updated" && shouldSetFreeForUpdate(payload))) {
      await setFreeStatus({ userId, subscriptionId });
      await recordEvent({ eventId, eventName, userId });
      return jsonResponse({ received: true }, { status: 200 });
    }

    // ── Subscription created or updated (metadata only, no credits) ──
    if (eventName.toLowerCase() === "subscription_created" || eventName.toLowerCase() === "subscription_updated") {
      if (!variantId) {
        console.error("ls-webhook: missing variant_id in subscription payload");
        return jsonResponse({ received: true }, { status: 200 });
      }

      const variantInfo = getCreditsForVariant(variantId);
      if (!variantInfo) {
        console.log(`ls-webhook: ignoring unknown variant_id=${variantId}`);
        return jsonResponse({ received: true }, { status: 200 });
      }

      const customerPortalUrl = payload?.data?.attributes?.urls?.customer_portal;
      const renewsAt = payload?.data?.attributes?.renews_at;

      await updateSubscriptionStatus({
        userId,
        variantId,
        subscriptionId,
        plan: variantInfo.plan,
        customerPortalUrl,
        renewsAt
      });

      await recordEvent({
        eventId,
        eventName,
        userId,
        variantId,
        creditsGranted: 0,
      });

      console.log(`ls-webhook: updated subscription metadata for user ${userId}. No credits granted (waiting for payment_success).`);
      return jsonResponse({ received: true }, { status: 200 });
    }

    // ── Payment events (subscription_payment_success) ──
    // We rely solely on subscription_payment_success to avoid requiring users to enable non-standard webhooks.
    // However, there is a race condition: subscription_payment_success fires simultaneously with subscription_created/updated.
    // To solve this, we introduce a deliberate delay so the metadata webhook finishes updating the database first.
    const isPaymentSuccess = eventName.toLowerCase() === "subscription_payment_success";

    if (isPaymentSuccess) {
      // ── Determine the correct variant/plan ──
      // For upgrades via the customer portal, Lemon Squeezy's custom_data
      // contains the STALE initial variant_id. We resolve the correct plan by:
      //   1. Checking the payload's variant_id first (reliable for new subscriptions)
      //   2. Polling the DB for the plan set by subscription_updated (reliable for upgrades)
      //   3. Taking the HIGHER-credit plan if payload and DB disagree (safe: always grant
      //      the upgrade amount, never the old amount)

      let finalVariantId = variantId;
      const supabaseAdmin = getSupabaseAdmin();
      let dbPlan: string | null = null;

      // Determine what the payload thinks the plan is
      const payloadVariantInfo = variantId ? getCreditsForVariant(variantId) : null;

      // Poll DB briefly to let subscription_updated finish if it's in-flight.
      // Key fix: do NOT break early on the OLD plan — wait for a plan that
      // is DIFFERENT from the payload's plan (indicates an upgrade was processed).
      for (let i = 0; i < 8; i++) {
        const { data: userRow } = await supabaseAdmin
          .from("user_credits")
          .select("subscription_plan")
          .eq("user_id", userId)
          .maybeSingle();

        dbPlan = userRow?.subscription_plan ?? null;

        // If DB has a paid plan that is HIGHER than what the payload says,
        // the upgrade has been processed. Use the DB plan.
        if (dbPlan === "pro") {
          // Pro is always the highest — trust it immediately.
          break;
        }
        if (dbPlan === "regular" && (!payloadVariantInfo || payloadVariantInfo.plan === "regular")) {
          // DB says regular and payload agrees (or has no opinion) — good enough.
          break;
        }
        // Otherwise keep polling (DB might still be on "free" or old plan).
        await new Promise((r) => setTimeout(r, 300));
      }

      // Resolve final variant: prefer the plan with MORE credits (safe for upgrades).
      const dbVariantInfo = dbPlan === "regular" || dbPlan === "pro"
        ? getCreditsForVariant(
            dbPlan === "pro"
              ? (VARIANT_PRO ?? "")
              : (VARIANT_REGULAR ?? ""),
          )
        : null;

      // Pick whichever gives more credits (handles upgrade race safely).
      if (dbVariantInfo && payloadVariantInfo) {
        finalVariantId = dbVariantInfo.credits >= payloadVariantInfo.credits
          ? (dbPlan === "pro" ? VARIANT_PRO! : VARIANT_REGULAR!)
          : variantId!;
      } else if (dbVariantInfo) {
        finalVariantId = dbPlan === "pro" ? VARIANT_PRO! : VARIANT_REGULAR!;
      }
      // else: keep finalVariantId = variantId (from payload)

      if (!finalVariantId) {
        console.error(`ls-webhook: ${eventName} — no variant_id from payload or DB. userId=${userId}`);
        await recordEvent({ eventId, eventName, userId });
        return jsonResponse({ received: true }, { status: 200 });
      }

      const variantInfo = getCreditsForVariant(finalVariantId);
      if (variantInfo) {
        // Extract metadata from the payment payload to pass to the atomic RPC.
        const portalUrl = payload?.data?.attributes?.urls?.customer_portal ?? null;
        const renewsAtVal = payload?.data?.attributes?.renews_at ?? null;

        const newBalance = await grantPaymentCredits({
          userId,
          creditsToAdd: variantInfo.credits,
          plan: variantInfo.plan,
          subscriptionId,
          customerPortalUrl: portalUrl,
          renewsAt: renewsAtVal,
        });
        await recordEvent({
          eventId,
          eventName,
          userId,
          variantId: finalVariantId,
          creditsGranted: variantInfo.credits,
        });
        console.log(
          `ls-webhook: ${eventName} granted ${variantInfo.credits} credits to user ${userId}. ` +
          `New balance: ${newBalance}. Plan: ${variantInfo.plan}.`,
        );
      }
      return jsonResponse({ received: true }, { status: 200 });
    }

    console.log(`ls-webhook: unhandled event ${eventName}`);
    await recordEvent({ eventId, eventName, userId });
    return jsonResponse({ received: true }, { status: 200 });
  } catch (err) {
    console.error("ls-webhook handler error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
});
