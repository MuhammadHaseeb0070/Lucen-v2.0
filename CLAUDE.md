<!-- GSD:project-start source:PROJECT.md -->

## Project

**Lucen v2.3 — Stabilization Milestone**

A stabilization pass on Lucen v2.3 — an AI chat SPA (React 19 + Vite + Supabase). The product is already live, the user works on the `dev` branch daily, and pushes to production via Vercel + Supabase. This milestone exists to fix every concern documented in `.planning/codebase/CONCERNS.md` and finish the Phase 5 production hardening that the Phase 1–4 audit deferred, without breaking the dev/prod flow the user relies on.

**Core Value:** Ship a secure, performant, and well-tested version of Lucen that the user can deploy with confidence — every known concern resolved, every regression guarded.

### Constraints

- **No local dev environment:** The user does not run `supabase start` or `vite` locally. All verification must work against `tsc -b`, `eslint`, and `vite build` for compile-time checks; runtime checks are done by the user on the deployed Vercel + Supabase dev environment.
- **Test infrastructure is greenfield:** There is no Vitest, Jest, or Playwright in `package.json` today. The first phase of this milestone must add them.
- **Single-language project:** TypeScript everywhere — frontend (`src/`) and edge functions (`supabase/functions/`) both target TypeScript. No Python, no Go.
- **Vite SPA, not SSR:** No Next.js migration. No server components.
- **No test infrastructure migration to a different runner:** If we add Vitest, it stays Vitest. If we add Playwright, it stays Playwright. No framework-shopping.
- **API key isolation:** OpenRouter, Tavily, Lemon Squeezy keys must stay server-side. Frontend never holds these.
- **Deployment:** Pushes to `dev` go to Vercel preview + Supabase dev. When the user is happy, `dev` → `main` triggers prod.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- TypeScript 5.9 — entire frontend (`.ts`, `.tsx`) and all Supabase Edge Functions (`.ts`). Single-language project.
- CSS — Three stylesheets in `src/`: `index.css`, `artifact-hub.css`, `powertools.css`
- HTML — `index.html` entry point with CSP headers

## Runtime

- Browser-based SPA (no SSR). Runs on Vite dev server or Vercel static deploy.
- Deno runtime (via Supabase Edge Functions). All Edge Functions import from `https://deno.land/std@0.168.0/http/server.ts` and `https://esm.sh/@supabase/supabase-js@2`.
- Managed by project. `@types/node` ^24.10.1 in devDependencies.
- npm (lockfile: `package-lock.json` present)

## Frameworks

- React 19.2 with React DOM
- React Router DOM 7.13 (client-side routing via `App.tsx`)
- Zustand 5.0 (state management — 10 stores in `src/store/`)
- Vite 7.3 (bundler + dev server)
- `@vitejs/plugin-react` 5.1
- TypeScript compilation via `tsc -b`
- Not detected (no Jest, Vitest, or Playwright in dependencies; no test files found)

## Key Dependencies

- `js-tiktoken` ^1.0.21 — token counting in Web Worker (`src/workers/tokenizer.worker.ts`) using `cl100k_base` encoding
- `shiki` ^4.0.2 — code syntax highlighting in Web Worker (`src/workers/highlighter.worker.ts`)
- `@supabase/supabase-js` ^2.98.0 — database, auth, storage, Edge Function invocation
- `react-markdown` ^10.1.0 — markdown rendering in `MarkdownRenderer.tsx`
- `remark-gfm` ^4.0.1 — GitHub-flavored markdown
- `remark-math` ^6.0.0 — math notation
- `rehype-katex` ^7.0.1 — KaTeX rendering
- `rehype-mathjax` ^7.1.0 — MathJax fallback
- `better-react-mathjax` ^3.0.0 — interactive math
- `rehype-raw` ^7.0.0 — raw HTML passthrough
- `rehype-sanitize` ^6.0.0 — HTML sanitization
- `react-syntax-highlighter` ^16.1.0 — code blocks
- `mermaid` ^11.13.0 — diagram rendering
- `pdfjs-dist` ^5.5.207 — PDF parsing in `fileProcessor.ts`
- `mammoth` ^1.11.0 — DOCX conversion
- `xlsx` ^0.18.5 — Excel/CSV parsing
- `jszip` ^3.10.1 — archive handling
- `lucide-react` ^0.575.0 — icon library
- `@tanstack/react-virtual` ^3.13.24 — virtualized lists
- `lenis` ^1.1.18 — smooth scrolling
- `uuid` / `@types/uuid` ^13.0.0 / ^10.0.0 — ID generation
- `@sentry/react` ^10.56.0 — error tracking and performance monitoring (initialized in `src/main.tsx`)

## Dev Dependencies

- `eslint` ^9.39.1 with `@eslint/js` — linting via `eslint.config.js`
- `eslint-plugin-react-hooks` ^7.0.1
- `eslint-plugin-react-refresh` ^0.4.24
- `typescript` ~5.9.3
- `typescript-eslint` ^8.48.0
- `globals` ^16.5.0
- `@types/react` ^19.2.7, `@types/react-dom` ^19.2.3
- `@types/node` ^24.10.1

## Build & Bundling

## Configuration

- Root `tsconfig.json` — references `tsconfig.app.json` and `tsconfig.node.json`
- `tsconfig.app.json` — `src/` compilation (ES2022, DOM lib, bundler resolution)
- `tsconfig.node.json` — `vite.config.ts` only (ES2023, Node types)
- `eslint.config.js` — flat config using `@eslint/js`, `typescript-eslint`, `react-hooks`, `react-refresh`
- Globals: browser
- `.env.example` — placeholder (redirects to `vercel.env.example` and `supabase.env.example`)
- `vercel.env.example` — frontend env vars (VITE_ prefix)
- `supabase.env.example` — Edge Function secrets reference
- `supabase/.env.dev` — actual local dev secrets
- `supabase/.env.prod` — production secrets (existence noted)
- `supabase/config.toml` — API port 54321, DB port 54322 (Postgres 17), Studio port 54323
- Edge Functions `chat-proxy` and `deduct-credits` have `verify_jwt = false`

## Package Manager

- npm
- Lockfile: `package-lock.json` (large, committed)

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Style

- No Prettier or automatic formatter configured (no `.prettierrc`, `.editorconfig`, or `biome.json` found). Code formatting is manual.
- Linting via ESLint 9.x with flat config (`eslint.config.js`).
- Semicolons: used consistently across all files (99% of statements end with `;`).
- Quotes: double quotes (`"`) preferred for JSX/TSX attributes, single quotes (`'`) for JavaScript strings. Both are used interchangeably.
- Indentation: 2 spaces (default Vite/TS project setup).
- Trailing commas: used consistently in multiline objects and arrays.
- Line wrapping: soft limit around 100-120 characters. No hard enforcement.
- `react-refresh/only-export-components` enforced (Vite HMR rule).
- React Hooks rules strictly enforced (`react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`).
- TypeScript strict mode enabled via `tsconfig.app.json`:
- `// eslint-disable-next-line react-hooks/purity` used on `uuidv4()` calls inside render bodies (e.g., `ChatArea.tsx` line 541, 553) as a pragmatic escape hatch since UUID generation is idempotent enough for the use case.
- `// @ts-ignore` used sparingly (e.g., `ChatArea.tsx` line 84) to suppress minor TypeScript strictness.

## Naming

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
- React components: PascalCase (`const ChatArea: React.FC = () => { ... }`).
- Custom hooks: camelCase with `use` prefix, e.g., `useThrottledContent`, `useDebounceValue`.
- Regular functions: camelCase, e.g., `sanitizeMinimaxTags`, `parseArtifacts`, `getUserFriendlyError`.
- Store actions: camelCase, e.g., `createConversation`, `addMessage`, `clearChats`.
- Local variables: camelCase, e.g., `activeConversationId`, `isMessageLoading`.
- Constants: UPPER_SNAKE_CASE, e.g., `MIDSTREAM_PERSIST_MS`, `STREAM_IDLE_TIMEOUT_MS`, `SYNC_DEBOUNCE_MS`.
- Module-level mutable state: camelCase, e.g., `initPromise`, `syncInFlight`, `syncTimer`.
- Interfaces: PascalCase with no prefix, e.g., `Conversation`, `Message`, `Artifact`, `ModelInfo`.
- Type aliases: PascalCase, e.g., `ArtifactType`, `GenerationStatus`, `ResponseMode`.
- Const assertion types: PascalCase, e.g., `ThemeSolidColorKey`, `ThemeAlphaColorKey`.
- Tuple types: PascalCase, e.g., `export const CHAT_SIZE_STEPS = [0.92, 0.96, 1, 1.06, 1.12] as const`.

## TypeScript Patterns

- Type-only imports use `import type` syntax:
- Interfaces preferred for object shapes (`interface AuthStore { ... }`).
- Type aliases used for unions, tuples, and computed types.
- Used for arrays that define valid choices:
- Used for config arrays to enforce type membership:
- `?.` and `??` used consistently over `&&` guards for optional access.
- Prevalent in store subscriptions and function parameters.
- Used on Zustand stores and React hooks (e.g., `useState<string | null>(null)`).
- String literal unions used instead (enforced by `erasableSyntaxOnly: true`):
- Module-scoped constants and helper functions used instead.
- Used for singletons and caches:
- Pattern includes cleanup functions exposed for HMR (`disposeAuthStore`, `clearThemeSyncTimer`).

## React Patterns

- Functional components with `React.FC` type annotation:
- `useEffect`, `useRef`, `useCallback`, `useMemo`, `useState`, `useDeferredValue` from React.
- `useShallow` from `zustand/react/shallow` for optimizing Zustand selector re-renders.
- `useVirtualizer` from `@tanstack/react-virtual` for virtualized chat message lists.
- `useRef` used extensively for: DOM element refs, abort controllers, refs to avoid stale closures.
- Individual selectors for single-value reads:
- `useShallow` wrapper for multi-value selects:
- Direct store access via `.getState()` in event handlers and background tasks:
- `useCallback` for all event handlers passed as props.
- `useMemo` for expensive computations (derived data, sorted lists).
- `useDeferredValue` for deferring heavy list reconciliation during streaming.
- `useRef` + ref forwarding for virtualizer scroll elements.
- Inline styles used for dynamic values (avoiding CSS class generation overhead).
- `Component` class used for error boundaries:
- `AbortController` for stream cancellation.
- `setInterval` for batching streaming updates (50ms flush window).
- `setTimeout` for debounced DB writes (`MIDSTREAM_PERSIST_MS = 1500`).
- `requestAnimationFrame` for scroll-driven UI updates.
- CSS imported via `import './App.css'` (traditional CSS files, no CSS modules).
- CSS custom properties used extensively (theme colors via `--bg-base`, `--text-primary`, etc.).
- Inline `style={{}}` objects for dynamic values.
- `className` strings with BEM-like naming (e.g., `chat-search-bar--open`, `pin-marker-tooltip-edit`).
- Components are single `.tsx` files combining markup and logic.
- Services, stores, and config are separate `.ts` files.

## State Management (Zustand)

- `zustand/middleware` `persist` used in stores that need localStorage.
- `partialize` function to strip non-serializable or transient state.
- `version` field in persist config for migrations.
- `onRehydrateStorage` callback for post-hydration side effects (e.g., `applyThemeFromStore()` in `themeStore.ts`).
- Stores import each other's `.getState()` directly (e.g., `chatStore.ts` imports `creditsStore` and `themeStore`).
- Pattern: `useOtherStore.getState().actionName()` in event handlers and callbacks.
- Stores do NOT import hooks from each other — only `.getState()` for imperative access.
- Event listeners tracked and removed on HMR dispose:
- Exported cleanup functions: `disposeAuthStore()`, `clearThemeSyncTimer()`.

## Error Handling

## Logging

- Default: `debug` in development, `warn` in production.
- Configurable via `localStorage.setItem('lucen_log_level', level)` or `VITE_LOG_LEVEL` env var.
- All logs prefixed with `[Lucen]` tag.
- Module-specific tags used: `[Midstream]`, `[chat-title]`, `[ModelConfig]`, `[Sync]`, `[RAG Embed]`.
- `console.warn`, `console.error`, `console.debug` used directly in many places alongside the logger.
- `console.warn` used for non-fatal issues (e.g., "ModelConfig failed to fetch from backend").

## Comments

- Complex logic: regex patterns, stream flushing strategies, edge case handling.
- Bug fixes: always include issue reference (e.g., `// C3 fix: ...`, `// H2 fix: ...`).
- File headers: block comments at top explaining file purpose (`// ===== Supabase Auth ====`).
- Performance notes: why a specific approach was chosen (`// 50ms interval replaces per-frame RAF`).
- Used for exported functions with complex behavior:
- Used for interface fields with non-obvious meaning:
- Systematic pattern throughout the codebase: `// C1:`, `// C2:`, `// H1:`, `// H5:`, `// M12:` etc., referencing the audit tracking IDs in `AUDIT_PROGRESS.md`.

## Imports

- Relative imports only (e.g., `../../store/authStore`), no `@/` alias configured.

## Module Design

- Default exports for components (`export default ChatArea;`).
- Named exports for utilities, services, stores (`export const supabase`, `export function parseArtifacts`).
- Mixed default + named exports in some modules (`src/lib/supabase.ts`).
- `src/types/index.ts` exports all type definitions.
- No barrel index files in other directories.
- Some files are very large (noted as architectural concerns):

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text
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

- **State in stores, not components:** All shared state lives in Zustand stores, not React useState/useReducer. Components subscribe to slices of store state.
- **Optimistic UI with background sync:** Local state updates immediately; Supabase sync happens asynchronously in the background, with error logging but no UI blocking.
- **Stream-first architecture:** AI responses stream via SSE through chat-proxy edge function; frontend processes chunks as they arrive with 16ms batching to prevent render thrashing.
- **Serverless backend (backend-for-frontend pattern):** Edge functions handle all API key management, credit enforcement, and external service calls; frontend never holds sensitive credentials.
- **Web Workers for CPU-intensive work:** Token counting, artifact parsing, and syntax highlighting run in dedicated workers to avoid blocking the main thread.

## Layers

- Purpose: Renders UI, handles user interactions, subscribes to stores
- Location: `src/components/`, `src/pages/`
- Contains: React components with JSX markup, CSS files
- Depends on: Stores (for state), Services (for business logic), lib (for utilities)
- Used by: React Router in `App.tsx`
- Purpose: Single source of truth for all application state. Provides actions for mutation.
- Location: `src/store/`
- Contains: 13 Zustand stores -- `authStore.ts`, `chatStore.ts`, `uiStore.ts`, `artifactStore.ts`, `creditsStore.ts`, `themeStore.ts`, `sideChatStore.ts`, `tokenStore.ts`, `debugStore.ts`, `diagnosticsStore.ts`, `projectStore.ts`, `composerStore.ts`, `workspaceSessionStore.ts`
- Depends on: Services (database, auth, openrouter, etc.), lib (supabase client)
- Used by: Components, other stores (via `getState()` cross-store calls)
- Purpose: Business logic, API calls, data access
- Location: `src/services/`
- Contains: `database.ts` (Supabase CRUD), `openrouter.ts` (AI streaming), `auth.ts` (auth service), `fileProcessor.ts` (file parsing), `artifactDb.ts` (artifact CRUD), `checkout.ts` (payment), `userSettings.ts`, `outputBudget.ts`, `artifactVersionDb.ts`, workspace services
- Depends on: `src/lib/supabase.ts` (client singleton), external APIs
- Used by: Stores, sometimes components directly
- Purpose: Shared utilities, client initialization, config
- Location: `src/lib/`, `src/config/`
- Contains: `supabase.ts` (client), `stringUtil.ts`, `logger.ts`, `errorMessages.ts`, `searchHighlight.tsx`, `fileIconUtil.ts`, `artifactPatchParser.ts`, `artifactPatcher.ts`, `iframeErrorBridge.ts`; config files: `models.ts`, `admin.ts`, `pricing.ts`, `credits.ts`, `subscriptionConfig.ts`, `prompts.ts`
- Depends on: NPM packages
- Used by: All other layers
- Purpose: Shared TypeScript type definitions
- Location: `src/types/`
- Contains: `index.ts` (Message, Conversation, Artifact, ModelInfo, etc.), `workspace.ts`
- Used by: All other layers
- Purpose: Offload CPU-intensive operations off the main thread
- Location: `src/workers/`
- Contains: `tokenizer.worker.ts`, `artifactParse.worker.ts`, `highlighter.worker.ts`, plus client wrappers: `artifactParseWorkerClient.ts`, `highlighterWorkerClient.ts`
- Depends on: NPM packages (js-tiktoken, shiki)
- Purpose: Serverless API endpoints running on Deno
- Location: `supabase/functions/`
- Contains: `chat-proxy/index.ts` (AI proxy), `embed/index.ts` (RAG embeddings), `retrieve-chunks/index.ts` (vector search), `classify-intent/index.ts`, `deduct-credits/index.ts`, `generate-title/index.ts`, `ls-checkout/index.ts`, `ls-webhook/index.ts`, `web-search/index.ts`, `describe-image/index.ts`, `get-file-content/index.ts`, `get-model-config/index.ts`, shared utilities in `_shared/`
- Depends on: Supabase secrets (OPENROUTER_API_KEY, TAVILY_API_KEY, etc.)
- Purpose: Data persistence with row-level security
- Location: `supabase/migrations/` (36 migration files)
- Key tables: conversations, messages, user_credits, credit_ledgers, usage_logs, artifacts, artifact_votes, artifact_comments, file_attachments, document_chunks, user_settings, webhook_events
- Key features: pgvector extension for 768-dimension embeddings, SECURITY DEFINER functions for credit mutations

## Data Flow

### Primary Chat Message Flow

### Auth Flow

### Artifact Streaming Flow

### Payment/Credit Flow

## Key Abstractions

- Purpose: Immutable state containers with action methods. Some persisted to localStorage via `zustand/middleware/persist`.
- Examples: `src/store/authStore.ts`, `src/store/chatStore.ts`, `src/store/uiStore.ts`, `src/store/artifactStore.ts`, `src/store/creditsStore.ts`, `src/store/themeStore.ts`
- Pattern: `create<StoreType>()(persist((set, get) => ({ ...state, ...actions }), { name: 'storage-key', partialize: ... }))`
- Cross-store communication: via `useXStore.getState()` or direct imports between stores
- Purpose: Single `createClient()` instance shared across the app
- Location: `src/lib/supabase.ts`
- Pattern: Module-level export with null fallback; `isSupabaseEnabled()` gate for local-only mode; cached session state for synchronous checks
- Purpose: All external API calls go through Supabase Edge Functions to keep API keys server-side
- Pattern: Frontend calls `POST /functions/v1/{name}` with JWT auth; function verifies JWT, calls external API, returns result
- Key example: `openrouter.ts` calls `chat-proxy` edge function, never directly calls OpenRouter
- Purpose: Handle streaming AI responses with multiple event types
- Pattern: `streamChat()` -> `streamViaEdgeFunctionWrapper()` (continuation loop with retry) -> `streamViaEdgeFunctionWithInnerCallbacks()` (network error classification) -> `streamViaEdgeFunction()` (HTTP fetch) -> `processStream()` (SSE line parsing with event type routing)
- Purpose: Reliable message storage during streaming without DB hammering
- Pattern: Optimistic local update + background remote persist with throttled mid-stream writes (MIDSTREAM_PERSIST_MS=1500ms), sendBeacon flush on tab close/visibility change, authoritative write on stream end

## Entry Points

- Location: `src/main.tsx`
- Triggers: Browser loads index.html -> Vite loads main.tsx
- Responsibilities: Initialize Sentry error monitoring, mount React app into `#root` DOM node
- Location: `src/App.tsx`
- Triggers: React mounts
- Responsibilities: Sets up React Router with BrowserRouter, defines route tree:
- Location: `src/components/Layout.tsx`
- Triggers: User navigates to `/chat`
- Responsibilities: Auth gate (shows AuthScreen if no user), admin view detection, renders Navbar, Sidebar, ChatArea/AdminDashboard, ArtifactWorkspace, SideChatPanel, SettingsScreen, PricingModal, FileLibrary, AttachmentViewer, ArtifactHub, CommandPalette
- Location: `src/services/openrouter.ts` (function `streamChat`, line 502)
- Triggers: User sends a chat message
- Responsibilities: Orchestrates the entire AI chat pipeline -- RAG retrieval, context pruning, model message building, SSE streaming, auto-continuation

## Module Boundaries

- Frontend owns: rendering, routing, state management, client-side file processing, SSE stream parsing, artifact preview rendering
- Backend (edge functions) owns: AI model proxy, API key management, credit enforcement, embeddings/vector search, web search, payment processing, image description, user settings
- Contract: Edge functions receive JWT-authenticated requests from frontend, return JSON responses or SSE streams
- Stores own: state shape, mutation logic, persistence config, cross-store orchestration
- Components own: rendering, event handlers (calling store actions), local UI-only state (modals, dropdowns)
- Services own: data access (database CRUD), external API calls, file processing logic
- Stores own: state containers that call services, coordinate multiple service calls, manage loading/error states
- Workers own: token counting (tokenizer.worker.ts), artifact parsing (artifactParse.worker.ts), syntax highlighting (highlighter.worker.ts)
- Main thread owns: everything else; communicates with workers via postMessage

## Architectural Constraints

- **Threading:** Single-threaded React main thread with 3+ dedicated Web Workers for CPU-intensive work. Edge functions run on Deno (single-threaded per invocation, async I/O).
- **Global state:** Module-level singletons in `src/lib/supabase.ts` (Supabase client), `src/store/chatStore.ts` (midstreamState Map, titleGenInFlight Set), `src/store/authStore.ts` (initPromise, syncInFlight). Some stores expose dispose/cleanup functions for HMR.
- **Circular imports:** Avoided by design -- types import nothing, services import lib only, stores import services, components import stores. Cross-store calls use `getState()` accessor pattern.
- **API key isolation:** OpenRouter, Tavily, Lemon Squeezy API keys exist only in Supabase secrets (server-side). Frontend uses only Supabase URL + anon key (safe behind RLS).

## Anti-Patterns

### Cross-Store Coupling via getState()

### Module-Level Mutable State

### Mixed Concerns in openrouter.ts (1700+ lines)

## Error Handling

- SSE streaming errors: Caught in `processStream()`, delivered via `callbacks.onError(msg)`, classified as retryable vs. non-retryable
- Network retry: 3 attempts with exponential backoff in `streamViaEdgeFunctionWrapper()` (line 987)
- Watchdog timeout: 30s idle timeout kills stuck streams, triggers continuation loop
- Store action errors: Logged with `console.error`, rarely surfaced to user (fire-and-forget pattern)
- Edge function errors: HTTP status codes parsed; 401 triggers session expiry UI

## Cross-Cutting Concerns

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
