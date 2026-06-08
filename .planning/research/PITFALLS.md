# Pitfalls Research

**Domain:** AI Chat SPA (React 19 + Vite + Supabase + OpenRouter + Lemon Squeezy + RAG + Artifacts)
**Researched:** 2026-06-08
**Confidence:** HIGH (verified against codebase state and official documentation)

## Critical Pitfalls

### Pitfall 1: Streaming `finishReason` Drift Causes Silent Revenue Loss

**Severity:** Catastrophic

**What goes wrong:**
Billing depends on `finishReason` to determine whether a stream completed normally (`stop`), was truncated (`length`), or errored. If `finishReason` is not assigned in every streaming code path, completed streams are billed at zero cost. The chat-proxy edge function has at least two streaming paths (lines 766, 1493 of `supabase/functions/chat-proxy/index.ts`) where `finishReason` parsing happens independently, and BUG-05 in CONCERNS.md confirms some paths never assign it. This is a silent revenue leak -- no error is logged, no Sentry breadcrumb fires.

**Why it happens:**
OpenRouter SSE chunks do not include `finish_reason` on every chunk. It only appears on the final chunk. If the SSE parser processes the final chunk through a code path that doesn't extract `finish_reason` (e.g., the tool-call round-loop path vs. the direct-content path in `processStream`), the billing logic defaults to zero cost because it sees `finishReason === null`.

**How to avoid:**
1. Normalize `finishReason` extraction to a single function called once per stream, not duplicated across paths.
2. Add a Sentry breadcrumb whenever `finishReason` is null at billing time but stream completed. This turns the silent loss into a measurable alert.
3. Add a billing assertion test: mock SSE chunks with known `finish_reason` values, verify the final billing calculation matches.

**Warning signs:**
- `usage_logs` table showing zero-cost entries for non-truncated streams
- `finishReason` being null in logs but stream completed with `[DONE]` sentinel
- Revenue-per-stream-token ratio dropping without deployment changes

**Phase to address:**
Phase 1 (Streaming refactor + billing guard). The `finishReason` null path must be fixed during the chat-proxy refactor, not after. Adding the billing assertion without fixing the root cause provides false confidence.

---

### Pitfall 2: Webhook Idempotency Race at the Database Layer

**Severity:** Catastrophic

**What goes wrong:**
Lemon Squeezy webhooks are delivered with "at least once" semantics. The current idempotency guard (`webhook_events` table INSERT with unique `event_id`, 23505 = duplicate) is correct at the application layer but has a timing hole: if two webhook deliveries arrive concurrently, both INSERTs may succeed because the unique constraint check happens inside the same transaction snapshot. The result is double-granted credits.

The previous dedup index on `credit_ledgers` (`credit_ledgers_subscription_dedup_idx` on `(user_id, subscription_id, valid_from)`) was already found to be broken because `valid_from = NOW()` produces a unique timestamp on every call -- this was fixed in `20260523000001_payment_hardening.sql` with monthly bucketing. But the monthly bucketing means a legitimate renewal in a new month + a duplicate from the old month could both grant.

**Why it happens:**
Webhook idempotency is typically implemented at the application layer (check-then-insert) without considering concurrent delivery. PostgreSQL's default READ COMMITTED isolation level does not prevent phantom reads without explicit locking. The TOCTOU race between SELECT (check) and INSERT (claim) is the classic pattern.

**How to avoid:**
1. Use PostgreSQL advisory locks or `INSERT ... ON CONFLICT DO NOTHING` (already done for `webhook_events`) but wrap the entire grant logic in a single atomic function.
2. Add a `processed_at` column check: before granting, verify no row exists with matching `event_id` AND `processed_at IS NOT NULL`.
3. Add a reconciliation cron job (weekly) that compares Lemon Squeezy's subscription API with local `credit_ledgers` and flags discrepancies.

**Warning signs:**
- Users reporting credit balances that don't add up
- `credit_ledgers` showing multiple entries for the same subscription_id in the same month
- Sentry alerts showing `grant_subscription_credits` being called multiple times for the same `event_id`

**Phase to address:**
Phase 3 (Billing hardening). The webhook handler must be made atomic before production traffic scales. The current code has some mitigations but the gap is the concurrent double-grant window.

---

### Pitfall 3: CSP-Report-Only Rollout Without Report Endpoint Causes False Confidence

**Severity:** Material (with catastrophic potential)

**What goes wrong:**
CONCERNS.md (PROD-04, SEC-02) tracks adding CSP headers. The planned CSP in PROJECT.md is `default-src 'self'; frame-src 'self'; img-src 'self' data: https:; script-src 'self'`. Several things are wrong with this:
1. `script-src 'self'` blocks ALL inline scripts, which means every `useEffect` hook in the SPA will be blocked -- the entire app breaks.
2. There is no report-uri or report-to directive, so CSP violations fail silently.
3. The artifact iframe has `allow-scripts` in its sandbox but no CSP on the srcdoc, meaning the iframe has no script restriction of its own.
4. Mixed content risk: if the app loads over HTTPS but OpenRouter or Tavily responses reference HTTP resources, those are silently blocked.

The common mistake is deploying CSP in "enforce" mode without first running "Report-Only" mode, which breaks the app in production immediately.

**Why it happens:**
CSP is complex. `script-src 'self'` seems safe but blocks the SPA's own inline scripts. Teams often add CSP headers to `vercel.json` without testing against their actual app bundle. SPAs with code splitting and lazy loading need `'strict-dynamic'` and nonces, not just `'self'`.

**How to avoid:**
1. Deploy CSP in `Content-Security-Policy-Report-Only` mode first, with a `report-to` endpoint that collects violations.
2. Use `'strict-dynamic'` with a server-generated nonce, which allows the initial script bundle and propagates trust to dynamically loaded chunks. Vite supports `__NONCE__` replacement in `index.html` for this.
3. Add `frame-src 'self'` and `frame-ancestors 'self'` to prevent clickjacking via the artifact iframe.
4. Never add CSP via `vercel.json` headers without first testing against `vite build` output.

**Warning signs:**
- Angular/React apps showing blank screens after CSP deployment (inline scripts blocked)
- Browser console warnings about CSP violations with no report endpoint configured
- CSP report endpoint returning 404 (no collector configured)

**Phase to address:**
Phase 5 (CSP rollout). Must be one of the last production-hardening phases because it requires knowing the exact script loading patterns of the final bundle. Do it after lazy-loading (PERF-04) is done, since code splitting changes the script injection pattern.

---

### Pitfall 4: Zustand Persist Middleware Leaking Sensitive Data to localStorage

**Severity:** Material

**What goes wrong:**
The app has 13 Zustand stores, 5 of which use the `persist` middleware. The `partialize` configuration correctly excludes sensitive fields (chatStore strips file content and messages; sideChatStore explicitly comments "SECURITY: Never persist raw chat messages"). However:
- The `themeStore` partialize (lines 905-911) persists `customColors` which could contain user-specific theme data (not sensitive, but demonstrates the pattern).
- There is no store-wide audit that verifies every store's `partialize` excludes PII.
- The `creditsStore` partialize (line 119-123) persists the entire state except `isSynced` -- if the store shape changes in the future to include sensitive billing data, it auto-leaks.
- No `version` field is used for persisted schema migration -- a future store rename would silently lose or corrupt stored data.

**Why it happens:**
Zustand's `persist` middleware is easy to use but has no default security posture. `partialize` is opt-out (you specify what to KEEP), not opt-in (you specify what to EXCLUDE). A developer adding a new field to the store must remember to add it to the exclusion list in `partialize`. The default is to persist everything.

**How to avoid:**
1. Audit all 5 persisted stores and confirm `partialize` is opt-in (only keep what's needed, exclude everything else by default).
2. Add a `version` field to each persisted store with a `migrate` function. This prevents silent data corruption on schema changes.
3. Never store auth tokens, user emails, or credit card info in any Zustand store (even without persist). The `authStore` correctly avoids `persist` middleware for this reason, but verify no component caches auth data into a persisted store via `set()`.
4. Add a lint rule or test that asserts every persisted store has an explicit `partialize` and `version`.

**Warning signs:**
- localStorage inspection showing chat message content or user PII
- Store migration errors on version bump (missing `migrate` function)
- Large localStorage entries degrading page load performance

**Phase to address:**
Phase 2 (State management consolidation). Per TD-08 (cross-store coupling), this is the right phase to audit all store configurations, add `version`/`migrate` to persisted stores, and fix `partialize` patterns.

---

### Pitfall 5: Edge Function JWT Expiry Mid-Stream With No Recovery

**Severity:** Material (catastrophic if combined with billing)

**What goes wrong:**
The chat-proxy edge function streams SSE for potentially 30+ seconds (or longer with continuation loops). If the user's JWT expires during this stream (default Supabase JWT lifetime is 1 hour), the final credit deduction call (`deduct-credits` edge function) fails with a 401. The user's LLM output is delivered but not billed. The user has to refresh to regain functionality.

SEC-06 in CONCERNS.md tracks this but the fix is non-trivial: the edge function cannot refresh the JWT (it doesn't have the refresh token), and the frontend cannot inject a new token mid-stream (SSE is already open).

**Why it happens:**
JWT expiry is a fixed TTL (typically 1 hour with Supabase). Long-running streams that exceed this TTL are uncommon in traditional request-response APIs but common in AI streaming. OpenRouter streams can last 5+ minutes for long outputs, and continuation loops can extend this to 15+ minutes.

**How to avoid:**
1. At the edge function level, verify JWT expiry at stream START and at billing CALL time. Reject the billing call with 401 if expired, but surface a clear error to the frontend.
2. On the frontend, periodically check remaining JWT TTL. If less than 5 minutes remain, proactively refresh before starting a new stream.
3. In the chat-proxy handler, send a `token_expiring` SSE event 60 seconds before the short-deadline check. The frontend can refresh the token and send it back via a secondary channel.
4. Short-term mitigation: set the connection pool timeout on the edge function to be less than the JWT TTL, forcing natural reconnection.

**Warning signs:**
- `deduct-credits` returning 401 errors after long streams
- Users reporting "session expired" after 45+ minute sessions
- Sentry showing `getUser failure after local decode success` on billing events

**Phase to address:**
Phase 1 (chat-proxy refactor). The JWT refresh contract needs to be established while splitting the monolithic function; retrofitting it later is much harder.

---

### Pitfall 6: In-Memory Circuit Breaker State Lost on Every Cold Start

**Severity:** Material

**What goes wrong:**
The circuit breaker in `supabase/functions/_shared/circuitBreaker.ts` stores state in a module-level `Map<string, CircuitState>`. This state is per-Deno-isolate and per-cold-start. When Supabase scales out to multiple instances, each isolate independently burns through 5 failures before opening its circuit. The result: during an OpenRouter outage, the full failure budget is exhausted on every cold start, and the circuit provides minimal protection.

PERF-05 in CONCERNS.md tracks moving this to shared KV, but the staged approach matters: switching from in-memory to KV without also handling the half-open probe behavior can cause cascading failures when KV is also degraded.

**Why it happens:**
Serverless platforms (Supabase Edge Functions, Deno Deploy, Cloudflare Workers) are _stateless by design_. Developers coming from long-lived servers naturally implement circuit breakers with in-memory state without considering that each invocation may run on a different isolate.

**How to avoid:**
1. Migrate circuit breaker state to a shared KV store (Deno KV or Upstash Redis) with a TTL of 60 seconds on entries to auto-clean stale state.
2. Add a global circuit key (`openrouter-global`) in addition to per-operation keys (`openrouter-embed`, `openrouter-chat`). A single global circuit prevents all OpenRouter traffic when the whole API is degraded.
3. Implement graceful degradation UI: when circuit is open, show "AI temporarily unavailable" rather than hanging or showing cryptic errors.
4. Add a Sentry metric for circuit state transitions (closed -> open -> half-open -> closed) to monitor upstream reliability.

**Warning signs:**
- Multiple Sentry events with the same OpenRouter error pattern in quick succession
- Users reporting "AI not responding" followed by "AI working" in alternating requests
- `circuitStatus()` showing inconsistent state across requests

**Phase to address:**
Phase 3 (Production hardening: circuit breaker + rate limiting). Per PROD-03, this is already planned. Must be done before scaling beyond the current user base.

---

### Pitfall 7: CSS-Tuned Cosine Similarity Threshold for RAG Without Embedding Model Versioning

**Severity:** Material

**What goes wrong:**
The `retrieve-chunks` edge function uses cosine similarity search against `document_chunks` with a fixed threshold. If the embedding model (`google/gemini-embedding-001`) changes or gets updated, the embedding distribution shifts. A threshold tuned for version 1 may retrieve too few (or too many) chunks for version 2. Since chunks are embedded at upload time and never re-embedded, old documents have version-1 embeddings and new documents have version-2 embeddings, creating an inconsistent retrieval surface.

**Why it happens:**
Embedding models are black boxes. `google/gemini-embedding-001` may change its internal model without a version bump (Gemini API revisions are not always semver). Teams rarely track which embedding model version produced which chunk, making drift invisible until users complain about reduced answer quality.

**How to avoid:**
1. Store the embedding model name and version alongside each chunk in `document_chunks` (e.g., `embedding_model TEXT` column).
2. At retrieval time, check if the stored model matches the current production model. If not, flag for re-embedding or adjust the similarity threshold.
3. Implement a background re-embedding job that refreshes chunks whose embedding model is out of date.
4. Log the embedding model version with each RAG retrieval in `usage_logs` for drift analysis.

**Warning signs:**
- RAG answer quality degrading after an embedding model update notice from OpenRouter
- New documents being retrieved with significantly different similarity scores than old documents for the same query
- Users reporting "the AI seems to ignore my uploaded files" after a deployment

**Phase to address:**
Phase 4 (RAG polish). Adding the `embedding_model` column is a small migration; the re-embedding job is the larger effort.

---

### Pitfall 8: iframe postMessage Abuse via Crafted HTML Artifacts

**Severity:** Material

**What goes wrong:**
HTML artifacts render in an iframe with `sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"`. While `allow-same-origin` is NOT granted (making the iframe cross-origin), the `postMessage` bridge in `iframeErrorBridge.ts` accepts messages from ANY iframe source (line 205: no source origin check for when `iframeWindow` is null). A crafted artifact iframe can send `__lucen_iframe_error` tagged postMessage events, causing the parent to display fake error messages or potentially exploit the error display rendering.

The `attachErrorListener` function (line 199) accepts an optional `iframeWindow` parameter. When null (which happens when the iframe re-creates on `srcDoc` change), it listens for ALL `__lucen_iframe_error` messages from any source.

**Why it happens:**
The postMessage bridge was designed for error forwarding, which requires cross-origin communication. The security mitigation (`ENVELOPE_KEY` tagging, source window check when available) is correct but incomplete -- the "any iframe" fallback for srcDoc re-creation opens a hole.

**How to avoid:**
1. Add origin validation: verify `msg.origin` matches the expected artifact origin (which for `srcdoc` iframes is `null`). Never trust a `postMessage` from a cross-origin window without explicitly checking `msg.origin === null`.
2. Validate the payload shape before passing to `onError`. The current check (line 208: `typeof payload.message !== 'string'`) is minimal.
3. Rate-limit error forwarding: debounce to at most 1 error per 100ms to prevent flooding.
4. Consider using a rotating nonce/secret in the injected script that changes with each `srcDoc`, so old iframes cannot communicate.

**Warning signs:**
- False runtime error badges appearing on artifacts that render correctly
- Console warnings about unexpected postMessage events with `__lucen_iframe_error` envelope
- Errors whose `sourceOrigin` doesn't match any known artifact

**Phase to address:**
Phase 1 (Security hardening — postMessage validation). This is a direct security concern that should be fixed alongside SEC-01 (SVG sanitization) and the iframeErrorBridge regex fix (BUG-04).

---

### Pitfall 9: Web Worker Termination Not Handled on Route Change

**Severity:** Material

**What goes wrong:**
When the user navigates away from the chat view (to marketing pages, settings, etc.), React unmounts components that depend on Web Workers (`tokenizer.worker.ts`, `artifactParse.worker.ts`, `highlighter.worker.ts`). The workers themselves are not terminated because they are created at the module level (artifactParseWorkerClient, highlighterWorkerClient) or driven by store lifecycle (tokenStore). On rapid navigation (chat -> settings -> chat), stale worker instances accumulate, and postMessage handlers may process responses from old workers onto the current UI state.

The `tokenStore` has a `worker.terminate()` call (line 50), but `artifactParseWorkerClient` and `highlighterWorkerClient` have no termination logic visible in the codebase.

**Why it happens:**
Web Workers in SPAs are typically initialized once (singleton pattern) but not cleaned up. Developers assume the worker pool is shared and harmless. However, each worker holds WASM memory (Pyodide for Python execution, js-tiktoken for tokenizer, shiki for highlighting), which can be 10-50 MB each. Accumulated workers cause browser tab OOM.

**How to avoid:**
1. Add a `dispose()` or `terminate()` function to each worker client, called in the React component's `useEffect` cleanup.
2. For singleton workers, add a reference count: terminate only when count reaches zero.
3. Tag postMessage requests with a session ID. Workers receiving responses with a mismatched session ID discard them.
4. Use `AbortSignal` for in-flight work: when the component unmounts, abort pending requests so the worker can discard stale results.

**Warning signs:**
- Browser tab memory growing on navigation cycles (check Chrome Task Manager)
- Stale artifact results appearing after fast navigation (FAG-03 + FAG-02 combination)
- Multiple identical workers in `chrome://inspect/#workers`

**Phase to address:**
Phase 2 (State management + worker lifecycle). Must be paired with the tokenStore fix (H7 — Tokenizer Worker never terminated, already in CONCERNS.md as fixed but the pattern should be verified across all workers).

---

### Pitfall 10: Vite Source Map Exposure on Vercel Production Deploy

**Severity:** Material

**What goes wrong:**
Vite generates source maps in production builds by default (controlled by `build.sourcemap`). If these are deployed to Vercel, anyone can view the original TypeScript source code through browser DevTools. For a codebase with AI prompts, RAG chunking logic, credit deduction algorithms, and internal API contracts, this exposes proprietary logic and potential attack surface.

The current `vite.config.ts` is minimal: no `sourcemap: false` or `build.sourcemap` configuration.

**Why it happens:**
Source maps are essential for debugging in production (Sentry error stack traces need them). The common mistake is either: (a) deploying source maps to the CDN (publicly accessible), or (b) disabling them entirely (Sentry loses stack traces). The correct approach is to upload source maps to Sentry only, never to the hosting CDN.

**How to avoid:**
1. Set `build.sourcemap: 'hidden'` in `vite.config.ts` — produces `.js.map` files but doesn't add the `//# sourceMappingURL` comment, so browsers won't load them. Sentry can still ingest them.
2. Alternatively, set `build.sourcemap: true` and configure Sentry's `sourceMapUploadPlugin` to upload maps during build, then delete the `.map` files before deploy.
3. Verify in production: open Chrome DevTools -> Sources tab. If you see `.ts` files with original source, source maps are exposed.
4. Never use `build.minify: false` in production — it enables the Sentry plugin but exposes full source.

**Warning signs:**
- `.js.map` files visible in `vite build` output
- Original `.ts` source visible in production browser DevTools
- Sensitive strings (API endpoints, prompt templates) readable in the Sources panel

**Phase to address:**
Phase 5 (Vite configuration hardening). This is a configuration fix, not a code change, but it's production-security-critical. The `vite.config.ts` has no `sourcemap` setting currently (inherits Vite default: `true` for build, which includes the comment).

---

### Pitfall 11: Supabase Migration NOT NULL Column Addition on Large Tables

**Severity:** Material (increasing with data size)

**What goes wrong:**
The codebase has 36+ SQL migrations. Several add `NOT NULL DEFAULT` columns (e.g., `20260331000001_usage_logs_cost_breakdown.sql` adds `web_search_enabled BOOLEAN NOT NULL DEFAULT false`). On a table with millions of rows, this causes a full table rewrite in PostgreSQL — the column is written to every existing row, potentially causing downtime or significant migration delays.

Currently the database is small (pre-production), so this hasn't bitten the project yet. But as data accumulates, "just add a column" migrations become dangerous.

**Why it happens:**
`ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT` in PostgreSQL versions before 11 required a full table rewrite. PostgreSQL 11+ optimizes this (metadata-only for immutable defaults), but `DEFAULT false` (boolean) IS immutable and optimized. The trap is `DEFAULT now()` (STABLE, not IMMUTABLE) or `DEFAULT gen_random_uuid()` — these DO cause rewrites. The existing codebase appears to use immutable defaults, but the pattern is worth documenting.

The real danger is when adding a `NOT NULL` column WITHOUT a default to a large table: `ALTER TABLE ... ADD COLUMN col TEXT NOT NULL` — this fails immediately on tables with any rows because existing rows would have NULL.

**How to avoid:**
1. Always use `ADD COLUMN IF NOT EXISTS` with a `DEFAULT` value for new `NOT NULL` columns.
2. Verify defaults are IMMUTABLE (boolean, integer, text literals). `DEFAULT now()` uses the migration timestamp, not the row-creation timestamp — use a separate column for creation time.
3. For columns that must be NOT NULL without a logical default: add as nullable first, backfill in batches, then `ALTER COLUMN ... SET NOT NULL`.
4. Review migrations in order (forward-only, never modify existing migrations). The codebase follows this pattern.

**Warning signs:**
- Migrations taking seconds (for small tables) that will take minutes or hours later.
- `ALTER TABLE ... ADD COLUMN ... NOT NULL` without DEFAULT clause.
- `DEFAULT now()` or `DEFAULT uuid_generate_v4()` on new NOT NULL columns.

**Phase to address:**
Phase 3 (Database hardening). Review all existing migrations for patterns that will break at scale. Add migration validation to the build step.

---

### Pitfall 12: Edge Function Cold Start Amplifying Streaming Tail Latency

**Severity:** Material

**What goes wrong:**
Supabase Edge Functions (Deno) cold start in approximately 50-200ms for a simple function, but the chat-proxy function (1,668 lines with multiple imports across `_shared/*.ts`) likely takes 500ms-2s to cold start. In a streaming context, this means the first stream chunk is delayed by the cold start time, producing a visible "hang then burst" pattern for the user. For continuation loops, every continuation is a new edge function invocation, so every loop iteration experiences cold start.

Supabase Edge Functions have a configurable concurrency limit and keep-warm behavior. Cold starts are unpredictable — a function that has been idle for 5+ minutes may be evicted.

**Why it happens:**
Serverless functions are designed for short, bursty workloads, not persistent streaming sessions. AI streaming is inherently long-lived (30 seconds to 5+ minutes). The industry pattern is to use a dedicated streaming server for the AI proxy, but Lucen targets the serverless model for simplicity. The cost is cold start latency.

**How to avoid:**
1. Set up a keep-warm cron job that pings the chat-proxy endpoint every 2 minutes to prevent eviction.
2. Split the monolithic function (TD-02) into smaller modules; cold start time is proportional to the total JS bundle size.
3. Consider a "warmup" endpoint that pre-loads the function without processing a request.
4. Add Sentry tracing with `tracePropagationTargets` to measure cold start vs warm request latency.
5. For continuation loops, set `keepalive: true` on the Deno serve options to hint to the runtime.

**Warning signs:**
- P99 streaming TTFB (time-to-first-byte) significantly higher than P50.
- Users reporting "first message is slow, then fast" in a new session.
- Sentry traces showing >500ms for the first `chat-proxy` invocation but <100ms for subsequent.

**Phase to address:**
Phase 1 (chat-proxy refactor). The cold start issue is a direct consequence of the monolithic function size. Splitting it (TD-02) is the most impactful mitigation. After splitting, add a keep-warm cron.

---

### Pitfall 13: Negative Credit Balances From Race Conditions in Concurrent Deductions

**Severity:** Catastrophic

**What goes wrong:**
The credit deduction flow involves: (1) frontend calls `deduct-credits` edge function, (2) edge function calls `deduct_credits` RPC (SECURITY DEFINER), (3) RPC decrements `remaining_credits`. If the frontend sends two concurrent deduction requests (e.g., two simultaneous streams or a retry race), both RPC calls may read the same balance, both determine sufficient funds, and both decrement, potentially going negative.

The `credit_ledgers` FIFO system is designed to prevent this (each deduction atomically drains from the oldest ledger), but the `remaining_credits` column in `user_credits` is a cached sum that's updated independently. The `20260508000001_fix_credit_races.sql` migration added `FOR UPDATE` row locking to `ensure_user_credits`, but the deduction path (`deduct_credits` RPC) needs the same treatment.

**Why it happens:**
The cached balance pattern (`remaining_credits` in `user_credits` as a serialized sum of `credit_ledgers`) is fast but racy without row-level locking (`SELECT ... FOR UPDATE`). The ledger entries are append-only (adding lines is locked by PK), but the cached sum is updated in a separate statement.

**How to avoid:**
1. Audit `deduct_credits` RPC: ensure `SELECT ... FOR UPDATE` locks the user's `user_credits` row before reading balance.
2. Use PostgreSQL advisory locks (`pg_advisory_xact_lock`) for the user ID to serialize all deduction operations.
3. Add a CHECK constraint on `user_credits.remaining_credits >= 0` as a safety net — it will cause an error on attempted negative, which surfaces in Sentry immediately.
4. Add a reconciliation query that runs daily: `SELECT user_id FROM user_credits WHERE remaining_credits < 0`.

**Warning signs:**
- Negative `remaining_credits` values in user_credits table.
- Users receiving "insufficient credits" errors when they clearly have credits.
- Multiple active streaming sessions for the same user (concurrent deduction risk).

**Phase to address:**
Phase 3 (Billing hardening). The race condition fix (row-level locking for deduction) is critical before any paid user activity.

---

### Pitfall 14: Reasoning Content Leakage Through SSE Stream Into Non-Reasoning UI

**Severity:** Material

**What goes wrong:**
OpenRouter returns `delta.reasoning` in SSE chunks for reasoning models (e.g., DeepSeek R1, Claude with thinking). The frontend routes these to either a "thinking box" (onReasoning callback) or main content (onChunk) based on the `treatReasoningAsContent` flag. If this flag is incorrectly set, raw chain-of-thought reasoning is displayed as the assistant's actual response, which can include sensitive intermediate data (e.g., "the user's files contain X, Y, Z" or internal instructions).

The codebase has two model paths (main chat + side chat) with different `supportsReasoning` flags. A mismatch between the declared capability and actual model behavior causes reasoning content to leak into the wrong UI channel.

**Why it happens:**
Model capability metadata is configured in `src/config/models.ts` and `src/services/openrouter.ts`. If a model's reasoning support is mis-declared (e.g., `supportsReasoning: false` for a model that actually emits reasoning), the `delta.reasoning` content flows into `onChunk` instead of `onReasoning`, displaying raw internal monologue to the user.

**How to avoid:**
1. Add a Rust/wasm-based reasonination check: detect `delta.reasoning` presence on the first chunk regardless of the `treatReasoningAsContent` flag, and route accordingly.
2. Implement a "reasoning firewall" in `processStream` that, for the first 3 chunks, redirects ANY content tagged as `reasoning` to the thinking box, ignoring the config flag.
3. Add a Sentry breadcrumb when reasoning content is detected in the non-reasoning path — this indicates a misconfigured model.
4. Validate model config against actual OpenRouter response in a health-check end-to-end test.

**Warning signs:**
- Chain-of-thought text appearing as the AI response (look for phrases like "I need to...", "Let me think about this...")
- Users reporting "the AI is showing its internal monologue"
- `delta.reasoning` appearing in SSE chunks when `supportsReasoning: false`

**Phase to address:**
Phase 4 (Streaming polish). The reasoning content routing is part of the streaming pipeline. Fixing it after the monolith split (Phase 1) and before production launch ensures safe handling of all model types.

---

### Pitfall 15: Tool Call Token Budget Exhaustion (Tool-Call Round Loop)

**Severity:** Material

**What goes wrong:**
The chat-proxy edge function supports tool calls (web_search, analyze_image, process_file) with a maximum of 3 rounds per request. Each tool call consumes output tokens from the model's budget. If tools return large results (>12K characters as mentioned in FAG-01), the combined tool output + model response can exceed the output budget, causing truncation mid-response or forcing a continuation loop that re-invokes tools.

The tool call budget is checked at `supabase/functions/chat-proxy/index.ts:1230` with "tool limits & deduplication." But there is no per-round tool output token budget — only a per-round model output budget. A single large tool response can consume the entire round's worth of tokens.

**Why it happens:**
AI tool results are unpredictable. A web search for "latest news" might return 500 characters or 50,000. The tool execution doesn't account for the size of its own output when deciding whether to continue. The model may try to use all budget remaining, which includes both tool output tokens AND response tokens.

**How to avoid:**
1. Implement a per-tool output token cap (e.g., 2000 chars per tool result), truncating or summarizing excessively long results.
2. Add a total tool-output token budget (separate from model-output budget). When the tool output budget is exhausted, stop tool execution for that round.
3. Track `tool_call_id -> tokens_used` in the circuit breaker state to detect tool budget abuse patterns.
4. Add a Circuit Breaker specifically for tool output volume: if average tool output per request exceeds threshold over 5 requests, limit to 1 tool per request.

**Warning signs:**
- Models producing truncated responses after tool calls (finish_reason = 'length')
- Continuation loops triggered immediately after tool results (model consumed budget on tool output, not response)
- Users complaining that web search "doesn't fit in the response"

**Phase to address:**
Phase 1 (chat-proxy refactor). The tool call round logic is deep in the monolithic function. Per FAG-01, the checklist for safe modification includes verifying behavior with "tool with >12K char output" — this trap is documented in the fragile area but needs a systematic fix, not just a checklist item.

---

### Pitfall 16: Zero-byte / Encrypted File Uploads Without Friendly Error Response

**Severity:** Minor (escalates with scale)

**What goes wrong:**
FileProcessor.ts handles PDF, DOCX, XLSX, PPTX, and image uploads client-side. The error handling for encrypted PDFs (line 214: `[Failed to extract text — PDF may be encrypted or corrupted]`) is reasonable, but there's no check at the upload boundary for:
- Zero-byte files: `file.size === 0` passes through validation, wastes 50MB combined budget.
- Encrypted/ password-protected DOCX: `mammoth` throws a generic error, caught as "Failed to extract text."
- Corrupt XLSX: SheetJS may throw obscure errors from deep inside binary parsing.

The current error messages are generic (SEC-05 in CONCERNS.md specifically flags this). This creates a poor UX: users don't know if their file is genuinely broken, encrypted, or unsupported.

**Why it happens:**
Error handling is often added reactively ("we got a crash from this file type, let's catch it"). Proactive validation at the upload boundary is more work but produces better UX. The file processing pipeline checks combined size and per-file size limits but doesn't validate file content.

**How to avoid:**
1. Add zero-byte file check at the `processAttachment` entry point in `fileProcessor.ts` (line 425 area) — return a clear error before any processing.
2. For encrypted documents, detect the file header magic bytes (PDF starts with `%PDF`, DOCX is ZIP with specific internal structure). If extraction fails, distinguish between "encrypted" (header present but extraction fails with password error) and "corrupt" (header missing or malformed).
3. Time-box costly extraction operations (e.g., `extractPdfText` with a 10-second timeout per page).
4. Surface distinct error messages to the user: "This file appears to be password-protected" vs. "This file appears to be corrupted" vs. "Could not extract text from this file type."

**Warning signs:**
- Sentry events showing `PDF extraction failed` with no additional context
- User complaints about file uploads failing silently
- The `uploadedFiles` array containing files with `error` but no descriptive message

**Phase to address:**
Phase 2 (File processing refinement). Per SEC-05, the file upload content security is already on the roadmap. Adding friendly error messages is low-complexity and high-ROI.

---

### Pitfall 17: OTP Replay and Enumeration Attack Surface

**Severity:** Material

**What goes wrong:**
The app uses Supabase Auth with OTP (one-time password) for signup and password recovery. The `verifyOtp` function in `authStore.ts` accepts `email, token, type` and calls `supabase.auth.verifyOtp`. Without additional guardrails:
- **OTP replay:** If the same OTP can be verified multiple times within its validity window (default 5 minutes in Supabase), an attacker who intercepts an OTP can reuse it.
- **Enumeration:** The OTP flow reveals whether an email is registered (difference between "OTP sent" and "OTP sent, but email doesn't exist"). Supabase mitigates this by always returning "OTP sent" regardless, but the timing difference may still leak information.
- **Rate limiting on OTP verify:** The app checks rate limiting on `chat-proxy` but NOT on the auth endpoints (Supabase handles auth rate limiting at the platform level, but the edge function layer doesn't add an additional check).

**Why it happens:**
Supabase Auth handles OTP verification server-side, so these are largely Supabase's responsibility. However, the app's auth flow adds UX enhancements (pending messages, navigation to OTP screen) that can create side channels. The `otpVerified` flag (H4 fix: reset at start of every call) was a reactive fix for a sticky flag bug — the same pattern could apply to other auth state.

**How to avoid:**
1. Use Supabase's built-in OTP configuration: set `OTP_EXPIRY` to the minimum viable window (5 minutes default is reasonable).
2. Verify that Supabase's rate limiting for auth endpoints covers OTP verify calls (it does by default, but verify in Supabase Dashboard).
3. Do not add custom OTP verify caching or "remember OTP" logic in the authStore — this defeats Supabase's one-time use guarantee.
4. Add a `checkRateLimit` on the frontend for `verifyOtp` calls: max 3 attempts per 60 seconds per email, surfaced as a UI error.

**Warning signs:**
- Supabase Auth logs showing multiple successful OTP verifications with the same token
- Users reporting "I verified my OTP but it still prompts me" (could be sticky flag OR replay)
- Auth edge function (if one exists) not rate-limited on OTP verify path

**Phase to address:**
Phase 2 (Auth hardening). The authStore was recently fixed (H3, H4, H6) but the rate limiting on auth endpoints and OTP guardrails should be verified against Supabase's current configuration.

---

### Pitfall 18: Chunking Quality Regressions From Overlap Logic

**Severity:** Minor (escalates with RAG importance)

**What goes wrong:**
The `embed` edge function uses a fixed chunk size (4000 chars, ~1000 tokens) with 400 char overlap and naive word-boundary splitting. The overlap logic (lines 38-44 of `embed/index.ts`) ensures progress even when the ideal breakpoint is too close to the start, but:
1. Overlap is fixed at 10% — for very structured content (code, tables), 400 chars may not span a complete logical unit, causing context splits mid-function.
2. No content-aware chunking: a 4000-char chunk that splits mid-table produces two chunks with no meaningful connection.
3. No deduplication at chunk boundaries: overlap creates near-duplicate chunks where the same sentence appears at the end of one chunk and the start of the next.

**Why it happens:**
Fixed-size chunking with overlap is the "hello world" of RAG — it works well enough for prose but degrades for structured content. Teams don't notice until retrieval quality drops for code or tabular data.

**How to avoid:**
1. Add content-type detection before chunking: if the text appears to be code or tabular, use semantic chunking (break at function boundaries, table rows) rather than fixed-size splitting.
2. Implement deduplication at the chunk level after overlap: if two chunks overlap by >50 chars, remove the overlapping section from the later chunk.
3. Add chunk quality monitoring: for each query, log the number of chunks retrieved and their similarity scores. A sudden drop in chunk count or similarity indicates chunking regression.
4. Consider recursive splitting for very large documents: chunk, then sub-chunk if individual chunks exceed the model's token limit.

**Warning signs:**
- RAG retrieving the same information from multiple chunks (duplicate overlap)
- Code files producing RAG chunks that start/end mid-function
- Table-heavy documents not matching queries about specific rows/columns

**Phase to address:**
Phase 4 (RAG polish). The chunking is functional for the current scale. Quality improvements should follow the core RAG pipeline (embed + retrieve) which is already working.

---

### Pitfall 19: Mixed Content Blocked in Artifact iframe With `allow-scripts`

**Severity:** Minor

**What goes wrong:**
HTML artifacts render in an iframe with `srcdoc` (no URL) and `sandbox="allow-scripts allow-forms allow-popups ..."`. If the artifact HTML references external resources via `http://` URLs (not `https://`), the iframe may block them because the main page is served over HTTPS. This is the mixed content behavior: browsers block active mixed content (scripts, iframes) by default but may allow passive mixed content (images) with a warning.

The `allow-scripts` sandbox value does NOT bypass mixed content blocking. An artifact that loads `http://example.com/script.js` will fail silently.

**Why it happens:**
AI models don't know about mixed content. When prompted to "create a website," the model may generate HTML with `http://` links. The artifact iframe is `about:srcdoc` (a secure context), which enforces HTTPS-only for active content.

**How to avoid:**
1. Strip `http://` references in the artifact renderer (replace `http://` with `https://` or add `//` protocol-relative URLs).
2. Add a friendly warning banner on the artifact when mixed content is detected: "This artifact uses non-secure resources and some may not load."
3. For images specifically, add an `onerror` handler that retries with `https://` prefix.

**Warning signs:**
- Artifact iframes showing broken images or missing resources
- Console warnings in the artifact iframe about mixed content
- Users reporting "my embedded website doesn't load images"

**Phase to address:**
Phase 5 (CSP rollout). Mixed content handling is a polish item tied to the CSP configuration. Address it alongside the CSP header rollout.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Single `openrouter.ts` monolith (1770 lines) | Faster initial development | Untestable, any change risks 5+ concerns | Never — already past threshold |
| Single `chat-proxy/index.ts` monolith (1668 lines) | Faster edge function development | Cold start latency, hard to debug streaming issues | Never — already past threshold |
| Cross-store `getState()` imports | Avoids Zustand `subscribe` boilerplate | Spaghetti dependencies, cannot test stores independently | Only during active development, must refactor before production |
| In-memory circuit breaker state | Zero infrastructure, works locally | State lost on every cold start/scale-out | Only for dev/early staging, never for production |
| No shared types between frontend/edge functions | Faster iteration per side | Silent contract drift, runtime deserialization errors | Acceptable during prototyping only |
| `any` type for `setViewerFile` | Quick to implement | Runtime errors from malformed file data | Never — should be typed from day one |
| No test infrastructure | Zero setup cost | Every deployment is a leap of faith; same bugs fixed multiple times | Never — already causing documented regression cycles |
| Regex-based sanitization (SVG) | Simpler than DOMParser, no async | Bypassable by mixed-case events, encoded entities | Never — DOMParser is the correct primitive |
| Fixed chunk size (4000 chars) with overlap | Simple and efficient for prose | Degrades for code/tables, duplicate chunk boundaries | Acceptable for MVP; must refactor for structured content |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| OpenRouter stream parsing | Assuming all chunks have `finish_reason` | Only the final chunk has it; extract once, route to billing |
| OpenRouter embedding version | Not tracking which model produced each chunk | Store `embedding_model` per chunk for drift detection |
| Lemon Squeezy webhooks | Application-level dedup only (check-then-insert) | Use PostgreSQL UNIQUE constraint + atomic INSERT with ON CONFLICT |
| Lemon Squeezy payment flow | No reconciliation cron against LS API | Weekly job: compare LS subscription state with local DB |
| Supabase Auth OTP | No rate limiting on OTP verify at app layer | Add app-level rate limiting (Supabase's default may not match UX needs) |
| Supabase Edge Function cold start | Assuming Deno keeps functions warm | Add keep-warm cron; split monoliths to reduce cold start time |
| Tavily web search | Hardcoded result count (5 max) | Make configurable but cap server-side to prevent runaway costs |
| Sentry source maps | Deploying .map files to Vercel CDN | Use `build.sourcemap: 'hidden'` or Sentry upload plugin |
| Sandpack/iframe artifacts | `sandbox` missing `allow-same-origin` | Current config is correct (no `allow-same-origin`) but verify postMessage bridge |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| 60Hz `JSON.stringify` in theme fingerprint | UI jank on slider drag, high CPU | Memoize fingerprint (PERF-01 in CONCERNS.md) | Already happening for theme adjusters |
| No `React.memo` on large components | Re-render cascades in ChatArea, MessageBubble | Add `React.memo` (PERF-02 in CONCERNS.md) | At ~50+ messages in a conversation |
| Debug store ring buffer filling memory | Dev tab using >200MB | TTL eviction + max bytes (PERF-03) | Dev sessions >2 hours |
| Monolithic openrouter.ts eagerly loaded | Larger initial bundle size, slower page load | Dynamic import for continuation engine (PERF-04) | Every page load currently |
| In-memory circuit breaker | During OpenRouter outage, all isolates burn through failure budget | Shared KV circuit breaker (PERF-05) | At 2+ concurrent edge function instances |
| Web Worker WASM memory accumulation | Browser tab OOM after navigation cycles | Dispose workers on route change; track reference count | At 3+ navigations within a session |
| Fixed SSE batching (16ms) | May batch too aggressively for fast models | Make configurable per-model | Depends on model token generation speed |
| No lazy loading for heavy libs (mermaid, pdfjs) | Initial bundle includes all rendering libraries | Code-split artifact renderers | Every page load |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| SVG rendered via `innerHTML` without DOMParser sanitization | XSS in main document context | Replace regex sanitization with DOMParser (SEC-01) |
| Mermaid `securityLevel: 'loose'` | JS execution in diagram labels | Switch to `'strict'` or `'sandbox'` (Bug-08) |
| postMessage bridge accepts messages from any origin without payload validation | Spoofed error messages, potential XSS via error rendering | Add `msg.origin === null` check; validate payload shape |
| No CSP headers on main app | No defense-in-depth against XSS in non-iframe contexts | Add CSP with Report-Only first (SEC-02) |
| Rate limiting only on chat-proxy (10 of 11 functions unguarded) | Abuse of embed, webhook, suggest-title endpoints | Apply `checkRateLimit` to all edge functions (SEC-04) |
| JWT verified by local decode then admin.getUserById | Forged JWT can reach billing code before verification fails | Add Sentry alert; move verification to stream entry point (SEC-03) |
| File upload without content-hash dedup | Duplicate processing of same file; storage amplification | Content-hash at upload boundary (SEC-05) |
| Edge function `verify_jwt = false` for chat-proxy and deduct-credits | Custom auth logic may have gaps | Use `supabase.auth.getUser()` as single auth primitive |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| `onDone` not called after `onError` in processStream | UI stuck in loading state, user must refresh | Call `onDone` unconditionally in a `finally` block (BUG-01) |
| Empty HTML artifact renders as whitespace | User thinks artifact is blank/broken | Validate meaningful content before rendering (BUG-03) |
| Missing `[DONE]` sentinel after stream error | Infinite continuation loop, user sees "still loading" | Always emit `[DONE]` even in error paths (BUG-06) |
| OTP verified flag sticking between attempts | User sees "verified" but is not actually logged in | Reset flag at START of each verifyOtp call (H4 fix — verified) |
| `focusedArtifactId` doesn't reset worker state | Stale artifact results shown for new artifact | Reset worker + store on artifact switch (BUG-10) |
| Credit deduction failure shown as generic error | User doesn't know billing failed | Surface specific credit deduction error (H11 fix — verified) |
| Model selection not showing which model supports what | User picks reasoning model, gets no thinking box | Display model capabilities in model picker UI |

## "Looks Done But Isn't" Checklist

- [ ] **Sentry integration:** `@sentry/react` is in `package.json` but verify `Sentry.init()` is called in `main.tsx` with correct DSN, release, environment, and breadcrumb setup for auth/credit/stream errors.
- [ ] **Rate limiting:** Only `chat-proxy` has `checkRateLimit`. All 10 other edge functions are missing it. Add to each.
- [ ] **SVG sanitization:** `sanitizeSvg()` exists but confirm it is called on ALL SVG rendering paths, not just some.
- [ ] **Worker termination:** `tokenStore` has `worker.terminate()` but verify `artifactParseWorkerClient` and `highlighterWorkerClient` do as well.
- [ ] **Circuit breaker shared state:** Module-level `Map` exists. Verify the KV-backed version is connected, not just the in-memory one.
- [ ] **CSP headers:** `vercel.json` has no CSP. Planned CSP in PROJECT.md would break inline scripts — test before deploy.
- [ ] **Source map exposure:** No `build.sourcemap` in `vite.config.ts`. Vite default is `sourcemap: true` for build, exposing full source.
- [ ] **Feature flags / kill switches:** `isKillSwitched()` exists but verify every edge function entry point calls it.
- [ ] **Cross-store subscribe pattern:** TD-08 recommends replacing `getState()` with `subscribe`. Confirm this is actually done, not just planned.
- [ ] **Shared types between frontend/edge functions:** TD-06 flags this. Verify whether a shared types package exists or is still planned.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Streaming finishReason drift causing zero billing | MEDIUM | Fix `finishReason` assignment in all paths; reconcile `usage_logs` for under-billed streams; credit the difference |
| Webhook double-grant of credits | LOW (for the user) / MEDIUM (for reconciliation) | Reconcile against Lemon Squeezy API: compare granted credits vs subscription history; manual credit reversal via admin function |
| Negative credit balance from race | MEDIUM | Add CHECK constraint to block future negatives; fix deduction RPC with row locking; reconcile negative users via manual adjustment |
| CSP deployment breaking the app | HIGH (immediate revert needed) | Revert CSP headers; deploy as Report-Only; iterate on policies; test against `vite build` output |
| JWT expiry mid-stream causing auth failure | MEDIUM | Implement token refresh callback; set JWT TTL in Supabase config to 2 hours for production to widen the window |
| Data loss from Zustand persist schema migration | HIGH (user data lost permanently) | Add `version` + `migrate` to every persisted store; export-to-JSON recovery tool for users who already lost data |
| Sensitive data leaked to localStorage from persisted store | HIGH (PII exposure if attacker has local access) | Immediately rotate any leaked tokens; wipe localStorage on next app version; add `partialize` audit |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Streaming `finishReason` drift | Phase 1 (Streaming refactor) | Add billing assertion test; verify `usage_logs` shows correct cost for all stream paths |
| 2. Webhook idempotency race | Phase 3 (Billing hardening) | Concurrent webhook delivery test with PG advisory lock; verify unique constraint prevents double grant |
| 3. CSP Report-Only without report endpoint | Phase 5 (CSP rollout) | Deploy Report-Only first with reporting endpoint; collect violations for 1 week before enforcing |
| 4. Zustand persist leaking PII | Phase 2 (State management) | Audit all 5 persisted stores; verify `partialize` is opt-in per store |
| 5. JWT expiry mid-stream | Phase 1 (chat-proxy refactor) | Long-stream integration test: simulate 2-hour stream, verify token refresh |
| 6. In-memory circuit breaker | Phase 3 (Production hardening) | Verify shared KV is connected; test cold start doesn't reset circuit state |
| 7. Embedding model versioning | Phase 4 (RAG polish) | Verify `embedding_model` column exists; test re-embedding job |
| 8. postMessage abuse via artifacts | Phase 1 (Security hardening) | Add origin + payload validation; verify crafted artifact cannot trigger fake errors |
| 9. Worker termination on route change | Phase 2 (Worker lifecycle) | Verify `dispose()` called in `useEffect` cleanup; check Chrome workers tab after navigation |
| 10. Vite source map exposure | Phase 5 (Vite config) | Verify `build.sourcemap: 'hidden'`; check production DevTools for TS sources |
| 11. NOT NULL column migration at scale | Phase 3 (Database hardening) | Review all 36+ migrations for NOT NULL WITHOUT DEFAULT patterns |
| 12. Cold start tail latency | Phase 1 (chat-proxy refactor) | Measure P99 TTFB before/after monolith split |
| 13. Negative credit race | Phase 3 (Billing hardening) | Verify `SELECT ... FOR UPDATE` in `deduct_credits` RPC; add CHECK constraint |
| 14. Reasoning content leakage | Phase 4 (Streaming polish) | Test with reasoning model; verify `delta.reasoning` routed to thinking box |
| 15. Tool call budget exhaustion | Phase 1 (chat-proxy refactor) | Test >12K char tool output; verify truncation handling |
| 16. Zero-byte/encrypted file errors | Phase 2 (File processing) | Test upload of encrypted PDF, zero-byte file, corrupt DOCX |
| 17. OTP replay and enumeration | Phase 2 (Auth hardening) | Test rapid OTP verify; verify Supabase rate limiting config |
| 18. Chunking quality regressions | Phase 4 (RAG polish) | Test RAG retrieval with code files; check for duplicate chunk overlap |
| 19. Mixed content in artifact iframe | Phase 5 (CSP rollout) | Test artifact with `http://` resources; verify graceful degradation |

## Sources

- Codebase analysis of `supabase/functions/`, `src/store/`, `src/services/`, `src/lib/`, `src/components/`, `supabase/migrations/`
- CONCERNS.md (all sections: Tech Debt, Known Bugs, Security, Performance, Fragile Areas)
- ARCHITECTURE.md (component boundaries, data flow patterns)
- INTEGRATIONS.md (all external service configurations and versions)
- PROJECT.md (stabilization milestone requirements and constraints)
- Supabase Auth documentation (sessions, JWT expiry, refresh tokens) — confirmed via WebFetch against supabase.com/docs
- CSP documentation (MDN, Level 3 spec) — confirmed via WebFetch against MDN
- Zustand persist middleware documentation — confirmed via pmnd.rs/state library reference
- Payment hardening migration (`20260523000001_payment_hardening.sql`) — shows existing awareness of the monthly-bucket dedup fix
- Credit race migration (`20260508000001_fix_credit_races.sql`) — shows existing FOR UPDATE locking for ensure_user_credits
- Previous audit findings (AUDIT_PROGRESS.md, artifact-audit-findings.md) — shows 28 issues resolved, 10+ still open

*Pitfalls research for: Lucen v2.3 stabilization milestone*
*Researched: 2026-06-08*