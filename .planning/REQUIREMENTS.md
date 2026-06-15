# Milestone v3.0 Requirements: Core Messaging & Tool Pipeline Stabilization

## Goals & Objectives

Secure, harden, and stabilize the client-to-server messaging pipeline, tool execution loop, file/image RAG handlers, and artifact lifecycles. Ensure the application does not leak data horizontally, hang on heavy python computation, show raw XML in the chat bubble, or lose routing context on page refreshes.

## Functional Requirements

### REQ-01: Security Boundaries & Sibling Functions
- **Horizontal Privilege Escalation Prevention:** Ensure [get-file-content](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/functions/get-file-content/index.ts) and [describe-image](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/functions/describe-image/index.ts) query DB tables and files checking ownership. Only files linked to conversations owned by the calling `user.id` can be read.
- **Deno Import Resolving:** Fix the ReferenceError in the [web-search](file:///e:/Lucen/Lucen-v2.3%20fresh/supabase/functions/web-search/index.ts) edge function by importing `createClient` from `@supabase/supabase-js`.
- **Accurate File API HTTP Statuses:** Return a proper `404 Not Found` if a file is requested but doesn't exist in the database, rather than returning a blank string with a `200 OK`.

### REQ-02: Client Routing & Store Synchronization
- **React Router URL Bindings:** Enable parametric path mapping `/chat/:id` in the frontend router.
- **Mount Sync:** On mount of `Layout.tsx`, extract the conversation ID from the URL param and call `setActiveConversation` to hydrate the active chat area.
- **Navigation Pushes:** Clicking sidebar conversations or creating new conversations must push the new URL path to the router history.

### REQ-03: State Management & Artifact Cleanup
- **Artifact Isolation on Swap/Delete:** Clearing or deleting a conversation must explicitly reset the active workspace artifact. 
- **Auto-Open Refactoring:** Restrict auto-opening of historic artifacts when switching between chats. Only open the workspace panel automatically when the active message is currently streaming, or in response to direct user click interactions.
- **Layout Leakage Cleanup:** Ensure the workspace panel is closed/hidden when the main `ChatArea` is unmounted (e.g. going to `OwnerDashboard`).

### REQ-04: Parser & Runtime Hardening
- **Code Fence Parser Unwrapping:** Order the parsing sequence in [parseArtifacts](file:///e:/Lucen/Lucen-v2.3%20fresh/src/lib/artifactParser.ts) so markdown code-fence wrappers are stripped *before* neutralizing nested fenced tags, ensuring fully-fenced artifacts open in the workspace automatically.
- **Worker Hang Termination watchdog:** Implement a client-side execution watchdog timer in [pyodideWorkerClient.ts](file:///e:/Lucen/Lucen-v2.3%20fresh/src/workers/pyodideWorkerClient.ts). If execution runs longer than 60 seconds (indicating an event-loop-blocking python infinite loop), terminate the worker via `worker.terminate()`, re-initialize, and resolve the task as timed out.
- **Ephemeral Stream Errors:** Keep transient API and credit errors out of the message's permanent `content` field. Render error warnings as metadata or separate UI alert states.
