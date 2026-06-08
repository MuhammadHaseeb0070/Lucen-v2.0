# Architecture Research

**Domain:** AI Chat SPA (React 19 + Vite) with Deno Edge Functions (Supabase) — stabilization refactoring
**Researched:** 2026-06-08
**Confidence:** HIGH (verified against existing codebase plus official docs)

## Executive Summary

This document covers the structural patterns needed for the Lucen v2.3 stabilization milestone. The project is not being re-architected; instead, two monoliths (`openrouter.ts` at 1,770 lines and `chat-proxy/index.ts` at 1,668 lines) are being decomposed into focused modules, types are being shared between the Vite frontend and Deno edge functions, and several infrastructure patterns (rate limiting, circuit breaker, streaming SSE with billing, CSP) are being hardened for production.

The research covers 12 specific architectural questions. Key findings:

1. **Modulith pattern** for TypeScript service decomposition: group by domain concern (messages, streaming, continuation, RAG), not by technical layer (utils, helpers, services).
2. **Zustand `subscribeWithSelector`** is the correct replacement for `getState()` cross-store coupling — it provides typed, selective subscriptions without creating direct import dependencies.
3. **Deno KV** is not available in Supabase Edge Functions; **Upstash Redis** via HTTP REST is the correct choice for shared rate limit and circuit breaker state.
4. **The `_shared/` directory** in edge functions must remain small and stateless to keep cold starts fast — only import what each function needs.
5. **CSP for Vite/Vercel** should use nonce-based inline script strategy via Vite's `transformIndexHtml` hook, with `frame-src 'self'` and `sandbox` flags on artifact iframes.

## Standard Architecture

### System Overview (After Decomposition)

```
+----------------------------------------------------------------------------+
|                         Browser (React 19 SPA)                              |
|  +----------------------+  +-------------------+  +----------------------+ |
|  |   React Components   |  |   Zustand Stores   |  |   Web Workers (4)    | |
|  |  ChatArea, MessageI-  |  | auth, chat, ui,    |  | tokenizer, artifact- | |
|  |  nput, ArtifactWork-  |  | artifact, credits,  |  | Parse, highlighter,  | |
|  |  space, Settings...   |  | theme, sideChat...  |  | python (Pyodide)     | |
|  +-----------+----------+  +---------+----------+  +----------+----------+ |
|              |                       |                        |            |
|              +-----------------------+------------------------+            |
|                                      |                                     |
|                          src/services/ (modulith)                           |
|  +----------------+ +----------------+ +--------------+ +----------------+ |
|  | messages/      | | streaming/     | | continuation/| | rag/           | |
|  |  buildMessages | |  processStream | |  continuation| |  retrieveChunks| |
|  |  pruneMessages | |  sseParser     | |  detectRepeat| |  contextInject | |
|  |  contextBuilder| |  streamClient  | |  detectStall | |                | |
|  +----------------+ +----------------+ +--------------+ +----------------+ |
|              |                       |                        |            |
|              +-----------------------+------------------------+            |
|                                      |                                     |
|              POST /functions/v1/chat-proxy (JWT + SSE)                     |
+--------------------------------------+-------------------------------------+
                                       |
+--------------------------------------v-------------------------------------+
|                      Supabase Edge Function (Deno)                          |
|  +------------------------------------------------------------------------+|
|  | chat-proxy/index.ts (orchestrator only, ~400 lines after split)        ||
|  |  - JWT verify                     - route to handler                    ||
|  |  - rate limit check               - circuit breaker check               ||
|  |  - kill switch check              - SSE response setup                  ||
|  |  - delegates to:                  - error recovery                      ||
|  +-----------------------------------+------------------------------------+||
|                                      |                                     |
|  +-------------------+ +-----------+ +------------+ +--------------------+ ||
|  | _shared/          | | auth/     | | tools/      | | billing/           | ||
|  |  cors.ts           | |  jwt.ts   | |  orchestrate| |  usage.ts          | ||
|  |  logging.ts        | |           | |  webSearch  | |  creditDeduction   | ||
|  |  featureFlags.ts   | |           | |  analyzeI-  | |  accounting         | ||
|  |                    | |           | |  mage       | |                    | ||
|  |                    | |           | |  readFile   | |                    | ||
|  +-------------------+ +-----------+ +------------+ +--------------------+ ||
|                                      |                                     |
|           +--------------------------v---------------------------+         |
|           |           Shared State (Upstash Redis)                |         |
|           |  rateLimit:buckets  circuitBreaker:state  kv:flags    |         |
|           +------------------------------------------------------+         |
+--------------------------------------+-------------------------------------+
                                       |
+--------------------------------------v-------------------------------------+
|                         External Services                                   |
|  OpenRouter (AI)    Tavily (search)    Lemon Squeezy (payments)            |
+---------------------------------------------------------------------------+
```

### Component Boundaries (After Decomposition)

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `messages/` | Build API messages (system prompts, RAG context, vision notices), prune history to fit context window, compute output budget | `config/models.ts`, `config/prompts.ts`, `rag/`, `types/` |
| `streaming/` | SSE stream parsing, rate-limited chunk dispatch, event type routing (tool_activity, content_start, delta.content) | `types/`, `modular event callbacks` |
| `continuation/` | Auto-continuation loop, repetition detection, stall detection, structural regression check, message reassembly | `messages/`, `streaming/`, `types/` |
| `rag/` | RAG chunk retrieval (edge function call), context injection into message building | `messages/`, `types/` |
| `chat-proxy/index.ts` | Orchestrator only: JWT verify, rate limit, kill switch, SSE setup, dispatch to sub-modules, usage recording | `_shared/*`, `tools/`, `billing/` |
| `tools/` | Tool orchestration: web search, image analysis, file reading. Process tool calls, merge results | `types/`, `_shared/toolRegistry.ts` |
| `billing/` | Credit deduction, usage recording, accounting object lifecycle | `_shared/usage.ts`, `types/` |
| `auth/` (in edge function) | JWT decode, Supabase verify, token expiry check | `_shared/logging.ts` |
| Zustand stores | State containers with actions. Cross-store via `subscribe` not `getState()` | Services, Components, other stores (via subscribe) |

### Data Flow (After Decomposition)

```
User sends message
  -> chatStore.sendMessage()
    -> messages/buildMessages() [uses rag/ for RAG context]
    -> streaming/streamClient.fetch() [POST to chat-proxy]
      -> chat-proxy: verify JWT, check rate limit, check circuit breaker
        -> OpenRouter API call (streaming)
      <- SSE stream returned
    -> streaming/processStream() [parse SSE events]
      -> onChunk -> chatStore.updateMessage()
      -> onToolActivity -> tool orchestration
      -> onDone -> continuation/ check if needed
        -> if continuation needed: messages/buildContinuationMessages()
          -> streaming/streamClient.fetch() [next pass]
```

## Recommended Project Structure

### Frontend: `src/services/` decomposition

```
src/services/
├── index.ts                    # Re-exports public API (preserves backward compat)
├── messages/
│   ├── builder.ts              # buildApiMessages(), buildMessageContent()
│   ├── pruner.ts               # pruneMessagesForContext()
│   ├── contextBuilder.ts       # buildRuntimeContext(), buildStructuralSummary()
│   └── outputBudget.ts         # computeOutputBudget(), approxTokens(), messageCostApprox() (moved from current openrouter.ts)
├── streaming/
│   ├── processStream.ts        # SSE line parser + event router (was ~500 lines in openrouter.ts)
│   ├── streamClient.ts         # streamViaEdgeFunction(), fetch wrapper + network retry
│   └── types.ts                # SSE event types, callback interface, stream state
├── continuation/
│   ├── engine.ts               # streamViaEdgeFunctionWrapper() + continuation loop logic
│   ├── detector.ts             # isInsideArtifact(), isRepeatingLastWindow(), isLowEntropy(), hasStructuralRegression()
│   └── messageAssembler.ts     # buildContinuationMessages() + multi-pass message merging
├── rag/
│   ├── retriever.ts            # retrieveRelevantChunks() - edge function call
│   └── injector.ts             # RAG context injection helpers
├── artifact/
│   └── detector.ts             # Artifact boundary detection in stream (moved from openrouter.ts inline)
├── database.ts                 # (exists, keep as-is)
├── auth.ts                     # (exists, keep as-is)
├── fileProcessor.ts            # (exists, keep as-is)
├── artifactDb.ts               # (exists, keep as-is)
├── outputBudget.ts             # (moved to messages/ but keep re-export for backward compat)
└── openrouter.ts               # Thin facade: re-exports from sub-modules + deprecated warning
```

### Edge Function: `supabase/functions/chat-proxy/` decomposition

```
supabase/functions/chat-proxy/
├── index.ts                    # Orchestrator only (~300-400 lines)
│                               #  - Deno.serve(), CORS, killswitch, JWT, rate limit, circuit breaker
│                               #  - Route to stream handler or error response
│                               #  - Single accounting.finalized guard at exit
├── auth.ts                     # JWT decode + Supabase verify + expiry check
├── streamHandler.ts            # OpenRouter fetch + SSE pump + tool call loop + [DONE] sentinel
├── billing.ts                  # Credit deduction per round, usage accounting, pricing helpers
├── validation.ts               # validateModelOutput(), buildResponseFormatContract()
├── validation.test.ts          # Unit tests for validation logic
├── types.ts                    # chat-proxy-specific types (Accounting, StreamState, etc.)

supabase/functions/_shared/
├── cors.ts                     # (keep as-is)
├── logging.ts                  # (keep as-is)
├── rateLimit.ts                # Replace Map with Upstash Redis REST calls (see below)
├── circuitBreaker.ts           # Replace Map with Upstash Redis REST calls (see below)
├── featureFlags.ts             # (keep as-is — Deno.env.get is correct for kill switches)
├── toolRegistry.ts             # (keep as-is — tool definitions)
└── usage.ts                    # (keep as-is — DB write logic)
```

## Shared Types Strategy

### Recommended: Published NPM package via workspace

The codebase has two TypeScript environments with different runtimes:
- `src/` — React/Vite (browser, ESM)
- `supabase/functions/` — Deno (Deno native, URL imports)

**Recommended approach:** A separate `packages/shared-types/` directory managed via npm workspaces:

```
lucen/
├── packages/
│   └── shared-types/
│       ├── package.json         # name: "@lucen/shared-types"
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts         # Re-exports everything
│           ├── sse-events.ts    # SSE stream event types
│           ├── api-contracts.ts # Request/response shapes for chat-proxy
│           ├── tool-types.ts    # Tool definitions, tool call shapes
│           ├── artifact-types.ts# Artifact type, patch types
│           └── billing.ts       # Usage log, credit types
├── package.json                 # "workspaces": ["packages/*"]
├── src/                         # References @lucen/shared-types
└── supabase/
    └── functions/               # References via npm: or local import
```

**Workflow:**
1. Build: `cd packages/shared-types && tsc -b` produces ESM + `.d.ts`
2. Frontend: `npm install @lucen/shared-types` — resolves via workspace
3. Edge functions: Import the `.ts` source directly from the workspace via relative path, or bundle into the function on deploy

**Alternative (simpler, recommended for this milestone):** Path alias + manual sync

Since edge functions import Deno-style (`https://esm.sh/...`), the simplest approach is:
1. Author types in `src/types/shared/` 
2. Build a script `scripts/sync-shared-types.ts` that copies relevant files to `supabase/functions/_shared/types/`
3. Both sides import from their local copy
4. A CI check or pre-commit hook verifies the copies are in sync

**Why not JSON Schema / codegen:** Too much tooling overhead for this milestone. The two-side sync with a verification script is pragmatic.

## Architectural Patterns

### Pattern 1: Modulith Decomposition for TypeScript Services

**What:** Decompose a monolithic service module into a directory of focused sub-modules, each with a single responsibility, all re-exported through a facade `index.ts` that preserves the public API.

**When to use:** When a service file exceeds ~400 lines and contains multiple distinct concerns (message building, streaming, continuation, RAG).

**Trade-offs:**
- (+) Testable in isolation — each sub-module can be unit tested without invoking the full pipeline
- (+) Reduced merge conflicts — multiple developers can work on different sub-modules
- (+) Cognitive load — each file is under 300 lines with a single purpose
- (-) More files to navigate — requires good naming and an index.ts facade
- (-) Import paths get longer — mitigated by barrel exports

**Example — prescriptive directory layout:**

```
// src/services/messages/builder.ts
import type { Message } from '../../types';
import { getActiveModel } from '../../config/models';
import { TEMPLATES, BASE_SYSTEM_PROMPT } from '../../config/prompts';

export function buildApiMessages(
  messages: Message[],
  ragContext: string | null,
  templates: string[],
): Array<{ role: string; content: string }> {
  // Moves the ~200 lines of message construction from openrouter.ts here
}

// src/services/messages/pruner.ts
export function pruneMessagesForContext(
  messages: Message[],
  modelMaxTokens: number,
): Message[] {
  // Moves the ~60 lines of context window pruning from openrouter.ts here
}

// src/services/index.ts — Facade preserving the public API
export { streamChat, buildContinuationMessages } from './continuation/engine';
export { buildApiMessages, pruneMessagesForContext } from './messages/builder';
export { retrieveRelevantChunks } from './rag/retriever';

// Legacy openrouter.ts becomes a thin re-export:
export { streamChat, buildContinuationMessages } from './index';
```

**Refactoring order (build dependencies):**
1. `types/` — ensure all types the sub-modules need exist (no circular deps)
2. `messages/` — pure functions, easiest to extract first, no testing infra needed beyond Vitest
3. `rag/` — depends on messages/ types but no streaming state
4. `streaming/` — the SSE parser and stream client, depends on types
5. `continuation/` — depends on both messages/ and streaming/
6. Facade `index.ts` + thin `openrouter.ts` — last step, wires everything together

### Pattern 2: Zustand `subscribeWithSelector` for Cross-Store Events

**What:** Replace `useOtherStore.getState().someAction()` with `useOtherStore.subscribe(selector, callback)` from Zustand's `subscribeWithSelector` middleware, enabling stores to react to specific state changes in other stores without creating import dependency chains.

**When to use:** Any store that needs to react to changes in another store — e.g., `authStore` needs to clear `chatStore` on logout.

**Trade-offs:**
- (+) Eliminates import coupling — stores subscribe to changes rather than importing each other
- (+) Type-safe — selector picks precisely the slice of state to watch
- (+) Testable — each store can be tested without importing its dependents
- (-) Async timing — subscribers fire synchronously during `set()`, so order matters
- (-) Cleanup — unsubscribes must be managed (returned function from `.subscribe()`)

**Example — current anti-pattern (authStore imports chatStore):**

```typescript
// CURRENT (bad) — authStore.ts imports useChatStore
import { useChatStore } from './chatStore';

// inside some action:
useChatStore.getState().clearChats();
```

**Example — recommended pattern:**

```typescript
// authStore.ts — no imports from other stores
import { subscribeWithSelector } from 'zustand/middleware';

export const useAuthStore = create<AuthStore>()(
  subscribeWithSelector((set, get) => ({
    user: null,
    session: null,
    // ... other state and actions
  }))
);

// A separate orchestration module (e.g., src/store/orchestration.ts)
// subscribes auth changes and dispatches to other stores:
import { useAuthStore } from './authStore';
import { useChatStore } from './chatStore';
import { useCreditsStore } from './creditsStore';

let unsub: (() => void) | null = null;

export function startCrossStoreSync() {
  unsub = useAuthStore.subscribe(
    (state) => state.user,           // selector — re-runs callback only when user changes
    (user, previousUser) => {
      if (!user && previousUser) {
        // User logged out
        useChatStore.getState().clearChats();
        useCreditsStore.getState().reset();
      } else if (user && !previousUser) {
        // User logged in
        useCreditsStore.getState().syncWithRetry();
      }
    },
    { equalityFn: (a, b) => a?.id === b?.id } // optional: custom equality
  );
}

export function stopCrossStoreSync() {
  unsub?.();
}
```

**Key rules for `subscribeWithSelector`:**
1. Import `subscribeWithSelector` from `zustand/middleware` and wrap the store creator
2. Only ONE orchestration module subscribes to cross-store changes — stores themselves stay pure
3. The `startCrossStoreSync()` / `stopCrossStoreSync()` pair is called from `App.tsx` on mount/unmount
4. Always provide an equality function for selector-based subscriptions (prevents infinite loops from reference inequality)

### Pattern 3: Edge Function Modular Architecture with Cold-Start Awareness

**What:** Organize edge functions so that imports are minimal and each function only loads the modules it needs. The `_shared/` directory should contain small, stateless utility modules — not fat service layers.

**When to use:** All Supabase Edge Functions, especially the latency-sensitive `chat-proxy`.

**Trade-offs:**
- (+) Faster cold starts — Deno loads fewer files, less parsing
- (+) Smaller deploy bundles — each function is self-contained
- (-) Code duplication risk — solved by keeping `_shared/` as thin utility wrappers, not business logic
- (-) Module boundaries must be explicit — no implicit dependencies

**Example — current cold start problem:**

```typescript
// CURRENT (chat-proxy/index.ts): imports EVERYTHING at module top
import { TOOLS, getOpenRouterTools } from '../_shared/toolRegistry.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { circuitAllow } from '../_shared/circuitBreaker.ts';
import { isKillSwitched } from '../_shared/featureFlags.ts';
import { recordUsage, type UsageStatus } from '../_shared/usage.ts';
import { createLogger } from '../_shared/logging.ts';
// All loaded before any request is served
```

**Recommended — lazy import for heavy modules:**

```typescript
// RECOMMENDED — inline heavy imports only when needed
import { getCorsHeaders } from '../_shared/cors.ts';        // tiny, always needed
import { createLogger } from '../_shared/logging.ts';       // tiny, always needed
import { checkRateLimit } from '../_shared/rateLimit.ts';   // small, always needed
import { isKillSwitched } from '../_shared/featureFlags.ts';// small, always needed

// toolRegistry and circuitBreaker are imported INSIDE the handler, not at module top
Deno.serve(async (req: Request) => {
  // ...
  if (isKillSwitched('CHAT')) return error503;

  // Defer tool imports until we know we have work to do
  // This speeds up cold-start for health checks and CORS preflight
  const { circuitAllow } = await import('../_shared/circuitBreaker.ts');
  // ...
});
```

**Key rules for edge function modularity:**
1. `_shared/` modules must be < 200 lines and import nothing outside `_shared/`
2. Business logic lives inside the function's own directory (e.g., `chat-proxy/billing.ts`), not in `_shared/`
3. Defer imports of heavy modules (>5KB equivalent) inside the handler function
4. The handler entry point (`index.ts`) does only: CORS → kill switch → auth → route → return
5. Each function directory has its own `types.ts` for function-specific types

### Pattern 4: Upstash Redis for Shared Edge Function State

**What:** Replace in-memory `Map` objects in `_shared/rateLimit.ts` and `_shared/circuitBreaker.ts` with Upstash Redis (HTTP REST API), which works across Deno isolates and survives cold starts.

**When to use:** Any state that must be shared across edge function instances:
- Rate limit buckets (per-user sliding window)
- Circuit breaker state (per-upstream-service)
- Feature flags (already using `Deno.env.get()` — fine for per-deploy flags)

**Trade-offs:**
- (+) Shared across all isolates — rate limits and circuit breaker work correctly in production
- (+) HTTP-based (no WebSocket needed for Deno) — Upstash Redis exposes a REST API via `@upstash/redis`
- (+) Survives cold starts — state is durable
- (-) Adds ~5-20ms latency per check (network hop vs in-memory)
- (-) Costs money (Upstash has a generous free tier but production costs scale)

**Example — rate limiter with Upstash Redis:**

```typescript
// supabase/functions/_shared/rateLimit.ts
// @ts-ignore — Deno import from npm:
import { Redis } from 'npm:@upstash/redis@1.30';

const redisUrl = Deno.env.get('UPSTASH_REDIS_REST_URL');
const redisToken = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');

// Initialize lazily — don't connect on cold start
let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) {
    if (!redisUrl || !redisToken) {
      throw new Error('Upstash Redis not configured; fall back to in-memory');
    }
    redis = new Redis({ url: redisUrl, token: redisToken });
  }
  return redis;
}

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs = 60_000,
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  try {
    const redis = getRedis();
    const now = Date.now();
    const windowStart = now - windowMs;

    // Use a sorted set: member = timestamp, score = timestamp
    // ZREMRANGEBYSCORE removes old entries, ZCARD gets current count
    const redisKey = `ratelimit:${key}:${Math.floor(now / windowMs)}`;
    
    // Atomic: add timestamp + set TTL + check count
    const result = await redis
      .multi()
      .zadd(redisKey, { score: now, member: `${now}-${Math.random()}` })
      .zremrangebyscore(redisKey, 0, windowStart)
      .zcard(redisKey)
      .expire(redisKey, Math.ceil(windowMs / 1000) + 10) // TTL cleanup
      .exec();
    
    if (!result) return { allowed: true }; // fallback on error
    const count = result[2] as number;
    
    if (count > maxRequests) {
      return { allowed: false, retryAfterMs: windowMs };
    }
    return { allowed: true };
  } catch (err) {
    // Fail open on Redis error — better to allow through than block users
    console.error('Rate limit Redis error:', err);
    return { allowed: true };
  }
}
```

**Example — circuit breaker with Upstash Redis:**

```typescript
// supabase/functions/_shared/circuitBreaker.ts
import { Redis } from 'npm:@upstash/redis@1.30';

const FAILURE_THRESHOLD = 5;
const RECOVERY_MS = 30_000;

function getRedis(): Redis {
  // Same lazy init pattern as rateLimit.ts
}

export async function circuitAllow(name: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const key = `circuit:${name}`;
    const state = await redis.get<{ state: string; failures: number; lastFailure: number }>(key);
    
    if (!state || state.state === 'closed') return true;
    if (state.state === 'open') {
      if (Date.now() - state.lastFailure > RECOVERY_MS) {
        await redis.set(key, { state: 'half-open', failures: state.failures, lastFailure: state.lastFailure });
        return true;
      }
      return false;
    }
    // half-open
    return true;
  } catch {
    return true; // fail open
  }
}

export async function circuitSuccess(name: string): Promise<void> {
  try {
    const redis = getRedis();
    await redis.del(`circuit:${name}`);
  } catch { /* noop */ }
}

export async function circuitFailure(name: string): Promise<void> {
  try {
    const redis = getRedis();
    const key = `circuit:${name}`;
    const state = await redis.get<{ failures: number }>(key) || { failures: 0 };
    state.failures++;
    state.lastFailure = Date.now();
    state.state = state.failures >= FAILURE_THRESHOLD ? 'open' : 'closed';
    await redis.set(key, state, { ex: 300 }); // auto-expire after 5 min
  } catch { /* noop */ }
}
```

**Key design decisions:**
- Fail open on Redis errors (better to serve a request than block everything)
- Auto-expire circuit breaker state (prevents stale state from accumulating)
- Sorted sets for sliding window rate limiting (accurate, atomic, no race conditions)
- Lazy Redis client initialization (no TCP connection on cold start for health checks)

### Pattern 5: Streaming SSE from Edge Functions with Billing Accounting

**What:** Track usage (input tokens, output tokens, reasoning tokens, tool calls) during an SSE streaming response and record billing atomically when the stream ends. Handle edge cases: early termination, errors, token expiry, idempotent retries.

**When to use:** Any edge function that streams AI responses and needs to bill per-token.

**Trade-offs:**
- (+) Accurate billing — recorded at stream end with exact final usage from OpenRouter
- (+) Atomic — single `recordUsage` call per stream, failure-safe
- (-) Accounting object must be passed through the entire streaming pipeline
- (-) Token expiry mid-stream requires polling the JWT expiry before billing write

**Example — accounting pattern for SSE streaming:**

```typescript
// chat-proxy/billing.ts
export interface Accounting {
  finalized: boolean;
  userId: string;
  conversationId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  webSearchUsed: boolean;
  imagesCount: number;
  toolCalls: number;
  finishReason: string | null;
  error?: string;
}

// Called once at stream end, guarded by `finalized` flag
export async function finalizeAccounting(
  accounting: Accounting,
  supabase: any,
): Promise<void> {
  if (accounting.finalized) return; // idempotent guard
  accounting.finalized = true;

  // Minimum billing: if outputTokens is 0 but we did tool calls, bill minimum
  const billableOutput = Math.max(accounting.outputTokens, accounting.toolCalls > 0 ? 1 : 0);

  await recordUsage({
    userId: accounting.userId,
    conversationId: accounting.conversationId,
    model: accounting.model,
    inputTokens: accounting.inputTokens,
    outputTokens: billableOutput,
    reasoningTokens: accounting.reasoningTokens,
    webSearchUsed: accounting.webSearchUsed,
    imagesCount: accounting.imagesCount,
    toolCalls: accounting.toolCalls,
    finishReason: accounting.finishReason,
    error: accounting.error,
  });
}
```

**Key rules for SSE billing:**
1. **`finalized` guard prevents double-billing** — set to `true` before any async operation in the finalization path. If the function crashes during `recordUsage`, the next invocation must detect the un-finalized state and re-attempt.
2. **`finishReason` must be assigned on every exit path** — the current bug (BUG-05) is that some streaming paths never assign it, causing zero-cost billing. Every path in the stream pump must set `accounting.finishReason`.
3. **`[DONE]` sentinel must always be emitted** — even on error (BUG-06). Use `try/finally` in the SSE pump to ensure the sentinel is written.
4. **JWT expiry check before billing** — if the token expired mid-stream, the billing `recordUsage` call will fail. Use `supabase.auth.getUser()` just before `finalizeAccounting`; if it fails, log the usage to a dead-letter queue (e.g., `usage_logs` table with `recorded=false` flag) for manual reconciliation.

### Pattern 6: Mermaid and SVG Rendering with Security Isolation

**What:** Render Mermaid diagrams and SVG content inside sandboxed iframes, never directly in the main DOM. Apply `securityLevel` for Mermaid and DOMParser-based sanitization for SVG.

**When to use:** Any rendering of user-generated or AI-generated SVG/Mermaid content.

**Trade-offs:**
- (+) Iframe sandbox prevents JS execution in rendered content
- (+) Mermaid `securityLevel: 'strict'` blocks click handlers and JS in labels
- (-) Iframe means communication via `postMessage` — error bridge needed
- (-) DOMParser sanitization adds overhead vs regex but is not bypassable

**Example — Mermaid rendering:**

```typescript
// Right (current code at ArtifactRenderer.tsx:486-488 already uses 'strict')
mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'strict',  // Was 'loose' (BUG-08), now correctly 'strict'
});

// The SVG output from mermaid.render() is still inserted into the main DOM via innerHTML
// This is a remaining risk. Better: insert into a sandboxed iframe's srcdoc.
```

**Example — SVG rendering with iframe isolation (recommended):**

```typescript
// RECOMMENDED: Render SVG inside a sandboxed iframe, not in main DOM
function SvgRenderer({ svgContent }: { svgContent: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!iframeRef.current) return;
    // Sanitize SVG using DOMParser (not regex)
    const sanitized = sanitizeSvgDom(svgContent);
    // Set as srcdoc — iframe is sandboxed, no same-origin access
    iframeRef.current.srcdoc = sanitized;
  }, [svgContent]);

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts"  // Minimal — no allow-same-origin, no allow-popups
      title="SVG Preview"
      className="artifact-svg-iframe"
    />
  );
}

// DOMParser-based sanitization (replaces regex-based sanitizeSvg)
function sanitizeSvgDom(raw: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, 'image/svg+xml');
  
  // Remove all <script> elements
  doc.querySelectorAll('script').forEach(el => el.remove());
  
  // Remove all event handler attributes (onclick, onload, onerror, etc.)
  const allElements = doc.querySelectorAll('*');
  allElements.forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (/^on/i.test(attr.name)) {
        el.removeAttribute(attr.name);
      }
    });
  });
  
  // Remove <foreignObject> (can contain HTML/JS)
  doc.querySelectorAll('foreignObject').forEach(el => el.remove());
  
  // Remove <use> with external href (can load external resources)
  doc.querySelectorAll('[href^="http"], [xlink:href^="http"]').forEach(el => {
    el.removeAttribute('href');
    el.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
  });
  
  return doc.documentElement.outerHTML;
}
```

### Pattern 7: Pyodide Execution in Web Worker with Timeout

**What:** Execute Python code in a Pyodide Web Worker with a configurable timeout. Use `AbortController` to terminate the worker if execution exceeds the time limit.

**When to use:** Python artifact execution where code may contain infinite loops or long-running operations.

**Trade-offs:**
- (+) Worker termination via `worker.terminate()` is the only reliable way to stop Pyodide (no interrupt signal available in WASM)
- (+) Memory limits via Pyodide config or fixed-size buffer pre-allocation
- (-) `worker.terminate()` destroys the entire worker — must spawn a new one for each execution
- (-) Pyodide is ~8MB WASM — cold start for the worker is significant

**Example:**

```typescript
// src/workers/python.worker.ts
// Wraps Pyodide execution with timeout enforcement in the main-thread client

export interface PythonExecRequest {
  code: string;
  timeoutMs: number;  // default 30_000
  memoryLimitMB?: number;  // hint for pre-allocation
}

export interface PythonExecResult {
  stdout: string;
  stderr: string;
  error?: string;
  timedOut: boolean;
}

// In the store or service layer:
async function executePython(code: string, timeoutMs = 30_000): Promise<PythonExecResult> {
  const worker = new Worker(
    new URL('../workers/python.worker.ts', import.meta.url),
    { type: 'module' }
  );
  
  const result = await new Promise<PythonExecResult>((resolve) => {
    const timer = setTimeout(() => {
      worker.terminate();  // Hard kill — only reliable way with Pyodide
      resolve({
        stdout: capturedStdout,
        stderr: capturedStderr,
        error: 'Execution timed out',
        timedOut: true,
      });
    }, timeoutMs);
    
    worker.onmessage = (event: MessageEvent<PythonExecResult>) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    
    worker.onerror = (err) => {
      clearTimeout(timer);
      resolve({
        stdout: '',
        stderr: err.message,
        error: err.message,
        timedOut: false,
      });
    };
    
    worker.postMessage({ code, timeoutMs } as PythonExecRequest);
  });
  
  return result;
}
```

**Key rules:**
1. **Always `worker.terminate()` on timeout** — Pyodide has no yield points for cooperative interruption; only a hard thread kill works
2. **Re-create the worker for each execution** — once terminated, the worker is dead. Accept the Pyodide cold start (~2-3s) for the next execution
3. **Pre-allocate memory via Pyodide config** — `loadPyodide({ indexURL: '...', jsglobals: self })` and set `pyodide.setMemoryLimit()` if available
4. **Console capture** — redirect `sys.stdout` and `sys.stderr` to StringIO objects in the worker before execution, extract after completion

### Pattern 8: CSP for Vite/Vercel with Nonce Strategy

**What:** Add Content Security Policy headers to the Vite SPA deployed on Vercel. Use nonce-based inline script handling (not `'unsafe-inline'`) because Vite injects inline scripts for HMR and module preloading in production builds.

**When to use:** Production deployment of a Vite SPA that handles user-generated content (artifact rendering).

**Trade-offs:**
- (+) Nonce-based CSP is secure — inline scripts without the nonce are blocked
- (+) Vite supports `__NONCE__` replacement in `transformIndexHtml` hook
- (-) Nonce must be regenerated per-request — requires server-side rendering of index.html (or a serverless function at Vercel edge)
- (-) Static SPA deployment makes per-request nonces harder — `'unsafe-inline'` for development, strict CSP for production with a rewrite rule

**Vercel deployment strategy (recommended):**

```
// vercel.json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; frame-src 'self'; connect-src 'self' https://*.supabase.co https://api.openrouter.ai; object-src 'none'; base-uri 'self'; form-action 'self'"
        }
      ]
    }
  ]
}
```

**For Vite's inline scripts**, check the Vite build output. If Vite generates inline scripts in the built HTML (common for `@vitejs/plugin-react` with dev helpers), the above CSP will block them. Options:

1. **Switch to `'strict-dynamic'`** (modern, recommended):
   ```
   script-src 'strict-dynamic' 'self'; object-src 'none'; base-uri 'self'
   ```
   This allows any script loaded by an already-trusted script — works with JS bundles that inject inline scripts.

2. **Remove `@vitejs/plugin-react` dev injection** in production — check if `reactDevtools` or `reactRefresh` are included in the production build.

3. **Use Vite's `__NONCE__` in `transformIndexHtml`**:
   ```typescript
   // vite.config.ts
   export default defineConfig({
     plugins: [
       react(),
       {
         name: 'csp-nonce',
         transformIndexHtml: {
           enforce: 'post',
           transform(html) {
             // Replace script tags to use nonce (only works if Vercel edge rewrites serve dynamic HTML)
             return html.replace(
               /<script/g,
               '<script nonce="__CSP_NONCE__"'
             );
           },
         },
       },
     ],
   });
   ```

**For artifact iframes (`<iframe srcdoc>`):** The CSP's `frame-src 'self'` only applies to `src` iframes, not `srcdoc` iframes. `srcdoc` iframes inherit CSP from the parent page UNLESS they have their own `<meta http-equiv="Content-Security-Policy">` in the srcdoc HTML. **Add a meta CSP inside artifact srcdoc:**

```typescript
// ArtifactRenderer.tsx — inject CSP into iframe srcdoc
function buildSrcdoc(html: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta http-equiv="Content-Security-Policy" 
            content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; script-src 'unsafe-inline' 'unsafe-eval';">
      <!-- unsafe-inline needed for artifact JS to run; unsafe-eval for some frameworks -->
      ${attachErrorListener()}  <!-- existing error bridge injection -->
    </head>
    <body>${html}</body>
    </html>
  `.trim();
}
```

### Pattern 9: `iframe srcdoc` CSP and Sandbox for Artifact Rendering

**What:** User-generated HTML artifacts are rendered inside `<iframe srcdoc>` with explicit CSP headers and restrictive `sandbox` attribute.

**When to use:** Every HTML artifact renderered in `ArtifactRenderer.tsx`.

**Trade-offs:**
- (+) `sandbox="allow-scripts"` alone prevents network access, form submission, popups, and same-origin access
- (+) CSP inside srcdoc prevents inline script execution beyond what the sandbox allows
- (-) `sandbox` attribute conflicts with certain user-generated content features (e.g., `fetch()` for API demos)
- (-) Debugging inside sandboxed iframes is harder (no `console.log` visible in DevTools without `allow-same-origin`)

**Current sandbox (from ArtifactRenderer.tsx:223):**
```html
sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
```

**Recommended sandbox (tighter, review each flag):**
```html
<!-- Minimal sandbox for artifact rendering -->
sandbox="allow-scripts"
```
- Remove `allow-popups` and `allow-popups-to-escape-sandbox` (prevents `window.open()` which could be used for phishing)
- Remove `allow-forms` (prevents form submission to arbitrary URLs)
- Remove `allow-modals` (prevents `alert()`, `confirm()`, `prompt()` which can be annoying)
- Keep only `allow-scripts` (needed for most artifacts to function)

**Exception:** If users generate artifacts that require `fetch()` (API demos), add `allow-scripts` only — `fetch()` works with just `allow-scripts` in modern browsers. Do NOT add `allow-same-origin` (that would bypass CSP protections on the parent page).

**CSP inside srcdoc:**
```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'none'; 
               script-src 'unsafe-inline' 'unsafe-eval'; 
               style-src 'unsafe-inline'; 
               img-src data: https:; 
               connect-src *; 
               font-src data:;">
```

Key:
- `default-src 'none'` — blocks everything by default
- `connect-src *` — allows `fetch()` for API demos
- `img-src data: https:` — allows embedded and remote images
- `script-src 'unsafe-inline' 'unsafe-eval'` — allows artifact's own JS (eval needed for some bundlers like esbuild-wasm)

## Anti-Patterns

### Anti-Pattern 1: Cross-Store getState() Spaghetti

**What people do:** Import `useOtherStore` directly in a store module and call `useOtherStore.getState().someAction()`.

**Why it's wrong:** Creates implicit import chains. `authStore.ts` importing `chatStore.ts` means changing `chatStore`'s API signature can break `authStore` at runtime. Makes stores untestable in isolation.

**Do this instead:** Use Zustand's `subscribeWithSelector` middleware on the target store, defined in a single orchestration module. Stores themselves import nothing from other stores.

### Anti-Pattern 2: In-Memory State for Multi-Isolate Systems

**What people do:** Store rate limit buckets, circuit breaker state, and feature flags in module-level `Map` objects in edge functions.

**Why it's wrong:** Each Deno isolate has its own memory. A rate limit of 30 req/min per user is 30 req/min per ISOLATE — with 10 isolates, it's effectively 300 req/min. Circuit breaker state is lost on cold start. Feature flags in `Deno.env.get()` are actually fine (env vars are set per-deploy, not per-isolate).

**Do this instead:** Rate limit and circuit breaker state go to Upstash Redis (HTTP REST). Feature flags stay in `Deno.env.get()`.

### Anti-Pattern 3: Regex-Based SVG Sanitization

**What people do:** Use regex to strip dangerous content from SVG before injecting into the DOM (`svg.replace(/<script>/gi, '')`).

**Why it's wrong:** Regex can't parse HTML/SVG. Bypasses include: mixed case, encoded entities, attribute-based execution (`<svg onload=alert(1)>`), namespace tricks (`<svg:script>`), and HTML comments hiding content.

**Do this instead:** `new DOMParser().parseFromString(svg, 'image/svg+xml')` for SVG, then remove dangerous elements and attributes from the parsed DOM tree. SVG rendered via `innerHTML` in the main DOM should be moved to a sandboxed iframe instead.

### Anti-Pattern 4: Stateful Shared Modules in Edge Functions

**What people do:** Import a shared module into every edge function, even if only some need it (current `toolRegistry.ts` is imported by all functions that might need tool definitions).

**Why it's wrong:** Module imports in Deno are synchronous and loaded at function cold start. Importing `toolRegistry.ts` (4.5KB) into `deduct-credits/index.ts` adds unnecessary cold-start latency to a function that never uses tools.

**Do this instead:** Only import what each function needs. If a shared module is >2KB, make it a dynamic import inside the handler.

### Anti-Pattern 5: Module-Level Mutable State for Test-Unfriendly Patterns

**What people do:** Store debounce timers, caches, and in-flight request tracking in module-level variables (e.g., `const midstreamState = new Map()` in `chatStore.ts`).

**Why it's wrong:** Module state persists across HMR reloads, is not reset between tests, and creates hidden state that's easy to forget to clean up.

**Do this instead:** Move ephemeral state into Zustand stores or React refs. When module-level state is unavoidable (e.g., Supabase client singleton), expose explicit `dispose()` / `reset()` functions.

## Build Order Implications

The refactoring must happen in dependency order to avoid breaking the deployed app:

| Step | Refactoring | Dependencies | Risk |
|------|-------------|--------------|------|
| 1 | Test infra (Vitest + Playwright) | None | None — greenfield add |
| 2 | Shared types (`src/types/shared/`) | None | Low — pure types, no behavior change |
| 3 | Extract `messages/` from openrouter.ts | Test infra, shared types | Medium — pure functions, easy to verify with unit tests |
| 4 | Extract `rag/` from openrouter.ts | Test infra, shared types | Low — API call to edge function, easy to mock |
| 5 | Extract `streaming/` from openrouter.ts | Test infra, shared types | HIGH — SSE parsing is deeply coupled to callbacks. Must verify every callback fires at the right time. Manual test checklist required. |
| 6 | Extract `continuation/` from openrouter.ts | All of the above | HIGH — continuation loop is the most complex logic. Must regression-test: single pass, multi-pass, stall, repetition, artifact wrap-up. |
| 7 | Wire facade `index.ts` + thin `openrouter.ts` | Steps 3-6 | Medium — re-exports must match existing API exactly |
| 8 | Lazy-load `continuation/` (dynamic import) | Step 6 | Low — changes only the import site |
| 9 | Extract `auth/`, `billing/`, `tools/` from chat-proxy | Test infra | Medium — moderate refactor but each module is somewhat self-contained |
| 10 | Upstash Redis for rate limit + circuit breaker | Steps 9+ | Medium — changes to existing working code, requires `UPSTASH_REDIS_*` env vars |
| 11 | Zustand `subscribeWithSelector` migration | Test infra | Medium — changes cross-store behavior, verify with integration tests |
| 12 | CSP + iframe sandbox hardening | None | Low — additive headers, no behavior change |
| 13 | Pyodide timeout + worker management | Existing pyodide worker | Low — additive, wraps existing worker |
| 14 | DOMParser SVG sanitization | Existing ArtifactRenderer | Medium — changes existing sanitization, verify with bypass tests |
| 15 | SSE billing accounting fix | Steps 9-10 | HIGH — billing bugs caused revenue loss. Must test every exit path assigns `finishReason`. |

**Critical risk:** Steps 5, 6, and 15 require manual testing checklists. The user cannot run `supabase start` locally, so verification is by pushing to Vercel + Supabase dev and testing manually. Each of these steps must produce a checklist of:
1. What to test (exact steps)
2. What to expect (exact output)
3. What failure looks like (how to know it's broken)

## Data Flow (Key Paths)

### Primary Chat Flow

```
1. User types message -> MessageInput
2. MessageInput calls chatStore.sendMessage()
3. chatStore.sendMessage():
   a. Creates optimistic message in state
   b. Calls messages/buildApiMessages() with current conversation history
   c. Calls rag/retriever.retrieveRelevantChunks() if RAG is enabled
   d. Calls messages/pruner.pruneMessagesForContext() to fit context window
   e. Calls streaming/streamClient.fetch() with built messages -> POST to chat-proxy
4. chat-proxy/index.ts:
   a. Verifies JWT via supabase.auth.getUser()
   b. Calls checkRateLimit() -> rejects if over limit
   c. Calls circuitAllow('openrouter') -> rejects if circuit open
   d. Calls streamHandler() -> OpenRouter fetch + SSE pump
5. streamHandler():
   a. POST to OpenRouter with stream:true
   b. Read response body as ReadableStream
   c. Parse SSE lines, emit events:
      - tool_activity -> execute tool, merge results, continue streaming
      - content_start -> signal model transition
      - delta.content / delta.reasoning -> queue for SSE output
      - finish_reason:'length' -> set continuation flag
      - [DONE] -> close SSE stream
   d. On stream end: finalizeAccounting()
      - Set accounting.finishReason from last chunk
      - Calculate usage from response headers/content
      - recordUsage() to DB
6. Frontend streaming/processStream.ts:
   a. Parse SSE event stream from chat-proxy
   b. Route chunks via callbacks:
      - onChunk: chatStore.updateMessage() batches at 16ms
      - onToolActivity: update UI state
      - onReasoning: update thinking box
      - onDone: check continuation
   c. continuation/engine.ts checks:
      - Was finish_reason 'length'?
      - Not repeating? Not stalled? Not structural regression?
      - If yes: buildContinuationMessages() + streamClient.fetch() for next pass
   d. On final done: persist message to Supabase, trigger credit sync
```

### Artifact Rendering Flow

```
1. Streaming detects <lucen_artifact> via artifactParser regex
2. Content between tags accumulated in artifact buffer
3. On artifact close tag (or stream end):
   a. artifactParse.worker.ts parses artifact metadata
   b. ArtifactWorkspace renders:
      - html -> <iframe srcdoc> with sandbox + meta CSP
      - svg -> <iframe srcdoc> with DOMParser-sanitized SVG
      - mermaid -> mermaid.render() with securityLevel:'strict' -> <div> with SVG
      - file -> download button or preview
   c. iframeErrorBridge.ts captures runtime errors via postMessage
```

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-1k users | Current architecture + Upstash Redis for shared state is sufficient. 4 Deno isolates handle the load. |
| 1k-10k users | Need Redis-backed rate limiting (the in-memory limit breaks at this scale). Consider adding a CDN cache for static assets. |
| 10k+ users | Need dedicated compute for edge functions (Supabase Pro or Team plan). Consider splitting chat-proxy into separate functions for streaming vs tool execution. |

### Scaling Priorities

1. **First bottleneck:** Per-isolate in-memory rate limiting (current state). At ~100 concurrent users, rate limits become ineffective because each isolate has its own window. Fix: Upstash Redis (already planned).

2. **Second bottleneck:** Pyodide worker memory for Python artifacts. Each Pyodide instance uses ~8MB WASM + heap. With many concurrent Python executions, browser memory can exceed 500MB. Fix: limit concurrent Python executions to 2 per tab, queue the rest.

## Sources

- `zustand/docs` — Zustand v5 `subscribeWithSelector` middleware documentation (github.com/pmndrs/zustand)
- `supabase/functions/_shared/` — Current edge function shared utilities (codebase analysis)
- `src/services/openrouter.ts` — Current monolith being decomposed (codebase analysis)
- `supabase/functions/chat-proxy/index.ts` — Current edge function monolith being decomposed (codebase analysis)
- `Deno KV documentation` — docs.deno.com/deploy/kv/manual (Deno KV not available in Supabase Edge Functions)
- `Upstash Redis for Deno` — npm:@upstash/redis (HTTP REST-based Redis for Deno)
- `ArtifactRenderer.tsx` — Current iframe sandbox and Mermaid rendering (codebase analysis: `securityLevel:'strict'`, sandbox attributes)
- `CSPS Evaluator` — MDN CSP documentation (developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- `Vite CSP nonce` — Vite docs on transformIndexHtml (vite.dev/guide/api-plugin#transformindexhtml)

---
*Architecture research for: Lucen v2.3 stabilization — modulith decomposition, shared types, edge function patterns, cross-store communication, sandboxing*
*Researched: 2026-06-08*