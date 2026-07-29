"""Deterministic token-max model routing for Solforge MCP with retry fallback.

Reads from policy/qwen-models.json and selects models based on:
1. Explicit role override (if allowlisted)
2. Role support
3. Context window capacity (input + output)
4. Largest usable capacity
5. Deterministic priority/ID tie-breaking
6. Automatic retry with next candidate on quota errors
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Callable, TypeVar

# Repository root is two levels up from tools/mcp
REPO_ROOT = Path(__file__).parent.parent.parent
MANIFEST_PATH = REPO_ROOT / "policy" / "qwen-models.json"

_cached_manifest: dict[str, Any] | None = None

T = TypeVar("T")


def load_manifest() -> dict[str, Any]:
    """Load and cache the model manifest."""
    global _cached_manifest
    if _cached_manifest is not None:
        return _cached_manifest
    with open(MANIFEST_PATH, encoding="utf-8") as f:
        _cached_manifest = json.load(f)
    return _cached_manifest


def count_tokens(text: str) -> int:
    """Conservative token estimation using character-based approximation.

    Accounts for different character types:
    - ASCII characters (~4 chars per token)
    - Whitespace compression (~8 chars per token)
    - Multi-byte characters (~2 chars per token)
    Includes 5% safety margin for tokenizer variations.
    """
    if not text:
        return 0

    # Count different character types
    ascii_chars = 0
    whitespace = 0
    multibyte_chars = 0

    for char in text:
        code = ord(char)
        if code <= 127:
            if char in (' ', '\t', '\n', '\r'):
                whitespace += 1
            else:
                ascii_chars += 1
        else:
            multibyte_chars += 1

    # Token calculation based on character types:
    # - ASCII: ~4 chars per token
    # - Whitespace: ~8 chars per token (compressed)
    # - Multibyte: ~2 chars per token (CJK, emoji, etc.)
    tokens = int(
        ascii_chars / 4 +
        whitespace / 8 +
        multibyte_chars / 2
    )

    # Add 20% safety margin for tokenizer variations
    return int(tokens * 1.20) + 1


def estimate_tokens(text: str) -> int:
    """Estimate token count (deprecated, use count_tokens)."""
    return count_tokens(text)


def select_model(
    role: str,
    explicit_model: str | None = None,
    estimated_input_tokens: int = 0,
    reserved_output_tokens: int = 1500,
) -> dict[str, Any]:
    """Select best model for role with deterministic token-max routing.

    Returns:
        dict with keys: model, reason, candidates
    """
    manifest = load_manifest()
    allowlist = manifest["allowlist"]
    models = manifest["models"]

    # 1. Check explicit override
    if explicit_model:
        if explicit_model not in allowlist:
            raise ValueError(
                f"Model {explicit_model} not in allowlist. "
                f"Allowed: {', '.join(allowlist)}"
            )
        model_def = next((m for m in models if m["id"] == explicit_model), None)
        if not model_def:
            raise ValueError(f"Model {explicit_model} not found in manifest")
        if role not in model_def["roles"]:
            raise ValueError(
                f"Model {explicit_model} does not support role {role}. "
                f"Supports: {', '.join(model_def['roles'])}"
            )
        return {
            "model": explicit_model,
            "reason": "explicit-override",
            "candidates": [explicit_model],
        }

    # 2. Filter by role support
    candidates = [m for m in models if role in m["roles"]]
    if not candidates:
        raise ValueError(f"No models support role: {role}")

    # 3. Filter by context capacity
    required_tokens = estimated_input_tokens + reserved_output_tokens
    candidates = [m for m in candidates if m["contextWindow"] >= required_tokens]
    if not candidates:
        raise ValueError(
            f"No models have sufficient context for role {role}. "
            f"Required: {required_tokens} tokens"
        )

    # 4. Sort by usable capacity (context window), then priority, then ID
    candidates.sort(
        key=lambda m: (
            -m["contextWindow"],  # Largest first (negative for descending)
            -m["priority"],       # Higher priority first
            m["id"],              # Lexicographic for deterministic tie-breaking
        )
    )

    selected = candidates[0]
    return {
        "model": selected["id"],
        "reason": "token-max-routing",
        "candidates": [c["id"] for c in candidates],
    }


def is_retryable_error(error: Exception) -> bool:
    """Check if an error is retryable per manifest policy."""
    manifest = load_manifest()
    retryable_errors = manifest["retryPolicy"]["retryableErrors"]
    error_message = str(error)
    return any(pattern in error_message for pattern in retryable_errors)


def get_next_candidate(failed_model: str, candidates: list[str]) -> str | None:
    """Get next candidate model after a failure."""
    try:
        idx = candidates.index(failed_model)
        if idx == len(candidates) - 1:
            return None
        return candidates[idx + 1]
    except ValueError:
        return None


def execute_with_retry(
    role: str,
    fn: Callable[[str, int], T],
    explicit_model: str | None = None,
    estimated_input_tokens: int = 0,
    reserved_output_tokens: int = 1500,
    max_retries: int | None = None,
) -> dict[str, Any]:
    """Execute a function with automatic retry fallback through candidate models.

    Args:
        role: Agent role
        fn: Function to execute, receives (model, attempt) -> result
        explicit_model: Explicit model override
        estimated_input_tokens: Input token count
        reserved_output_tokens: Output token reservation
        max_retries: Maximum retry attempts (default: from manifest or 3)

    Returns:
        dict with keys: result, model, attempts, selection
    """
    manifest = load_manifest()
    max_attempts = max_retries if max_retries is not None else manifest["retryPolicy"].get("maxRetries", 3)

    # Get initial model selection
    selection = select_model(
        role=role,
        explicit_model=explicit_model,
        estimated_input_tokens=estimated_input_tokens,
        reserved_output_tokens=reserved_output_tokens,
    )

    attempts = []
    current_model = selection["model"]

    for attempt in range(max_attempts):
        try:
            result = fn(current_model, attempt)
            attempts.append({"model": current_model, "success": True})
            return {
                "result": result,
                "model": current_model,
                "attempts": attempts,
                "selection": selection,
            }
        except Exception as error:
            retryable = is_retryable_error(error)
            attempts.append({
                "model": current_model,
                "success": False,
                "error": str(error),
                "retryable": retryable,
            })

            if not retryable:
                # Non-retryable error, fail immediately
                raise

            # Try next candidate
            next_model = get_next_candidate(current_model, selection["candidates"])
            if not next_model:
                # No more candidates, throw exhaustion error
                raise ValueError(
                    f"All retry attempts exhausted for role {role}. "
                    f"Tried models: {', '.join(a['model'] for a in attempts)}. "
                    f"Last error: {error}"
                )

            current_model = next_model

            print(f"model_retry: role={role}, failed={attempts[-1]['model']}, "
                  f"next={current_model}, attempt={attempt + 1}, reason={error}")

    # Exhausted all retries without finding next candidate
    raise ValueError(
        f"All {max_attempts} retry attempts exhausted for role {role}. "
        f"Tried models: {', '.join(a['model'] for a in attempts)}"
    )


def get_role_default(role: str) -> str:
    """Get role default model from manifest."""
    manifest = load_manifest()
    default_model = manifest["roleDefaults"].get(role)
    if not default_model:
        raise ValueError(f"No default model for role: {role}")
    return default_model