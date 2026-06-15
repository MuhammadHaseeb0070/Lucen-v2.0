## Testing Strategy & Frameworks

**Last Updated:** 2026-06-15
**Focus Area:** Unit Testing, E2E Testing, Coverage Metrics, and CI/CD Verification Commands

---

### 1. Testing Philosophy & Objectives
Lucen enforces a dual testing strategy combining unit tests and automated browser tests:
1. **Unit & Integration Tests (Vitest):** Validate standalone utility scripts, store actions, token budgeting formulas, and text/artifact parsers.
2. **End-to-End Tests (Playwright):** Validate full user flows (such as authentication, chat streams, billing page actions, layout scaling, and workspaces) on simulated browser runtimes.
3. **Environment Isolation:** Local tests run against mock APIs or interface directly with Vercel and Supabase dev/staging environments, as databases do not run locally.

---

### 2. Unit & Integration Testing (Vitest)
* **Framework:** **Vitest** (v1.6.0) utilizing a Virtual DOM browser environment configured through **jsdom** (v24.0.0).
* **Execution Script:** `npm run test` (mapped in `package.json` to `vitest run --coverage`).
* **Coverage Collection:** Managed via `@vitest/coverage-v8` (v1.6.0). The project enforces the following coverage thresholds:
  * **Lines:** 50% minimum coverage.
  * **Branches:** 40% minimum coverage.
  * **Functions:** 45% minimum coverage.
  * **Statements:** 50% minimum coverage.
* **Test Placements:** Unit test files are colocated next to the target scripts they validate:
  * [`src/store/authStore.test.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/authStore.test.ts): Validates store changes, login loops, and session expirations.
  * [`src/store/creditsStore.test.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/creditsStore.test.ts): Verifies ledger consumption logic and balances.
  * [`src/store/themeStore.test.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/themeStore.test.ts): Checks custom color themes mapping and persistence checks.
  * [`src/services/fileProcessor.test.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/fileProcessor.test.ts): Validates file type checks, size limit triggers, text extraction, and deduplication logic.

---

### 3. End-to-End Testing (Playwright)
* **Framework:** **Playwright** (v1.44.0) configured in [`playwright.config.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/playwright.config.ts).
* **Execution Script:** `npm run e2e` (mapped to `playwright test`).
* **Location:** E2E test files are grouped within [`tests/e2e/`](file:///e:/Lucen/Lucen-v2.3%20fresh/tests/e2e/).
* **Active E2E Suites:**
  * [`tests/e2e/smoke.test.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/tests/e2e/smoke.test.ts): Smoke test checking home page loads, routing stability, and page metadata titles matching `/Lucen/`.
  * [`tests/e2e/core.test.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/tests/e2e/core.test.ts): Validates the entire user flow: inputting credentials, opening the dashboard, sending chat prompt strings, starting reasoning and text stream updates, loading files, extracting context, opening the code workspace panel, and verifying iframe DOM renders.

---

### 4. Code Quality & Verification Pipeline
Before merging or deploying modifications, compile-time validation is performed using the following steps:
1. **TypeScript Verification:** Run `npx tsc -b` or `npx tsc --noEmit` to verify type checker constraints.
2. **ESLint Static Code Checks:** Run `npm run lint` (runs `eslint .` via [`eslint.config.js`](file:///e:/Lucen/Lucen-v2.3%20fresh/eslint.config.js)) to check hook rules, HMR listeners, and formatting guidelines.
3. **Vitest Unit Coverage:** Run `npm run test` to check unit tests.
4. **Vite Production Bundling:** Run `npm run build` (runs `tsc -b && vite build`) to compile resources and output static files into the `dist/` folder, ensuring the code builds without errors.
