// ============================================
// Supabase Edge Function: ls-checkout
// ============================================
// Creates a Lemon Squeezy Checkout and returns its URL.
// Requirements (Supabase secrets):
//   - SUPABASE_URL
//   - SUPABASE_ANON_KEY
//   - LEMON_SQUEEZY_API_KEY
//   - LEMON_SQUEEZY_STORE_ID   (numeric store id from Lemon dashboard → Settings)
// Optional:
//   - VITE_APP_URL (for default redirect URL after purchase)
//
// Request (JSON):
//   { "variantId": string | number, "userId"?: string, "redirectUrl"?: string }
//
// Notes:
// - We validate the authenticated user from the bearer token and always use that
//   user id for checkout custom data, regardless of any userId passed in.
// - We pass user id at: checkout_data.custom.user_id (CRITICAL)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

type Json = Record<string, unknown>;

function jsonResponse(body: Json, init: ResponseInit = {}, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {}),
      ...extraHeaders,
    },
  });
}

function asStringId(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

async function createLemonCheckout(params: {
  apiKey: string;
  storeId: string;
  variantId: string;
  userId: string;
  redirectUrl?: string;
}): Promise<{ url: string }> {
  // https://docs.lemonsqueezy.com/api/checkouts/create-checkout — store + variant are relationships, not attributes.variant_id.
  const attributes: Record<string, unknown> = {
    checkout_data: {
      custom: {
        user_id: params.userId,
      },
    },
  };
  if (params.redirectUrl) {
    attributes.product_options = { redirect_url: params.redirectUrl };
  }

  const payload = {
    data: {
      type: "checkouts",
      attributes,
      relationships: {
        store: {
          data: { type: "stores", id: String(params.storeId) },
        },
        variant: {
          data: { type: "variants", id: String(params.variantId) },
        },
      },
    },
  };

  const res = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
    method: "POST",
    headers: {
      "Accept": "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      "Authorization": `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Lemon Squeezy API Error ${res.status}: ${text}`);
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON returned by Lemon Squeezy");
  }

  const url = json?.data?.attributes?.url;
  if (typeof url !== "string" || !url) {
    throw new Error("Lemon Squeezy response missing checkout URL");
  }
  return { url };
}

serve(async (req: Request) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405, headers: cors });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, { status: 401, headers: cors });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const lemonApiKey = Deno.env.get("LEMON_SQUEEZY_API_KEY");
    const lemonStoreId = Deno.env.get("LEMON_SQUEEZY_STORE_ID");
    if (!lemonApiKey) {
      return jsonResponse({ error: "LEMON_SQUEEZY_API_KEY not configured on server" }, { status: 500, headers: cors });
    }
    if (!lemonStoreId?.trim()) {
      return jsonResponse({ error: "LEMON_SQUEEZY_STORE_ID not configured on server" }, { status: 500, headers: cors });
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: "Invalid or expired token" }, { status: 401, headers: cors });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const variantId = asStringId(body.variantId);
    if (!variantId) {
      return jsonResponse({ error: "Missing variantId" }, { status: 400, headers: cors });
    }

    const redirectUrl =
      typeof body.redirectUrl === "string" && body.redirectUrl.trim()
        ? body.redirectUrl.trim()
        : (Deno.env.get("VITE_APP_URL") ? `${Deno.env.get("VITE_APP_URL")}` : undefined);

    const checkout = await createLemonCheckout({
      apiKey: lemonApiKey,
      storeId: lemonStoreId.trim(),
      variantId,
      userId: user.id,
      redirectUrl,
    });

    return jsonResponse({ url: checkout.url }, { status: 200, headers: cors });
  } catch (err) {
    console.error("ls-checkout error:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500, headers: cors },
    );
  }
});

