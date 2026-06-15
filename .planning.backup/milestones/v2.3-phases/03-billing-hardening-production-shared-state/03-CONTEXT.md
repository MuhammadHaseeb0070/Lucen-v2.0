# Phase 3: Billing Hardening + Production Shared State - Context

**Gathered:** 2026-06-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Unify web search keys, isolate theme configurations and viewer file types, enforce feature flag kill switches across all edge functions, and implement Redis-backed (Upstash) rate limiting and circuit breakers with robust local in-memory fallbacks.

</domain>

<decisions>
## Implementation Decisions

### Rate Limiting & Upstash Redis Integration
- **D-01 (Upstash Redis Connection):** Connect to Upstash Redis from Deno edge functions using the Upstash REST API (`fetch`). The database REST URL and Token will be retrieved via environment variables `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- **D-02 (Local Fallback):** If Upstash Redis credentials are not configured in the environment, rate limiting must gracefully fall back to local in-memory sliding-window tracking so local development is not disrupted.
- **D-03 (Edge Functions Coverage):** All 12 edge functions must perform rate limiting at entry.
- **D-04 (Retry-After Header):** When a request is rate-limited, return an HTTP `429 Too Many Requests` status code and set the `Retry-After: <seconds>` response header.

### Circuit Breaker State Sharing
- **D-05 (Shared Circuit Breaker State):** Store the OpenRouter circuit breaker state (consecutive failures count, state, lastFailure timestamp) in Upstash Redis. Transition state naturally via Redis TTL (e.g. set the state key to `open` with a 30-second TTL; when it expires, the circuit transitions back to `half-open`).
- **D-06 (Circuit Breaker Fallback):** Fall back to local in-memory circuit breaker tracking if Upstash is not configured.
- **D-07 (UI Degradation):** When the circuit breaker is open, edge functions return a `503 Service Unavailable` with a clear message: `"AI service is temporarily unavailable. Please try again in a moment."` The React frontend will detect this and show a user-friendly message.

### Kill Switches / Feature Flags
- **D-08 (Edge Entry Checking):** Every edge function must check `isKillSwitched()` at entry. If a feature is disabled via its environment variable (e.g. `FEATURE_WEB_SEARCH=false` or `FEATURE_CHAT=false`), immediately return a `503 Service Unavailable` with a JSON payload indicating that the feature is temporarily disabled.

### Web Search Key Unification
- **D-09 (Single Source of Truth):** Unify the web search toggle key to `web_search_enabled` (snake_case) across frontend, Edge Functions, and database usage logs.
- **D-10 (Legacy Warning Translation):** In the edge function request parsing, if the legacy keys `webSearchEnabled` or `enableWebSearch` are detected, parse them into `web_search_enabled` but log a deprecation warning in the structured logs (`logger.warn`) to identify old client callers.

### Theme & Viewer Typing
- **D-11 (Themes Extraction):** Extract color palettes and themes to `src/config/themes.ts`.
- **D-12 (ViewerFile Typing):** Strongly type the `ViewerFile` interface, making sure that `setViewerFile` is strongly typed.

### the agent's Discretion
- The exact layout of the UI warning banner/toast when the circuit is open.
- The precise configuration-based rate limits for each individual edge function.

</decisions>

<canonical_refs>
## Canonical References

### Roadmap and Requirements
- `.planning/ROADMAP.md` — Milestones and phase success criteria
- `.planning/REQUIREMENTS.md` — Requirements TD-03, TD-04, TD-05, SEC-04, PROD-02, PROD-03, PROD-04, PERF-05

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `supabase/functions/_shared/rateLimit.ts` — in-memory rate limiting logic
- `supabase/functions/_shared/circuitBreaker.ts` — in-memory circuit breaker logic
- `supabase/functions/_shared/featureFlags.ts` — env-driven feature toggles

### established Patterns
- Entry point structure: Deno.serve index facade parsing request and applying CORS/headers.

### Integration Points
- Edges functions entry points (`index.ts` files under `supabase/functions/`).
- React client API requests in `src/services/openrouter/client.ts`.

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-billing-hardening-production-shared-state*
*Context gathered: 2026-06-08*
