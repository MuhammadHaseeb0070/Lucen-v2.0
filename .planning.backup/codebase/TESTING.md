# Testing

**Last updated:** 2026-06-08

## Framework

**Status: No test framework installed.**

The project has zero test dependencies in `package.json`:
- No Vitest, Jest, Playwright, Cypress, or any test runner.
- No test config files (`vitest.config.ts`, `jest.config.ts`, etc.).
- No `test` script in `package.json` scripts.

**Run Commands:**
```bash
npm run dev          # Start dev server (only available command)
npm run build        # Build (tsc + vite)
npm run lint         # ESLint
npm run preview      # Preview production build
```

No test commands exist.

## Test File Organization

**No test files found anywhere in the codebase:**
- Zero `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx` files.
- Zero `__tests__/` directories.
- Zero `*.test.js` or `*.spec.js` files.

**Root-level Python scripts (not actual tests):**
- `test_pyodide_script.py` — A test/scaffold script for Pyodide WASM-based Python execution, generates a personal finance Excel workbook using openpyxl/pandas. Not a unit or integration test.
- `test_pyodide_script2.py` — Presumably similar purpose (not a real test file).

These are Pyodide execution test scripts, not automated test files.

## Mocking Strategy

**Not applicable** — no test framework or test suite exists.

The codebase has no mocks, stubs, spies, or test fixtures of any kind. The closest patterns to "test harness" are:
- Local-only mode fallbacks (`STUB_USER` in `auth.ts`, `null` Supabase client) which serve as a manual development aid, not a testing mechanism.
- The `localStorage` persistence of Zustand stores, which enables manual QA by inspecting stored state.

## Coverage

**Not enforced.** No coverage tools configured.

No coverage targets, no coverage reports, no Istanbul/V8 instrumentation.

## Current Testing Gaps

From `AUDIT_PROGRESS.md` (Section 7 — Architecture Smells, item #10):

> **No end-to-end tests** — Not a single test file found. Everything is manual testing.

Known risks from the audit:

| Risk | Impact |
|------|--------|
| No regression tests | Every code change risks breaking existing functionality — no safety net |
| No CI test gate | Build passes type check + lint, but any runtime regression goes undetected |
| 72KB `openrouter.ts` untestable | Monolithic architecture makes unit testing impractical |
| 45KB `chatStore.ts` untestable | Mixes persistence, streaming, state, and business logic |
| No integration tests for edge functions | 12 Supabase Edge Functions with no automated verification |
| No E2E for critical paths | Auth flow, chat streaming, credit deduction, artifact generation all manual |

## Recommended Test Strategy

Based on the project's current state and architecture, the following test areas should be prioritized:

### 1. Unit Tests (highest priority utilities)
Files well-suited for unit testing:
- `src/lib/artifactParser.ts` — Pure function `parseArtifacts()` with clear inputs/outputs. Regex-heavy edge cases.
- `src/lib/errorMessages.ts` — Pure function `getUserFriendlyError()` with deterministic output per error type.
- `src/lib/stringUtil.ts` — Pure function `sanitizeMinimaxTags()` with clear regex patterns.
- `src/lib/iframeErrorBridge.ts` — Pure utility functions (if any).
- `src/lib/artifactPatchParser.ts` — Patch parsing logic.

### 2. Store/State Unit Tests
Zustand stores can be tested by calling actions directly:
- `src/store/authStore.ts` — Test signIn/signUp/verifyOtp flows with mock Supabase client.
- `src/store/chatStore.ts` — Test conversation CRUD, message ordering, pinning, forking logic.
- `src/store/artifactStore.ts` — Test artifact lifecycle, version management.

### 3. Component Tests
React components with clear rendering logic:
- `src/components/MessageBubble.tsx` — Render variations (user vs assistant, streaming, error, etc.).
- `src/components/ArtifactRenderer.tsx` — Content rendering, throttling, error states.

### 4. Integration Tests
- Edge function requests/responses (chat-proxy, embed, web-search, classify-intent).
- Auth flow (signup -> OTP -> session -> signout).
- Chat streaming pipeline (send message -> stream response -> persist).

### Recommended Tools
- **Vitest** — Already compatible with Vite project, minimal config overhead.
- **React Testing Library** + **jsdom** — For component tests.
- **@testing-library/user-event** — For user interaction simulation.
- **MSW (Mock Service Worker)** — For API mocking during integration tests.
- **Playwright** — For E2E browser testing of critical paths.

---

*Testing analysis: 2026-06-08*