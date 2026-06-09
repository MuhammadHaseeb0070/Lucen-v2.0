---
phase: 06-web-search-optimization
plan: 01
subsystem: web-search
tags: [tavily, search, parallel, step-limits, sanitization, ui-ux]

requires: []
provides:
  - Parallelized web_search execution to support concurrent queries.
  - Dynamically scaled maxRounds limit up to 5 when using attachments.
  - Strict negative constraints injected into the final step system message.
  - Defensive sanitization inside sanitizeMinimaxTags for parameter/partial tags.
  - Beautiful, glassmorphic steps and citations styling.
affects: []

tech-stack:
  added: []
  patterns: [Parallel tool execution, Dynamic round ceilings, Defensive sanitization, Glassmorphism CSS]

key-files:
  created:
    - src/lib/stringUtil.test.ts
  modified:
    - supabase/functions/_shared/toolRegistry.ts
    - supabase/functions/chat-proxy/streamHandler.ts
    - src/lib/stringUtil.ts
    - src/index.css

key-decisions:
  - "D-01: Set web_search parallelizable: true — speeds up multi-query tasks."
  - "D-02: Dynamically adjust maxRounds inside streamHandler — prevents truncation bugs when attachments require image description before search."
  - "D-03: Strip partial XML tags at the end of stream — cleans up raw parameters before final complete tags arrive."

patterns-established:
  - "Dynamic maxRounds step scaling."
  - "Defensive client-side parsing of leaked parameter tags."

requirements-completed:
  - Parallel Web Search
  - Dynamic Step Limits
  - Defensive Tag Sanitization
  - Premium Steps and Citations UI

# Metrics
duration: 15min
completed: 2026-06-09
---

# Phase 6: Plan 01 — Web Search Optimization Summary

**Optimized and hardened the web search architecture, parallelized tool calls, dynamically set maxRounds limits, and polished the frontend steps & citations UI.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-06-09T11:08:00Z
- **Completed:** 2026-06-09T11:15:00Z
- **Tasks:** 6
- **Files modified:** 4
- **Files created:** 1

## Accomplishments

- **Parallelized Searches**: Changed `web_search` to `parallelizable: true`, enabling concurrent Tavily search execution.
- **Dynamic step limits**: Configured dynamic round scaling to allow up to 5 step iterations when using images/files + web search.
- **Leaked tag stripping**: Enhanced `sanitizeMinimaxTags` to aggressively remove parameter/partial tags from text blocks.
- **Final round negative prompting**: Injected strict step limit warnings when thresholds are reached, blocking XML tool leaks.
- **Premium CSS styles**: Structured responsive grids, glassmorphism, glowing checkmarks, and hover effects for sources and steps.
- **Verified changes**: All unit and Playwright E2E browser tests successfully pass.

## Task Commits

1. **feat(06-01)**: enable parallel web search, implement dynamic maxRounds, harden final round prompting, defensively sanitize partial tags, and restyle UI steps/citations.

## Files Created/Modified

- `supabase/functions/_shared/toolRegistry.ts` (Modified)
- `supabase/functions/chat-proxy/streamHandler.ts` (Modified)
- `src/lib/stringUtil.ts` (Modified)
- `src/index.css` (Modified)
- `src/lib/stringUtil.test.ts` (Created)

## Decisions Made

- Dynamic maxRounds calculations prevent premature step limits and raw tag output without changing context caps or Lemon Squeezy credit tracking rules.
- Defensive XML tag sanitization operates directly on streamed content chunks, ensuring a clean render immediately before the final response finishes.
