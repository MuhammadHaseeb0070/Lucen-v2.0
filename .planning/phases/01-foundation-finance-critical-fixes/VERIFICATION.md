# Centralized Manual Verification Plan - Phase 1

This document outlines the manual verification procedures for the non-automatable changes introduced in **Phase 1: Foundation + Finance-Critical Fixes**. Since the execution environment does not have active Supabase connections or local Deno servers running, these steps must be performed in a live staging/deployment environment.

---

## BUG-05: finishReason Billing Drift & Sentry Breadcrumbs

### Objective
Ensure that:
1. `finishReason` is assigned in every streaming path (including errors, watchdog triggers, and credit check failures).
2. A Sentry warning breadcrumb is recorded if `finishReason` is originally null/missing in the billing function, but a fallback is applied successfully.

### Prerequisites
- Supabase Edge Functions deployed to staging.
- Sentry integration enabled on the edge function environment with a valid `SENTRY_DSN`.

### Test Case 1: Watchdog Trigger / Early Exit
1. Start a long streaming request.
2. Manually trigger a watchdog timeout or interrupt the streaming request by closing the client connection prematurely (triggering `aborted` status).
3. Check the database `usage_logs` table for the corresponding row:
   ```sql
   SELECT status, status_reason FROM usage_logs WHERE user_id = 'your-user-id' ORDER BY created_at DESC LIMIT 1;
   ```
4. **Acceptance Criteria**: The status is logged as `aborted`, and `status_reason` is `eof_without_done`. Verify that the database credit balance matches the billing calculation for the tokens processed before aborting.

### Test Case 2: Null finishReason Warning Telemetry
1. Force the upstream provider (or a mock endpoint) to return chunks *without* a `finish_reason` in the final stream chunk.
2. Let the stream run to completion.
3. Check the Sentry dashboard for a warning breadcrumb in the billing category:
   - **Message format**: `Billing calculated with null finishReason for user <user_id>, status: completed`
4. **Acceptance Criteria**: The warning breadcrumb is triggered successfully, but the billing transaction continues normally, and `finishReason` falls back to `stop`.

---

## SEC-06: JWT Expiry Mid-Stream Verification

### Objective
Verify that the edge function periodically checks token validity, attempts validation via `getUserById` if expired, and rejects the connection with a 401 error event on revoked/inactive user sessions.

### Test Case 1: Active Session Expiration Mid-Stream
1. Configure a temporary JWT token with a very short expiration time (e.g. 15 seconds).
2. Initiate a chat stream that takes at least 30 seconds to complete (e.g., requesting a long narrative response).
3. **Acceptance Criteria**: The stream should complete successfully without any client-side disruption. Because the user is still valid and active in the database, the server's call to `getUserById` validates and permits the stream to continue.

### Test Case 2: Banned / Revoked User Mid-Stream
1. Configure a JWT token with a short expiration (e.g. 15 seconds).
2. Initiate a long streaming request.
3. While the stream is actively running and after the token has expired (> 15 seconds elapsed), deactivate or delete the user in the Supabase Auth dashboard.
4. **Acceptance Criteria**:
   - The stream terminates immediately.
   - The client-side logs capture an event-stream error block:
     ```json
     event: error
     data: {"error": "Session expired. Please sign in again.", "code": 401}
     ```
   - The user is signed out on the client page, showing the login screen.
