## Code Conventions & Guidelines

**Last Updated:** 2026-06-15
**Focus Area:** Coding Standards, State Management Rules, Naming Layouts, and Quality Enforcement

---

### 1. TypeScript Coding Standards
* **Strict Compiler:** The codebase enforces strict type safety via [`tsconfig.app.json`](file:///e:/Lucen/Lucen-v2.3%20fresh/tsconfig.app.json). Avoid `any` types; define structural interfaces or types for all objects.
* **Imports:** Use the `import type` construct when importing syntax interfaces to prevent unnecessary runtime bundle weight:
  ```typescript
  import type { Message, Conversation, Artifact } from '../../types';
  ```
* **Guard Patterns:** Prefer optional chaining (`?.`) and nullish coalescing (`??`) over logical AND (`&&`) shortcuts to prevent printing `0` or `NaN` into page DOM structures.
* **String Union Enums:** Avoid compiling numeric TypeScript Enums to comply with `erasableSyntaxOnly: true`. Use string literal unions instead:
  ```typescript
  export type ResponseMode = 'chat' | 'artifact' | 'inline';
  ```
* **TS Escape Hatches:** Enforce pure functions. Avoid `// @ts-ignore` or `eslint-disable` except in verified cases (such as using UUID generators within render loops using `// eslint-disable-next-line react-hooks/purity`).

---

### 2. React 19 Render Patterns
* **Components:** Functional components are declared using `React.FC` typings:
  ```typescript
  const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => { ... };
  ```
* **Hook Optimization:**
  * **useCallback:** Wrap click handlers or callback methods in `useCallback` when passed as child properties to prevent rendering cascades.
  * **useMemo:** Use `useMemo` to cache heavy calculations (such as derived lists or formatted tables).
  * **useShallow:** When extracting multiple state values from a Zustand store, wrap the selectors in `useShallow` to prevent unnecessary component renders when unrelated state items change:
    ```typescript
    import { useShallow } from 'zustand/react/shallow';
    const { conversations, activeConversationId } = useChatStore(
      useShallow((s) => ({ conversations: s.conversations, activeConversationId: s.activeConversationId }))
    );
    ```
* **Virtualization:** Always implement `@tanstack/react-virtual`'s `useVirtualizer` for scrollable chat listings to keep browser nodes count low.
* **Error Containment:** Wrap features (such as Python executors or artifact sandboxes) in custom React Error Boundaries to prevent a component crash from breaking the entire page layout.

---

### 3. Zustand Global State Store Rules
* **Decoupled Stores:** Single-responsibility stores must handle distinct business context slices (e.g. `themeStore`, `creditsStore`, `artifactStore`).
* **Cross-Store Access:** Stores must never import another store's React hooks to prevent circular rendering locks. For cross-store values, use direct `.getState()` accessor loops within event functions:
  ```typescript
  // Inside chatStore.ts
  const user = useAuthStore.getState().user;
  ```
* **Persistence & Caching:** Stores that cache state to localStorage (via the `persist` middleware) must define a custom `partialize` filter to strip non-serializable variables (e.g., AbortControllers, pending timers, loading states, file blobs):
  ```typescript
  partialize: (state) => ({
    conversations: state.conversations,
    drafts: state.drafts
  })
  ```
* **Hot-Reload Cleanup:** Invocations that open listeners, timers, or threads (such as auth status events or workers) must register teardown hooks inside `import.meta.hot.dispose` blocks to prevent memory leaks during HMR:
  ```typescript
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.removeEventListener('beforeunload', cleanupHandler);
    });
  }
  ```

---

### 4. Naming Guidelines
* **Components:** PascalCase (e.g., `ChatArea.tsx`, `ArtifactRenderer.tsx`, `MessageBubble.tsx`).
* **Pages:** PascalCase with `Page` suffix (e.g., `HomePage.tsx`, `LoginPage.tsx`).
* **Zustand Stores:** Filename is camelCase suffixing `Store` (e.g., `authStore.ts`), but exports a hook prefixed with `use` (e.g., `export const useAuthStore = create...`).
* **Services:** camelCase (e.g., `auth.ts`, `openrouter.ts`, `database.ts`).
* **Workers:** camelCase suffixing `.worker.ts` (e.g., `tokenizer.worker.ts`, `pyodide.worker.ts`). Wrappers use `WorkerClient` suffix.
* **Constants:** UPPER_SNAKE_CASE (e.g., `MIDSTREAM_PERSIST_MS = 1500`, `MAX_TOTAL_UPLOAD_BYTES = 52428800`).
* **Custom Hooks:** camelCase prefixed with `use` (e.g., `useThrottledContent`).

---

### 5. Styling & CSS Conventions
* **Vanilla CSS:** Maintain separation of styles. Custom classes live in [`index.css`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/index.css), [`App.css`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/App.css), [`artifact-hub.css`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/artifact-hub.css), and [`powertools.css`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/powertools.css).
* **CSS Variables:** Color palettes, typography limits, and borders are mapped to variables (e.g. `--bg-base`, `--text-primary`) under the `:root` level to support light and dark theme styling.
* **Layout Classes:** BEM-like class notation is preferred for layout structures (e.g., `chat-area__bubble--assistant`).
* **Dynamic Styling:** Inline style elements (`style={{ ... }}`) are used only for dynamically computed offsets (e.g. window sizes, coordinate positions, and slider percentages) to avoid stylesheet bloating.

---

### 6. Logging, Errors, & Audit Triggers
* **Prefixing:** Prefix console outputs using `[Lucen]` to isolate application logs from external browser plugins:
  ```typescript
  logger.debug('[Lucen][RAG Embed] chunk saved', { chunkId });
  ```
* **Log Levels:** Use the `logger` service which dynamically reads log-level settings (`localStorage.getItem('lucen_log_level')` or `VITE_LOG_LEVEL`) to silence debug statements in production.
* **Audit Tags:** Include specific tags matching tracked items in [`AUDIT_PROGRESS.md`](file:///e:/Lucen/Lucen-v2.3%20fresh/AUDIT_PROGRESS.md) within code comments to link modifications to the audit log:
  ```typescript
  // C1 fix: RAG embedding trigger updated to support assistant messages
  ```
