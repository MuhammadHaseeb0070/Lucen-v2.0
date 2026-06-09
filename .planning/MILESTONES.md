# Milestones

## v2.3 Stabilization Milestone (Shipped: 2026-06-09)

**Phases completed:** 5 phases, 9 plans, 19 tasks

**Key accomplishments:**

- Vitest and Playwright test runners configured in a unified Vite setup with V8 coverage gates and Chromium E2E smoke tests
- Billing drift safeguards and Sentry warning breadcrumbs implemented alongside mid-stream JWT verification inside the chat-proxy Edge function
- Delivered the shared types package, configured Deno import maps and TypeScript path aliases, and implemented client unit tests with complete test coverage check passing
- Configured Upstash Redis-backed rate limits and circuit breakers with local fallbacks, edge-level kill switches, search flag unifications, themes separation, and clean store types
- Strict DOMPurify sanitization and sandboxing configured for SVG, Mermaid, and HTML iframe previews, with a clean empty/malformed fallback UI state
- Empty file rejection, client-side content-hash deduplication, and password-protected document extraction error handling
- Integrated Sentry logging in the edge function auth layer to capture forged JWT signature alerts with redacted metadata and Deno flushing
- Audited all prior-phase implementations as already complete; created the only missing artifact — the Playwright E2E core.test.ts suite

## v2.5 Web Search Optimization Milestone (Shipped: 2026-06-09)

**Phases completed:** 1 phase, 1 plan, 6 tasks

**Key accomplishments:**

- Concurrency enabled for web search calls (`parallelizable: true`), improving search speed and response latency.
- Dynamic `maxRounds` step limit scaling up to 5 rounds, preventing premature truncation when processing attachments + web search.
- Injected strict step limit negative constraints in final generation turns to prevent leaked tool XML tags.
- Enhanced defensive XML tag sanitization in `sanitizeMinimaxTags` to strip partial/leaked parameters.
- Built a beautiful, glassmorphic steps progress and domain citation card UI.

---

