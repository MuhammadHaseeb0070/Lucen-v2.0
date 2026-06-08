# Phase 2: Structural Decomposition - Research

**Date:** 2026-06-08
**Subsystem:** Service & State Refactoring
**Status:** Completed

---

## 1. Monolithic Decomposition Analysis

### 📁 1.1 Frontend: `src/services/openrouter.ts` (1,771 lines)
* **Goal:** Split this massive file into a directory structure under `src/services/openrouter/` while keeping the original file `src/services/openrouter.ts` as a facade that re-exports all public types and functions (like `streamChat`, `buildContinuationMessages`, etc.).
* **Proposed Sub-modules:**
  1. `src/services/openrouter/messages.ts` — Contains message builders: `buildMessageContent`, `buildApiMessages`, `approxTokens`, `messageCostApprox`, `pruneMessagesForContext`.
  2. `src/services/openrouter/rag.ts` — Contains vector-search retrieval logic: `retrieveRelevantChunks`.
  3. `src/services/openrouter/streaming.ts` — Contains SSE parser and stream reader: `processStream` and auxiliary sanitizers like `sanitizeAssistantOutput`.
  4. `src/services/openrouter/continuation.ts` — Contains token budgeting and loop continuation mechanics: `computeOutputBudget`, `isInsideArtifact`, `isRepeatingLastWindow`, `isLowEntropy`, `hasStructuralRegression`, `buildStructuralSummary`, `buildContinuationMessages`.
  5. `src/services/openrouter/client.ts` — Orchestrates the streaming process, manages retry loops: `streamViaEdgeFunctionWrapper`, `streamViaEdgeFunctionWithInnerCallbacks`, `streamViaEdgeFunction`, and the main export `streamChat`.
* **Facade Re-export:** `src/services/openrouter.ts` will simply look like:
  ```typescript
  export { streamChat } from './openrouter/client';
  export { buildContinuationMessages } from './openrouter/continuation';
  // Re-export any other types needed by components/stores.
  ```

### 📁 1.2 Backend: `supabase/functions/chat-proxy/index.ts` (1,715 lines)
* **Goal:** Split this massive Deno edge function into sub-modules inside its own folder, keeping the `index.ts` as a thin orchestrator.
* **Proposed Sub-modules:**
  1. `supabase/functions/chat-proxy/auth.ts` — Handles JWT decoding, Supabase admin auth verify, and rate-limiting setup: `decodeJwtPayload`, `checkRateLimit`.
  2. `supabase/functions/chat-proxy/billing.ts` — Encapsulates credits check, cost calculations, and credit deduction calls: `computeWebSearchCredits`, `deduct_user_credits` logic.
  3. `supabase/functions/chat-proxy/streamHandler.ts` — Houses the SSE stream forwarding loop, tool call loops, and emergency fallback handlers: `processStream` logic (lines 725-1627).
  4. `supabase/functions/chat-proxy/utils.ts` — Helper methods: `validateModelOutput`, `buildResponseFormatContract`, `countImagesInMessages`, `forceImageDetailLow`, `hasWebPlugin`, `sanitizeDomainList`, `sanitizeWebPlugins`, `detectAttachments`.
  5. `supabase/functions/chat-proxy/index.ts` — Main `Deno.serve` entry point that imports the sub-modules and chains them.
* **Deno Import Resolving:** Uses relative paths (`./auth.ts`, etc.) and imports shared files like `../_shared/cors.ts` correctly. Since Deno handles these relative paths natively, no bundler config is required.

---

## 2. Zustand Store Decoupling (TD-08)

### ⚠️ Current Store Gossip (getState() Calls)
* `authStore.ts` imports `chatStore` and calls `useChatStore.getState().clearChats()`.
* `chatStore.ts` imports `uiStore` and calls `useUIStore.getState().setViewerFile()`.
* `themeStore.ts` imports `authStore` to schedule appearances sync.
* This direct coupling creates a spider web of store dependencies that ruins unit testing isolation.

### 🔌 Refactoring Plan: Centralized `orchestration.ts`
* **File Location:** [src/store/orchestration.ts](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/orchestration.ts)
* **Pattern:** We will use Zustand's `subscribe` (with `subscribeWithSelector` middleware) inside a centralized orchestrator file. Stores will only define their own local states and actions; they will NOT import other stores.
* **Orchestrator Setup:**
  ```typescript
  import { useAuthStore } from './authStore';
  import { useChatStore } from './chatStore';
  import { useThemeStore } from './themeStore';
  
  // Listen to Auth Store sign-out, trigger chat clearing
  useAuthStore.subscribe(
      (state) => state.session,
      (session) => {
          if (!session) {
              useChatStore.getState().clearChats();
              useThemeStore.getState().clearThemeSyncTimer();
          }
      }
  );
  
  // Connect other stores similarly...
  ```
* This decouples the stores completely, allowing them to build and compile in isolation.

---

## 3. Zustand State Versioning & Migrations (TD-09)

* All persisted Zustand stores (`chatStore`, `uiStore`, `creditsStore`, `sideChatStore`) must implement standard versioning and migrate utilities to prevent crashes when new code changes the state structure.
* **Pattern:**
  ```typescript
  export const useChatStore = create()(
      persist(
          (set, get) => ({ ... }),
          {
              name: 'lucen-chat-storage',
              version: 1, // incremental version
              migrate: (persistedState: any, version: number) => {
                  if (version === 0) {
                      // Perform migration steps to version 1
                      // Remove any legacy PII (e.g. email, session info)
                  }
                  return persistedState;
              }
          }
      )
  );
  ```

---

## 4. Structured Logging & Correlation IDs (TD-07)

* **Barcode Tracing Strategy:**
  1. Frontend: In `src/services/openrouter.ts`'s `streamChat`, we will generate a correlation ID `const correlationId = crypto.randomUUID()`.
  2. The ID is stored in the local log action and attached to the HTTP headers of the `fetch` request to `chat-proxy`:
     ```typescript
     headers: {
         'Content-Type': 'application/json',
         'Authorization': `Bearer ${token}`,
         'X-Correlation-ID': correlationId
     }
     ```
  3. Edge Functions: `chat-proxy` and all sibling functions retrieve the header:
     ```typescript
     const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();
     ```
  4. The correlation ID is passed to `createLogger('chat-proxy', { correlationId })` so every logged message in the transaction carries this barcode.
* **Migration:** Refactor all 50+ occurrences of `console.log`, `console.warn`, `console.error` to use `src/lib/logger.ts`.

---

## 5. Performance Memoization (PERF-01, PERF-02, PERF-03)

### 🎨 Theme Fingerprint (PERF-01)
* **Problem:** `buildThemeApplyFingerprint` does `JSON.stringify` on color properties 60 times a second as a user slides the color picker.
* **Fix:** Store the last calculated fingerprint and the last colors object. Before stringifying, do a fast shallow comparison on key color properties. If identical, return the cached string.

### 💬 Component Rendering (PERF-02)
* **Problem:** Streaming chat causes the main chat list component to re-render all elements continuously.
* **Fix:** Apply `React.memo` to `MessageBubble.tsx` using a stable custom comparison function (`prevProps.message.content === nextProps.message.content && prevProps.message.isStreaming === nextProps.message.isStreaming`).

### 🧹 Debug Ring Buffer (PERF-03)
* **Problem:** Dev payload capture logs request/response JSON in memory. Long sessions can leak megabytes.
* **Fix:** Enforce entries in `debugStore` are evicted after 30 minutes (TTL) or when memory exceeds a threshold (e.g. 50 entries cap).

---

## 6. Bug Diagnostics & Fix Strategies

### 🐛 BUG-01 (onDone not called on streaming error)
* In `src/services/openrouter.ts:processStream`, when `reader.read()` rejects or throws an error inside the stream loop, `onError` is fired, but `onDone` is skipped. 
* **Fix:** Wrap the stream loop in a `try...catch...finally` block. Ensure `callbacks.onDone(wasTruncated)` is always invoked in the `finally` block if a stream was successfully started.

### 🐛 BUG-02 (Artifact parser orphaned closing tags)
* `src/lib/artifactParser.ts:INCOMPLETE_TAG_RE` only removes opening `<lucen_artifact...>` tags that are cut off. Sibling closing tags `</lucen_artifact>` or formatting tags (`</head>`, `</li>`) must also be stripped if the opening tag was removed.
* **Fix:** Update parser regex and state machine to recognize when the artifact block is unclosed/incomplete, and strip any trailing orphaned closing tags.

### 🐛 BUG-04 (iframe injectIntoHtml targets incorrect head)
* `src/lib/iframeErrorBridge.ts:injectIntoHtml` searches for `<head[^>]*>` to insert the script but matches `</head>` due to a loose pattern.
* **Fix:** Tighten the regex to match specifically opening tags `/<head\b[^>]*>/i` to ensure the script enters the top of the header block.

### 🐛 BUG-10 (Artifact state reset on focus change)
* In `src/store/artifactStore.ts`, when `focusedArtifactId` changes, the worker/store state isn't reset. Stale console/runner outputs bleed into the next artifact.
* **Fix:** Subscribe to `focusedArtifactId` changes. Clear logs, execution status, and terminate any running workers on change.

### 🐛 BUG-06 (chat-proxy server errorDONE sentinel)
* In `supabase/functions/chat-proxy/index.ts`, when a runtime error occurs in the stream generator, the catch block exits but does not stream a `[DONE]` SSE event, leaving the client in an infinite loop.
* **Fix:** Ensure the stream controller always writes `data: [DONE]\n\n` in the catch/finally blocks of the edge function handler.

---

*Research Completed: 2026-06-08*
