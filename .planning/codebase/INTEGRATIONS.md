# External Integrations

**Last updated:** 2026-06-08

## Backend Services

### Supabase
- **Role:** Primary backend platform. Provides database (Postgres), authentication, Edge Functions (Deno), storage, and real-time subscriptions.
- **SDK/Client:** `@supabase/supabase-js` ^2.98.0 (frontend), `https://esm.sh/@supabase/supabase-js@2` (Edge Functions)
- **Database:** Postgres 17 via `supabase/config.toml`. Schema defined across 30+ migration files in `supabase/migrations/`.
- **Tables:** `conversations`, `messages`, `user_settings`, `artifacts`, `artifact_votes`, `artifact_comments`, `file_attachments`, `usage_logs`, `subscriptions`, `credit_ledgers`, `webhook_events`, `credits`
- **Storage Buckets:** `attachments` bucket for file uploads (public URLs generated via `supabase.storage.from('attachments').getPublicUrl()`)
- **Edge Functions:** 12 deployed functions (see full list below)
- **Configuration:** `supabase/config.toml`, `supabase/.env.dev`, `supabase/.env.prod`
- **Auth:** Email/password authentication via `supabase.auth` API. JWT session management with automatic refresh.
- **Env Vars (frontend):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- **Env Vars (server):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`

### Supabase Edge Functions
| Function | File | Purpose |
|----------|------|---------|
| `chat-proxy` | `supabase/functions/chat-proxy/index.ts` | Proxies streaming chat to OpenRouter. Handles vision, web search tools, credit deduction, usage logging. Core LLM gateway. |
| `ls-checkout` | `supabase/functions/ls-checkout/index.ts` | Creates Lemon Squeezy checkout sessions. Validates variant IDs against env config. |
| `ls-webhook` | `supabase/functions/ls-webhook/index.ts` | Handles Lemon Squeezy subscription lifecycle webhooks (created, updated, cancelled, expired, resumed, payment success/failure/refund). HMAC-SHA256 verified. |
| `deduct-credits` | `supabase/functions/deduct-credits/index.ts` | Server-authoritative credit deduction and balance queries. Atomic operations. |
| `embed` | `supabase/functions/embed/index.ts` | Generates embeddings via OpenRouter for RAG (Retrieval-Augmented Generation). Chunks text before embedding. |
| `retrieve-chunks` | `supabase/functions/retrieve-chunks/index.ts` | Retrieves relevant chunks for RAG by embedding query and searching vector store. |
| `describe-image` | `supabase/functions/describe-image/index.ts` | Silent vision helper that uses OpenRouter to describe images, injects first-person descriptions into assistant context. |
| `web-search` | `supabase/functions/web-search/index.ts` | Executes web searches via Tavily API. Classifies search intent, returns results. |
| `classify-intent` | `supabase/functions/classify-intent/index.ts` | Classifies user intent for web search (search/skip/clarify) via OpenRouter. |
| `generate-title` | `supabase/functions/generate-title/index.ts` | Generates conversation titles and segment summaries via OpenRouter. |
| `get-file-content` | `supabase/functions/get-file-content/index.ts` | Retrieves file content from Supabase Storage for RAG processing. |
| `get-model-config` | `supabase/functions/get-model-config/index.ts` | Returns server-side model configuration (secrets-safe). Not in repo — fetched at runtime. |

### OpenRouter
- **Role:** Primary LLM provider gateway. All model inference goes through OpenRouter's API.
- **Endpoint:** `https://openrouter.ai/api/v1/chat/completions` (chat), `https://openrouter.ai/api/v1/embeddings` (embeddings)
- **SDK:** Direct HTTP fetch (no SDK). API key stored server-side only in Supabase Edge Function secrets.
- **Key (server):** `OPENROUTER_API_KEY`
- **Models configured:**
  - Main chat: `minimax/minimax-m2.7:nitro` (default, env-configurable via `VITE_MAIN_CHAT_MODEL`)
  - Side chat: `openai/gpt-4o-mini` (default, env-configurable via `VITE_SIDE_CHAT_MODEL`)
  - Vision helper: `openai/gpt-4o-mini` (env-configurable via `VISION_HELPER_MODEL`)
  - Intent classification: `openai/gpt-4o-mini` (env-configurable via `WEB_INTENT_MODEL`)
  - Title generation: uses `openai/gpt-4o-mini` (via side chat model)
  - Embeddings: `google/gemini-embedding-001` (env-configurable via `EMBEDDING_MODEL`)
  - Online/web search model: `openai/gpt-4o-mini` (env-configurable via `OPENROUTER_ONLINE_MODEL`)
- **Auth:** Server-side only. Frontend never sees the API key. All calls go through Supabase Edge Function proxy (`chat-proxy`).

### Tavily
- **Role:** Web search engine for real-time information retrieval.
- **Endpoint:** `https://api.tavily.com/search`
- **Key (server):** `TAVILY_API_KEY`
- **Usage:** Called from `web-search` and `classify-intent` Edge Functions. Cost: $4 per 1,000 searches.
- **Integration pattern:** Classify intent via OpenRouter -> Execute search via Tavily -> Return results to chat-proxy.

### Lemon Squeezy
- **Role:** Payment processor and subscription management. Sole payment provider.
- **SDK:** Direct HTTP fetch to Lemon Squeezy REST API (`https://api.lemonsqueezy.com/v1/`)
- **Endpoints consumed:** Checkout creation, webhook handling
- **Keys (server):** `LEMON_SQUEEZY_API_KEY`, `LEMON_SQUEEZY_STORE_ID`, `LEMON_SQUEEZY_WEBHOOK_SECRET`
- **Plan variant IDs:** `LS_VARIANT_REGULAR`, `LS_VARIANT_PRO` (loaded from env, mapped to Lemon Squeezy product variants)
- **Checkout flow:** Client calls `ls-checkout` Edge Function -> creates Lemon Squeezy Checkout session -> redirects user -> Lemon Squeezy sends webhook to `ls-webhook` -> updates subscription + grants credits
- **Variant IDs (dev):** Regular=1454819, Pro=1454813 (from `supabase/.env.dev`)
- **Portal:** Customer portal managed by Lemon Squeezy, accessible via `lemon_squeezy_customer_portal_url` from server.
- **Webhook security:** HMAC-SHA256 signature verification. Idempotency via `webhook_events` table.

### Sentry
- **Role:** Error monitoring and performance tracking.
- **SDK:** `@sentry/react` ^10.56.0
- **Config:** `VITE_SENTRY_DSN` env var (optional — Sentry only initializes if DSN is present)
- **Integrations:** `browserTracingIntegration`, `replayIntegration` (error-only replays)
- **Traces sample rate:** 0.1 (10%)
- **Error replays:** 100% on error
- **Security:** Auth tokens stripped from error reports via `beforeSend` hook

## Databases

**Supabase Postgres 17** — sole database. Used for:
- User data: conversations, messages, attachments
- Subscription management: subscriptions, credit_ledgers, credits
- Billing: usage_logs (with full accounting columns)
- Artifact hub: artifacts, artifact_votes, artifact_comments (with versioning via `artifact_versions` lineage)
- User preferences: user_settings
- Search: Full-Text Search via `search_chat_history` RPC function
- Vector search: RAG via embeddings (pgvector, configured in migrations)

**File/Blob Storage:** Supabase Storage (`attachments` bucket)

**Caching:** None detected (no Redis, Memcached, or CDN caching)

## Authentication

**Provider:** Supabase Auth (email/password)

**Flow:**
- Sign up / sign in via `supabase.auth.signUp()` / `supabase.auth.signInWithPassword()`
- Session managed via JWT tokens with automatic refresh (`supabase.auth.refreshSession()`)
- Session cache maintained in `supabase.ts` singleton via `onAuthStateChange` listener
- Local stub user (`local-user`) available when Supabase is not configured (local-only mode)

**Edge Function Auth:**
- Frontend sends JWT access token as `Authorization: Bearer <token>` header
- Service role key used server-side for admin operations (credit deduction, webhook processing)
- `verify_jwt = false` for `chat-proxy` and `deduct-credits` (custom auth logic in function code)

## Monitoring & Observability

**Error Tracking:** Sentry (conditional on `VITE_SENTRY_DSN`)
**Logging:** Custom `logger` utility in `src/lib/logger.ts` with configurable levels (debug/info/warn/error/none). Level driven by `VITE_LOG_LEVEL` env var.
**Usage Tracking:** `usage_logs` table in Supabase, populated by all Edge Functions via shared `recordUsage()` helper. Tracks tokens, costs, status, and call metadata.

## Deployment & Hosting

**Frontend Hosting:** Vercel (presumed from `vercel.env.example`)
**Backend Hosting:** Supabase Platform (Edge Functions + Database + Auth + Storage)
**CI Pipeline:** Not detected in repo

## AI/Tooling Integrations

**Tokenizer:** `js-tiktoken` (cl100k_base encoding) in Web Worker for accurate token counting
**Syntax Highlighting:** `shiki` in Web Worker for code highlighting
**PDF Processing:** `pdfjs-dist` (client-side PDF text extraction)
**Document Processing:** `mammoth` (DOCX), `xlsx` (Excel), `jszip` (Zip archives)
**Diagram Rendering:** `mermaid` (diagrams), `react-syntax-highlighter` (code blocks)
**Math Rendering:** `remark-math` + `rehype-katex` (primary) + `rehype-mathjax` (fallback) + `better-react-mathjax` (interactive)

## Webhooks & Callbacks

**Incoming:**
- `ls-webhook` Edge Function — receives Lemon Squeezy subscription lifecycle events (created, updated, cancelled, expired, resumed, payment_success, payment_failed, payment_refunded, order_refunded)
  - Signature verified via HMAC-SHA256
  - Idempotent via `webhook_events` dedup table

**Outgoing:**
- None detected

## Environment Variables

### Frontend (VITE_ prefix, set in Vercel)
| Variable | Required | Source |
|----------|----------|--------|
| `VITE_SUPABASE_URL` | Yes | Supabase project settings |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase project settings (public, anon key) |
| `VITE_APP_NAME` | No | App branding |
| `VITE_ADMIN_EMAILS` | No | Comma-separated admin emails |
| `VITE_LOG_LEVEL` | No | debug / info / warn / error |
| `VITE_DEV_PAYLOAD_CAPTURE` | No | Debug payload capture flag |
| `VITE_LS_VARIANT_REGULAR` | Conditional | Lemon Squeezy variant for Regular plan |
| `VITE_LS_VARIANT_PRO` | Conditional | Lemon Squeezy variant for Pro plan |
| `VITE_MAIN_CHAT_MODEL` | Conditional | Main chat model identifier |
| `VITE_MAIN_CHAT_MODEL_NAME` | No | Display name |
| `VITE_MAIN_CHAT_CONTEXT_WINDOW` | No | Context window tokens |
| `VITE_MAIN_CHAT_MAX_OUTPUT` | No | Max output tokens |
| `VITE_MAIN_CHAT_SUPPORTS_REASONING` | No | Reasoning support flag |
| `VITE_MAIN_MODEL_SUPPORTS_VISION` | No | Vision support flag |
| `VITE_MAIN_CHAT_TOKENS_PER_SECOND` | No | Throughput estimate |
| `VITE_MAIN_CHAT_INPUT_COST_PER_1M` | No | Cost tracking |
| `VITE_MAIN_CHAT_OUTPUT_COST_PER_1M` | No | Cost tracking |
| `VITE_SIDE_CHAT_MODEL` | No | Side chat model identifier |
| `VITE_SIDE_CHAT_MODEL_NAME` | No | Display name |
| `VITE_SIDE_CHAT_TOKENS_PER_SECOND` | No | Throughput estimate |
| `VITE_OPENROUTER_MODEL` | No | Fallback model |
| `VITE_PLATFORM_MAX_STREAM_SECONDS` | No | Stream timeout |
| `VITE_CONTINUATION_MAX_CHUNKS_ARTIFACT` | No | Artifact continuation limit |
| `VITE_CONTINUATION_MAX_CHUNKS_CHAT` | No | Chat continuation limit |
| `VITE_ABSOLUTE_OUTPUT_CEILING` | No | Hard output ceiling |
| `VITE_CHAT_OUTPUT_CEILING` | No | Chat output ceiling |
| `VITE_ARTIFACT_OUTPUT_CEILING` | No | Artifact output ceiling |
| `VITE_STREAM_IDLE_TIMEOUT_MS` | No | Idle stream timeout |
| `VITE_MIDSTREAM_PERSIST_MS` | No | Mid-stream persistence interval |
| `VITE_SENTRY_DSN` | No | Sentry DSN for error tracking |

### Backend (Supabase Edge Function Secrets)
| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key |
| `SUPABASE_URL` | Yes | Auto-injected by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Admin database access |
| `SUPABASE_ANON_KEY` | Yes | Public anon key |
| `VITE_APP_URL` | Yes | CORS origin and redirect base |
| `TAVILY_API_KEY` | Conditional | Required if web search enabled |
| `LEMON_SQUEEZY_API_KEY` | Conditional | Required if billing enabled |
| `LEMON_SQUEEZY_STORE_ID` | Conditional | Required if billing enabled |
| `LEMON_SQUEEZY_WEBHOOK_SECRET` | Conditional | Required for webhook verification |
| `LEMON_SQUEEZY_TEST_MODE` | No | Test mode flag |
| `LS_VARIANT_REGULAR` | Conditional | Regular plan variant ID |
| `LS_VARIANT_PRO` | Conditional | Pro plan variant ID |
| `CREDITS_REGULAR` | No | Regular plan credit amount |
| `CREDITS_PRO` | No | Pro plan credit amount |
| `WEB_INTENT_MODEL` | No | Intent classification model |
| `VISION_HELPER_MODEL` | No | Vision helper model |
| `EMBEDDING_MODEL` | No | Embedding model |
| `ABSOLUTE_OUTPUT_CEILING` | No | Server output ceiling |

---

*Integration audit: 2026-06-08*