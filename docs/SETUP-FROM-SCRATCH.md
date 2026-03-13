# Lucen — Setup From Scratch

This guide assumes you are starting with empty Supabase, GitHub, and Vercel. Follow the steps **in order**.

---

## Prerequisites

- GitHub account
- [Supabase](https://supabase.com) account
- [Vercel](https://vercel.com) account
- [OpenRouter](https://openrouter.ai) API key
- Node.js 20+ (for local dev)

---

## Phase 1: Supabase

### 1.1 Create Project

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. **New Project**
3. Name: `lucen`
4. Set and **save** the database password
5. Region: pick closest to your users
6. Create project (wait ~2 min)

### 1.2 Auth URL Configuration (CRITICAL)

1. In your project: **Authentication → URL Configuration**
2. **Site URL:** `https://www.lucen.space`
3. **Redirect URLs:** add:
   - `https://www.lucen.space/**`
   - `https://lucen.space/**`
   - `http://localhost:5173/**` (for local dev)
4. Save

### 1.3 Get API Keys

1. **Settings → API**
2. Copy:
   - **Project URL** (e.g. `https://xxxxxxxx.supabase.co`)
   - **anon public** key (starts with `eyJ...`)

### 1.4 Deploy Database and Edge Functions (Local)

From your project root:

```powershell
# 1. Login (opens browser)
npx supabase login

# 2. Link project (use Project Ref from URL: supabase.com/dashboard/project/XXXXX)
npx supabase link --project-ref YOUR_PROJECT_REF

# 3. Push migrations
npx supabase db push

# 4. Set secrets (replace values)
npx supabase secrets set OPENROUTER_API_KEY=sk-or-v1-your-key
# Use comma-separated list if you have multiple domains:
npx supabase secrets set VITE_APP_URL="https://www.lucen.space,https://lucen.space"

# 5. Deploy Edge Functions
npx supabase functions deploy chat-proxy --no-verify-jwt
npx supabase functions deploy deduct-credits --no-verify-jwt
npx supabase functions deploy create-checkout --no-verify-jwt
npx supabase functions deploy stripe-webhook --no-verify-jwt
```

### 1.5 Optional: Stripe

If using Stripe:

1. Create Product + Price in [Stripe Dashboard](https://dashboard.stripe.com)
2. Copy Price ID (e.g. `price_1Nxy...`)
3. Create Webhook: URL `https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.deleted`, `customer.subscription.past_due`
4. Copy webhook signing secret (`whsec_...`)
5. Set secrets:
   ```
   npx supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx
   npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx
   ```

---

## Phase 2: Vercel

### 2.1 Import Project

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repo
3. Framework: **Vite** (auto-detected)
4. Root directory: leave default

### 2.2 Environment Variables

Add these **before** first deploy:

| Name | Value |
|------|-------|
| `VITE_SUPABASE_URL` | Your Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `VITE_APP_NAME` | `Lucen` |
| `VITE_OPENROUTER_MODEL` | `deepseek/deepseek-v3.2` |

Do **NOT** add `VITE_OPENROUTER_API_KEY` in Vercel (keeps API key server-side).

If using Stripe, add:

| Name | Value |
|------|-------|
| `VITE_STRIPE_PRO_PRICE_ID` | Your Stripe Price ID |

### 2.3 Deploy

Click Deploy. Note your URL (e.g. `https://lucen.vercel.app` or custom `https://www.lucen.space`).

---

## Phase 3: GitHub Actions (Optional)

To auto-deploy Supabase on push to `main`:

1. Repo → **Settings → Secrets and variables → Actions**
2. Add:
   - `SUPABASE_PROJECT_ID` = project ref from URL (e.g. `abcdefghij`)
   - `SUPABASE_DB_PASSWORD` = database password
   - `SUPABASE_ACCESS_TOKEN` = from [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)
   - `OPENROUTER_API_KEY` = your OpenRouter key
   - `VITE_APP_URL` = `https://www.lucen.space`
   - (If Stripe) `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

3. Push to `main` — workflow runs automatically.

---

## Phase 4: Final Checks

### 4.1 Supabase Auth URLs

Ensure **Site URL** and **Redirect URLs** match your live domain. If you use `www.lucen.space`, both `www` and non-www should be in Redirect URLs if users can land on either.

### 4.2 Vercel → Supabase Alignment

- `VITE_SUPABASE_URL` in Vercel **must** match the Supabase project that hosts your Edge Functions.
- If you recreate Supabase, update Vercel env vars and redeploy.

### 4.3 New Session After Project Change

If you changed Supabase projects: **Sign out** on the app, clear site data or use incognito, then **sign in again**. Old JWTs from a previous project will return 401.

### 4.4 Debug 401 on chat-proxy

1. Open DevTools → Network
2. Send a message
3. Click the `chat-proxy` request → Headers
4. Check **Request Headers**: is `Authorization: Bearer ...` present?
5. If not: session is missing — sign in again.
6. If yes: JWT may be for wrong project or expired. Sign out, sign in, retry.

---

## One-Push Flow

After setup:

1. Push to `main` on GitHub
2. Vercel auto-deploys the frontend
3. GitHub Actions auto-deploys Supabase (migrations + Edge Functions)

---

## Quick Reference: All Env Vars

| Where | Variable | Purpose |
|-------|----------|---------|
| **Vercel** | `VITE_SUPABASE_URL` | Supabase project URL |
| **Vercel** | `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| **Vercel** | `VITE_APP_NAME` | App title |
| **Vercel** | `VITE_OPENROUTER_MODEL` | Default LLM model |
| **Vercel** | `VITE_STRIPE_PRO_PRICE_ID` | Stripe Price ID (optional) |
| **Supabase Secrets** | `OPENROUTER_API_KEY` | OpenRouter API key |
| **Supabase Secrets** | `VITE_APP_URL` | Production URL (for CORS) |
| **Supabase Secrets** | `STRIPE_SECRET_KEY` | Stripe secret (optional) |
| **Supabase Secrets** | `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret (optional) |
