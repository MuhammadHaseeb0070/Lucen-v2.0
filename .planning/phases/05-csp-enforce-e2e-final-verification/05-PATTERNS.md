# Phase 5 — Pattern Mapping

## Codebase Analogs

### Playwright E2E Tests
- **Target File:** `tests/e2e/core.test.ts`
- **Existing Analog:** `tests/e2e/smoke.test.ts`
- **Key Pattern:** Playwright E2E test scripts utilizing `page.route` to mock APIs.
```typescript
import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Lucen/);
});
```

### Sandbox and Warning Notice
- **Target File:** `src/components/ArtifactRenderer.tsx`
- **Existing Analog:** `src/components/ArtifactRenderer.tsx` (the `HtmlRenderer` subcomponent)
- **Key Pattern:** Configuring `iframe` sandbox attributes.
```tsx
<iframe
  srcDoc={srcdoc}
  sandbox="allow-scripts"
  title="Artifact Preview"
  className="w-full h-full border-0"
/>
```

### Sentry Logger Integration
- **Target File:** `src/lib/logger.ts`
- **Existing Analog:** `src/lib/logger.ts`
- **Key Pattern:** Custom console logging wrapper.
```typescript
import * as Sentry from '@sentry/react';

Sentry.addBreadcrumb({
  category: 'logger',
  message: '[Lucen] message',
  level: 'warning',
});
```
