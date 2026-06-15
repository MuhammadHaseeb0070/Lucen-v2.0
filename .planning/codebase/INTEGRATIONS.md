## External Integrations & Services

**Last Updated:** 2026-06-15
**Focus Area:** Third-Party APIs, Authentication, Payments, Web Search, and Cloud Storage

---

### 1. Supabase Platform (Backend-as-a-Service)
Lucen relies heavily on Supabase for database storage, file persistence, user auth, and Deno edge functions.

#### 1.1. Supabase Auth
* **Implementation:** Orchestrated client-side in [`src/store/authStore.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/authStore.ts) and [`src/services/auth.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/auth.ts).
* **Mechanisms:** Supports Password-based registration/login, Password Resets, and One-Time Password (OTP) magic links sent via email.
* **State Syncing:** Tracks `onAuthStateChange` events. Clears user local storage and caches on cross-tab sign-outs (`SIGNED_OUT` handler) to mitigate data leakage.
* **Security & Tokens:** Exposes JWT (JSON Web Tokens) to authenticate calls. S1/S2 audits replaced custom base64 token parsing in all Edge Functions with secure `supabase.auth.getUser(token)` signature validation.

#### 1.2. Supabase Storage
* **Bucket:** `attachments` (configured in Supabase Dashboard with RLS restrictions).
* **Flow:** Files are processed client-side via [`src/services/fileProcessor.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/fileProcessor.ts). Documents (.xlsx, .docx, etc.) and images are stored under user-specific prefixes: `${user_id}/${timestamp}-${filename}`.
* **Security:** Bucket actions enforce Row-Level Security (RLS), restricting reads and writes to the owner's authenticated UUID.

#### 1.3. Supabase PostgreSQL with `pgvector`
* **Infrastructure:** Postgres 17 database instance configured in [`supabase/config.toml`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/config.toml).
* **Extensions:** Utilizes `pgvector` for storing and performing similarity searches on 768-dimension text embeddings.
* **RAG Pipeline:** 
  1. Frontend uploads files, parses text, and requests embeddings via the [`supabase/functions/embed/index.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/functions/embed/index.ts) Edge Function.
  2. Embeddings are stored in the database's vector fields.
  3. When a user submits subsequent messages, the client queries similarity matches via [`supabase/functions/retrieve-chunks/index.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/functions/retrieve-chunks/index.ts) to construct the RAG context injected into the prompt.

---

### 2. OpenRouter API (AI & Reasoning Model Integration)
* **Proxy Architecture:** To prevent exposure of API keys, the frontend never connects directly to OpenRouter. All chat, image description, and intent classification tasks are routed through the secure [`supabase/functions/chat-proxy/index.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/functions/chat-proxy/index.ts) Deno Edge Function.
* **Streaming Protocol:** Server-Sent Events (SSE) stream text chunks back to the React UI in real-time.
* **Model Configurations:** Model limits, token ceilings, context lengths, and costs are parsed from headers and configured in [`src/config/models.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/config/models.ts).
* **Advanced Pipeline features:**
  * **Continuation Loop:** Automatically sends continuation instructions if a model hits its output token limit mid-generation. Handled in [`src/services/openrouter/continuation.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/openrouter/continuation.ts).
  * **Token Budgeting:** Dynamically scales context windows using the tokenizer worker to prevent context window overflow.
  * **Reasoning Parsing:** Flushes model thinking processes immediately to separate UI bubbles before content is typed.

---

### 3. Tavily API (Real-Time Web Search)
* **Implementation:** The model can call a `web_search` tool dynamically during chats if the search checkbox is toggled.
* **Deno Function:** The backend proxies queries through the [`supabase/functions/web-search/index.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/functions/web-search/index.ts) Deno Edge Function.
* **Budget & Limits:** Restricts search invocations (max 3 searches per turn) and stores searched queries in an active `searchedQueries` Set in [`src/services/openrouter/client.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/openrouter/client.ts) to prevent duplicate runs and token waste.

---

### 4. Lemon Squeezy (Payments & Webhooks)
* **Checkout Integration:** Built in [`src/services/checkout.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/checkout.ts) to request checkout sessions for subscriptions and top-up credits.
* **Webhook Processing:** Handled by the [`supabase/functions/ls-webhook/index.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/functions/ls-webhook/index.ts) Deno function.
* **Double-Grant Guards:** Uses a unique DB ledger check and writes transaction records to `webhook_events` to ensure no webhook payload is processed twice. Prevents concurrent TOCTOU (Time-Of-Check to Time-Of-Use) bugs.
* **Ledgers:** Grants credits into a First-In-First-Out (FIFO) ledger inside the database, allowing granular consumption audits.

---

### 5. Sentry (Error Tracking & Diagnostics)
* **Frontend Scope:** Initialized in [`src/main.tsx`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/main.tsx) using `@sentry/react`.
* **Telemetry:** Catches rendering crashes and unhandled Promise rejections. Exposes custom properties (e.g., streaming correlation IDs) to help track failed API requests.
* **Error Boundaries:** Standard React Error Boundaries wrap components to catch runtime UI issues and report details to Sentry.
