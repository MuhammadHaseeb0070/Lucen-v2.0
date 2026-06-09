# Milestone v2.6 Requirements: Excel-focused Pyodide Rebuild

## Goals & Objectives
Replace the generic, unoptimized Python artifact type and Pyodide environment in Lucen with a focused, Excel-only Pyodide sandbox that leverages browser-based WebAssembly to run Python scripts generating downloadable `.xlsx` and `.csv` files.

## Functional Requirements

### REQ-01: Artifact Type System Transition
- **Artifact Type**: Remove `'python'` from the `ArtifactType` union and list of supported types.
- **New Type**: Add `'excel'` in its place.
- **Parsing**: Update `parseArtifacts` in `src/lib/artifactParser.ts` to recognize `<lucen_artifact type="excel">` and extract it properly.

### REQ-02: Excel Pyodide Web Worker Rebuild
- **Location**: `src/workers/pyodide.worker.ts` and `src/workers/pyodideWorkerClient.ts`.
- **Environment**:
  - Whitelisted libraries pre-loaded: `openpyxl`, `xlsxwriter`, `pandas`, `numpy`, `matplotlib`, `Pillow`.
  - Headless backend configured for `matplotlib` (using `matplotlib.use('Agg')` and proper figure resolution).
  - Secure `/home/pyodide` directory workspace initialization and recursive cleanup before/after runs.
  - Script timeout set to 60 seconds.
- **File Management**:
  - Load input files from user attachments into `/home/pyodide/`.
  - Collect generated output files matching extensions: `.xlsx`, `.xls`, `.csv`, `.png`, `.jpg`, `.jpeg`, `.pdf`, `.json`, `.txt`, `.zip`.

### REQ-03: Premium Excel UI & Error Handling
- **Component**: `ExcelRenderer` inside `src/components/ArtifactRenderer.tsx`.
- **States**:
  - *Loading Stage Progress*: Display distinct progress indicators for: "Setting up Python environment", "Loading Excel libraries...", "Loading your input file", and "Running script".
  - *Success State*: Display file cards with matching download buttons for generated spreadsheets, and render any generated images inline. Show collapsible console warnings.
  - *Error State*: Detect timeouts, missing packages, missing input files, syntax errors, or memory errors, and present them in a clear human-readable format.
  - *Regenerate/Retry Handler*: Wire up the retry action to feed the error back into chat context to prompt LLM self-correction.

### REQ-04: System Prompt Refactoring
- **File**: `src/config/prompts.ts`.
- **Updates**:
  - Replace the entire generic `python` artifact section in `BASE_SYSTEM_PROMPT` with instructions on when to use `excel` (creating spreadsheets, pivot tables, charts, calculations, editing uploads), approved libraries, environmental limitations (no internet/GUI), and rules.
  - Update tag formatting rules in `STRICT RULES` section to reference `<lucen_artifact type="excel" title="...">`.
