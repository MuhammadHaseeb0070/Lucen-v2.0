# Lucen — Project Profile & Status

## What This Is

An AI chat SPA (React 19 + Vite + Supabase) that the user works on daily on the `dev` branch, pushing to production via Vercel + Supabase.

## Core Value

Ship a secure, performant, well-tested, and premium-quality AI assistant with robust tools and billing controls.

## Requirements

### Validated

- ✓ React 19 SPA with Vite + TypeScript strict mode builds (`tsc -b && vite build`) — v2.3
- ✓ Supabase auth (email + OTP + password reset) — JWT-validated across all edge functions — v2.3
- ✓ AI chat streaming via OpenRouter proxy (chat-proxy edge function) — v2.3
- ✓ RAG: file → chunk → embed → pgvector retrieval (768-dim) — v2.3
- ✓ Credit/subscription system: Lemon Squeezy checkout, atomic credit deduction, FIFO ledger — v2.3
- ✓ Artifact system: `<lucen_artifact>` parsing, HTML/SVG/Mermaid render, versioning, voting, public Hub — v2.3
- ✓ React workspace sandbox (Code editor, preview iframe, terminal, diagnostics, AI panel) — v2.3
- ✓ 13 Zustand stores with persistence for chat, UI, credits, side-chat — v2.3
- ✓ Marketing pages (home, about, contact, packages, terms, privacy, refund) — v2.3
- ✓ Sentry error monitoring integration — v2.3
- ✓ Monolithic openrouter.ts and chat-proxy split into focused modules — v2.3
- ✓ Rate limiting and circuit breakers with shared Upstash Redis state — v2.3
- ✓ DOMPurify SVG/Mermaid sanitization and restricted allow-scripts sandbox — v2.3
- ✓ Vitest + Playwright test infrastructure with 42 unit and 10 E2E tests — v2.3
- ✓ JWT verification mid-stream and forged JWT alert safeguards — v2.3
- ✓ File upload size limit validations, content-hash deduplication, and encrypted file error states — v2.3
- ✓ Parallel Web Search: Support parallelizable tool execution for `web_search` to fetch results concurrently — v2.5
- ✓ Dynamic Step Limits: Prevent step ceiling truncation errors by scaling `maxRounds` dynamically (up to 5 rounds for attachment + web search calls) — v2.5
- ✓ Stronger Final Turn Prompting: Prevent LLM tool leakages in final rounds by prompting with strong negative constraints when limits are reached — v2.5
- ✓ Defensive Tag Sanitization: Harden client-side XML tag stripping to defensively clean all possible parameters and leaked tool tags — v2.5
- ✓ Premium Steps and Citations UI: Restyle tool step statuses and domain citations to be beautiful, glassmorphic, and dynamic — v2.5
- ✓ Transition Artifact Type: Move from 'python' to 'excel' in type definitions and parsing — v2.6
- ✓ Rebuilt Pyodide Worker: Preload packages, set 60s timeout, and configure headless Agg backend — v2.6
- ✓ Excel UI Renderer: Multi-stage loading, error classification, and download cards with self-correction feedback — v2.6
- ✓ System Prompt Refactoring: Refactored base prompt with excel instructions and strict tags — v2.6
- ✓ Multi-Model Secret Configuration: Implement primary, secondary, and tertiary model fallback secrets — v2.7
- ✓ Sequential Fallback Execution Loop: Graceful try-catch model failovers in both streaming and non-streaming modes — v2.7
- ✓ Parameter Normalization Registry: Normalize reasoning model payloads (strip temperature/top_p, convert to max_completion_tokens) — v2.7
- ✓ Dynamic Metadata Header Sync: Return dynamically matched model headers and sync to client stores — v2.7
- ✓ Configuration Sync Update: Resolve dynamic model config in `/get-model-config` endpoint — v2.7
- ✓ Generative UI Intelligence Engine: Overhaul system prompts and fpdf2 generation to mandate Google Material aesthetics and fix Unicode/deprecation errors — v2.8
- ✓ Offline Pyodide Proxy: Fallback system fetching Pyodide packages locally when CDN is blocked — v2.9
- ✓ Core Messaging & Tool Pipeline Stabilization (security scopes in get-file-content/describe-image, web-search Deno import fix, router URL sync, worker infinite loop timeout watchdog, parser unwrap sequence, ephemeral error logs, smooth streaming via requestAnimationFrame, steps expanded by default) — v3.0

### Active

- **Next Milestone:** Define next objectives using `/gsd-new-milestone`.

### Out of Scope

- Net-new product features not in CONCERNS.md.
- Migration off Lemon Squeezy, OpenRouter, Supabase, Vercel.
- Full rewrite of the 13 Zustand stores.
- SSR / Next.js migration — Vite SPA stays.
- Mobile app.

## Context

- **Codebase state:** Dynamic Deno edge functions and front-end React code. Fully functional and passing compilation.
- **Verification strategy:** Automated integration tests (Vitest + Playwright) plus manual user validation.

---
*Last updated: 2026-06-16 after v3.0 Core Messaging & Tool Pipeline Stabilization completion*
