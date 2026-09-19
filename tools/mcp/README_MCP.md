# Solforge MCP — Deterministic Model Router

MCP server for Solforge with deterministic token-max model routing.

## Features

- Deterministic model selection based on context capacity and priority
- Shared model manifest (`policy/qwen-models.json`) with orchestrator
- Environment variable overrides with allowlist validation
- Conservative token estimation without heavy tokenizer dependencies
- Retryable error handling for quota issues
- Runtime state defaults to the user data directory, outside Git
- File writes disabled by default and enabled only for scoped roots
- Bounded file, memory, log, and query sizes

## Install

Run these commands from the Solforge repository root. The examples use a POSIX shell; on Windows, use the virtual environment's `Scripts` directory instead of `bin`.

```bash
cd tools/mcp
python3 -m venv .venv-mcp
.venv-mcp/bin/python -m pip install --upgrade pip
.venv-mcp/bin/python -m pip install -r requirements-mcp.txt
```

## Test

From `tools/mcp`:

```bash
.venv-mcp/bin/python test_connection.py
```

Full vector-memory test, which downloads the embedding model on first run:

```bash
.venv-mcp/bin/python test_connection.py --with-vector
```

MCP stdio smoke test:

```bash
.venv-mcp/bin/python mcp_stdio_smoke.py
```

## Start read-only

From `tools/mcp`:

```bash
.venv-mcp/bin/python nk_forge_mcp_server.py
```

## Opt into scoped writes

Writes are disabled unless both the write flag and one or more repository-relative roots are supplied.

```bash
export NK_MCP_ALLOW_WRITES=1
export NK_MCP_WRITE_ROOTS='apps/orchestrator,docs,generated'
.venv-mcp/bin/python nk_forge_mcp_server.py
```

## Environment options

```text
NK_FORGE_ROOT
NK_MCP_STATE_DIR
NK_MCP_ALLOW_WRITES
NK_MCP_WRITE_ROOTS
NK_MCP_COLLECTION
NK_MCP_EMBED_MODEL
NK_MCP_MAX_FILE_BYTES
NK_MCP_MAX_MEMORY_CHARS
NK_MCP_MAX_LOG_CHARS
```

`NK_FORGE_ROOT` can point to a Solforge checkout when the server is started outside the repository. `NK_MCP_STATE_DIR` can override the default user-data location for runtime state.

## Git hygiene

If an older prototype created runtime state inside a checkout, inspect and back it up before removing anything. These paths should normally remain ignored:

```gitignore
nk_society.db
nk_society.db-*
qdrant_data/
logs/
.venv-mcp/
```
