# Phase 1: Foundation + Finance-Critical Fixes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-08
**Phase:** 01-foundation-finance-critical-fixes
**Areas discussed:** Bug fix implementation details, Test framework configuration, Shared types integration pattern, Manual verification documentation format

---

## Bug fix implementation details

| Option | Description | Selected |
|--------|-------------|----------|
| Add Sentry breadcrumb + assign finishReason in all paths | Centralized billing function Sentry breadcrumbs & finishReason assignment | ✓ |
| Assign finishReason only | Just assign finishReason without breadcrumbs | |
| Attempt refresh, continue stream | refresh JWT mid‑stream; if refresh succeeds, continue the stream; otherwise reject with 401 | ✓ |
| Reject with 401, frontend retries | don't refresh mid-stream, just reject | |
| Yes, add unit tests after test infrastructure ready | Add unit tests for fixes | ✓ |

**User's choice:** Explicit decisions to add Sentry breadcrumbs in centralized billing, assign finishReason on all paths, refresh JWT mid-stream using Supabase Auth API, and write unit tests once Vitest is set up.

---

## Test framework configuration

| Option | Description | Selected |
|--------|-------------|----------|
| Extend vite.config.ts with test property | Keeps config unified in vite.config.ts | ✓ |
| Separate vitest.config.ts | Dedicated Vitest configuration file | |
| Enforce as CI gates (fail if not met) | Fail the build if Vitest coverage thresholds are not met | ✓ |
| Set as thresholds but warning only | Allow build to pass even if thresholds aren't met | |
| *.test.ts files alongside source | Place test files next to source files | ✓ |
| tests/e2e, Chromium only | Playwright e2e tests in tests/e2e running on Chromium only | ✓ |

**User's choice:** Unified Vite configuration, coverage threshold enforcement as CI gate, *.test.ts files alongside source, and Chromium-only Playwright E2E tests in tests/e2e directory.

---

## Shared types integration pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Use supabase/functions/import_map.json to map 'shared/' path to '../../src/shared/' | Mapping 'shared/' path to '../../src/shared/' in import_map.json so both frontend and Deno edge functions import directly | ✓ |
| Write a sync script to automatically copy src/shared to supabase/functions/_shared/types | Automated copy on build/deploy | |
| Use a symlink under supabase/functions/_shared/types pointing to src/shared | Symlink-based import | |

**User's choice:** Use supabase/functions/import_map.json to map the 'shared/' path to '../../src/shared/' so both front-end and Deno edge functions can import it directly.

---

## Manual verification documentation format

| Option | Description | Selected |
|--------|-------------|----------|
| Centralized VERIFICATION.md file in the phase's planning directory | .planning/phases/01-foundation-finance-critical-fixes/VERIFICATION.md detailing exact manual steps | ✓ |
| Inline checklist inside the final walkthrough.md artifact | List manual verification steps at the end of the phase's walkthrough | |
| Standardized manual verification scripts under a tests/manual/ directory | Dedicated manual test files | |

**User's choice:** Centralized VERIFICATION.md file in the phase's planning directory (.planning/phases/01-foundation-finance-critical-fixes/) detailing exact steps.

---

## Claude's Discretion

None — all decisions were explicit user choices.

## Deferred Ideas

None — discussion stayed within phase scope.

---

*Phase: 01-foundation-finance-critical-fixes*
*Discussion log generated: 2026-06-08*
