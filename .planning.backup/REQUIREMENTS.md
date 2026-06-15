# Milestone v2.9 Requirements: Pluggable Python Artifact Engine (MS Word Integration)

## Goals & Objectives

Evolve the current Pyodide sandbox environment (which is currently hardcoded for Excel) into a highly granular, pluggable artifact engine. It must support generating diverse Python-based artifacts—specifically starting with MS Word (`.docx`) compatibility—without risk of regressions in existing Excel functionality. The architecture should be robust enough to easily add future integrations (e.g., PDF, PowerPoint) independently.

## Functional Requirements

### REQ-01: Pluggable Artifact Architecture
- **Granular Integration Modules:** Decouple the monolithic `pyodide.worker.ts` into isolated configuration strategies or modules for each supported file type (`excel`, `word`, etc.).
- **Dynamic Dependency Loading:** The Pyodide worker must dynamically load the appropriate whitelisted packages (e.g., `python-docx` for Word) based on the artifact type, preventing unnecessary downloads and memory bloat.
- **Fail-Safe Isolation:** A failure in the Word integration (e.g., package installation error, runtime crash) must not affect the Excel integration.

### REQ-02: MS Word Integration
- **Artifact Type Extension:** Extend the `ArtifactType` union to support a generic `document` or specifically `word`/`python` type based on the new architecture.
- **Dependency Support:** Ensure `python-docx` and required dependencies (`lxml`) are installed seamlessly via Pyodide's `micropip` in the worker environment.
- **Supported Outputs:** Allow the generation and extraction of `.docx` files from the `/home/pyodide` virtual filesystem.

### REQ-03: Premium Unified UI & Error Handling
- **Responsive Previews:** Expand the existing `ExcelRenderer` UI into a generic `DocumentRenderer` or a dynamic view that adapts its descriptions and visuals to the specific document type.
- **Lifecycle Feedback:** Provide granular progress tracking (e.g., "Installing python-docx...", "Formatting Word document...").
- **Download Mechanisms:** Implement clean, responsive cards for downloading generated files.
- **Error Reporting Feedback Loop:** Provide actionable error messages to the user if a script fails or crashes. Allow the user to "Report to AI", injecting the stack trace back into the chat context so the AI can automatically self-correct.

### REQ-04: Secure Constraints & Prompt Enhancements
- **Security:** Maintain the 60-second timeout, memory limits, and isolated `/home/pyodide` workspace constraints for all pluggable types.
- **Prompt Architecture:** Refactor the system prompt (`src/config/prompts.ts`) so the LLM is aware of the different document types it can generate and the specific libraries available for each, minimizing "hallucinated" unsupported library usage.
