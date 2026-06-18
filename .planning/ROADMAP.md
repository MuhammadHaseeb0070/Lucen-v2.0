# Roadmap: Lucen Stabilization

## Milestones

- ✅ **v2.3 Stabilization** — Phases 1-5 (shipped 2026-06-09)
- ✅ **v2.5 Web Search Optimization** — Phase 6 (shipped 2026-06-09)
- ✅ **v2.6 Excel-focused Pyodide Rebuild** — (shipped 2026-06-10)
- ✅ **v2.7 Robust OpenRouter Multi-Model System** — [Phases 8-9](file:///e:/Lucen/Lucen-v2.3%20fresh/.planning/milestones/v2.7-ROADMAP.md) (shipped 2026-06-10)
- ✅ **v2.8 Generative UI Intelligence Engine** — Phase 10 (shipped 2026-06-15)
- ✅ **v2.9 Offline Pyodide Proxy** — Phase 11 (shipped 2026-06-12)
- ✅ **v3.0 Core Messaging & Tool Pipeline Stabilization** — [Phases 12-14](file:///e:/Lucen/Lucen-v2.3%20fresh/.planning/milestones/v3.0-ROADMAP.md) (shipped 2026-06-16)
- ✅ **v3.1 Smart Artifact Patching System** — Phases 15-18

## Phases

<details>
<summary>✅ v2.3 Stabilization (Phases 1-5) — SHIPPED 2026-06-09</summary>

- [x] Phase 1: Foundation + Finance-Critical Fixes (3/3 plans) — completed 2026-06-08
- [x] Phase 2: Structural Decomposition (1/1 plans) — completed 2026-06-08
- [x] Phase 3: Billing Hardening + Production Shared State (1/1 plans) — completed 2026-06-08
- [x] Phase 4: Security Hardening (3/3 plans) — completed 2026-06-09
- [x] Phase 5: CSP Enforce + E2E + Final Verification (1/1 plans) — completed 2026-06-09

</details>

<details>
<summary>✅ v2.5 Web Search Optimization (Phase 6) — SHIPPED 2026-06-09</summary>

- [x] Phase 6: Web Search Optimization & Hardening (1/1 plans) — completed 2026-06-09

</details>

<details>
<summary>✅ v2.6 Excel-focused Pyodide Rebuild — SHIPPED 2026-06-10</summary>

- [x] Rebuilt Pyodide sandbox environment and transitioned to excel artifact type — completed 2026-06-10

</details>

<details>
<summary>✅ v2.7 Robust OpenRouter Multi-Model System (Phases 8-9) — SHIPPED 2026-06-10</summary>

- [x] Phase 8: Multi-Model Fallback Engine (1/1 plans) — completed 2026-06-10
- [x] Phase 9: Parameter Normalization & Client Synchronization (1/1 plans) — completed 2026-06-10

</details>

<details>
<summary>✅ v2.8 Generative UI Intelligence Engine (Phase 10) — SHIPPED 2026-06-15</summary>

- [x] Phase 10: UI Prompt Overhaul & `<design_strategy>` (1/1 plans) — completed 2026-06-15

</details>

<details>
<summary>✅ v2.9 Offline Pyodide Proxy (Phase 11) — SHIPPED 2026-06-12</summary>

- [x] Phase 11: Offline Pyodide Proxy Fallback System (1/1 plans) — completed 2026-06-12

</details>

### 🔵 v3.1 Smart Artifact Patching System

- [x] Phase 15: Patch Format & Parser Migration (completed 2026-06-18)
- [x] Phase 16: Dedicated Patch System Prompt & Sidecar Call (completed 2026-06-18)
- [x] Phase 17: Inline Update Input & Context Selector (completed 2026-06-18)
- [x] Phase 18: Version History Panel & Post-Patch UX (completed 2026-06-18)

### Phase 15: Patch Format & Parser Migration

**Goal:** Migrate to Git conflict search/replace markers, support sentinels, and add post-patch HTML sanity checking via DOMParser.
**Mode:** standard
**Success Criteria:**

1. Git conflict markers are parsed correctly.
2. DOMParser check blocks invalid HTML patches.

**Plans:**
2/2 plans complete

- [x] 15-02-PLAN.md

### Phase 16: Dedicated Patch System Prompt & Sidecar Call

**Goal:** Create a dedicated system prompt for patching and execute it via a sidecar call.
**Mode:** standard
**Success Criteria:**

1. Dedicated patch prompt is created.

**Plans:**
1/1 plans complete

- [x] 16-01-PLAN.md

### Phase 17: Inline Update Input & Context Selector

**Goal:** Build the inline update input box and context selector below artifacts.
**Mode:** standard
**Success Criteria:**

1. Inline update input and context selector exist and are functional.

**Plans:**
1/1 plans complete

- [x] 17-01-PLAN.md

### Phase 18: Version History Panel & Post-Patch UX

**Goal:** Implement the version history panel and post-patch feedback UX.
**Mode:** standard
**Success Criteria:**

1. Version history panel and post-patch feedback UX are functional.

**Plans:**
1/1 plans complete

- [x] 18-01-PLAN.md

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|---|---|---|---|---|
| 1. Foundation + Finance-Critical Fixes | v2.3 | 3/3 | Complete | 2026-06-08 |
| 2. Structural Decomposition | v2.3 | 1/1 | Complete | 2026-06-08 |
| 3. Billing Hardening + Production Shared State | v2.3 | 1/1 | Complete | 2026-06-08 |
| 4. Security Hardening | v2.3 | 3/3 | Complete | 2026-06-09 |
| 5. CSP Enforce + E2E + Final Verification | v2.3 | 1/1 | Complete | 2026-06-09 |
| 6. Web Search Optimization & Hardening | v2.5 | 1/1 | Complete | 2026-06-09 |
| 7. Excel-focused Pyodide Rebuild | v2.6 | 1/1 | Complete | 2026-06-10 |
| 8. Multi-Model Fallback Engine | v2.7 | 1/1 | Complete | 2026-06-10 |
| 9. Parameter Normalization & Client Synchronization | v2.7 | 1/1 | Complete | 2026-06-10 |
| 10. UI Prompt Overhaul & `<design_strategy>` | v2.8 | 1/1 | Complete | 2026-06-15 |
| 11. Offline Pyodide Proxy Fallback System | v2.9 | 1/1 | Complete | 2026-06-12 |
| 12. Security Boundaries & API Imports | v3.0 | 1/1 | Complete | 2026-06-16 |
| 13. Client-Side Routing & State Synchronization | v3.0 | 1/1 | Complete | 2026-06-16 |
| 14. Parser, Worker, & Stream Pipeline Hardening | v3.0 | 1/1 | Complete | 2026-06-16 |
| 15. Patch Format & Parser Migration | v3.1 | 2/2 | Complete    | 2026-06-18 |
| 16. Dedicated Patch System Prompt & Sidecar Call | v3.1 | 1/1 | Complete | 2026-06-18 |
| 17. Inline Update Input & Context Selector | v3.1 | 1/1 | Complete | 2026-06-18 |
| 18. Version History Panel & Post-Patch UX | v3.1 | 1/1 | Complete | 2026-06-18 |
