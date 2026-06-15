## Concerns, Technical Debt, & Risks

**Last Updated:** 2026-06-15
**Focus Area:** Known Risks, Tech Debt, Performance Bottlenecks, and Security Boundaries

---

### 1. High-Priority Performance Concerns

#### 1.1. Rendering Thrashing from SSE Streams
* **File Reference:** [`src/store/chatStore.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/chatStore.ts)
* **Risk:** High-frequency Server-Sent Events (SSE) token chunks (such as fast Gemini or Claude outputs) can overload the browser's render loop if React state updates on every incoming token.
* **Current Mitigation:** The store uses `MIDSTREAM_PERSIST_MS = 1500` to throttle database upsert operations. However, frontend visual rendering still subscribes directly to message updates.
* **Debt:** Visual rendering relies on React re-reconciling lists. Although virtualized using `useVirtualizer`, the message rendering cycle needs deep optimization (such as requestAnimationFrame throttling or off-store character buffers) to prevent browser input lag.

#### 1.2. Client-Side Document Parsing RAM Usage
* **File Reference:** [`src/services/fileProcessor.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/fileProcessor.ts)
* **Risk:** Parsing 30MB+ Word documents (`mammoth`), PDFs (`pdfjs-dist`), and Excel spreadsheets (`xlsx`) client-side inside the browser tab consumes substantial CPU and memory.
* **Impact:** Can cause browser tab crashes or device lockups on low-spec mobile clients.
* **Debt:** All parsing operations run synchronously on the main thread.
* **Remediation:** Move parsing libraries (specifically Mammoth and ExcelJS) into a background Web Worker (similar to `pyodide.worker.ts`) to keep the UI thread responsive during uploads.

#### 1.3. Pyodide WASM Overhead & Network Proxy Fallbacks
* **File Reference:** [`src/workers/pyodide.worker.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/pyodide.worker.ts)
* **Risk:** Pyodide requires downloading a ~10MB WASM payload and allocating 200MB+ of browser memory, causing slow page loads.
* **Network Failures:** In environments with strict CORS policies or firewalls blocking raw jsDelivr CDNs, the worker falls back to loading files through the Supabase edge function proxy ([`supabase/functions/pyodide-proxy/index.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/functions/pyodide-proxy/index.ts)).
* **Impact:** Multiplies backend bandwidth consumption, increasing Deno Edge Function execution costs.

---

### 2. Architectural Smells & Code Debt

#### 2.1. Monolithic State Stores
* **File Reference:** [`src/store/chatStore.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/chatStore.ts) and [`src/store/themeStore.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/themeStore.ts)
* **Debt:** [`chatStore.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/chatStore.ts) (900 lines) contains local database persistence, search filtering, optimistic updates, title generation requests, and message state. Similarly, [`themeStore.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/themeStore.ts) (over 700 lines) houses 37KB of hardcoded color configuration objects.
* **Remediation:** Split color constants into a separate configuration file, and refactor search actions out of `chatStore.ts` into a dedicated store.

#### 2.2. Web Search Option Clutter
* **File Reference:** [`supabase/functions/chat-proxy/index.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/functions/chat-proxy/index.ts)
* **Debt:** Web search parameters destructured from the request body use three different keys: `web_search_enabled`, `webSearchEnabled`, and `enableWebSearch`.
* **Impact:** Developers must maintain all three options in sync, increasing code complexity and the risk of api failures if the client sends the wrong key.

---

### 3. Reliability & Security Risks

#### 3.1. Auto-Continuation Infinite Loop Risk
* **File Reference:** [`src/services/openrouter/continuation.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/openrouter/continuation.ts)
* **Risk:** The auto-continuation feature recursively calls OpenRouter models when they hit token limits (`finish_reason = length`).
* **Impact:** Loop detection filters (like low-entropy or string repeats checks) prevent endless runs, but bugs in these checks could result in infinite loops, draining API keys and user credit balances.
* **Mitigation:** Ensure strict ceilings (such as maximum continuation passes) are enforced on every stream.

#### 3.2. Server-Side Observability Gaps
* **File Reference:** [`supabase/functions/`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/functions/)
* **Risk:** While the frontend logs errors to Sentry, server-side Deno Edge Functions lack structured log aggregation and correlation IDs.
* **Impact:** Tracking down bugs across multi-step transactions (such as checkout webhooks or credits deductions) requires manually searching text streams in the Supabase console, increasing debugging times.
* **Debt:** Implement correlation IDs across all Edge Function requests to easily trace requests end-to-end.
