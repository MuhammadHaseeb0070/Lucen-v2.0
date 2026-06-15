## Directory Structure & Code Layout

**Last Updated:** 2026-06-15
**Focus Area:** Repository Directory Mapping, Module Boundaries, and Component Placement

---

### 1. Root Level Directory Map
* **[`src/`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/)**: Root source folder containing all client-side React 19 UI, Zustand state stores, Web Workers, client API utilities, and application configuration.
* **[`supabase/`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/)**: Backend logic containing Deno Edge Functions and database migration files.
* **[`tests/`](file:///e:/Lucen/Lucen-v2.3%20fresh/tests/)**: Testing suite, organized into subfolders:
  * [`tests/e2e/`](file:///e:/Lucen/Lucen-v2.3%20fresh/tests/e2e/): Playwright integration tests (such as [`smoke.test.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/tests/e2e/smoke.test.ts) and [`core.test.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/tests/e2e/core.test.ts)).
* **[`public/`](file:///e:/Lucen/Lucen-v2.3%20fresh/public/)**: Static frontend assets, configuration manifests, and preload files.
* **[`docs/`](file:///e:/Lucen/Lucen-v2.3%20fresh/docs/)**: Developer guidelines and system walkthroughs.
* **[`.planning/`](file:///e:/Lucen/Lucen-v2.3%20fresh/.planning/)**: GSD workflow lifecycle tracking folder, holding active state logs and codebase maps.

---

### 2. Frontend Source Layout (`src/`)

```text
src/
├── components/          # Reusable UI elements (Chat, Sidebar, Workspace)
│   └── react-workspace/ # Iframe layout components and renderer code
├── pages/               # Top-level Page Views (HomePage, LoginPage, etc.)
├── store/               # 13 Global Zustand State Stores & test logs
├── services/            # Client APIs, File Processor, & OpenRouter pipelines
│   └── openrouter/      # Streaming client, continuations, and messages pruner
├── workers/             # Web Workers (Pyodide compiler, Shiki highlighter, etc.)
├── lib/                 # Core singletons, loggers, and parsing helpers
├── config/              # Model configurations and prompt contracts
├── types/               # TypeScript interfaces and global schemas
├── App.tsx              # App router configuration and auth gate mapping
├── main.tsx             # Sentry initializer and React DOM mount setup
├── App.css              # App styling
├── index.css            # 210KB variables mapping
├── artifact-hub.css     # Public gallery styling
└── powertools.css       # Utility styles
```

#### 2.1. `src/store/` (Zustand Stores)
Central state controller layer of the application.
* [`authStore.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/authStore.ts): Directs user authentication states, login/logout, OTP validation, and background syncer timer loops.
* [`chatStore.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/chatStore.ts): 42KB store managing message lists, optimistic text rendering, throttled DB writes, and title generators.
* [`themeStore.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/themeStore.ts): 38KB store defining client styles, color palettes, and server appearance updates.
* [`projectStore.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/projectStore.ts): Tracks workspace session states, filesystem folders, and snapshots.
* [`artifactStore.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/artifactStore.ts): Artifact instances, healing logs, and version edits.
* **Other Stores:** `uiStore.ts`, `creditsStore.ts`, `sideChatStore.ts`, `tokenStore.ts`, `debugStore.ts`, `diagnosticsStore.ts`, `composerStore.ts`, `workspaceSessionStore.ts`.

#### 2.2. `src/services/` (Client API Services)
Handles integration business logic and data access.
* [`openrouter/`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/openrouter/): Segregated OpenRouter client layers:
  * [`client.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/openrouter/client.ts): Orchestrates `streamChat`, fetching RAG elements, computing token budgets, and invoking the proxy.
  * [`continuation.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/openrouter/continuation.ts): Continuation conditions, low-entropy checks, and repetition filters.
  * [`messages.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/openrouter/messages.ts): Message format mapper and message list pruner.
  * [`rag.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/openrouter/rag.ts): Retrievable context vector matching.
  * [`streaming.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/openrouter/streaming.ts): Server-Sent Events chunk extraction and stream router.
* [`fileProcessor.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/fileProcessor.ts): 24KB file processing layer. Employs parsing engines (PDF, Word, Excel, PPT) and limits total combined upload sizes (50MB total, 30MB per non-image document) and content lengths.
* [`database.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/database.ts): Database CRUD queries for tables like `conversations` and `messages`.
* [`checkout.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/checkout.ts): Lemon Squeezy payment flows.

#### 2.3. `src/workers/` (Web Workers)
* [`pyodide.worker.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/pyodide.worker.ts) & [`pyodideWorkerClient.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/pyodideWorkerClient.ts): Initializes the local browser Python WASM console, intercepts network fetches to route through backend proxies, installs custom package wheels, and returns base64 files.
* [`tokenizer.worker.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/tokenizer.worker.ts): Tiktoken wrapper to count token arrays off the React render thread.
* [`highlighter.worker.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/highlighter.worker.ts) & [`highlighterWorkerClient.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/highlighterWorkerClient.ts): Async code styling using Shiki.
* [`artifactParse.worker.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/artifactParse.worker.ts) & [`artifactParseWorkerClient.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/artifactParseWorkerClient.ts): Extracts code segments and visual layouts from stream outputs.

#### 2.4. `src/lib/` (Utilities)
* [`supabase.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/lib/supabase.ts): Client client setup, handles session validation.
* [`logger.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/lib/logger.ts): Logger class prefixing `[Lucen]` logs with configurable log levels.
* [`stringUtil.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/lib/stringUtil.ts): Cleaners and parsers.

---

### 3. Backend Source Layout (`supabase/`)

```text
supabase/
├── migrations/         # 36 SQL DB schema files (RLS, vectors, credit tables)
├── functions/          # Deno Edge Functions
│   ├── _shared/        # Shared code (JWT decoders, CORS headers, tools registry)
│   ├── chat-proxy/     # AI request router, tools executor, and billing deductions
│   ├── embed/          # Chunk embed logic for RAG
│   ├── retrieve-chunks/# Similarity vector searching
│   ├── ls-webhook/     # Lemon Squeezy payment verification webhooks
│   ├── pyodide-proxy/  # Custom asset routes for Pyodide assets
│   ├── web-search/     # Tavily browser search proxy
│   ├── describe-image/ # Image vision proxy
│   └── ...             # classify-intent, get-file-content, get-model-config, etc.
└── config.toml         # Supabase docker setup ports configuration
```
