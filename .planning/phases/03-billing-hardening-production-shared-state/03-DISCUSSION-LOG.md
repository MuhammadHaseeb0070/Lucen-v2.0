# Phase 3: Billing Hardening + Production Shared State - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-08
**Phase:** 03-billing-hardening-production-shared-state
**Areas discussed:** Rate Limiting + Upstash Redis integration, Circuit Breaker state sharing, Kill Switch checking pattern, Web Search key migration

---

## Rate Limiting & Upstash Redis Integration

| Option | Description | Selected |
|--------|-------------|----------|
| In-Memory Only | Keep in-memory tracking in Deno isolates (leads to independent limits per instance). | |
| Upstash Redis REST | Use Upstash Redis via lightweight HTTP POST fetches (REST API) with a local in-memory fallback. | ✓ |
| Full TCP Redis | Connect using standard TCP Redis protocol inside Edge Functions (increases connection overhead). | |

**User's choice:** Upstash Redis REST with a local in-memory fallback.
**Notes:** The REST client is chosen for Deno isolates because it doesn't hold open persistent TCP connections, which keeps execution extremely fast and serverless-friendly.

---

## Circuit Breaker State Sharing

| Option | Description | Selected |
|--------|-------------|----------|
| In-Memory Only | Track failures in memory per-isolate. | |
| Upstash Redis | Share failure counters and state across Deno instances using Upstash Redis keys with short TTLs. | ✓ |

**User's choice:** Share state across Deno instances using Upstash Redis.
**Notes:** If Upstash Redis is not configured or fails, it drops back to in-memory state tracking to ensure high availability.

---

## Kill Switches / Feature Flags checking pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Per-Function Code Check | Manually add if-statements checking `isKillSwitched` inside each function body. | |
| Unified Middleware Wrapper | Apply a standard check at the entry point of all 12 edge functions. | ✓ |

**User's choice:** Unified entry checking at all 12 edge functions.
**Notes:** Ensures new functions automatically benefit from feature flags and cannot bypass the check.

---

## Web Search key migration

| Option | Description | Selected |
|--------|-------------|----------|
| Keep support for all | Keep accepting all three keys without warnings. | |
| strict check only | Only accept `web_search_enabled` and fail on legacy keys. | |
| Translation + Deprecation warning | Map legacy keys (`webSearchEnabled`, `enableWebSearch`) to `web_search_enabled` but emit warnings. | ✓ |

**User's choice:** Map legacy keys to `web_search_enabled` and emit warnings.
**Notes:** Ensures backward compatibility while prompting developers/clients to update their callers.

---

## the agent's Discretion
- Spacing, exact visual styling of warning messages.
- Specific rate limit numbers for secondary utility functions.

## Deferred Ideas
None.

---

*Phase: 03-billing-hardening-production-shared-state*
*Discussion log generated: 2026-06-08*
