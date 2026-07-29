#!/usr/bin/env bash
set -euo pipefail

ROOT="${NK_FORGE_ROOT:-$HOME/hack/nk-forge}"
VENV="${NK_MCP_VENV:-$ROOT/.venv-mcp}"

cd "$ROOT"

python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install -r requirements-mcp.txt

echo
echo "Installed NANOKAT Forge MCP dependencies."
echo "Basic test:"
echo "  $VENV/bin/python test_connection.py"
echo
echo "Vector test:"
echo "  $VENV/bin/python test_connection.py --with-vector"
