#!/usr/bin/env python3
"""Test MCP retry logic without requiring live API credentials."""
from model_router import (
    count_tokens,
    select_model,
    execute_with_retry,
    is_retryable_error,
    get_next_candidate,
)


def test_token_counting():
    """Test token counting accuracy."""
    print("=== Token Counting Tests ===")

    # ASCII text
    tokens = count_tokens("Hello world")
    assert tokens > 0, "Should return positive token count"
    assert 2 <= tokens <= 4, f"Expected 2-4 tokens for 'Hello world', got {tokens}"
    print(f"{'ASCII text':30} | 'Hello world' | {tokens} tokens ✓")

    # Chinese characters
    tokens = count_tokens("你好世界")
    assert 2 <= tokens <= 4, f"Expected 2-4 tokens for Chinese text, got {tokens}"
    print(f"{'Chinese characters':30} | '你好世界' | {tokens} tokens ✓")

    # Whitespace compression
    text = "a    b    c"
    tokens = count_tokens(text)
    assert tokens < len(text) / 2, f"Should compress whitespace, got {tokens} tokens for {len(text)} chars"
    print(f"{'Whitespace compression':30} | '{text}' | {tokens} tokens ✓")

    # Empty string
    tokens = count_tokens("")
    assert tokens == 0, f"Expected 0 tokens for empty string, got {tokens}"
    print(f"{'Empty string':30} | '' | {tokens} tokens ✓")

    # Longer sentence
    text = "The quick brown fox jumps over the lazy dog"
    tokens = count_tokens(text)
    assert tokens > 0, "Should return positive token count"
    print(f"{'Longer sentence':30} | '{text[:30]}' | {tokens} tokens ✓")
    print()


def test_model_selection():
    """Test deterministic model selection."""
    print("=== Model Selection Tests ===")

    # Planner role
    selection = select_model(role="planner", estimated_input_tokens=1000, reserved_output_tokens=1500)
    assert selection["model"] in ["qwen-long", "qwen-plus", "qwen-max"], f"Unexpected planner model: {selection['model']}"
    assert selection["reason"] == "token-max-routing", f"Expected token-max-routing, got {selection['reason']}"
    assert len(selection["candidates"]) > 0, "Should have candidates"
    print(f"Role: {'planner':10} | Model: {selection['model']:15} | Candidates: {len(selection['candidates'])} | Reason: {selection['reason']} ✓")

    # Repair role
    selection = select_model(role="repair", estimated_input_tokens=500, reserved_output_tokens=1000)
    assert selection["model"] in ["qwen-plus", "qwen-turbo"], f"Unexpected repair model: {selection['model']}"
    assert selection["reason"] == "token-max-routing", f"Expected token-max-routing, got {selection['reason']}"
    print(f"Role: {'repair':10} | Model: {selection['model']:15} | Candidates: {len(selection['candidates'])} | Reason: {selection['reason']} ✓")

    # Navigator role
    selection = select_model(role="navigator", estimated_input_tokens=2000, reserved_output_tokens=2000)
    assert selection["model"] in ["qwen-plus", "qwen-turbo"], f"Unexpected navigator model: {selection['model']}"
    assert selection["reason"] == "token-max-routing", f"Expected token-max-routing, got {selection['reason']}"
    print(f"Role: {'navigator':10} | Model: {selection['model']:15} | Candidates: {len(selection['candidates'])} | Reason: {selection['reason']} ✓")
    print()


def test_retry_logic():
    """Test retry logic with mock errors."""
    print("=== Retry Logic Tests ===")

    # Test 1: Success on first attempt
    print("Test 1: Success on first attempt")
    attempt_count = [0]

    def success_fn(model, attempt):
        attempt_count[0] += 1
        return {"success": True, "model": model}

    result = execute_with_retry(
        role="planner",
        fn=success_fn,
        estimated_input_tokens=1000,
        reserved_output_tokens=1500,
    )
    assert attempt_count[0] == 1, f"Expected 1 attempt, got {attempt_count[0]}"
    assert result['result']['success'] is True, "Expected success=True"
    assert result['model'] in ["qwen-long", "qwen-plus", "qwen-max"], f"Unexpected model: {result['model']}"
    assert len(result['attempts']) == 1, f"Expected 1 attempt record, got {len(result['attempts'])}"
    print(f"  ✓ Succeeded on attempt {attempt_count[0]}")
    print(f"  Model used: {result['model']}")
    print(f"  Total attempts: {len(result['attempts'])}")
    print()

    # Test 2: Retry on quota error
    print("Test 2: Retry on quota error (simulated)")
    attempt_count = [0]

    def retry_fn(model, attempt):
        attempt_count[0] += 1
        if attempt == 0:
            raise Exception("AllocationQuota.FreeTierOnly: quota exceeded")
        return {"success": True, "model": model, "attempt": attempt}

    result = execute_with_retry(
        role="planner",
        fn=retry_fn,
        estimated_input_tokens=1000,
        reserved_output_tokens=1500,
    )
    assert attempt_count[0] == 2, f"Expected 2 attempts (1 fail + 1 success), got {attempt_count[0]}"
    assert result['result']['success'] is True, "Expected final success=True"
    assert result['result']['attempt'] == 1, f"Expected attempt=1 in result, got {result['result']['attempt']}"
    assert len(result['attempts']) == 2, f"Expected 2 attempt records, got {len(result['attempts'])}"
    assert result['attempts'][0]['success'] is False, "First attempt should have failed"
    assert result['attempts'][0]['retryable'] is True, "First attempt should be retryable"
    assert result['attempts'][1]['success'] is True, "Second attempt should have succeeded"
    print(f"  ✓ Succeeded after {attempt_count[0]} attempts")
    print(f"  Final model: {result['model']}")
    print(f"  Attempt history:")
    for i, att in enumerate(result['attempts']):
        status = "✓" if att['success'] else f"✗ ({att.get('error', 'unknown')})"
        print(f"    {i+1}. {att['model']:15} {status}")
    print()

    # Test 3: Non-retryable error
    print("Test 3: Non-retryable error (auth failure)")
    attempt_count = [0]

    def auth_fail_fn(model, attempt):
        attempt_count[0] += 1
        raise Exception("InvalidAuthentication: invalid API key")

    try:
        execute_with_retry(
            role="planner",
            fn=auth_fail_fn,
            estimated_input_tokens=1000,
            reserved_output_tokens=1500,
        )
        assert False, "Should have raised an exception"
    except Exception as e:
        assert "InvalidAuthentication" in str(e), f"Expected InvalidAuthentication error, got: {e}"
        assert attempt_count[0] == 1, f"Expected exactly 1 attempt (no retry), got {attempt_count[0]}"
        print(f"  ✓ Failed immediately (no retry): {str(e)[:60]}")
        print(f"  Attempts made: {attempt_count[0]}")
    print()


def test_error_classification():
    """Test retryable error detection."""
    print("=== Error Classification Tests ===")

    # Retryable: AllocationQuota.FreeTierOnly
    error = Exception("AllocationQuota.FreeTierOnly: quota exceeded")
    result = is_retryable_error(error)
    assert result is True, f"Expected True for quota error, got {result}"
    print(f"✓ {str(error)[:50]:50} | Retryable: {result}")

    # Retryable: Throttling.RateQuota
    error = Exception("Throttling.RateQuota: too many requests")
    result = is_retryable_error(error)
    assert result is True, f"Expected True for throttling error, got {result}"
    print(f"✓ {str(error)[:50]:50} | Retryable: {result}")

    # Non-retryable: InvalidAuthentication
    error = Exception("InvalidAuthentication: invalid API key")
    result = is_retryable_error(error)
    assert result is False, f"Expected False for auth error, got {result}"
    print(f"✓ {str(error)[:50]:50} | Retryable: {result}")

    # Non-retryable: InvalidParameter
    error = Exception("InvalidParameter: missing required field")
    result = is_retryable_error(error)
    assert result is False, f"Expected False for invalid parameter, got {result}"
    print(f"✓ {str(error)[:50]:50} | Retryable: {result}")

    # Non-retryable: Random error
    error = Exception("Some random error")
    result = is_retryable_error(error)
    assert result is False, f"Expected False for random error, got {result}"
    print(f"✓ {str(error)[:50]:50} | Retryable: {result}")
    print()


def test_candidate_progression():
    """Test candidate model progression."""
    print("=== Candidate Progression Tests ===")

    candidates = ["qwen-max", "qwen-plus", "qwen-turbo"]

    print(f"Candidates: {candidates}")
    current = candidates[0]
    for i in range(len(candidates) + 1):
        next_model = get_next_candidate(current, candidates)
        if next_model:
            print(f"  {current} → {next_model}")
            current = next_model
        else:
            print(f"  {current} → (exhausted)")
            break
    print()


if __name__ == "__main__":
    print("🧪 Solforge MCP Retry Logic Test Suite\n")

    test_token_counting()
    test_model_selection()
    test_retry_logic()
    test_error_classification()
    test_candidate_progression()

    print("✅ All mock tests completed successfully!")
    print("\nNote: These tests use mock data and don't require live API credentials.")
    print("For live API testing, set DASHSCOPE_API_KEY and DASHSCOPE_BASE_URL.")
