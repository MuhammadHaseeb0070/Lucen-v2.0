# ============================================
# Lemon Squeezy: TEST ↔ LIVE Mode Transition
# ============================================
#
# This file documents exactly which values change
# between Test and Live mode. Keep it as a reference.
#
# HOW IT WORKS:
# - Lemon Squeezy Test Mode creates SEPARATE products,
#   variants, and webhooks from Live Mode.
# - When you go live, you must recreate products/variants
#   in Live Mode and create a new webhook.
# - The ONLY things that change are:
#   1. Variant IDs (different in test vs live)
#   2. Webhook Signing Secret (different webhook = different secret)
#   3. LEMON_SQUEEZY_TEST_MODE flag (true → false)
#
# WHAT STAYS THE SAME:
# - API Key (same key works in both modes)
# - Store ID (same store)
# - Webhook URL (same Supabase function)
# - All your app code (zero code changes needed)
#
# ============================================

# ── STEP 1: In Lemon Squeezy Dashboard ──────
# 1. Turn OFF "Test Mode" (bottom-left toggle)
# 2. Create product "Lucen Subscription" with variants:
#    - Regular: $10/month
#    - Pro: $20/month
# 3. Note the NEW variant IDs
# 4. Settings → Webhooks → Create NEW webhook:
#    - URL: same as test (https://<project>.supabase.co/functions/v1/ls-webhook)
#    - New signing secret (generate fresh one)
#    - Select ALL 9 events

# ── STEP 2: Update Supabase Edge Function Secrets ──
# (Dashboard → Edge Functions → Manage Secrets)
#
# CHANGE these 3:
#   LS_VARIANT_REGULAR         = <NEW live variant ID>
#   LS_VARIANT_PRO             = <NEW live variant ID>
#   LEMON_SQUEEZY_WEBHOOK_SECRET = <NEW live signing secret>
#
# CHANGE this 1:
#   LEMON_SQUEEZY_TEST_MODE    = false
#
# KEEP these unchanged:
#   LEMON_SQUEEZY_API_KEY      = (same)
#   LEMON_SQUEEZY_STORE_ID     = (same)
#   CREDITS_REGULAR            = 4000
#   CREDITS_PRO                = 10000

# ── STEP 3: Update Vercel Environment Variables ──
# CHANGE these 2:
#   VITE_LS_VARIANT_REGULAR    = <NEW live variant ID>
#   VITE_LS_VARIANT_PRO        = <NEW live variant ID>
#
# Then redeploy on Vercel (or push a commit)

# ── STEP 4: Update local .env (if developing locally) ──
# VITE_LS_VARIANT_REGULAR=<live variant ID>
# VITE_LS_VARIANT_PRO=<live variant ID>

# ── TOTAL CHANGES: 4 Supabase secrets + 2 Vercel vars = DONE ──
