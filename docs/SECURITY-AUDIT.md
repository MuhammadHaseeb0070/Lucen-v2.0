# Lucen — Security Audit & Loopholes

## Summary

| Issue | Severity | Status |
|-------|----------|--------|
| Client-side API key exposure | High | Mitigated — use chat-proxy, no VITE_OPENROUTER_API_KEY in prod |
| CORS wildcard | Medium | Fixed — restricted when VITE_APP_URL set |
| Model abuse | Medium | Fixed — server allowlist in chat-proxy |
| .env.example real keys | Critical | Fixed — placeholders only |
| JWT 401 on chat-proxy | Operational | See troubleshooting below |

---

## 1. 401 Unauthorized on chat-proxy

**Cause:** The Edge Function calls `supabase.auth.getUser(token)`. If that fails, it returns 401.

**Typical causes:**
1. **Project mismatch** — `VITE_SUPABASE_URL` in Vercel points to a different Supabase project than where Edge Functions run.
2. **Stale token** — User logged in before you changed projects; JWT is for the old project.
3. **Missing/expired token** — Session not sent or expired.

**Fix:**
- Ensure Vercel `VITE_SUPABASE_URL` = same project as your Supabase dashboard
- Have user sign out and sign in again after any Supabase project change
- Check Network tab: `chat-proxy` request must include `Authorization: Bearer <jwt>`

---

## 2. Client-Side API Key

**Risk:** `VITE_OPENROUTER_API_KEY` is baked into the built JS and visible in the browser.

**Mitigation:**
- Do **not** set `VITE_OPENROUTER_API_KEY` in Vercel
- All production traffic should go through `chat-proxy` (server-side key)
- Keep `VITE_OPENROUTER_API_KEY` only in local `.env` for dev

---

## 3. CORS

**Risk:** `Access-Control-Allow-Origin: *` lets any site call your Edge Functions if they obtain a JWT.

**Mitigation:**
- Set `VITE_APP_URL` in Supabase secrets to your production URL(s)
- Supports comma-separated list: `https://www.lucen.space,https://lucen.space`
- When set, only those origins + localhost are allowed

---

## 4. Model Abuse

**Risk:** Client could send arbitrary model IDs and force expensive models.

**Mitigation:**
- `chat-proxy` uses an allowlist: `deepseek/deepseek-v3.2`, `deepseek-r1`, etc.
- Unknown model → falls back to `deepseek/deepseek-v3.2`

---

## 5. Secrets in Repo

**Risk:** `.env.example` previously had real keys.

**Mitigation:**
- `.env.example` uses placeholders only
- `.env` is gitignored — never commit real keys

---

## 6. Stripe Price ID

**Risk:** `pro_tier` is not a valid Stripe Price ID.

**Mitigation:**
- Set `VITE_STRIPE_PRO_PRICE_ID` in Vercel to your real Stripe Price ID (e.g. `price_1Nxy...`)
- Frontend uses it; create-checkout validates server-side

---

## 7. GitHub Actions Secrets

**Note:** Stripe secrets are optional. The workflow only sets them if they exist in GitHub Secrets, so you can omit them when Stripe is not configured.
