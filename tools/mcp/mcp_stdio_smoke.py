#!/usr/bin/env python3

import asyncio
import json
import os
import tempfile
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


ROOT = Path(__file__).resolve().parent
PYTHON = ROOT / ".venv-mcp" / "bin" / "python"
SERVER = ROOT / "nk_forge_mcp_server.py"


async def main() -> None:
    with tempfile.TemporaryDirectory(prefix="nk-forge-mcp-stdio-") as tmp:
        params = StdioServerParameters(
            command=str(PYTHON),
            args=[str(SERVER)],
            env={
                "HOME": str(Path.home()),
                "PATH": os.environ.get("PATH", ""),
                "NK_FORGE_ROOT": str(ROOT),
                "NK_MCP_STATE_DIR": tmp,
                "NK_MCP_ALLOW_WRITES": "0",
            },
        )

        async with stdio_client(params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()

                listed = await session.list_tools()
                names = sorted(tool.name for tool in listed.tools)

                expected = {
                    "health",
                    "read_file",
                    "write_file",
                    "store_memory",
                    "query_memory",
                    "log_task",
                }

                missing = expected.difference(names)
                if missing:
                    raise RuntimeError(
                        f"Missing MCP tools: {sorted(missing)}"
                    )

                result = await session.call_tool("health", arguments={})

                print("PASS: MCP stdio initialization")
                print("PASS: tools/list")
                print("Tools:", ", ".join(names))

                if result.structuredContent is not None:
                    print(json.dumps(result.structuredContent, indent=2))
                else:
                    for item in result.content:
                        text = getattr(item, "text", None)
                        if text:
                            print(text)

                print("PASS: health tool call")


if __name__ == "__main__":
    asyncio.run(main())
