#!/usr/bin/env python3
"""Local smoke test for mcp_server.py.

Basic mode does not download an embedding model.
Pass --with-vector to test FastEmbed + Qdrant retrieval.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sqlite3
import tempfile
from pathlib import Path


def load_server(path: Path):
    spec = importlib.util.spec_from_file_location("nk_forge_mcp_server", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--with-vector",
        action="store_true",
        help="also download/load FastEmbed and test semantic memory",
    )
    args = parser.parse_args()

    server_path = Path(__file__).with_name("nk_forge_mcp_server.py").resolve()

    with tempfile.TemporaryDirectory(prefix="nk-forge-mcp-test-") as tmp:
        temp_root = Path(tmp)
        repo = temp_root / "repo"
        state = temp_root / "state"
        repo.mkdir()
        (repo / "generated").mkdir()
        (repo / "README.md").write_text("NANOKAT Forge\n", encoding="utf-8")

        os.environ["NK_FORGE_ROOT"] = str(repo)
        os.environ["NK_MCP_STATE_DIR"] = str(state)
        os.environ["NK_MCP_ALLOW_WRITES"] = "1"
        os.environ["NK_MCP_WRITE_ROOTS"] = "generated"

        server = load_server(server_path)
        server.init_db()

        assert server.DB_PATH.exists()
        assert server.read_file("README.md")["content"] == "NANOKAT Forge\n"

        wrote = server.write_file("generated/test.txt", "hello\n")
        assert wrote["ok"] is True
        assert (repo / "generated" / "test.txt").read_text() == "hello\n"

        try:
            server.read_file("../outside.txt")
        except ValueError:
            pass
        else:
            raise AssertionError("Path traversal was not rejected")

        logged = server.log_task(
            "smoke-agent",
            "Run local smoke test",
            "Basic checks passed",
            tokens=1,
            duration=0.01,
        )
        assert logged["ok"] is True

        with sqlite3.connect(server.DB_PATH) as conn:
            count = conn.execute(
                "SELECT COUNT(*) FROM interactions"
            ).fetchone()[0]
        assert count == 1

        if args.with_vector:
            stored = server.store_memory(
                "smoke",
                "NANOKAT Forge uses bounded agent tools.",
            )
            assert stored["ok"] is True
            result = server.query_memory(
                "What uses bounded tools?",
                limit=1,
            )
            assert len(result["results"]) == 1

        print("PASS: database initialization")
        print("PASS: bounded file read")
        print("PASS: allowlisted file write")
        print("PASS: traversal rejection")
        print("PASS: SQLite and Markdown logging")
        if args.with_vector:
            print("PASS: FastEmbed and Qdrant semantic memory")
        else:
            print("SKIP: vector test (run with --with-vector)")
        print(f"Temporary state cleaned: {temp_root}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
