# Lucen — Architecture Document
> Technical decisions, data flows, and structural rules.
> Read this before changing any core system. Never violate the constraints listed here.

---

## Stack Overview

```
Frontend          →  React 19 + Vite + Zustand + React Router
Deployment        →  Vercel (frontend)
Backend           →  Supabase Edge Functions (Deno)
Database          →  PostgreSQL on Supabase + pgvector
Auth              →  Supabase Auth (OTP + password)
AI Provider       →  OpenRouter (all models)
Search            →  Tavily API
Payments          →  Lemon Squeezy
In-browser Python →  Pyodide (WASM worker)
```

---

## Critical Architecture Rules

These are non-negotiable. Breaking any of these will break the system.

1. **OpenRouter API key lives in backend only.** `OPENROUTER_API_KEY` is a Supabase secret. It never appears in frontend code or Vite env vars.

2. **chat-proxy is the only entry point to AI.** All AI calls go through `supabase/functions/chat-proxy/index.ts`. The frontend calls chat-proxy, chat-proxy calls OpenRouter. Never route around this.

3. **Tool calls are server-side only.** Tools (`analyze_image`, `process_file`, `web_search`) are executed inside chat-proxy via sibling function calls. The frontend only receives `tool_activity` SSE events and final streamed content. Frontend never executes tools directly.

4. **Credit mutations are SQL-function-only.** `deduct_user_credits`, `grant_subscription_credits`, `expire_subscription_ledgers` are `SECURITY DEFINER` functions. Frontend and edge functions call these functions — they never run `UPDATE user_credits SET remaining_credits = ...` directly.

5. **RLS is always on.** Every table has RLS. Never disable it. Never use service role key on the frontend.

6. **Stream first, parse second.** chat-proxy must flush chunks to the client as they arrive. Never buffer entire responses before sending.

7. **Reasoning tokens stream immediately.** If a chunk has `delta.reasoning` or `delta.reasoning_content`, it gets flushed to the client right away — it does not wait in the outerLoop buffer.

8. **`treatReasoningAsContent = true` for ALL models after tool calls.** When `after_tool_calls` is true in a `content_start` event, all reasoning tokens route to main content — not the thinking box. This applies to every model, not just MiniMax.

---

## Request Flow — Standard Chat Message

```
User submits message
        ↓
FileProcessor (client) — if files attached:
  → extract text client-side
  → POST /functions/v1/embed  (chunks + vectors stored)
        ↓
openrouter.ts: buildApiMessages()
  → assemble message history
  → inject RAG chunks if document conversation
  → inject prior tool steps as proper tool_calls / tool messages
  → prune to fit context window (preserve system prompt + pinned msgs)
        ↓
POST /functions/v1/classify-intent
  → checks last 10 messages
  → returns: 'search' | 'skip' | 'clarify'
  → if 'search': calls Tavily, injects results into system prompt
        ↓
POST /functions/v1/chat-proxy  (SSE stream)
  → verify JWT
  → check credits (abort if ≤ 0)
  → build OpenRouter request with tools if files/images present
  → send to OpenRouter
        ↓
chat-proxy stream handling:
  → outerLoop: detect if first response is tool_call or content
    - reasoning chunks (delta.reasoning/reasoning_content) → flush immediately, break loop
    - tool_call chunks → stay in loop, collect tool call data
    - content chunks → break loop, start passthrough streaming
  → if tool_calls detected:
    - validate each tool call (id, name, allowlist)
    - execute tools (parallel if independent, sequential if dependent)
    - re-check credits each round
    - append tool results as proper OpenAI messages
    - loop back for next model round (max 3 rounds)
  → final response: emit content_start event, stream tokens to client
  → on stream end: deduct credits, write usage_log
        ↓
Frontend processStream():
  → reads SSE chunks
  → tool_activity events → update UI tool indicators
  → content_start with after_tool_calls → set treatReasoningAsContent = true (ALL models)
  → delta.reasoning → onReasoning callback (thinking box) OR onChunk (if treatReasoningAsContent)
  → delta.content → onChunk callback (main message)
  → finish_reason 'stop' → finalize message
        ↓
chatStore:
  → batches incoming chunks (16ms intervals) to prevent render thrashing
  → updates message.content and message.reasoning separately
  → persists final message to Supabase messages table
```

---

## Request Flow — Tool Call Detail

```
chat-proxy detects finish_reason === 'tool_calls'
        ↓
For each tool_call in toolCallsMap:
  1. Validate tc.id exists (generate UUID if missing)
  2. Validate tc.function.name exists (skip if missing)
  3. Check name is in ALLOWED_TOOLS = ['analyze_image', 'process_file', 'web_search']
  4. Parse tc.function.arguments as JSON (if fails → inject error result, skip execution)
        ↓
Determine execution order:
  - Check toolRegistry.ts canRunInParallel flag for each tool
  - Group parallel tools → execute concurrently with Promise.all
  - Sequential tools → execute one at a time, pass results forward
        ↓
For each tool execution:
  → emit SSE event: tool_activity { status: 'running', toolName: '...' }
  → callSiblingFunction(toolName, args, userJwt)
  → truncate output to 12,000 chars max
  → emit SSE event: tool_activity { status: 'completed'/'failed', toolName: '...' }
        ↓
Build new messages array:
  → append: { role: 'assistant', tool_calls: [...] }
  → append: { role: 'tool', tool_call_id: tc.id, content: result }[] for each tool
        ↓
Increment rounds counter
Re-check credits before next round
If rounds >= maxRounds (3) → stop, return final response with what we have
Otherwise → loop back to new OpenRouter call
```

---

## Data Flow — File Upload & RAG

```
User uploads file
        ↓
fileProcessor.ts (client-side):
  → PDF: pdfjs extracts text
  → DOCX: Mammoth extracts plain text (loses formatting)
  → XLSX/CSV: SheetJS parses to text table
  → PPTX: JSZip extracts XML text
  → Images: stored directly, no text extraction
        ↓
Text truncated to 50,000 chars
POST /functions/v1/embed:
  → splits text into 400-word chunks (50-word overlap)
  → deletes existing chunks for this file (idempotency)
  → calls OpenRouter embedding model (768 dimensions)
  → stores chunks + vectors in document_chunks table
        ↓
On next user message:
POST /functions/v1/retrieve-chunks:
  → embeds the user query
  → cosine similarity search via match_document_chunks SQL function
  → returns top-k most relevant chunks
  → injected into system prompt as context
```

---

## Auth Flow

```
Signup:
  supabase.auth.signUp(email, password)
  → Supabase sends 6-digit OTP to email
  → Frontend shows OtpVerifyScreen
  → supabase.auth.verifyOtp(email, token, 'signup')
  → Session established
  → syncDataOnLogin() runs

Login:
  supabase.auth.signInWithPassword(email, password)
  → Session established
  → syncDataOnLogin() runs

Session maintenance:
  → JWT stored in localStorage by Supabase client
  → authStore listens to onAuthStateChange
  → openrouter.ts refreshes session before each chat request if needed

Frontend → Edge Function auth:
  → supabase.auth.getSession() → session.access_token
  → Sent as: Authorization: Bearer <JWT>
  → Edge function calls supabase.auth.getUser(jwt) to verify
  → Extracts user.id for all database operations
```

---

## Database Schema Quick Reference

```
conversations     — user_id, title, created_at, updated_at
messages          — conversation_id, user_id, role, content, reasoning, tool_steps, is_streaming
user_credits      — user_id, remaining_credits, subscription_status, subscription_plan
credit_ledgers    — user_id, initial_amount, remaining_amount, expires_at, subscription_id (FIFO)
usage_logs        — user_id, conversation_id, model_id, tokens, credits, duration, status
webhook_events    — event_id (PK), event_name, user_id, credits_granted (idempotency table)
file_attachments  — message_id, conversation_id, user_id, file_name, extracted_text, ai_description
document_chunks   — conversation_id, message_id, user_id, content, embedding (vector 768)
artifacts         — user_id, conversation_id, type, content, is_public, lineage_id, version_no, is_head
artifact_votes    — artifact_id, user_id (composite PK — 1 vote per user per artifact)
artifact_comments — artifact_id, user_id, content
user_settings     — user_id, active_theme, settings (JSONB)
```

---

## State Management (Zustand Stores)

```
authStore       — user session, auth state, login/logout actions
chatStore       — conversations, messages, streaming state, pending chunks
settingsStore   — theme, model config, user preferences
debugStore      — dev payload capture (only active if VITE_DEV_PAYLOAD_CAPTURE=true)
```

**chatStore streaming state machine:**
```
idle → sending → streaming_reasoning → streaming_content → complete
                      ↕
                 tool_calling (between reasoning and content)
```

---

## SSE Event Types (chat-proxy → frontend)

| Event | When | Payload |
|-------|------|---------|
| `data: {...}` | Every chunk | Standard OpenAI SSE chunk |
| `event: tool_activity` | Tool starts/ends | `{ toolName, status: 'running'/'completed'/'failed' }` |
| `event: web_search_results` | After web search | `{ results: [...] }` |
| `event: content_start` | Before final response | `{ after_tool_calls: bool }` |
| `event: error` | Fatal error | `{ message, code }` |
| `: keepalive` | Every 5s during tool execution | (empty, prevents timeout) |
| `data: [DONE]` | Stream end | — |

---

## Token Budget Logic

```
VITE_MAIN_CHAT_CONTEXT_WINDOW  — total context the model supports
VITE_MAIN_CHAT_MAX_OUTPUT      — max tokens for response
VITE_CHAT_OUTPUT_CEILING       — app-level cap on output (may be lower than model max)
VITE_ARTIFACT_OUTPUT_CEILING   — higher cap when generating artifacts
VITE_ABSOLUTE_OUTPUT_CEILING   — hard ceiling, never exceeded regardless of settings

pruneMessagesForContext():
  1. Always keep: system prompt, pinned messages, current streaming message
  2. Walk backward through history
  3. Approximate tokens: 4 chars = 1 token
  4. Drop messages when budget exceeded
  5. If >5 messages dropped: call generate-title in 'summary' mode, inject summary
```

---

## Credit Math

```
Text credits:    total_tokens / 1000 * 1 credit
Web search:      1 credit per search result returned (billed separately)
Image credits:   image_tokens / 1000 * rate (varies by model)

deduct_user_credits(user_id, amount):
  → FIFO: deduct from ledger with earliest expires_at first
  → Update remaining_credits cache in user_credits
  → Update total_used and billing_cycle_usage
  → If balance = 0, return -1 (triggers insufficient credits handling)
```

---

## Continuation Logic

When model returns `finish_reason === 'length'` (hit output token limit mid-response):

```
1. Check if truncation is inside <lucen_artifact> tag
2. If yes: send continuation prompt to resume artifact generation
3. If no: send continuation prompt to resume plain text
4. Concatenate new chunk to existing message seamlessly
5. Max continuations: VITE_CONTINUATION_MAX_CHUNKS_ARTIFACT or VITE_CONTINUATION_MAX_CHUNKS_CHAT
6. Stop if: repetition detected (sliding window overlap), low entropy, unbalanced HTML tags
```

---

## Environment Variable Ownership

**Frontend (VITE_ prefix, safe to be in Vercel env):**
- Supabase URL + anon key (safe — RLS protects data)
- Model display names and token limits
- Lemon Squeezy variant IDs (not secret)
- App name, admin emails, log level

**Backend only (Supabase secrets — NEVER in frontend):**
- `OPENROUTER_API_KEY`
- `TAVILY_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LEMON_SQUEEZY_API_KEY`
- `LEMON_SQUEEZY_WEBHOOK_SECRET`
- `LEMON_SQUEEZY_STORE_ID`

---

## Deployment

- **Frontend:** Vercel. Auto-deploys on push to main branch.
- **Edge Functions:** Supabase. Deploy via `supabase functions deploy <name>` or GitHub Actions.
- **Database migrations:** `supabase/migrations/` folder. Apply via `supabase db push`.
- **Secrets:** Set via `supabase secrets set KEY=value` — never committed to git.
