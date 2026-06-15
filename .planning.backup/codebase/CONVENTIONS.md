# Code Conventions

**Last updated:** 2026-06-08

## Style

**Formatting:**
- No Prettier or automatic formatter configured (no `.prettierrc`, `.editorconfig`, or `biome.json` found). Code formatting is manual.
- Linting via ESLint 9.x with flat config (`eslint.config.js`).
- Semicolons: used consistently across all files (99% of statements end with `;`).
- Quotes: double quotes (`"`) preferred for JSX/TSX attributes, single quotes (`'`) for JavaScript strings. Both are used interchangeably.
- Indentation: 2 spaces (default Vite/TS project setup).
- Trailing commas: used consistently in multiline objects and arrays.
- Line wrapping: soft limit around 100-120 characters. No hard enforcement.

**Linting rules** (`eslint.config.js`):
```js
// Extends:
// - @eslint/js recommended
// - typescript-eslint recommended
// - eslint-plugin-react-hooks recommended (flat)
// - eslint-plugin-react-refresh (Vite)
```
- `react-refresh/only-export-components` enforced (Vite HMR rule).
- React Hooks rules strictly enforced (`react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`).
- TypeScript strict mode enabled via `tsconfig.app.json`:
  - `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`.
  - `verbatimModuleSyntax: true` — type imports MUST use `import type`.
  - `erasableSyntaxOnly: true` — no enums, no namespaces, no parameter properties.
  - `noUncheckedSideEffectImports: true`.

**Special patterns observed:**
- `// eslint-disable-next-line react-hooks/purity` used on `uuidv4()` calls inside render bodies (e.g., `ChatArea.tsx` line 541, 553) as a pragmatic escape hatch since UUID generation is idempotent enough for the use case.
- `// @ts-ignore` used sparingly (e.g., `ChatArea.tsx` line 84) to suppress minor TypeScript strictness.

## Naming

**Files:**
- Components: PascalCase, e.g., `ChatArea.tsx`, `ArtifactRenderer.tsx`, `MessageBubble.tsx`.
- Services: camelCase, e.g., `auth.ts`, `openrouter.ts`, `database.ts`.
- Stores: camelCase with `Store` suffix in filename but not in export, e.g., `authStore.ts` exports `useAuthStore`.
- Config: short meaningful names, e.g., `models.ts`, `pricing.ts`, `prompts.ts`.
- Workers: camelCase with `.worker.ts` suffix, e.g., `tokenizer.worker.ts`, `highlighter.worker.ts`.
- Worker clients: camelCase with `WorkerClient` suffix, e.g., `highlighterWorkerClient.ts`.
- Lib utilities: camelCase, e.g., `stringUtil.ts`, `errorMessages.ts`.
- Types/type definitions: `index.ts` inside `types/` directory.
- Pages: PascalCase with `Page` suffix, e.g., `HomePage.tsx`, `LoginPage.tsx`.
- Page sub-routes: nested in subdirectory, e.g., `pages/Auth/LoginPage.tsx`.

**Functions:**
- React components: PascalCase (`const ChatArea: React.FC = () => { ... }`).
- Custom hooks: camelCase with `use` prefix, e.g., `useThrottledContent`, `useDebounceValue`.
- Regular functions: camelCase, e.g., `sanitizeMinimaxTags`, `parseArtifacts`, `getUserFriendlyError`.
- Store actions: camelCase, e.g., `createConversation`, `addMessage`, `clearChats`.

**Variables:**
- Local variables: camelCase, e.g., `activeConversationId`, `isMessageLoading`.
- Constants: UPPER_SNAKE_CASE, e.g., `MIDSTREAM_PERSIST_MS`, `STREAM_IDLE_TIMEOUT_MS`, `SYNC_DEBOUNCE_MS`.
- Module-level mutable state: camelCase, e.g., `initPromise`, `syncInFlight`, `syncTimer`.

**Types/Interfaces:**
- Interfaces: PascalCase with no prefix, e.g., `Conversation`, `Message`, `Artifact`, `ModelInfo`.
- Type aliases: PascalCase, e.g., `ArtifactType`, `GenerationStatus`, `ResponseMode`.
- Const assertion types: PascalCase, e.g., `ThemeSolidColorKey`, `ThemeAlphaColorKey`.
- Tuple types: PascalCase, e.g., `export const CHAT_SIZE_STEPS = [0.92, 0.96, 1, 1.06, 1.12] as const`.

## TypeScript Patterns

**Type imports (`verbatimModuleSyntax`):**
- Type-only imports use `import type` syntax:
```typescript
import type { Artifact, ArtifactType } from '../types';
import type { AppUser } from '../services/auth';
import type { User as SupabaseUser } from '@supabase/supabase-js';
```

**Interface over type:**
- Interfaces preferred for object shapes (`interface AuthStore { ... }`).
- Type aliases used for unions, tuples, and computed types.

**Const assertions:**
- Used for arrays that define valid choices:
```typescript
export const CHAT_SIZE_STEPS = [0.92, 0.96, 1, 1.06, 1.12] as const;
export const CHAT_SIZE_LABELS = ['Smaller', 'Small', 'Default', 'Large', 'Larger'] as const;
```

**Satisfies keyword:**
- Used for config arrays to enforce type membership:
```typescript
export const THEME_SOLID_COLOR_KEYS = [
    'bgBase', 'bgSurface', ...
] as const satisfies readonly (keyof ThemeColors)[];
```

**Optional chaining and nullish coalescing:**
- `?.` and `??` used consistently over `&&` guards for optional access.
```typescript
const title = (titleRaw?.trim() || filename || 'Artifact').trim();
const m = attrs.match(re);
return m?.[1];
```

**Destructuring:**
- Prevalent in store subscriptions and function parameters.
```typescript
const { createConversation, addMessageLocal, ... } = useChatStore(...);
```

**Generics:**
- Used on Zustand stores and React hooks (e.g., `useState<string | null>(null)`).

**No enums:**
- String literal unions used instead (enforced by `erasableSyntaxOnly: true`):
```typescript
export type ArtifactType = 'html' | 'svg' | 'mermaid' | 'file';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';
```

**No namespaces:**
- Module-scoped constants and helper functions used instead.

**Module-level mutable state:**
- Used for singletons and caches:
  - `src/lib/supabase.ts`: `_cachedSession` boolean for session state.
  - `src/services/outputBudget.ts`: Module-level `mainConfig`/`sideConfig` objects.
  - `src/store/authStore.ts`: `initPromise`, `syncInFlight`, `syncTimer`, `authSubscription`.
  - `src/store/chatStore.ts`: `midstreamState`, `titleGenInFlight`.
  - `src/store/themeStore.ts`: `syncDebounceTimer`, `lastThemeApplyFingerprint`.
- Pattern includes cleanup functions exposed for HMR (`disposeAuthStore`, `clearThemeSyncTimer`).

## React Patterns

**Component structure:**
- Functional components with `React.FC` type annotation:
```typescript
const ChatArea: React.FC = () => { ... };
```

**Hooks:**
- `useEffect`, `useRef`, `useCallback`, `useMemo`, `useState`, `useDeferredValue` from React.
- `useShallow` from `zustand/react/shallow` for optimizing Zustand selector re-renders.
- `useVirtualizer` from `@tanstack/react-virtual` for virtualized chat message lists.
- `useRef` used extensively for: DOM element refs, abort controllers, refs to avoid stale closures.

**Store subscriptions:**
- Individual selectors for single-value reads:
```typescript
const activeConversationId = useChatStore((s) => s.activeConversationId);
```
- `useShallow` wrapper for multi-value selects:
```typescript
const { createConversation, addMessageLocal, ... } = useChatStore(
    useShallow((s) => ({ ... }))
);
```
- Direct store access via `.getState()` in event handlers and background tasks:
```typescript
useChatStore.getState().clearChats();
```

**Performance patterns:**
- `useCallback` for all event handlers passed as props.
- `useMemo` for expensive computations (derived data, sorted lists).
- `useDeferredValue` for deferring heavy list reconciliation during streaming.
- `useRef` + ref forwarding for virtualizer scroll elements.
- Inline styles used for dynamic values (avoiding CSS class generation overhead).

**Error boundaries:**
- `Component` class used for error boundaries:
```typescript
class ErrorBoundary extends Component<{...}, {...}> { ... }
```
Found in `ArtifactRenderer.tsx` with a class-based error boundary component.

**Stream / real-time patterns:**
- `AbortController` for stream cancellation.
- `setInterval` for batching streaming updates (50ms flush window).
- `setTimeout` for debounced DB writes (`MIDSTREAM_PERSIST_MS = 1500`).
- `requestAnimationFrame` for scroll-driven UI updates.

**CSS/styling:**
- CSS imported via `import './App.css'` (traditional CSS files, no CSS modules).
- CSS custom properties used extensively (theme colors via `--bg-base`, `--text-primary`, etc.).
- Inline `style={{}}` objects for dynamic values.
- `className` strings with BEM-like naming (e.g., `chat-search-bar--open`, `pin-marker-tooltip-edit`).

**File structure per component:**
- Components are single `.tsx` files combining markup and logic.
- Services, stores, and config are separate `.ts` files.

## State Management (Zustand)

**Store creation pattern:**
```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ExampleStore {
    value: string;
    setValue: (v: string) => void;
}

export const useExampleStore = create<ExampleStore>()(
    persist(
        (set, get) => ({
            value: '',
            setValue: (value) => set({ value }),
        }),
        {
            name: 'lucen-example-storage',
            partialize: (state) => ({
                // Only persist specific fields
                value: state.value,
            }),
        }
    )
);
```

**Persistence patterns:**
- `zustand/middleware` `persist` used in stores that need localStorage.
- `partialize` function to strip non-serializable or transient state.
- `version` field in persist config for migrations.
- `onRehydrateStorage` callback for post-hydration side effects (e.g., `applyThemeFromStore()` in `themeStore.ts`).

**Cross-store communication:**
- Stores import each other's `.getState()` directly (e.g., `chatStore.ts` imports `creditsStore` and `themeStore`).
- Pattern: `useOtherStore.getState().actionName()` in event handlers and callbacks.
- Stores do NOT import hooks from each other — only `.getState()` for imperative access.

**Module-level cleanup for HMR:**
- Event listeners tracked and removed on HMR dispose:
```typescript
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        window.removeEventListener('beforeunload', _beforeUnloadHandler);
    });
}
```
- Exported cleanup functions: `disposeAuthStore()`, `clearThemeSyncTimer()`.

## Error Handling

**Patterns:**
1. **User-friendly error messages** (`src/lib/errorMessages.ts`):
   - Central `getUserFriendlyError()` function maps technical errors to clean strings.
   - Categories: TypeError/null, 500, 401, 402, timeout, network, 429, 503.
   - Default fallback: "Something went wrong. Please try again."

2. **Fire-and-forget with `.catch(console.error)`**:
   - Async operations that shouldn't block the UI:
   ```typescript
   db.deleteConversation(id).catch(console.error);
   db.upsertStreamingMessage(convId, msg).catch((err) =>
       console.warn('[Midstream] flush failed:', err)
   );
   ```

3. **Try/catch in async store actions**:
   - Wrapping Supabase calls and other fallible operations.
   - Error string returned to caller for display.

4. **Error state in stores**:
   - `error: string | null` field in store interfaces.
   - `clearError()` action exposed.

5. **Defensive guards**:
   - `if (!supabase) return;` pattern for optional Supabase configuration.
   - `if (!isSupabaseEnabled()) return STUB_USER;` pattern for local-only mode.

6. **Console.warn for non-fatal issues**:
   - Used for graceful degradation messages (e.g., RAG embed failures, title generation errors).

## Logging

**Framework:** Custom `logger` object (`src/lib/logger.ts`).

**Log levels:** `debug`, `info`, `warn`, `error`, `none`.
- Default: `debug` in development, `warn` in production.
- Configurable via `localStorage.setItem('lucen_log_level', level)` or `VITE_LOG_LEVEL` env var.

**Patterns:**
```typescript
logger.debug('[ModelConfig] Loaded from backend:', { mainConfig, sideConfig });
logger.warn('[Sync] Error saving message to Supabase:', err);
```
- All logs prefixed with `[Lucen]` tag.
- Module-specific tags used: `[Midstream]`, `[chat-title]`, `[ModelConfig]`, `[Sync]`, `[RAG Embed]`.

**Raw console.*** usage:**
- `console.warn`, `console.error`, `console.debug` used directly in many places alongside the logger.
- `console.warn` used for non-fatal issues (e.g., "ModelConfig failed to fetch from backend").

## Comments

**When to comment:**
- Complex logic: regex patterns, stream flushing strategies, edge case handling.
- Bug fixes: always include issue reference (e.g., `// C3 fix: ...`, `// H2 fix: ...`).
- File headers: block comments at top explaining file purpose (`// ===== Supabase Auth ====`).
- Performance notes: why a specific approach was chosen (`// 50ms interval replaces per-frame RAF`).

**JSDoc/TSDoc:**
- Used for exported functions with complex behavior:
```typescript
/**
 * Parse artifact tags from AI response content.
 * Returns clean conversational text and extracted artifact objects.
 * ...
 */
export function parseArtifacts(...): ParseResult { ... }
```
- Used for interface fields with non-obvious meaning:
```typescript
/**
 * True while title is auto-managed by the title generator.
 * Flips to false after any manual rename so AI never overrides user intent.
 */
titleAuto?: boolean;
```

**Fix annotations:**
- Systematic pattern throughout the codebase: `// C1:`, `// C2:`, `// H1:`, `// H5:`, `// M12:` etc., referencing the audit tracking IDs in `AUDIT_PROGRESS.md`.

## Imports

**Order:**
1. External dependencies (React, Zustand, libraries).
2. Internal components (`../components/`).
3. Internal services/stores (`../store/`, `../services/`, `../config/`).
4. Internal types (`../types`).
5. CSS files (`./App.css`).

**No path aliases:**
- Relative imports only (e.g., `../../store/authStore`), no `@/` alias configured.

## Module Design

**Exports:**
- Default exports for components (`export default ChatArea;`).
- Named exports for utilities, services, stores (`export const supabase`, `export function parseArtifacts`).
- Mixed default + named exports in some modules (`src/lib/supabase.ts`).

**Barrel files:**
- `src/types/index.ts` exports all type definitions.
- No barrel index files in other directories.

**File sizes:**
- Some files are very large (noted as architectural concerns):
  - `src/store/chatStore.ts`: ~885 lines — stores + persistence + business logic.
  - `src/components/ChatArea.tsx`: ~1403 lines — component with streaming, search, pinning, forking.
  - `src/store/themeStore.ts`: ~959 lines — data + logic + persistence.
  - `src/lib/artifactParser.ts`: ~235 lines — pure parsing logic (well-scoped).
  - `src/services/openrouter.ts`: 72KB (noted in audit as monolithic concern).

---

*Convention analysis: 2026-06-08*