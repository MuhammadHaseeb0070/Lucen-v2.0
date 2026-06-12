# DEBUG: Pyodide Offline/CDN-Blocked Failure
Created: 2026-06-12T09:58:00Z
Status: ACTIVE

## Symptoms
- Python Excel/Word artifacts fail to run on lucen.space
- Error: `ModuleNotFoundError: No module named 'packaging'`
- Error: `Fetch API cannot load .../packaging-23.2-py3-none-any.whl`
- CSP violations for cdn.jsdelivr.net connections
- CORS block on cdn.jsdelivr.net from lucen.space origin

## Root Causes Identified
See ROOT_CAUSE_ANALYSIS section below.
