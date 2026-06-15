# Codebase Structure

**Analysis Date:** 2026-06-08

## Directory Layout

```
lucen-v2.3/
├── src/                           # Main application source
│   ├── main.tsx                   # Application entry point
│   ├── App.tsx                    # Root component + routing
│   ├── App.css                    # App-level styles
│   ├── index.css                  # Global styles (imported in main.tsx)
│   ├── artifact-hub.css           # Artifact Hub specific styles
│   ├── powertools.css             # Power tools specific styles
│   │
│   ├── components/                # React components (UI)
│   │   ├── Layout.tsx             # Authenticated app shell
│   │   ├── MarketingLayout.tsx    # Public pages shell
│   │   ├── AuthScreen.tsx         # Authentication screen
│   │   ├── Sidebar.tsx            # Conversation sidebar
│   │   ├── ChatArea.tsx           # Main chat message area
│   │   ├── ChatExchangeRow.tsx    # Single chat exchange (user + assistant)
│   │   ├── MessageInput.tsx       # Message composer
│   │   ├── MessageBubble.tsx      # Individual message bubble
│   │   ├── Navbar.tsx             # Top navigation bar
│   │   ├── MarkdownRenderer.tsx   # Markdown rendering with rehype/remark
│   │   ├── ArtifactWorkspace.tsx  # Side panel for rendered artifacts
│   │   ├── ArtifactRenderer.tsx   # Artifact rendering (HTML/SVG/Mermaid)
│   │   ├── ArtifactHub.tsx        # Public artifact gallery
│   │   ├── ArtifactPublishModal.tsx # Publish artifact to hub
│   │   ├── ArtifactVersionSelector.tsx # Version history picker
│   │   ├── ArtifactUpdateBinding.tsx # Patch intent binding
│   │   ├── ArtifactStatusPipeline.tsx # Patch status overlay
│   │   ├── ArtifactSuggestionPicker.tsx # Multi-artifact picker
│   │   ├── PatchTurnReportCard.tsx # Patch turn summary
│   │   ├── PatchSummaryCard.tsx   # Patch summary card
│   │   ├── SideChatPanel.tsx      # Floating side chat window
│   │   ├── SettingsScreen.tsx     # User settings modal
│   │   ├── ChatAppearanceSection.tsx # Chat appearance settings
│   │   ├── CommandPalette.tsx     # Ctrl+K command palette
│   │   ├── FileLibrary.tsx        # File library modal
│   │   ├── FileIcon.tsx           # File type icon component
│   │   ├── AttachmentViewer.tsx   # File attachment viewer
│   │   ├── SelectionMenu.tsx      # Template/conversation selector
│   │   ├── PricingModal.tsx       # Subscription/pricing modal
│   │   ├── UserUsageTab.tsx       # User usage statistics
│   │   ├── OwnerDashboard.tsx     # Admin dashboard
│   │   ├── Logo.tsx               # App logo
│   │   ├── SmoothScroll.tsx       # Smooth scroll wrapper (lenis)
│   │   ├── ExcelDocumentPreview.tsx # Excel file preview
│   │   ├── OtpVerifyScreen.tsx    # OTP verification screen
│   │   ├── NewPasswordScreen.tsx  # New password form
│   │   ├── ResetPasswordScreen.tsx # Password reset init
│   │   ├── ReactWorkspaceScreen.tsx # React project workspace
│   │   ├── AuthScreen.tsx         # Login/Register screen
│   │   │
│   │   └── react-workspace/       # React sandbox workspace
│   │       ├── CodeEditorPane.tsx  # Code editor (Monaco-like)
│   │       ├── DiagnosticsPane.tsx # Build/runtime diagnostics
│   │       ├── EditorTabs.tsx      # File tab bar
│   │       ├── FileExplorer.tsx    # File tree explorer
│   │       ├── PreviewPane.tsx     # Live preview iframe
│   │       ├── TerminalPane.tsx    # In-browser terminal
│   │       └── WorkspaceAiPanel.tsx # AI assistant in workspace
│   │
│   ├── pages/                     # Page-level components (marketing)
│   │   ├── HomePage.tsx           # Landing page
│   │   ├── AboutPage.tsx          # About page
│   │   ├── ContactPage.tsx        # Contact page
│   │   ├── PackagesPage.tsx       # Pricing plans
│   │   ├── TermsPage.tsx          # Terms of service
│   │   ├── PrivacyPage.tsx        # Privacy policy
│   │   ├── RefundPage.tsx         # Refund policy
│   │   └── Auth/                  # Auth pages
│   │       ├── LoginPage.tsx      # Login form
│   │       └── SignupPage.tsx     # Signup form
│   │
│   ├── store/                     # Zustand state stores
│   │   ├── authStore.ts           # Authentication state
│   │   ├── chatStore.ts           # Conversations + messages + streaming
│   │   ├── uiStore.ts             # UI state (sidebar, modals, templates)
│   │   ├── artifactStore.ts       # Artifact workspace + patching state
│   │   ├── creditsStore.ts        # Credit/subscription state
│   │   ├── themeStore.ts          # Theme management
│   │   ├── sideChatStore.ts       # Side chat state
│   │   ├── tokenStore.ts          # Token counting via web worker
│   │   ├── debugStore.ts          # Debug/development capture
│   │   ├── diagnosticsStore.ts    # Workspace diagnostics
│   │   ├── projectStore.ts        # React project state
│   │   ├── composerStore.ts       # Artifact composer state
│   │   └── workspaceSessionStore.ts # Workspace session state
│   │
│   ├── services/                  # Business logic + data access
│   │   ├── openrouter.ts          # AI chat streaming (1700+ lines)
│   │   ├── database.ts            # Supabase CRUD (conversations, messages)
│   │   ├── auth.ts                # Supabase auth wrapper
│   │   ├── fileProcessor.ts       # Client-side file parsing
│   │   ├── artifactDb.ts          # Artifact hub DB operations
│   │   ├── artifactVersionDb.ts   # Artifact versioning DB operations
│   │   ├── checkout.ts            # Lemon Squeezy checkout
│   │   ├── outputBudget.ts        # Token budget computation
│   │   ├── userSettings.ts        # User settings DB operations
│   │   ├── projectArchive.ts      # Project zipping/archiving
│   │   ├── projectImport.ts       # Project import parsing
│   │   ├── workspaceDiagnostics.ts # Workspace diagnostics logic
│   │   ├── workspaceRuntimeClient.ts # Workspace runtime client
│   │   └── workspaceAi.ts         # Workspace AI integration
│   │
│   ├── lib/                       # Shared utilities
│   │   ├── supabase.ts            # Supabase client singleton
│   │   ├── stringUtil.ts          # String utilities (sanitizeMinimaxTags)
│   │   ├── logger.ts              # Logging utility
│   │   ├── errorMessages.ts       # Error message constants
│   │   ├── artifactParser.ts      # <lucen_artifact> tag parser
│   │   ├── artifactPatchParser.ts # Search/replace patch parser
│   │   ├── artifactPatcher.ts     # Search/replace patch applier
│   │   ├── iframeErrorBridge.ts   # Iframe error capture bridge
│   │   ├── fileIconUtil.ts        # File extension to icon mapping
│   │   └── searchHighlight.tsx    # Search result highlighting
│   │
│   ├── config/                    # Configuration modules
│   │   ├── models.ts              # AI model configuration
│   │   ├── prompts.ts             # System prompts by template
│   │   ├── admin.ts               # Admin email list
│   │   ├── credits.ts             # Credit constants
│   │   ├── pricing.ts             # Price configuration
│   │   ├── subscriptionConfig.ts  # Subscription plans, variant IDs
│   │   └── promptsOld             # Legacy prompts (directory)
│   │
│   ├── types/                     # TypeScript type definitions
│   │   ├── index.ts               # Core types (Message, Conversation, Artifact, etc.)
│   │   └── workspace.ts           # React workspace types
│   │
│   ├── workers/                   # Web Workers
│   │   ├── tokenizer.worker.ts    # Token counting (js-tiktoken)
│   │   ├── artifactParse.worker.ts # Artifact content parsing
│   │   ├── artifactParseWorkerClient.ts # Worker client wrapper
│   │   ├── highlighter.worker.ts  # Syntax highlighting (shiki)
│   │   └── highlighterWorkerClient.ts # Worker client wrapper
│   │
│   └── assets/                    # Static assets
│       └── react.svg
│
├── supabase/                      # Supabase backend
│   ├── config.toml                # Local dev config
│   ├── reset_dev_env.sql          # Dev environment reset
│   │
│   ├── functions/                 # Edge Functions (Deno)
│   │   ├── _shared/               # Shared utilities
│   │   │   ├── cors.ts            # CORS headers
│   │   │   ├── usage.ts           # Usage logging helpers
│   │   │   ├── logging.ts         # Structured logging
│   │   │   ├── rateLimit.ts       # Rate limiting
│   │   │   ├── circuitBreaker.ts  # Circuit breaker pattern
│   │   │   ├── featureFlags.ts    # Feature flags
│   │   │   └── toolRegistry.ts    # Tool execution registry
│   │   │
│   │   ├── chat-proxy/index.ts    # AI chat proxy (main AI entry point)
│   │   ├── embed/index.ts         # RAG text embedding
│   │   ├── retrieve-chunks/index.ts # Vector similarity search
│   │   ├── classify-intent/index.ts # Intent classification
│   │   ├── deduct-credits/index.ts # Credit deduction
│   │   ├── generate-title/index.ts # AI title generation
│   │   ├── ls-checkout/index.ts   # Lemon Squeezy checkout creation
│   │   ├── ls-webhook/index.ts    # Lemon Squeezy webhook handler
│   │   ├── web-search/index.ts    # Tavily web search
│   │   ├── describe-image/index.ts # AI image description
│   │   ├── get-file-content/index.ts # File content retrieval
│   │   └── get-model-config/index.ts # Dynamic model configuration
│   │
│   └── migrations/                # Database migrations
│       ├── 20260305000001_initial_schema.sql
│       ├── 20260305000002_rls_policies.sql
│       ├── 20260307000001_fix_missing_tables.sql
│       ├── 20260315000001_atomic_credit_deduction.sql
│       ├── 20260327000001_phase1_lemon_credit_schema.sql
│       ├── 20260327000002_add_free_searches_used.sql
│       ├── 20260328000001_subscription_plan.sql
│       ├── 20260329000001_webhook_idempotency.sql
│       ├── 20260329000002_subscription_management.sql
│       ├── 20260330000001_atomic_credit_operations.sql
│       ├── 20260331000001_usage_logs_cost_breakdown.sql
│       ├── 20260401000001_generic_payment_columns.sql
│       ├── 20260402000001_credit_ledgers_migration.sql
│       ├── 20260403000001_lemon_only_cleanup.sql
│       ├── 20260403000002_subscription_security.sql
│       ├── 20260404000002_file_attachments.sql
│       ├── 20260425000001_messages_midstream_persist.sql
│       ├── 20260425000002_usage_logs_full_accounting.sql
│       ├── 20260429000001_artifacts_table.sql
│       ├── 20260429000002_artifacts_rls.sql
│       ├── 20260430000001_global_search_fts.sql
│       ├── 20260503000001_user_settings_washi_default.sql
│       ├── 20260504000001_artifacts_versioning.sql
│       ├── 20260508000001_fix_credit_races.sql
│       ├── 20260508000002_add_patch_call_kinds.sql
│       ├── 20260512000001_reliable_artifact_generation.sql
│       ├── 20260512000002_cleanup_reliable_artifact_generation.sql
│       ├── 20260515000001_fix_grant_sets_free_credit_flag.sql
│       ├── 20260523000001_payment_hardening.sql
│       ├── 20260524000001_agentic_tool_calling_schema.sql
│       ├── 20260527000001_add_missing_columns.sql
│       └── 20260529000001_storage_attachments.sql
│
├── public/                        # Static public assets
│   ├── lucen-favicon.svg          # Favicon
│   └── vite.svg                   # Vite default favicon
│
├── docs/                          # Documentation
│   └── DEPLOY.md                  # Deployment guide
│
├── scripts/                       # Build/utility scripts
│
├── dist/                          # Build output (generated)
├── node_modules/                  # Dependencies (generated)
│
├── .github/                       # GitHub Actions workflows
├── .agent/                        # Agent configuration
├── .claude/                       # Claude/Anthropic configuration
├── .cursor/                       # Cursor configuration
├── .planning/                     # Planning documents
│   └── codebase/                  # Codebase map documents
│
├── index.html                     # Vite HTML entry point
├── package.json                   # NPM dependencies
├── package-lock.json              # Lock file
├── tsconfig.json                  # TypeScript root config
├── tsconfig.app.json              # TypeScript app config (strict)
├── tsconfig.node.json             # TypeScript Node config
├── vite.config.ts                 # Vite build config
├── eslint.config.js               # ESLint flat config
├── vercel.json                    # Vercel deployment config
├── vercel.env.example             # Vercel env template
├── .env.example                   # Local env template
├── supabase.env.example           # Supabase env template
├── .gitignore                     # Git ignore rules
├── README.md                      # Project readme
├── ARCHITECTURE.md                # Full architecture document (root level)
├── PROJECT_SPEC.md                # Project specification
├── AUDIT_PROGRESS.md              # Audit tracking
├── cursorrules                    # Cursor IDE rules
└── LEMON_SQUEEZY_MODE_SWITCH.md   # Payment migration docs
```

## Key Directory Purposes

**`src/` (Main Application):**
- Purpose: All frontend application code -- components, state, services, utilities, types, workers, config
- Contains: TypeScript/TSX source files, CSS files
- Config files: `tsconfig.app.json` (strict mode, ES2022 target, React JSX transform)

**`src/components/` (UI Components):**
- Purpose: All React components -- app shell, chat, artifacts, modals, auth screens, marketing, workspace
- Contains: TSX component files, component-level CSS files
- Key subdirectory: `react-workspace/` for the React sandbox workspace (6 components)
- Pattern: One file per component, named PascalCase matching the component name

**`src/store/` (State Management):**
- Purpose: 13 Zustand stores that manage all shared application state
- Key pattern: `create<StoreType>()(persist((set, get) => ({...}), { name: 'lucen-*', partialize: ... }))`
- Four stores use persistence: `chatStore.ts` ('lucen-chat-storage'), `uiStore.ts` ('lucen-ui-storage'), `creditsStore.ts` (persisted), `sideChatStore.ts` (persisted)
- `chatStore.ts` uses `partialize` to strip streaming state and file data from persisted output

**`src/services/` (Business Logic):**
- Purpose: All service/data-access functions -- database operations, AI streaming, file processing, payments
- Contains: 14 service modules, one per domain concern
- Largest: `openrouter.ts` at ~1770 lines (contains AI streaming, RAG, context pruning, SSE parsing, auto-continuation)

**`src/lib/` (Shared Utilities):**
- Purpose: Low-level utilities, client singletons, parsers
- Contains: `supabase.ts` (critical -- singleton Supabase client), string utils, artifact parsers/patch engines, error bridges
- `src/lib/supabase.ts` is the most imported module across the codebase

**`src/config/` (Configuration):**
- Purpose: App configuration constants, prompt templates, model config
- Contains: Model display names/token limits, subscription variant IDs, admin emails, system prompts
- Dynamic: `models.ts` fetches remote model config via `get-model-config` edge function on login

**`src/workers/` (Web Workers):**
- Purpose: Offload CPU-intensive tasks to separate threads
- Contains: 3 workers + 2 client wrappers. Workers use Vite's `?worker` pattern (configured with `format: 'es'` in `vite.config.ts`)

**`src/types/` (Type Definitions):**
- Purpose: Centralized TypeScript interfaces and types shared across the app
- Contains: Two files -- `index.ts` (core types: Message, Conversation, Artifact, ModelInfo, etc.) and `workspace.ts` (React workspace types)
- `index.ts` is the single source of type truth, imported by nearly every other module

**`src/pages/` (Marketing Pages):**
- Purpose: Public-facing pages wrapped in `MarketingLayout`
- Contains: 8 static page components + Auth subdirectory with login/signup forms
- These are simple informational pages with no complex state management

**`supabase/` (Backend):**
- Purpose: Serverless backend -- edge functions (Deno TypeScript) and database migrations (SQL)
- `functions/chat-proxy/` is the most critical edge function: the single entry point for all AI model calls
- `functions/_shared/` contains shared modules used by multiple edge functions
- `migrations/` contains 36 timestamped SQL migration files, applied in order
- Config: `supabase/config.toml` for local development

## Naming Conventions

**Files:**
- PascalCase for React components: `Layout.tsx`, `ArtifactWorkspace.tsx`, `MessageInput.tsx`
- camelCase for non-component modules: `supabase.ts`, `openrouter.ts`, `fileProcessor.ts`, `artifactDb.ts`
- kebab-case for CSS files: `artifact-hub.css`, `powertools.css`
- Worker files end with `.worker.ts`: `tokenizer.worker.ts`, `artifactParse.worker.ts`
- Worker client wrappers: `{workerName}WorkerClient.ts` pattern

**Directories:**
- camelCase for all directories: `src/components/react-workspace/`, `src/pages/Auth/`, `src/store/`
- `_shared/` prefix for shared edge function modules (Supabase convention)

**Functions:**
- camelCase for all functions: `streamChat()`, `buildApiMessages()`, `processStream()`, `sanitizeAssistantOutput()`
- Async functions return Promises explicitly in type annotations where needed

**Variables:**
- camelCase for all variables: `apiMessages`, `perCallCap`, `ragContext`, `treatReasoningAsContent`
- UPPER_SNAKE_CASE for constants: `STREAM_IDLE_TIMEOUT_MS`, `CONTINUATION_MAX_CHUNKS_ARTIFACT`, `ABSOLUTE_OUTPUT_CEILING`

**Exports:**
- Named exports for store hooks: `export const useAuthStore`, `export const useChatStore`
- Named exports for service functions: `export async function streamChat`
- Default exports for components: `export default App`
- Named exports for types: `export interface Message`, `export type ArtifactType`

## File Organization

**Component File Structure:**
```
src/components/ComponentName.tsx  -- Single component per file
src/components/ComponentName.css  -- Optional co-located CSS (rare -- most use global CSS)
```

**Store File Structure:**
```
src/store/storeName.ts
  - create<StoreType>()((set, get) => ({ ...state, ...actions }))
  - Optional persist middleware
  - Optional module-level helpers (syncDataOnLogin, etc.)
```

**Service File Structure:**
```
src/services/serviceName.ts
  - Module-level doc comment describing purpose
  - Named exports for all public functions
  - Supabase enabled/disabled guards at top of each function
  - Error handling via try/catch with console.error logging
```

**Edge Function File Structure:**
```
supabase/functions/function-name/index.ts
  - Deno runtime (imports from https://deno.land/ or npm:)
  - JWT verification via supabase.auth.getUser()
  - CORS headers from _shared/cors.ts
  - Returns Response (JSON or SSE stream)
```

## Where to Add New Code

**New Feature (e.g., new chat capability):**
- Primary code: `src/services/` (if it's business logic), or extend `openrouter.ts` if it involves AI streaming
- UI: `src/components/` with PascalCase file name
- State: `src/store/` -- either extend existing store or create new one
- Types: Add to `src/types/index.ts`
- Tests: Not detected (no test infrastructure present)

**New Component:**
- Implementation: `src/components/ComponentName.tsx`
- Styles: Add to existing CSS files or create `src/components/ComponentName.css`
- Type definitions: `src/types/index.ts` if new domain types needed

**New Edge Function:**
- Implementation: `supabase/functions/function-name/index.ts`
- Shared utilities: `supabase/functions/_shared/` for reusable helpers
- Migration: `supabase/migrations/YYYYMMDDHHMMSS_description.sql`
- Deploy: `supabase functions deploy function-name`

**New Utility:**
- Shared helpers: `src/lib/utilName.ts`
- Configuration: `src/config/configName.ts`
- Types: `src/types/index.ts` or `src/types/newDomain.ts`

**New Web Worker:**
- Worker: `src/workers/workerName.worker.ts`
- Client wrapper: `src/workers/workerNameWorkerClient.ts`
- Register in vite.config.ts if needed

## Special Directories

**`dist/`:**
- Purpose: Vite build output
- Generated: Yes (via `vite build`)
- Committed: No (in `.gitignore`)

**`node_modules/`:**
- Purpose: NPM dependencies
- Generated: Yes (via `npm install`)
- Committed: No (in `.gitignore`)

**`supabase/.temp/`:**
- Purpose: Supabase CLI temporary state (linked project, CLI versions)
- Generated: Yes (by `supabase` CLI commands)
- Committed: No (in `.gitignore` typically)

**`.planning/codebase/`:**
- Purpose: Machine-generated architecture and codebase analysis documents
- Generated: Yes (by `/gsd-map-codebase` command)
- Committed: Yes (consumed by other GSD commands)

**`supabase/functions/_shared/`:**
- Purpose: Shared TypeScript modules for edge functions (CORS, usage logging, rate limiting, circuit breaker, feature flags, tool registry)
- Pattern: Imported by edge functions via relative paths like `../_shared/cors.ts`
- Notable: These run in the Deno runtime, not Node.js -- no NPM imports allowed

---

*Structure analysis: 2026-06-08*