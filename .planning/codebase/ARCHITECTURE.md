## System Architecture

**Last Updated:** 2026-06-15
**Focus Area:** High-Level Design, Architectural Layers, Communication Pipelines, and Data Flow Protocols

---

### 1. Architecture Design Patterns
Lucen is designed around five core architectural patterns:
1. **Client-Sandboxed SPA:** React frontend runs entirely client-side, using web worker sandboxes to perform heavy computational tasks (code compiling, tokenizing, styling) in parallel.
2. **Serverless Backend-for-Frontend (BFF):** All sensitive third-party integrations (payments, search, AI keys, credentials) are wrapped in Supabase Deno Edge Functions. The frontend never exposes secret keys and communicates only with authenticated Supabase gateways.
3. **Zustand-Driven State Management:** Global app state is contained in single-responsibility Zustand stores. Components subscribe to strict slices of store state (`useShallow` selectors) to prevent unnecessary React renders.
4. **Optimistic Updates with Background Synchronization:** Actions (such as messaging, theme switches, workspace changes) update local state immediately for a responsive UI. Database persistence happens in the background via non-blocking async queries.
5. **SSE Stream Orchestration & Batching:** Incoming streams from AI models are parsed line-by-line using Server-Sent Events (SSE). Updates are batched into React state to prevent DOM rendering bottlenecks.

---

### 2. Architectural Layers

```text
       ┌─────────────────────────────────────────────────────────────┐
       │                 USER INTERFACE LAYER (React 19)             │
       │  - Components (Layout, ChatArea, ArtifactWorkspace, etc.)   │
       └──────────────────────────────┬──────────────────────────────┘
                                      │ Subscriptions & Actions
                                      ▼
       ┌─────────────────────────────────────────────────────────────┐
       │                STATE LAYER (13 Zustand Stores)              │
       │  - authStore, chatStore, projectStore, themeStore, etc.     │
       └─────┬────────────────────────┬────────────────────────┬─────┘
             │                        │                        │
             ▼ Background Sync        ▼ Worker Messages        ▼ Direct Calls
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│      SERVICE LAYER      │  │      WORKER LAYER       │  │    DATABASE CLIENT      │
│  - openrouter/          │  │  - pyodide.worker       │  │  - supabase client      │
│  - fileProcessor        │  │  - tokenizer.worker     │  │  - database CRUD        │
│  - checkout             │  │  - highlighter.worker   │  │  - artifactDb CRUD      │
└────────────┬────────────┘  └─────────────────────────┘  └────────────┬────────────┘
             │                                                         │
             ▼ JWT-Auth Requests                                       ▼ RLS Postgres
┌──────────────────────────────────────────────────────────────────────┴────────────┐
│                       BACKEND PROXY & DATA LAYER (Supabase)                       │
│  - Deno Edge Functions (chat-proxy, embed, retrieve-chunks, ls-webhook, etc.)    │
│  - PostgreSQL 17 Database & pgvector (conversations, credit_ledgers, chunks)      │
│  - Storage Buckets (attachments)                                                  │
└───────────────────────────────────────────────────────────────────────────────────┘
```

#### 2.1. User Interface Layer (UI)
* **Location:** [`src/components/`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/components/) (45+ components) and [`src/pages/`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/pages/) (routes).
* **Responsibilities:** Renders the page markup, responds to user actions, and subscribes to Zustand stores.
* **Key Components:**
  * [`src/App.tsx`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/App.tsx): Entry routing and public/private layout branches.
  * [`src/components/Layout.tsx`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/components/Layout.tsx): The main app shell container (sidebar, active workspace, command palette, auth gate).
  * [`src/components/ArtifactWorkspace.tsx`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/components/ArtifactWorkspace.tsx): Renders custom documents and sandbox components within sandboxed iframe blocks.

#### 2.2. State Management Layer (Zustand Stores)
* **Location:** [`src/store/`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/).
* **Responsibilities:** Maintain state machines, manage local storage caching, coordinate actions, and sync modifications in the background.
* **Core Stores:**
  * [`authStore.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/authStore.ts): Enforces user state validation, token renewals, and session caching.
  * [`chatStore.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/chatStore.ts): Message state. Manages stream accumulation, database upsert scheduling (1500ms throttle), and first-turn title generation.
  * [`themeStore.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/themeStore.ts): Client appearance theme state, syncing settings to the server database.
  * [`projectStore.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/projectStore.ts): Sandboxed workspace layouts, folder paths, and file snapshots.
  * [`artifactStore.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/artifactStore.ts): Tracks generated documents, coordinates healing attempts, and saves version modifications.

#### 2.3. Web Worker Layer (Off-Thread CPU Processing)
* **Location:** [`src/workers/`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/).
* **Responsibilities:** Offloads heavy processing from the single-threaded React UI.
* **Workers:**
  * [`pyodide.worker.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/pyodide.worker.ts): Sandboxed WebAssembly Python environment, loading libraries, capturing print output, and saving file systems.
  * [`tokenizer.worker.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/tokenizer.worker.ts): Counts tiktoken string arrays.
  * [`highlighter.worker.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/highlighter.worker.ts): Uses Shiki to highlight code blocks.
  * [`artifactParse.worker.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/artifactParse.worker.ts): Extracts artifact details from text outputs.

#### 2.4. Service Layer (APIs & Utilities)
* **Location:** [`src/services/`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/) and [`src/lib/`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/lib/).
* **Responsibilities:** Implements external client wrappers, database CRUD queries, and file conversion libraries.
* **Core Modules:**
  * [`src/services/openrouter/`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/openrouter/): Segmented client libraries containing `client.ts` (chat stream entry point), `continuation.ts` (auto-continuation loop), `messages.ts` (pruner), `rag.ts` (chunk collector), and `streaming.ts` (SSE parser).
  * [`src/services/fileProcessor.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/fileProcessor.ts): Upload checks and client-side extraction (PDF, DOCX, XLSX, PPTX).

#### 2.5. Serverless Deno Edge Function Layer
* **Location:** [`supabase/functions/`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/functions/).
* **Responsibilities:** Authenticates requests, verifies API credentials, validates user credit ledgers, and handles external APIs.
* **Key Functions:**
  * [`chat-proxy/index.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/functions/chat-proxy/index.ts): Stream controller, handling tool calling and credit deduction.
  * [`ls-webhook/index.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/functions/ls-webhook/index.ts): Event validation for Lemon Squeezy updates.
  * [`embed/index.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/functions/embed/index.ts) & [`retrieve-chunks/index.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/functions/retrieve-chunks/index.ts): RAG embedding and vector database querying.

---

### 3. Core Data Flow Diagrams

#### 3.1. Primary Chat SSE Stream Flow
```text
User Sends Message
  │
  ▼
chatStore.addMessage() ──► Optimistically renders User bubble in UI
  │
  ▼
Gather Context ──► Retrieve files & RAG chunks via /retrieve-chunks (if files exist)
  │
  ▼
Compute Token Budget ──► tokenizer.worker.ts estimates prompt size
  │
  ▼
POST to /chat-proxy Edge Function (With Auth JWT & model IDs)
  │
  ├─► Server checks user credit balance
  │
  ├─► Proxies request to OpenRouter with streaming enabled
  │
  ▼
SSE Chunk Stream back to Client
  │
  ├─► streamChat.onChunk() receives chunk
  ├─► If reasoning token, update separate reasoning UI bubble
  ├─► If content token, parse text and build active message buffer
  │
  ├─► Throttled DB write: updates message content every 1500ms
  │
  ▼
Stream Finishes
  │
  ├─► If finish_reason === 'length', trigger continuation.ts to request next segment
  ├─► Authoritatively save finalized message to DB (isStreaming: false)
  └─► Deduct consumed credit amount in user credit table
```

#### 3.2. Local Sandboxed Python Execution Flow
```text
User triggers Python Run in Artifact Workspace
  │
  ▼
uiStore sends code payload to pyodideWorkerClient.ts
  │
  ▼
pyodide.worker.ts checks CDN access
  │
  ├─► If CDN blocked: Fetch wheels/assets via backend proxy /pyodide-proxy
  └─► If CDN reachable: Fetch directly from jsDelivr
  │
  ▼
Initialize Worker
  │
  ├─► Mount input files (Base64 data written to virtual FS /home/pyodide)
  ├─► Parse dependencies from imports and # pip: headers
  ├─► Install missing wheels via micropip (with automatic name mappings)
  │
  ▼
Execute Script inside Pyodide WASM
  │
  ├─► Redirect stdout/stderr to StreamWrapper
  ├─► Send print logs in real-time to UI using self.emit_stream
  ├─► Apply Matplotlib headless (Agg backend) rendering overrides
  │
  ▼
Scan filesystem for output modifications (xlsx, csv, png, pdf, zip, etc.)
  │
  ├─► Compare filesystem before/after file lists
  └─► Encode new/modified files in Base64 and return them to the UI
```
