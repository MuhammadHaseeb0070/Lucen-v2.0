# Architecture

**Analysis Date:** 2026-06-08

## System Overview

**Architecture Pattern:** Client-heavy SPA (React + Vite) with serverless backend (Supabase Edge Functions in Deno) and PostgreSQL database (Supabase). The frontend owns all rendering, routing, and state management. The backend is a thin BFF layer -- edge functions handle AI proxying, credit management, payments, embeddings, and web search. The frontend communicates with backend exclusively through Supabase client SDK and direct HTTPS calls to edge function endpoints.

```text
+--------------------------------------------------------------------+
|                       Browser (React 19 SPA)                        |
|  +------------------+  +-------------------+  +------------------+  |
|  |  Marketing Pages |  |  Main Chat App    |  |  React Workspace |  |
|  |  (public routes) |  |  (/chat/*)        |  |  (sandboxed)     |  |
|  +------------------+  +--------+----------+  +------------------+  |
|                                  |                                  |
|  Zustand Stores (12 stores)      |  Web Workers (4)                |
|  auth, chat, ui, artifact,   ....|....  tokenizer, artifactParse,  |
|  credits, theme, sideChat,       |     highlighter                 |
|  token, debug, diagnostics,      |                                  |
|  project, composer, workspace    |                                  |
+----------------------------------+----------------------------------+
                                   |
         Supabase SDK (JWT auth)   |  Direct HTTPS (edge functions)
           +-----------------------v--------------------------+
           |              Supabase Platform                    |
           |  +--------------------+  +---------------------+ |
           |  | PostgreSQL (DB)    |  | Edge Functions (Deno)| |
           |  | - conversations    |  | - chat-proxy (AI)   | |
           |  | - messages         |  | - embed (RAG)       | |
           |  | - user_credits     |  | - retrieve-chunks   | |
           |  | - artifacts        |  | - classify-intent   | |
           |  | - usage_logs       |  | - deduct-credits    | |
           |  | - file_attachments |  | - generate-title    | |
           |  | - credit_ledgers   |  | - ls-checkout       | |
           |  | - document_chunks  |  | - ls-webhook        | |
           |  | + pgvector         |  | - web-search        | |
           |  +--------------------+  | - describe-image    | |
           |                          | - get-file-content  | |
           |                          | - get-model-config  | |
           |                          +---------------------+ |
           +--------------------------------------------------+
                                   |
                         +---------v----------+
                         |  External Services  |
                         |  - OpenRouter (AI)  |
                         |  - Tavily (search)  |
                         |  - Lemon Squeezy    |
                         |    (payments)       |
                         |  - Sentry (errors)  |
                         +--------------------+
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| `App.tsx` | Root component, React Router setup, auth initialization | `src/App.tsx` |
| `Layout` | Authenticated app shell: Navbar, Sidebar, ChatArea, ArtifactWorkspace | `src/components/Layout.tsx` |
| `MarketingLayout` | Public pages shell (header/footer for marketing pages) | `src/components/MarketingLayout.tsx` |
| Chat Area | Main conversation rendering, composed of ChatArea (not explicitly listed but rendered inside Layout) | `src/components/Layout.tsx` (line 124) |
| `ArtifactWorkspace` | Side panel displaying rendered artifacts (HTML/SVG/Mermaid previews) | `src/components/ArtifactWorkspace.tsx` |
| `openrouter.ts` | Chat streaming orchestrator: RAG retrieval, context pruning, SSE streaming, auto-continuation | `src/services/openrouter.ts` |
| `database.ts` | Supabase data access layer for conversations and messages | `src/services/database.ts` |
| `artifactDb.ts` | Supabase data access layer for artifacts, votes, comments | `src/services/artifactDb.ts` |
| `fileProcessor.ts` | Client-side file parsing (PDF, DOCX, XLSX, PPTX, images) | `src/services/fileProcessor.ts` |
| `supabase.ts` | Singleton Supabase client, session helpers | `src/lib/supabase.ts` |

## Pattern Overview

**Overall:** Component-Service-Store pattern. State is managed in Zustand stores (immutable updates via `set()`). Business logic lives in services. UI rendering is React components. Backend communication goes through edge functions called either via `supabase.functions.invoke()` or direct `fetch()` to the function URL.

**Key Characteristics:**
- **State in stores, not components:** All shared state lives in Zustand stores, not React useState/useReducer. Components subscribe to slices of store state.
- **Optimistic UI with background sync:** Local state updates immediately; Supabase sync happens asynchronously in the background, with error logging but no UI blocking.
- **Stream-first architecture:** AI responses stream via SSE through chat-proxy edge function; frontend processes chunks as they arrive with 16ms batching to prevent render thrashing.
- **Serverless backend (backend-for-frontend pattern):** Edge functions handle all API key management, credit enforcement, and external service calls; frontend never holds sensitive credentials.
- **Web Workers for CPU-intensive work:** Token counting, artifact parsing, and syntax highlighting run in dedicated workers to avoid blocking the main thread.

## Layers

**Presentation Layer (React Components):**
- Purpose: Renders UI, handles user interactions, subscribes to stores
- Location: `src/components/`, `src/pages/`
- Contains: React components with JSX markup, CSS files
- Depends on: Stores (for state), Services (for business logic), lib (for utilities)
- Used by: React Router in `App.tsx`

**State Layer (Zustand Stores):**
- Purpose: Single source of truth for all application state. Provides actions for mutation.
- Location: `src/store/`
- Contains: 13 Zustand stores -- `authStore.ts`, `chatStore.ts`, `uiStore.ts`, `artifactStore.ts`, `creditsStore.ts`, `themeStore.ts`, `sideChatStore.ts`, `tokenStore.ts`, `debugStore.ts`, `diagnosticsStore.ts`, `projectStore.ts`, `composerStore.ts`, `workspaceSessionStore.ts`
- Depends on: Services (database, auth, openrouter, etc.), lib (supabase client)
- Used by: Components, other stores (via `getState()` cross-store calls)

**Service Layer:**
- Purpose: Business logic, API calls, data access
- Location: `src/services/`
- Contains: `database.ts` (Supabase CRUD), `openrouter.ts` (AI streaming), `auth.ts` (auth service), `fileProcessor.ts` (file parsing), `artifactDb.ts` (artifact CRUD), `checkout.ts` (payment), `userSettings.ts`, `outputBudget.ts`, `artifactVersionDb.ts`, workspace services
- Depends on: `src/lib/supabase.ts` (client singleton), external APIs
- Used by: Stores, sometimes components directly

**Library/Utility Layer:**
- Purpose: Shared utilities, client initialization, config
- Location: `src/lib/`, `src/config/`
- Contains: `supabase.ts` (client), `stringUtil.ts`, `logger.ts`, `errorMessages.ts`, `searchHighlight.tsx`, `fileIconUtil.ts`, `artifactPatchParser.ts`, `artifactPatcher.ts`, `iframeErrorBridge.ts`; config files: `models.ts`, `admin.ts`, `pricing.ts`, `credits.ts`, `subscriptionConfig.ts`, `prompts.ts`
- Depends on: NPM packages
- Used by: All other layers

**Types Layer:**
- Purpose: Shared TypeScript type definitions
- Location: `src/types/`
- Contains: `index.ts` (Message, Conversation, Artifact, ModelInfo, etc.), `workspace.ts`
- Used by: All other layers

**Worker Layer (Web Workers):**
- Purpose: Offload CPU-intensive operations off the main thread
- Location: `src/workers/`
- Contains: `tokenizer.worker.ts`, `artifactParse.worker.ts`, `highlighter.worker.ts`, plus client wrappers: `artifactParseWorkerClient.ts`, `highlighterWorkerClient.ts`
- Depends on: NPM packages (js-tiktoken, shiki)

**Backend Layer (Supabase Edge Functions):**
- Purpose: Serverless API endpoints running on Deno
- Location: `supabase/functions/`
- Contains: `chat-proxy/index.ts` (AI proxy), `embed/index.ts` (RAG embeddings), `retrieve-chunks/index.ts` (vector search), `classify-intent/index.ts`, `deduct-credits/index.ts`, `generate-title/index.ts`, `ls-checkout/index.ts`, `ls-webhook/index.ts`, `web-search/index.ts`, `describe-image/index.ts`, `get-file-content/index.ts`, `get-model-config/index.ts`, shared utilities in `_shared/`
- Depends on: Supabase secrets (OPENROUTER_API_KEY, TAVILY_API_KEY, etc.)

**Database Layer (PostgreSQL + pgvector):**
- Purpose: Data persistence with row-level security
- Location: `supabase/migrations/` (36 migration files)
- Key tables: conversations, messages, user_credits, credit_ledgers, usage_logs, artifacts, artifact_votes, artifact_comments, file_attachments, document_chunks, user_settings, webhook_events
- Key features: pgvector extension for 768-dimension embeddings, SECURITY DEFINER functions for credit mutations

## Data Flow

### Primary Chat Message Flow

1. User types message and clicks send in `MessageInput` (`src/components/MessageInput.tsx`)
2. If files are attached, `fileProcessor.ts` (`src/services/fileProcessor.ts`) extracts text client-side (PDF via pdfjs, DOCX via mammoth, XLSX via SheetJS, PPTX via JSZip)
3. Extracted text is embedded via POST to `/functions/v1/embed` which splits into chunks, calls OpenRouter embedding, and stores vectors in `document_chunks` table
4. `openrouter.ts:streamChat()` (`src/services/openrouter.ts`, line 502) is called:
   a. Retrieves RAG chunks via POST to `/functions/v1/retrieve-chunks` (cosine similarity search)
   b. Builds API messages via `buildApiMessages()` (system prompts, templates, runtime context, vision notice)
   c. Prunes message history to fit context window via `pruneMessagesForContext()`
   d. Computes output budget via `computeOutputBudget()` using precise token counting
   e. POSTs to `/functions/v1/chat-proxy` with JWT auth (the actual OpenRouter API key stays server-side)
5. `chat-proxy` edge function streams SSE events back:
   - `tool_activity` events for tool calls (web_search, analyze_image, process_file)
   - `content_start` event signaling model transition (e.g., after tool calls)
   - Standard OpenAI-style SSE chunks with delta.content and delta.reasoning
6. Frontend `processStream()` (`src/services/openrouter.ts`, line 1267) reads SSE chunks:
   - Routes reasoning chunks to either thinking box (onReasoning) or main content (onChunk) based on `treatReasoningAsContent` flag
   - Routes content chunks to onChunk callback
   - Detects truncation (finish_reason === 'length') for auto-continuation
7. `chatStore.updateMessage()` batches incoming chunks at 16ms intervals to prevent render thrashing
8. On stream end: final message persisted to Supabase, credits deducted server-side, title auto-generated for new conversations

### Auth Flow

1. App initialization: `authStore.initialize()` checks for existing Supabase session
2. Signup: `supabase.auth.signUp()` sends OTP email, user verifies via `OtpVerifyScreen`
3. Login: `supabase.auth.signInWithPassword()` establishes JWT session
4. Session maintenance: `authStore` listens to `onAuthStateChange`; token refreshed before each edge function call
5. Edge function auth: JWT sent as `Authorization: Bearer <token>`, function calls `supabase.auth.getUser(jwt)` for verification
6. Sign-out clears all local store state to prevent cross-tab data leakage

### Artifact Streaming Flow

1. Model generates `<lucen_artifact>` delimited content in its response stream
2. Frontend detects artifact boundaries in streaming chunks via regex
3. Artifact content is parsed in `artifactParse.worker.ts` and rendered in `ArtifactWorkspace`
4. On stream completion, artifact is saved to Supabase via `artifactDb.ts`
5. Artifact supports versioning via `artifactVersionDb.ts` -- each patch creates a new version in the lineage
6. Runtime errors from rendered iframes are captured via `iframeErrorBridge.ts` and surfaced for auto-healing

### Payment/Credit Flow

1. User initiates purchase from `PricingModal` or `PackagesPage`
2. `checkout.ts:startCheckout()` calls `ls-checkout` edge function which creates a Lemon Squeezy checkout session
3. After successful payment, `ls-webhook` edge function processes the Lemon Squeezy webhook:
   - Validates webhook signature
   - Grants credits via `grant_subscription_credits` SQL function (SECURITY DEFINER, FIFO via credit_ledgers)
   - Records in `webhook_events` for idempotency
4. Frontend detects `subscription_updated` URL parameter, triggers `creditsStore.syncWithRetry()`

## Key Abstractions

**Zustand Stores (13 stores):**
- Purpose: Immutable state containers with action methods. Some persisted to localStorage via `zustand/middleware/persist`.
- Examples: `src/store/authStore.ts`, `src/store/chatStore.ts`, `src/store/uiStore.ts`, `src/store/artifactStore.ts`, `src/store/creditsStore.ts`, `src/store/themeStore.ts`
- Pattern: `create<StoreType>()(persist((set, get) => ({ ...state, ...actions }), { name: 'storage-key', partialize: ... }))`
- Cross-store communication: via `useXStore.getState()` or direct imports between stores

**Supabase Client Singleton:**
- Purpose: Single `createClient()` instance shared across the app
- Location: `src/lib/supabase.ts`
- Pattern: Module-level export with null fallback; `isSupabaseEnabled()` gate for local-only mode; cached session state for synchronous checks

**Edge Function Proxy Pattern:**
- Purpose: All external API calls go through Supabase Edge Functions to keep API keys server-side
- Pattern: Frontend calls `POST /functions/v1/{name}` with JWT auth; function verifies JWT, calls external API, returns result
- Key example: `openrouter.ts` calls `chat-proxy` edge function, never directly calls OpenRouter

**Stream Processing Pipeline:**
- Purpose: Handle streaming AI responses with multiple event types
- Pattern: `streamChat()` -> `streamViaEdgeFunctionWrapper()` (continuation loop with retry) -> `streamViaEdgeFunctionWithInnerCallbacks()` (network error classification) -> `streamViaEdgeFunction()` (HTTP fetch) -> `processStream()` (SSE line parsing with event type routing)

**Message Persistence Strategy:**
- Purpose: Reliable message storage during streaming without DB hammering
- Pattern: Optimistic local update + background remote persist with throttled mid-stream writes (MIDSTREAM_PERSIST_MS=1500ms), sendBeacon flush on tab close/visibility change, authoritative write on stream end

## Entry Points

**Application Entry Point:**
- Location: `src/main.tsx`
- Triggers: Browser loads index.html -> Vite loads main.tsx
- Responsibilities: Initialize Sentry error monitoring, mount React app into `#root` DOM node

**Router Entry Point:**
- Location: `src/App.tsx`
- Triggers: React mounts
- Responsibilities: Sets up React Router with BrowserRouter, defines route tree:
  - Public marketing routes (under `MarketingLayout`): `/`, `/about`, `/contact`, `/packages`, `/login`, `/signup`, `/terms`, `/privacy`, `/refund`
  - Authenticated app routes: `/chat`, `/chat/*` (under `Layout`)
  - Auth sub-routes: `/auth/verify-otp`, `/auth/reset-password`

**Authenticated App Shell:**
- Location: `src/components/Layout.tsx`
- Triggers: User navigates to `/chat`
- Responsibilities: Auth gate (shows AuthScreen if no user), admin view detection, renders Navbar, Sidebar, ChatArea/AdminDashboard, ArtifactWorkspace, SideChatPanel, SettingsScreen, PricingModal, FileLibrary, AttachmentViewer, ArtifactHub, CommandPalette

**Chat Stream Entry Point:**
- Location: `src/services/openrouter.ts` (function `streamChat`, line 502)
- Triggers: User sends a chat message
- Responsibilities: Orchestrates the entire AI chat pipeline -- RAG retrieval, context pruning, model message building, SSE streaming, auto-continuation

## Module Boundaries

**Frontend vs. Backend:**
- Frontend owns: rendering, routing, state management, client-side file processing, SSE stream parsing, artifact preview rendering
- Backend (edge functions) owns: AI model proxy, API key management, credit enforcement, embeddings/vector search, web search, payment processing, image description, user settings
- Contract: Edge functions receive JWT-authenticated requests from frontend, return JSON responses or SSE streams

**Store vs. Component:**
- Stores own: state shape, mutation logic, persistence config, cross-store orchestration
- Components own: rendering, event handlers (calling store actions), local UI-only state (modals, dropdowns)

**Service vs. Store:**
- Services own: data access (database CRUD), external API calls, file processing logic
- Stores own: state containers that call services, coordinate multiple service calls, manage loading/error states

**Worker vs. Main Thread:**
- Workers own: token counting (tokenizer.worker.ts), artifact parsing (artifactParse.worker.ts), syntax highlighting (highlighter.worker.ts)
- Main thread owns: everything else; communicates with workers via postMessage

## Architectural Constraints

- **Threading:** Single-threaded React main thread with 3+ dedicated Web Workers for CPU-intensive work. Edge functions run on Deno (single-threaded per invocation, async I/O).
- **Global state:** Module-level singletons in `src/lib/supabase.ts` (Supabase client), `src/store/chatStore.ts` (midstreamState Map, titleGenInFlight Set), `src/store/authStore.ts` (initPromise, syncInFlight). Some stores expose dispose/cleanup functions for HMR.
- **Circular imports:** Avoided by design -- types import nothing, services import lib only, stores import services, components import stores. Cross-store calls use `getState()` accessor pattern.
- **API key isolation:** OpenRouter, Tavily, Lemon Squeezy API keys exist only in Supabase secrets (server-side). Frontend uses only Supabase URL + anon key (safe behind RLS).

## Anti-Patterns

### Cross-Store Coupling via getState()

**What happens:** Stores directly import and call `useOtherStore.getState().someAction()` (e.g., `authStore.ts` imports `useChatStore` and `useCreditsStore`; `chatStore.ts` imports `useTokenStore`)
**Why it's wrong:** Creates implicit dependency chains -- changing one store's API can break another store at runtime rather than at compile time. Makes reasoning about state changes harder.
**Do this instead:** Dispatch through shared events or a pub/sub mechanism. Or keep cross-store sync confined to a single orchestration layer (e.g., the `syncDataOnLogin()` function in `authStore.ts`).

### Module-Level Mutable State

**What happens:** Several files use module-level variables for caches/debounce state (`midstreamState` Map in `chatStore.ts`, `titleGenInFlight` Set, `_cachedSession` boolean in `supabase.ts`)
**Why it's wrong:** Module state persists across HMR reloads but is not part of React's lifecycle. Tests must manually reset it. It creates hidden state that's easy to forget to clean up.
**Do this instead:** Move ephemeral state into Zustand stores or use React refs. When module state is necessary (like debounce timers), expose explicit `dispose()`/`reset()` functions (as done in `authStore.ts` with `disposeAuthStore()`).

### Mixed Concerns in openrouter.ts (1700+ lines)

**What happens:** `src/services/openrouter.ts` contains: RAG retrieval, message building, context pruning, token budget calculation, SSE streaming, auto-continuation logic, repetition detection, structural regression checks, streaming state machine, and watchdog timeout management -- all in a single file.
**Why it's wrong:** Single file is 1700+ lines with 15+ functions, many with complex control flow. Hard to reason about, test, or modify without regressions.
**Do this instead:** Split into focused modules: `ragService.ts`, `contextBuilder.ts`, `sseParser.ts`, `continuationEngine.ts`, `streamClient.ts`.

## Error Handling

**Strategy:** Multi-layered -- errors are caught at each abstraction boundary, logged with console, and surfaced to user via callbacks or UI state.

**Patterns:**
- SSE streaming errors: Caught in `processStream()`, delivered via `callbacks.onError(msg)`, classified as retryable vs. non-retryable
- Network retry: 3 attempts with exponential backoff in `streamViaEdgeFunctionWrapper()` (line 987)
- Watchdog timeout: 30s idle timeout kills stuck streams, triggers continuation loop
- Store action errors: Logged with `console.error`, rarely surfaced to user (fire-and-forget pattern)
- Edge function errors: HTTP status codes parsed; 401 triggers session expiry UI

## Cross-Cutting Concerns

**Logging:** `console.log/warn/error` throughout. `src/lib/logger.ts` exists. No structured logging library used.
**Validation:** TypeScript compile-time validation via strict mode (`noUnusedLocals`, `noUnusedParameters`, `strict: true`). Runtime validation is minimal -- edge function responses are parsed with try/catch.
**Authentication:** Supabase Auth with JWT. `authStore` manages session lifecycle. Edge functions verify JWT via `supabase.auth.getUser()`.

---

*Architecture analysis: 2026-06-08*