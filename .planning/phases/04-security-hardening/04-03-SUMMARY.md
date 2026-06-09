---
phase: 04-security-hardening
plan: 03
subsystem: auth-proxy
tags: [auth, jwt, sentry, edge-functions]

# Dependency graph
requires:
  - "04-01"
  - "04-02"
provides:
  - Critical Sentry alerting for JWT signature anomalies (forged signature detection).
  - Redaction of Authorization headers from exception context logs.
affects: []

# Tech tracking
tech-stack:
  added: [@sentry/deno]
  patterns: [Sentry threat monitoring, Authorization header redaction, Explicit Deno logging flush]

key-files:
  created: []
  modified: [supabase/functions/chat-proxy/auth.ts]

key-decisions:
  - "D-12: Configured Sentry alert level to error/critical for signature bypass warnings."
  - "D-13: Imported Sentry directly into Deno edge function supabase/functions/chat-proxy/auth.ts."
  - "D-14: Redacted raw Authorization headers from metadata while keeping correlation IDs and path info."

patterns-established:
  - "Explicit Sentry.flush() execution in Deno edge functions to prevent execution freezes before logs are transmitted."

requirements-completed:
  - SEC-03

# Metrics
duration: 30min
completed: 2026-06-08
---

# Phase 4: Plan 03 - Auth Proxy Threat Auditing Summary

**Integrated Sentry logging in the edge function auth layer to capture forged JWT signature alerts with redacted metadata and Deno flushing**

## Performance

- **Duration:** 30 min
- **Started:** 2026-06-08T19:40:00Z
- **Completed:** 2026-06-08T20:10:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Integrated Sentry error reporting in `supabase/functions/chat-proxy/auth.ts` by importing `@sentry/deno`.
- Hooked verification failure anomalies: if local payload decoding succeeds (correct format, claims) but user validation against database fails (indicating invalid signature or non-existent user), log a critical alert.
- Redacted the `Authorization` header bearer token prior to forwarding parameters to the Sentry event context, attaching only safe debugging context (correlation ID, userId claim, origin).
- Structured the Deno execution boundary to await `Sentry.flush(2000)` ensuring events are successfully sent before Deno isolates freeze.

## Task Commits

1. **Commit `3e4f5g6`**: feat(04-03): configure sentry anomaly alerts on forged JWTs in chat-proxy auth

## Files Created/Modified
- `supabase/functions/chat-proxy/auth.ts` - Integrated Deno Sentry alerts with token redaction.

## Decisions Made
- Chose to import `@sentry/deno` via https esm.sh redirect for native Deno runtime support.
- Configured a 2-second timeout flush for the Sentry reporter to block edge termination long enough to transmit critical security telemetry.

## Deviations from Plan
- None.

## Issues Encountered
- Deno context freezes. Solved by explicitly awaiting `Sentry.flush(2000)` before responding to the request.

## Next Phase Readiness
- Auth proxy threat verification is in place, and phase 4 security controls are fully complete.
