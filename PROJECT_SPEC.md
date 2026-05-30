# Lucen — Project Specification
> This is the authoritative source of truth for what Lucen is, what it does, and how every part of it behaves.
> Every AI session working on this codebase MUST read this file before making any changes.
> Last updated after streaming + tool call fixes (May 2026).

---

## What Lucen Is

Lucen is a paid AI chat SaaS product. Users pay for credits and use them to chat with AI models. It is a competitor to ChatGPT and similar products. It is built by a solo founder using AI-assisted IDEs.

**Core value proposition:** A powerful AI chat interface with artifact generation, file understanding, web search, and Python execution — sold on a credit-based subscription model.

---

## User Types

| Type | Access | Credits |
|------|--------|---------|
| Free | 500 free credits on signup, no subscription | Limited |
| Regular | Paid subscription, 4,000 credits/month | Monthly refresh |
| Pro | Paid subscription, 10,000 credits/month | Monthly refresh |
| Admin | Full platform dashboard, set via VITE_ADMIN_EMAILS | Unlimited |

---

## Every Screen & What It Does

### 1. HomePage (`/`)
The main chat workspace. This is where all chat happens.

**Layout:** Three-panel layout:
- Left: Sidebar (conversation history)
- Center: ChatArea (messages)
- Right: ArtifactWorkspace (code preview, only visible when artifact exists)

**Behavior on load:**
- If not logged in → redirect to `/login`
- If logged in → load last conversation or start new one
- Sync user settings and theme from database
- Load conversation list in sidebar

---

### 2. LoginPage (`/login`)
Email + password sign in form.

**Flow:**
1. User enters email + password
2. On success → redirect to `/`
3. On failure → show inline error message
4. Link to signup page
5. Link to forgot password

---

### 3. SignupPage (`/signup`)
New account registration.

**Flow:**
1. User enters email + password
2. Submit → Supabase sends 6-digit OTP to email
3. Redirect to OTP verification screen
4. User enters 6-digit code
5. On success → account created, logged in, redirect to `/`

---

### 4. OtpVerifyScreen
Shown after signup or password reset.

**Behavior:**
- 6 individual digit input boxes
- Auto-advance to next box on digit entry
- Auto-submit when all 6 digits filled
- Resend code link (with cooldown timer)
- Error message on wrong code

---

### 5. ResetPasswordScreen (`/reset-password`)
User enters their email to receive a reset code.

**Flow:**
1. User enters email
2. Submit → Supabase sends 6-digit OTP
3. Redirect to OTP verify screen
4. After OTP verified → redirect to NewPasswordScreen

---

### 6. NewPasswordScreen
User sets their new password after OTP verification.

**Behavior:**
- Only accessible after `otpVerified = true` in authStore
- Password + confirm password fields
- On success → signs out all other sessions, redirects to `/`

---

### 7. SettingsScreen (modal/panel, not a route)
Opened from navbar. Contains tabs.

**Tabs:**
- **Appearance**: Theme selector (dark/light/custom), font size, bubble style
- **Models**: View active main model and side model info, token limits
- **Usage**: Credit balance, usage history, subscription status, upgrade button
- **Account**: Email display, logout button

---

### 8. OwnerDashboard (`/admin`)
Only accessible to emails in `VITE_ADMIN_EMAILS`.

**Shows:**
- Total users count
- Total credits used platform-wide
- Recent usage logs
- Per-user stats

---

### 9. ArtifactHub (`/hub`)
Public gallery of shared artifacts.

**Behavior:**
- Shows all artifacts where `is_public = true`
- Sorted by spark_count (upvotes) by default
- Filter by tags
- Full-text search
- Click artifact → opens preview
- Logged-in users can "spark" (upvote) artifacts
- Logged-in users can comment

---

### 10. PackagesPage (`/packages`)
Public pricing page.

**Shows:**
- Free plan features
- Regular plan features + price
- Pro plan features + price
- Upgrade buttons → trigger Lemon Squeezy checkout

---

### 11. Marketing Pages
`/about`, `/contact`, `/privacy`, `/terms`, `/refund` — static content pages.

---

## Chat Interface — Detailed Behavior

### Sending a Message

1. User types in MessageInput textarea
2. Can attach files by clicking paperclip or dragging onto textarea
3. Submit with Enter (Shift+Enter = newline) or send button
4. Message bubble appears immediately (optimistic UI)
5. Loading indicator shows in AI response bubble
6. If files attached → upload and embed happens before AI call
7. Intent classification runs (decide if web search needed)
8. Stream begins from chat-proxy

### Streaming Response Display

**Reasoning/Thinking:**
- If model returns reasoning tokens → show collapsible "Thinking..." bubble above main response
- Thinking bubble auto-expands while streaming, user can collapse it
- When main response starts → thinking bubble collapses and locks

**Main Response:**
- Streams in word by word in real time — never dumps all at once
- Markdown rendered as it streams (headers, bold, lists, code blocks)
- Code blocks have syntax highlighting and copy button
- Math equations rendered with MathJax
- Mermaid diagrams rendered inline

**Artifact Generation:**
- When AI responds with `<lucen_artifact>` tag → right panel opens automatically
- Shows artifact type (HTML, SVG, Mermaid, Python, file)
- Preview renders in real time as code streams in
- After streaming done → preview refreshes with final code
- If artifact has runtime error → error banner appears with "Auto-fix" button

### Tool Calls During Chat

**What tools exist:**
- `analyze_image` → sends image to vision model, returns description
- `process_file` → extracts content from uploaded file
- `web_search` → searches web via Tavily, returns results

**How tool calls work (CRITICAL — do not change this flow):**
1. Model decides it needs a tool → emits tool_call delta
2. Backend (chat-proxy) detects tool_call, executes it server-side
3. Frontend shows tool activity indicator ("Searching the web...", "Analyzing image...")
4. Tool result goes back to model as context
5. Model generates final response
6. Final response streams to frontend as normal

**Rules:**
- Tool calls NEVER happen on frontend — always server-side in chat-proxy
- Max 3 tool call rounds per message
- Independent tools can run in parallel
- Dependent tools run sequentially
- All tools validated against allowlist: `['analyze_image', 'process_file', 'web_search']`
- Tool output truncated at 12,000 characters max
- Each round checks credits before proceeding

### Credit Deduction
- 1 credit per 1,000 tokens (prompt + completion combined)
- Web search: additional credits per search
- Deducted AFTER stream completes successfully
- If credits reach 0 mid-turn → stream stops, user shown "Insufficient credits" message
- Failed/errored requests do NOT deduct credits

### Context Management
- Sliding window — old messages pruned when approaching model context limit
- System prompt always preserved
- If >5 messages pruned → auto-generate conversation summary injected as system message
- File attachments included as context up to token budget
- RAG retrieval for large documents (vector search, top-k chunks)

---

## Artifact System — Detailed Behavior

### Artifact Types
| Type | Preview | Description |
|------|---------|-------------|
| `html` | Live iframe | Full HTML/CSS/JS apps |
| `svg` | SVG renderer with pan/zoom | Vector graphics |
| `mermaid` | Mermaid.js diagram | Flowcharts, sequence diagrams |
| `python` | Pyodide terminal output | Python scripts run in browser |
| `file` | Code viewer with download | Any other code/text file |

### Artifact Workspace Panel
- Opens automatically when artifact is generated
- Three sub-panels: Code editor | Preview | AI refinement chat (SideChatPanel)
- Resize handles between panels
- Tabs: current artifact, version history

### Self-Healing
- If HTML artifact has JavaScript runtime error → error captured via iframeErrorBridge
- Error automatically sent back to AI with prompt to fix
- Max 3 auto-fix attempts
- User can also click "Fix this" manually

### Versioning
- Every AI update to an artifact creates a new version
- Version selector in toolbar (v1, v2, v3...)
- Can revert to any prior version
- Versions stored in `artifacts` table with lineage tracking

### Patching
- AI can update artifacts with git-style unified diff patches
- Patch shown as PatchSummaryCard before applying
- If patch fails to apply cleanly → falls back to full replacement
- Patch history tracked in `artifact_versions`

### Publishing to Hub
- User clicks "Share" on any artifact
- Fill in: title, description, tags, custom slug
- Sets `is_public = true`
- Artifact appears in public Hub at `/hub/[slug]`
- Owner can unpublish at any time

---

## File Upload System

### Supported File Types
| Type | Processing |
|------|-----------|
| Images (jpg, png, gif, webp) | Uploaded to Supabase storage, described by vision model when needed |
| PDF | Text extracted client-side via pdfjs |
| Word (.docx) | Text extracted via Mammoth (loses formatting/images) |
| Spreadsheet (.xlsx, .csv) | Parsed via SheetJS, shown as grid in AttachmentViewer |
| Presentation (.pptx) | XML extracted via JSZip |
| Plain text | Read directly |

### Upload Flow
1. User selects/drops file onto chat
2. File parsed client-side → text extracted
3. Text chunked and embedded via `embed` edge function
4. Chunks stored in `document_chunks` with vector embeddings
5. File metadata stored in `file_attachments`
6. When user asks about file → `retrieve-chunks` does vector search → top chunks injected into prompt

### File Library
- Persistent file panel showing all uploaded files in current conversation
- Shows file name, type icon, token count
- Can remove files from context
- Drag-and-drop zone always visible

---

## Sidebar — Detailed Behavior

### Conversation List
- Shows all user conversations sorted by most recent
- Each item shows: title (AI-generated), timestamp, first message preview
- Click → switch to that conversation
- Hover → shows delete button
- Title auto-generated after first AI response

### New Chat Button
- Creates new empty conversation
- Clears chat area
- Does NOT delete current conversation

### Search
- Search bar at top of sidebar
- Full-text search across all messages in all conversations
- Results highlight matching text

### Keyboard Shortcuts
- `Cmd/Ctrl + K` → open CommandPalette (global search + actions)
- `Cmd/Ctrl + N` → new conversation
- `Cmd/Ctrl + /` → toggle sidebar

---

## Credit & Billing System

### Credit Balance Display
- Shown in navbar (e.g. "1,247 credits")
- Updates in real time after each message
- Clicking opens Usage tab in Settings

### Free Tier
- 500 credits on signup (10-year expiry)
- No web search on free tier (blocked)
- Upgrade prompt shown when credits < 50

### Paid Tiers
- Checkout via Lemon Squeezy
- Credits allocated via webhook after payment
- Monthly refresh (old credits expire, new credits added)
- FIFO credit deduction (oldest credits used first)
- Subscription portal link available in Settings

### Credit Exhaustion
- When credits = 0 → chat input disabled
- Banner shown: "You've run out of credits. Upgrade to continue."
- Upgrade button opens PricingModal

---

## Theme System

### Built-in Themes
- `lucen` (default dark)
- Light theme (available)
- Custom (user-defined CSS variables)

### Customizable Variables
- Primary color
- Background color
- Font family
- Message bubble style (rounded/sharp/minimal)

### Storage
- Theme saved to `user_settings.active_theme` in database
- Synced across sessions/devices

---

## Security Model

### What Must Always Be True
1. JWT required for every edge function call — no exceptions
2. All database writes go through RLS policies — users can only touch their own rows
3. Credit manipulation only via `SECURITY DEFINER` SQL functions — never direct UPDATE from frontend
4. OpenRouter API key never exposed to frontend — only in backend secrets
5. Lemon Squeezy webhook validated via HMAC-SHA256 before processing
6. Checkout variant IDs validated against allowlist — no arbitrary product checkout
7. Tool calls only execute from chat-proxy — never from frontend
8. Admin dashboard only accessible to emails in VITE_ADMIN_EMAILS env var

### What the Frontend Is Allowed To Do
- Read its own data via Supabase client with anon key + RLS
- Call edge functions with user JWT
- Upload files to `attachments` storage bucket (own folder only)
- Read public artifacts from Hub

### What the Frontend Must NEVER Do
- Call OpenRouter directly
- Call Tavily directly
- Modify credit balances directly
- Access other users' data

---

## Known Limitations (Do Not "Fix" These)
- Mammoth Word parsing loses tables, images, and formatting — this is expected
- `stripe_customer_id` column exists in `user_credits` but is unused — leave it
- Free tier users cannot use web search — this is intentional
- Pyodide Python execution is slow on first load (WASM init) — expected

---

## Current Model Configuration
- Main chat model: configured via `VITE_MAIN_CHAT_MODEL` env var
- Side/utility model: configured via `VITE_SIDE_CHAT_MODEL` env var  
- Intent classification model: `WEB_INTENT_MODEL` backend secret
- Vision model: `VISION_HELPER_MODEL` backend secret
- Embedding model: `EMBEDDING_MODEL` backend secret (Gemini, 768-dimension vectors)
- All models accessed via OpenRouter API

---

## Edge Functions Reference

| Function | Purpose | Auth |
|----------|---------|------|
| `chat-proxy` | Main AI chat, tool orchestration, credit deduction | JWT required |
| `classify-intent` | Decides if web search needed | JWT required |
| `describe-image` | Vision model image description | JWT required |
| `embed` | Generate + store document embeddings | JWT required |
| `retrieve-chunks` | Vector similarity search for RAG | JWT required |
| `generate-title` | Auto-title conversations, summarize context | JWT required |
| `ls-checkout` | Create Lemon Squeezy checkout URL | JWT required |
| `ls-webhook` | Process payment webhooks | HMAC signature (no JWT) |
| `get-model-config` | Return model config to frontend | JWT + admin check |
