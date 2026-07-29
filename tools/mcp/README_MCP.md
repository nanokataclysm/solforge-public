# Solforge MCP — Deterministic Model Router

MCP server for Solforge with deterministic token-max model routing.

## Features

- Deterministic model selection based on context capacity and priority
- Shared model manifest (`policy/qwen-models.json`) with orchestrator
- Environment variable overrides with allowlist validation
- Conservative token estimation without heavy tokenizer dependencies
- Retryable error handling for quota issues
- Runtime state defaults to `~/.local/share/nanokat-forge/mcp`, outside Git
- File writes disabled by default (opt-in with scoped roots)
- Bounded file, memory, log, and query sizes

## Install

From the Solforge repository root:

```bash
cd tools/mcp
python3 -m venv .venv-mcp
.venv-mcp/bin/python -m pip install --upgrade pip
.venv-mcp/bin/python -m pip install -r requirements-mcp.txt
```

## Test

Basic connection test:

```bash
cd tools/mcp
.venv-mcp/bin/python test_connection.py
```

Full vector-memory test (downloads embedding model on first run):

```bash
.venv-mcp/bin/python test_connection.py --with-vector
```

MCP stdio smoke test:

```bash
.venv-mcp/bin/python mcp_stdio_smoke.py
```

## Start read-only

```bash
cd tools/mcp
.venv-mcp/bin/python nk_forge_mcp_server.py
```

## Opt into scoped writes

```bash
export NK_MCP_ALLOW_WRITES=1
export NK_MCP_WRITE_ROOTS='apps/orchestrator,docs,generated'
cd tools/mcp
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

## Git hygiene

If the old prototype already created runtime state inside the repository, inspect and back it up before removing anything. These paths should normally be ignored:

```gitignore
nk_society.db
nk_society.db-*
qdrant_data/
logs/
.venv-mcp/
```
