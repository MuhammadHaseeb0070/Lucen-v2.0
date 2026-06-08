# Technology Stack

**Last updated:** 2026-06-08

## Languages

**Primary:**
- TypeScript 5.9 — entire frontend (`.ts`, `.tsx`) and all Supabase Edge Functions (`.ts`). Single-language project.

**Secondary:**
- CSS — Three stylesheets in `src/`: `index.css`, `artifact-hub.css`, `powertools.css`
- HTML — `index.html` entry point with CSP headers

## Runtime

**Frontend:**
- Browser-based SPA (no SSR). Runs on Vite dev server or Vercel static deploy.

**Backend:**
- Deno runtime (via Supabase Edge Functions). All Edge Functions import from `https://deno.land/std@0.168.0/http/server.ts` and `https://esm.sh/@supabase/supabase-js@2`.

**Node.js Version (local dev):**
- Managed by project. `@types/node` ^24.10.1 in devDependencies.

**Package Manager:**
- npm (lockfile: `package-lock.json` present)

## Frameworks

**UI:**
- React 19.2 with React DOM
- React Router DOM 7.13 (client-side routing via `App.tsx`)
- Zustand 5.0 (state management — 10 stores in `src/store/`)

**Build:**
- Vite 7.3 (bundler + dev server)
- `@vitejs/plugin-react` 5.1
- TypeScript compilation via `tsc -b`

**Testing:**
- Not detected (no Jest, Vitest, or Playwright in dependencies; no test files found)

## Key Dependencies

**AI/LLM Integration:**
- `js-tiktoken` ^1.0.21 — token counting in Web Worker (`src/workers/tokenizer.worker.ts`) using `cl100k_base` encoding
- `shiki` ^4.0.2 — code syntax highlighting in Web Worker (`src/workers/highlighter.worker.ts`)

**Supabase:**
- `@supabase/supabase-js` ^2.98.0 — database, auth, storage, Edge Function invocation

**Markdown/Rendering:**
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

**File Processing:**
- `pdfjs-dist` ^5.5.207 — PDF parsing in `fileProcessor.ts`
- `mammoth` ^1.11.0 — DOCX conversion
- `xlsx` ^0.18.5 — Excel/CSV parsing
- `jszip` ^3.10.1 — archive handling

**UI Components:**
- `lucide-react` ^0.575.0 — icon library
- `@tanstack/react-virtual` ^3.13.24 — virtualized lists
- `lenis` ^1.1.18 — smooth scrolling
- `uuid` / `@types/uuid` ^13.0.0 / ^10.0.0 — ID generation

**Monitoring:**
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

**Build Command:** `tsc -b && vite build`
**Dev Command:** `vite`
**Lint Command:** `eslint .`
**Output Target:** ES2022 (frontend), ES2023 (node config `vite.config.ts`)
**Module System:** ESNext with `verbatimModuleSyntax`
**JSX:** `react-jsx` transform
**Worker Format:** ES modules (`worker.format: 'es'` in `vite.config.ts`)
**Strict Mode:** `strict: true` in all tsconfigs, plus `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`

## Configuration

**TypeScript:**
- Root `tsconfig.json` — references `tsconfig.app.json` and `tsconfig.node.json`
- `tsconfig.app.json` — `src/` compilation (ES2022, DOM lib, bundler resolution)
- `tsconfig.node.json` — `vite.config.ts` only (ES2023, Node types)

**Linting:**
- `eslint.config.js` — flat config using `@eslint/js`, `typescript-eslint`, `react-hooks`, `react-refresh`
- Globals: browser

**Environment:**
- `.env.example` — placeholder (redirects to `vercel.env.example` and `supabase.env.example`)
- `vercel.env.example` — frontend env vars (VITE_ prefix)
- `supabase.env.example` — Edge Function secrets reference
- `supabase/.env.dev` — actual local dev secrets
- `supabase/.env.prod` — production secrets (existence noted)

**Supabase Local Dev:**
- `supabase/config.toml` — API port 54321, DB port 54322 (Postgres 17), Studio port 54323
- Edge Functions `chat-proxy` and `deduct-credits` have `verify_jwt = false`

## Package Manager

- npm
- Lockfile: `package-lock.json` (large, committed)

---

*Stack analysis: 2026-06-08*