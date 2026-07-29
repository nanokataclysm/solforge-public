#!/usr/bin/env python3
"""Local, scoped MCP server for NANOKAT Forge."""

from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastembed import TextEmbedding
from mcp.server.fastmcp import FastMCP
from qdrant_client import QdrantClient, models

SERVER_NAME = "Solforge-MCP"
COLLECTION_NAME = os.getenv("NK_MCP_COLLECTION", "agent_memory")
EMBED_MODEL = os.getenv("NK_MCP_EMBED_MODEL", "BAAI/bge-small-en-v1.5")

BASE_DIR = Path(
    os.getenv("NK_FORGE_ROOT", str(Path.home() / "dev" / "solforge"))
).expanduser().resolve()
STATE_DIR = Path(
    os.getenv(
        "NK_MCP_STATE_DIR",
        str(Path.home() / ".local" / "share" / "nanokat-forge" / "mcp"),
    )
).expanduser().resolve()

DB_PATH = STATE_DIR / "nk_society.db"
LOGS_DIR = STATE_DIR / "logs"
QDRANT_PATH = STATE_DIR / "qdrant"

MAX_FILE_BYTES = int(os.getenv("NK_MCP_MAX_FILE_BYTES", "1000000"))
MAX_MEMORY_CHARS = int(os.getenv("NK_MCP_MAX_MEMORY_CHARS", "50000"))
MAX_LOG_CHARS = int(os.getenv("NK_MCP_MAX_LOG_CHARS", "20000"))
ALLOW_WRITES = os.getenv("NK_MCP_ALLOW_WRITES", "0") == "1"

WRITE_ROOTS = tuple(
    (BASE_DIR / item.strip()).resolve()
    for item in os.getenv(
        "NK_MCP_WRITE_ROOTS",
        "apps/orchestrator,docs,generated",
    ).split(",")
    if item.strip()
)

STATE_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)
QDRANT_PATH.mkdir(parents=True, exist_ok=True)

mcp = FastMCP(SERVER_NAME)
qdrant = QdrantClient(path=str(QDRANT_PATH))
_embedding_model: TextEmbedding | None = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    with sqlite3.connect(DB_PATH, timeout=10) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS interactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                agent_name TEXT NOT NULL,
                task TEXT NOT NULL,
                outcome TEXT NOT NULL,
                tokens_used INTEGER NOT NULL DEFAULT 0
                    CHECK(tokens_used >= 0),
                duration_sec REAL NOT NULL DEFAULT 0
                    CHECK(duration_sec >= 0)
            )
            """
        )


def embedding_model() -> TextEmbedding:
    global _embedding_model
    if _embedding_model is None:
        _embedding_model = TextEmbedding(model_name=EMBED_MODEL)
    return _embedding_model


def passage_vector(text: str) -> list[float]:
    return next(iter(embedding_model().passage_embed([text]))).tolist()


def query_vector(text: str) -> list[float]:
    return next(iter(embedding_model().query_embed(text))).tolist()


def ensure_collection(vector_size: int) -> None:
    if not qdrant.collection_exists(COLLECTION_NAME):
        qdrant.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=models.VectorParams(
                size=vector_size,
                distance=models.Distance.COSINE,
            ),
        )


def resolve_repo_path(relative_path: str, *, for_write: bool = False) -> Path:
    if not relative_path or "\x00" in relative_path:
        raise ValueError("Path must be a non-empty repository-relative path.")

    supplied = Path(relative_path)
    if supplied.is_absolute():
        raise ValueError("Absolute paths are not allowed.")

    candidate = (BASE_DIR / supplied).resolve()
    try:
        candidate.relative_to(BASE_DIR)
    except ValueError as exc:
        raise ValueError("Path escapes the NANOKAT Forge repository.") from exc

    if for_write:
        if not ALLOW_WRITES:
            raise PermissionError(
                "Writes are disabled. Set NK_MCP_ALLOW_WRITES=1 explicitly."
            )
        if not any(candidate == root or root in candidate.parents for root in WRITE_ROOTS):
            roots = ", ".join(str(root.relative_to(BASE_DIR)) for root in WRITE_ROOTS)
            raise PermissionError(
                f"Write path is outside the allowlisted roots: {roots}"
            )

    return candidate


def append_markdown_log(
    *,
    created_at: str,
    agent: str,
    task: str,
    outcome: str,
    tokens: int,
    duration: float,
) -> None:
    log_path = LOGS_DIR / f"session_{created_at[:10].replace('-', '')}.md"
    safe_task = task[:MAX_LOG_CHARS]
    safe_outcome = outcome[:MAX_LOG_CHARS]

    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(
            "\n".join(
                [
                    f"## [{created_at}] {agent}",
                    "",
                    f"**Tokens:** {tokens}",
                    f"**Duration:** {duration:.3f}s",
                    "",
                    "### Task",
                    "",
                    safe_task,
                    "",
                    "### Outcome",
                    "",
                    safe_outcome,
                    "",
                ]
            )
        )


def log_interaction(
    agent: str,
    task: str,
    outcome: str,
    *,
    tokens: int = 0,
    duration: float = 0.0,
) -> int:
    agent = agent.strip()
    task = task.strip()
    outcome = outcome.strip()

    if not agent or not task or not outcome:
        raise ValueError("agent, task, and outcome must not be empty")
    if tokens < 0 or duration < 0:
        raise ValueError("tokens and duration must be non-negative")

    created_at = utc_now()
    with sqlite3.connect(DB_PATH, timeout=10) as conn:
        cursor = conn.execute(
            """
            INSERT INTO interactions (
                created_at, agent_name, task, outcome, tokens_used, duration_sec
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (created_at, agent, task, outcome, tokens, duration),
        )
        interaction_id = int(cursor.lastrowid)

    append_markdown_log(
        created_at=created_at,
        agent=agent,
        task=task,
        outcome=outcome,
        tokens=tokens,
        duration=duration,
    )
    return interaction_id


@mcp.tool()
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "server": SERVER_NAME,
        "repository": str(BASE_DIR),
        "state_directory": str(STATE_DIR),
        "database_exists": DB_PATH.exists(),
        "collection_exists": qdrant.collection_exists(COLLECTION_NAME),
        "embedding_model": EMBED_MODEL,
        "writes_enabled": ALLOW_WRITES,
        "write_roots": [str(path.relative_to(BASE_DIR)) for path in WRITE_ROOTS],
    }


@mcp.tool()
def read_file(relative_path: str) -> dict[str, Any]:
    path = resolve_repo_path(relative_path)
    if not path.is_file():
        raise FileNotFoundError(f"File not found: {relative_path}")

    size = path.stat().st_size
    if size > MAX_FILE_BYTES:
        raise ValueError(f"File is {size} bytes; limit is {MAX_FILE_BYTES} bytes.")

    return {
        "path": str(path.relative_to(BASE_DIR)),
        "bytes": size,
        "content": path.read_text(encoding="utf-8", errors="replace"),
    }


@mcp.tool()
def write_file(relative_path: str, content: str) -> dict[str, Any]:
    path = resolve_repo_path(relative_path, for_write=True)
    encoded = content.encode("utf-8")
    if len(encoded) > MAX_FILE_BYTES:
        raise ValueError(
            f"Content is {len(encoded)} bytes; limit is {MAX_FILE_BYTES} bytes."
        )

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return {
        "ok": True,
        "path": str(path.relative_to(BASE_DIR)),
        "bytes": len(encoded),
    }


@mcp.tool()
def store_memory(category: str, text: str) -> dict[str, Any]:
    category = category.strip()
    text = text.strip()

    if not category or not text:
        raise ValueError("category and text must not be empty")
    if len(text) > MAX_MEMORY_CHARS:
        raise ValueError(
            f"Memory is {len(text)} characters; limit is {MAX_MEMORY_CHARS}."
        )

    vector = passage_vector(text)
    ensure_collection(len(vector))

    memory_id = str(uuid.uuid4())
    created_at = utc_now()
    qdrant.upsert(
        collection_name=COLLECTION_NAME,
        points=[
            models.PointStruct(
                id=memory_id,
                vector=vector,
                payload={
                    "category": category,
                    "text": text,
                    "created_at": created_at,
                },
            )
        ],
        wait=True,
    )

    return {
        "ok": True,
        "memory_id": memory_id,
        "category": category,
        "created_at": created_at,
    }


@mcp.tool()
def query_memory(query: str, limit: int = 3) -> dict[str, Any]:
    query = query.strip()
    if not query:
        raise ValueError("query must not be empty")
    if limit < 1 or limit > 20:
        raise ValueError("limit must be between 1 and 20")

    if not qdrant.collection_exists(COLLECTION_NAME):
        return {"query": query, "results": []}

    response = qdrant.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector(query),
        with_payload=True,
        limit=limit,
    )

    return {
        "query": query,
        "results": [
            {
                "memory_id": str(point.id),
                "score": float(point.score),
                "category": (point.payload or {}).get("category"),
                "text": (point.payload or {}).get("text"),
                "created_at": (point.payload or {}).get("created_at"),
            }
            for point in response.points
        ],
    }


@mcp.tool()
def log_task(
    agent: str,
    task: str,
    outcome: str,
    tokens: int = 0,
    duration: float = 0.0,
) -> dict[str, Any]:
    return {
        "ok": True,
        "interaction_id": log_interaction(
            agent,
            task,
            outcome,
            tokens=tokens,
            duration=duration,
        ),
    }


def main() -> None:
    init_db()
    try:
        mcp.run()
    finally:
        qdrant.close()




# --- Solforge agent roles (Qwen) ---
try:
    from agent_roles import run_role, ROLE_MODELS
except ImportError:
    try:
        from tools.mcp.agent_roles import run_role, ROLE_MODELS  # type: ignore
    except ImportError:
        run_role = None  # type: ignore
        ROLE_MODELS = {}


@mcp.tool()
def solforge_list_roles() -> dict:
    """List wired Qwen agent roles and model ids (no secrets)."""
    if not ROLE_MODELS:
        return {"ok": False, "error": "agent_roles not importable"}
    return {"ok": True, "roles": ROLE_MODELS}


@mcp.tool()
def solforge_agent(role: str, prompt: str) -> dict:
    """Run a wired Solforge role (navigator|planner|repair) via Qwen."""
    if run_role is None:
        return {"ok": False, "error": "agent_roles unavailable"}
    return run_role(role, prompt)


if __name__ == "__main__":
    main()
