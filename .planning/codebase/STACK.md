## Tech Stack

**Last Updated:** 2026-06-15
**Focus Area:** Core Technologies, Runtime Environments, Dependencies, and Configuration

---

### 1. Languages & Dialects
* **TypeScript (v5.9.3):** Used as the primary language across the entire frontend (`src/` codebase as `.ts` and `.tsx` files) and the backend Edge Functions (`supabase/functions/` as Deno `.ts` files). The project enforces strict type-checking and compiles utilizing `tsc -b`.
* **CSS (Vanilla):** Cascading Style Sheets are used for styling. Layout styling is split among four core files:
  * [`src/index.css`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/index.css) (210KB stylesheet defining tailwind-like custom CSS variables, custom typography, global overrides, utility classes, and layout variables)
  * [`src/App.css`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/App.css) (18KB layout stylesheet)
  * [`src/artifact-hub.css`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/artifact-hub.css) (19KB layout stylesheet for the public artifact marketplace UI)
  * [`src/powertools.css`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/powertools.css) (7.6KB utility classes)
* **HTML5:** Standard HTML structure with explicit CSP (Content Security Policy) headers defined in [`index.html`](file:///e:/Lucen/Lucen-v2.3%20fresh/index.html).
* **SQL:** PostgreSQL migrations and database schemas in [`supabase/migrations/`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/migrations/) (36 distinct files) defining security guidelines, triggers, vector indexes, and ledger queries.

---

### 2. Runtime Environments
* **Frontend Runtime (Browser SPA):** A client-side Single Page Application (no Server-Side Rendering) built to run on modern web browsers. Static deployment runs on Vercel, and local developer building is orchestrated by Vite.
* **Backend Runtime (Deno via Supabase Edge Functions):** All custom backend functionality executes within sandboxed serverless Deno runtimes. Functions import external dependencies from standard Deno registries (e.g., `https://deno.land/std@0.168.0/http/server.ts` and Deno-compatible ESM CDNs like `https://esm.sh/@supabase/supabase-js@2`).
* **Package Manager:** Node Package Manager (npm) with a locked `package-lock.json` dependency graph.
* **Node.js Types:** Node compatibility types are maintained via `@types/node` (~24.10.1) in devDependencies to support Vite configuration and build scripting.

---

### 3. Frameworks
* **React (v19.2.0):** Standard library for building interfaces, utilizing functional components and modern hooks. Runs alongside `react-dom` (v19.2.0).
* **React Router DOM (v7.13.1):** Client-side client routing, authenticated route guards, public pages, and chat views mapped in [`src/App.tsx`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/App.tsx).
* **Zustand (v5.0.11):** High-performance client-side global state store management, utilizing selector optimizations (`useShallow` from `zustand/react/shallow`) and local storage persistence middleware (`persist`). Tracks 13 specialized stores in [`src/store/`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/store/).
* **Vite (v7.3.1):** High-speed bundler and local development server configured via [`vite.config.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/vite.config.ts) using the official `@vitejs/plugin-react` plugin (v5.1.1).

---

### 4. Key Dependencies

#### 4.1. Core Utilities & RAG Tokens
* **`js-tiktoken` (^1.0.21):** Computes token lengths client-side within [`src/workers/tokenizer.worker.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/tokenizer.worker.ts) using `cl100k_base` encoding to enforce model input/output context budgets.
* **`@supabase/supabase-js` (^2.98.0):** Main client wrapper for authentication (Supabase Auth), storage buckets (for file attachments), real-time tables, and executing Edge Functions.
* **`uuid` (^13.0.0):** Used for cryptographically secure ID generation (messages, conversations, file entries). Linked via `@types/uuid` (^10.0.0) for development.
* **`zod` (^4.4.3):** Runtime schema schema validation and type parsing.

#### 4.2. File Parsing & Processing
* **`pdfjs-dist` (^5.5.207):** Direct PDF document text extraction running in [`src/services/fileProcessor.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/services/fileProcessor.ts). Employs web workers locally.
* **`mammoth` (^1.11.0):** Client-side DOCX-to-HTML and DOCX raw text parsing.
* **`xlsx` (^0.18.5):** Excel (.xlsx/.xls) and CSV parser translating tabular files into formatted markdown tables.
* **`exceljs` (^4.4.0):** Detailed spreadsheet data processing, styling, and rendering support.
* **`docx-preview` (^0.3.7):** Renders MS Word files directly inside the browser.
* **`jszip` (^3.10.1):** Dynamic zip file compression and unpacking.

#### 4.3. Markdown & Mathematical Layouts
* **`react-markdown` (^10.1.0):** Renders stream chunks and markdown strings.
* **`remark-gfm` (^4.0.1):** Extends markdown parsing to support Github-flavored styles (tables, task lists, checkboxes).
* **`remark-math` (^6.0.0):** Markdown syntax extension for LaTeX mathematical formulations.
* **`rehype-katex` (^7.0.1):** Formats math syntax utilizing the high-speed KaTeX library.
* **`rehype-mathjax` (^7.1.0):** Fallback parser for complex equations using MathJax.
* **`better-react-mathjax` (^3.0.0):** Interactive mathematical UI support.
* **`rehype-raw` (^7.0.0):** Safe parsing of HTML blocks.
* **`rehype-sanitize` (^6.0.0):** Sanitizes inputs to prevent XSS.
* **`dompurify` (^3.4.8):** Client-side sanitization of HTML strings prior to mounting inside artifact blocks or markdown.

#### 4.4. Syntax Highlighting & Graphics
* **`shiki` (^4.0.2):** High-fidelity code syntax highlighting performed off the main thread inside [`src/workers/highlighter.worker.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/highlighter.worker.ts).
* **`react-syntax-highlighter` (^16.1.0):** Fallback React wrapper for parsing inline code styles.
* **`mermaid` (^11.13.0):** Graph, chart, and architectural block visualization.

#### 4.5. Client Performance & Logging
* **`@tanstack/react-virtual` (^3.13.24):** Window virtualization optimizing rendering of large conversation histories without DOM lag.
* **`lenis` (^1.1.18):** Smooth scrolling across marketing paths and application workspace layouts.
* **`@sentry/react` (^10.56.0):** Observability pipeline for errors and page metrics initialized within [`src/main.tsx`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/main.tsx).

---

### 5. In-Browser WASM Execution
* **Pyodide (v0.26.2):** Standard Python WASM runtime execution inside the browser sandbox using [`src/workers/pyodide.worker.ts`](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/pyodide.worker.ts).
* Python execution supports auto-resolving packages on code-import (`py.loadPackagesFromImports`), installing wheels from PyPI via `micropip` (`# pip:` header), routing missing packages through a Supabase Deno proxy if CDN endpoints are firewalled/blocked, and base64 filesystem extraction.

---

### 6. Dev Dependencies
* **ESLint (v9.39.1):** Flat structure config validator in [`eslint.config.js`](file:///e:/Lucen/Lucen-v2.3%20fresh/eslint.config.js). Enforces TypeScript constraints via `typescript-eslint` (^8.48.0), React hooks purity via `eslint-plugin-react-hooks` (^7.0.1), and HMR patterns via `eslint-plugin-react-refresh` (^0.4.24).
* **Vitest (v1.6.0) + `@vitest/coverage-v8` (v1.6.0) + `jsdom` (v24.0.0):** Unit test infrastructure targeting store actions, text formatting, and parsing logic.
* **Playwright (v1.44.0):** End-to-end user path validation browser tests located in [`tests/e2e/`](file:///e:/Lucen/Lucen-v2.3%20fresh/tests/e2e/).

---

### 7. Configurations & Environments
* **`tsconfig.json`:** Root configuration file delegating to:
  * [`tsconfig.app.json`](file:///e:/Lucen/Lucen-v2.3%20fresh/tsconfig.app.json) (compiles `/src` targeting `ES2022`, browser libs, and module-bundler resolution with strict mode)
  * [`tsconfig.node.json`](file:///e:/Lucen/Lucen-v2.3%20fresh/tsconfig.node.json) (compiles the bundler file `vite.config.ts` targeting Node.js environments)
* **`.env.example`:** Top-level environment pointer. Actual variables flow from:
  * [`vercel.env.example`](file:///e:/Lucen/Lucen-v2.3%20fresh/vercel.env.example) (contains client-facing `VITE_` variables for Supabase endpoints, Anon keys, Sentry DSNs, and payment variant keys)
  * [`supabase.env.example`](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase.env.example) (contains server secrets like `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, and Lemon Squeezy credentials)
* **`supabase/config.toml`:** Configures database port mapping (Postgres 17 on 54322, local Studio on 54323, API gateway on 54321).
