"""Wire Solforge agent roles to Qwen (used by MCP tools)."""
from __future__ import annotations

import json
import os
from typing import Any

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover
    OpenAI = None  # type: ignore

try:
    from .model_router import select_model, count_tokens, estimate_tokens, get_role_default, execute_with_retry
except ImportError:
    from model_router import select_model, count_tokens, estimate_tokens, get_role_default, execute_with_retry


def get_explicit_override(role: str) -> str | None:
    """Get explicit model override from environment for a role."""
    role_upper = role.upper()
    override = os.environ.get(f"QWEN_{role_upper}_MODEL")
    if override:
        return override
    if role in ("planner", "chair"):
        return os.environ.get("QWEN_MODEL")
    return None

ROLE_PROMPTS = {
    "navigator": (
        "You are Solforge Navigator. Classify the mission. Return one JSON object with "
        "missionType, primaryOutcome, possibleArtifacts, websiteRequired, risks. JSON only."
    ),
    "planner": (
        "You are Solforge Planner. Turn a business brief into a website plan JSON with "
        "businessName, businessSummary, archetype, pages (3-6), palette (3 hex), motif, "
        "approvalCheckpoints, validationSteps, risks. JSON only."
    ),
    "repair": (
        "Fix input into one valid website plan JSON object. No markdown. JSON only."
    ),
}


def run_role(role: str, prompt: str) -> dict[str, Any]:
    """Run a role with deterministic token-max model routing."""
    if role not in ROLE_PROMPTS:
        return {
            "ok": False,
            "error": f"unknown role: {role}",
            "roles": list(ROLE_PROMPTS.keys()),
        }
    if OpenAI is None:
        return {"ok": False, "error": "openai package not installed in MCP venv"}

    key = os.environ.get("DASHSCOPE_API_KEY", "")
    base = os.environ.get("DASHSCOPE_BASE_URL", "")
    if not key or not base:
        return {"ok": False, "error": "DASHSCOPE_API_KEY and DASHSCOPE_BASE_URL required"}

    client = OpenAI(api_key=key, base_url=base)

    # Execute with automatic retry fallback
    try:
        explicit_model = get_explicit_override(role)
        system_prompt = ROLE_PROMPTS[role]
        estimated_input = count_tokens(system_prompt + prompt)

        def execute_completion(model: str, attempt: int) -> dict[str, Any]:
            result = client.chat.completions.create(
                model=model,
                temperature=0.2 if role != "repair" else 0,
                max_tokens=1200,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ],
            )
            content = result.choices[0].message.content or ""
            usage = result.usage.model_dump() if result.usage else None
            return {"content": content, "usage": usage}

        retry_result = execute_with_retry(
            role=role,
            fn=execute_completion,
            explicit_model=explicit_model,
            estimated_input_tokens=estimated_input,
            reserved_output_tokens=1200,
        )

        return {
            "ok": True,
            "role": role,
            "model": retry_result["model"],
            "selection": retry_result["selection"],
            "attempts": retry_result["attempts"],
            "content": retry_result["result"]["content"],
            "usage": retry_result["result"]["usage"],
        }
    except (ValueError, KeyError) as e:
        return {"ok": False, "error": f"model execution failed: {e}"}
