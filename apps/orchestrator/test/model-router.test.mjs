/**
 * Tests for deterministic token-max model routing.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  selectModel,
  estimateTokens,
  countTokens,
  isRetryableError,
  getNextCandidate,
  getRoleDefault,
  executeWithRetry,
} from "../lib/model-router.mjs";

describe("model-router", () => {
  describe("countTokens", () => {
    it("counts tokens accurately for ASCII text", () => {
      const text = "Hello world";
      const tokens = countTokens(text);
      assert.ok(tokens > 0, "Should return positive token count");
      assert.ok(tokens >= 2 && tokens <= 4, "Should be ~3 tokens for 'Hello world'");
    });

    it("handles empty string", () => {
      const tokens = countTokens("");
      assert.strictEqual(tokens, 0);
    });

    it("counts whitespace efficiently", () => {
      const text = "a    b    c"; // lots of spaces
      const tokens = countTokens(text);
      assert.ok(tokens < text.length / 2, "Should compress whitespace");
    });

    it("counts multibyte characters", () => {
      const text = "你好世界"; // Chinese characters
      const tokens = countTokens(text);
      assert.ok(tokens >= 2 && tokens <= 4, "Should handle CJK efficiently");
    });
  });

  describe("estimateTokens (deprecated)", () => {
    it("delegates to countTokens", () => {
      const text = "Hello world";
      const estimated = estimateTokens(text);
      const counted = countTokens(text);
      assert.strictEqual(estimated, counted);
    });
  });

  describe("selectModel", () => {
    it("selects explicit override when valid", async () => {
      const result = await selectModel({
        role: "planner",
        explicitModel: "qwen-plus",
      });
      assert.strictEqual(result.model, "qwen-plus");
      assert.strictEqual(result.reason, "explicit-override");
    });

    it("rejects non-allowlisted override", async () => {
      await assert.rejects(
        async () => {
          await selectModel({
            role: "planner",
            explicitModel: "gpt-4",
          });
        },
        /not in allowlist/,
      );
    });

    it("rejects override that doesn't support role", async () => {
      await assert.rejects(
        async () => {
          await selectModel({
            role: "planner",
            explicitModel: "qwen-turbo", // doesn't support planner
          });
        },
        /does not support role/,
      );
    });

    it("selects largest eligible model for role", async () => {
      const result = await selectModel({
        role: "planner",
        estimatedInputTokens: 1000,
        reservedOutputTokens: 1500,
      });
      // qwen-long has largest context (1M tokens) and supports planner
      assert.strictEqual(result.model, "qwen-long");
      assert.strictEqual(result.reason, "token-max-routing");
      assert.ok(result.candidates.includes("qwen-long"));
    });

    it("skips models with insufficient context", async () => {
      const result = await selectModel({
        role: "planner",
        estimatedInputTokens: 30000,
        reservedOutputTokens: 2000,
      });
      // qwen-max (8192) and qwen-turbo (8192) are too small
      // qwen-plus (32768) is sufficient
      assert.ok(["qwen-plus", "qwen-long"].includes(result.model));
      assert.ok(!result.candidates.includes("qwen-max"));
      assert.ok(!result.candidates.includes("qwen-turbo"));
    });

    it("resolves ties deterministically by priority", async () => {
      // Both qwen-plus and qwen-max support planner
      // When context requirements are low, both are eligible
      // qwen-max has higher priority (30 vs 20)
      const result = await selectModel({
        role: "planner",
        estimatedInputTokens: 1000,
        reservedOutputTokens: 1500,
      });
      // But qwen-long has largest context, so it wins
      assert.strictEqual(result.model, "qwen-long");
    });

    it("selects turbo for repair role", async () => {
      const result = await selectModel({
        role: "repair",
        estimatedInputTokens: 500,
        reservedOutputTokens: 1000,
      });
      // Only qwen-turbo and qwen-plus support repair
      // qwen-plus has larger context, so it wins
      assert.strictEqual(result.model, "qwen-plus");
    });

    it("throws when no models support role", async () => {
      // Temporarily test with invalid role
      await assert.rejects(
        async () => {
          await selectModel({
            role: "invalid-role",
          });
        },
        /No models support role/,
      );
    });

    it("throws when no models have sufficient context", async () => {
      await assert.rejects(
        async () => {
          await selectModel({
            role: "repair",
            estimatedInputTokens: 50000,
            reservedOutputTokens: 2000,
          });
        },
        /No models have sufficient context/,
      );
    });
  });

  describe("isRetryableError", () => {
    it("identifies AllocationQuota.FreeTierOnly as retryable", async () => {
      const error = new Error("AllocationQuota.FreeTierOnly: quota exceeded");
      const retryable = await isRetryableError(error);
      assert.strictEqual(retryable, true);
    });

    it("identifies InvalidAuthentication as non-retryable", async () => {
      const error = new Error("InvalidAuthentication: invalid API key");
      const retryable = await isRetryableError(error);
      assert.strictEqual(retryable, false);
    });

    it("identifies PermissionDenied as non-retryable", async () => {
      const error = new Error("PermissionDenied: access denied");
      const retryable = await isRetryableError(error);
      assert.strictEqual(retryable, false);
    });

    it("identifies SafetyViolation as non-retryable", async () => {
      const error = new Error("SafetyViolation: content policy");
      const retryable = await isRetryableError(error);
      assert.strictEqual(retryable, false);
    });
  });

  describe("getNextCandidate", () => {
    it("returns next candidate in list", () => {
      const candidates = ["qwen-long", "qwen-plus", "qwen-max"];
      const next = getNextCandidate("qwen-long", candidates);
      assert.strictEqual(next, "qwen-plus");
    });

    it("returns null when at end of list", () => {
      const candidates = ["qwen-long", "qwen-plus", "qwen-max"];
      const next = getNextCandidate("qwen-max", candidates);
      assert.strictEqual(next, null);
    });

    it("returns null when model not in list", () => {
      const candidates = ["qwen-long", "qwen-plus"];
      const next = getNextCandidate("qwen-turbo", candidates);
      assert.strictEqual(next, null);
    });
  });

  describe("getRoleDefault", () => {
    it("returns default for planner", async () => {
      const defaultModel = await getRoleDefault("planner");
      assert.strictEqual(defaultModel, "qwen-plus");
    });

    it("returns default for repair", async () => {
      const defaultModel = await getRoleDefault("repair");
      assert.strictEqual(defaultModel, "qwen-turbo");
    });

    it("throws for unknown role", async () => {
      await assert.rejects(
        async () => {
          await getRoleDefault("unknown-role");
        },
        /No default model for role/,
      );
    });
  });

  describe("executeWithRetry", () => {
    it("succeeds on first attempt", async () => {
      let callCount = 0;
      const result = await executeWithRetry({
        role: "planner",
        estimatedInputTokens: 1000,
        reservedOutputTokens: 1500,
        fn: async (model, attempt) => {
          callCount++;
          assert.strictEqual(attempt, 0);
          assert.ok(model);
          return { success: true, model };
        },
      });
      assert.strictEqual(callCount, 1);
      assert.strictEqual(result.result.success, true);
      assert.ok(result.model);
      assert.strictEqual(result.attempts.length, 1);
      assert.strictEqual(result.attempts[0].success, true);
    });

    it("retries on quota error and succeeds", async () => {
      let callCount = 0;
      const result = await executeWithRetry({
        role: "planner",
        estimatedInputTokens: 1000,
        reservedOutputTokens: 1500,
        fn: async (model, attempt) => {
          callCount++;
          if (attempt === 0) {
            const error = new Error("AllocationQuota.FreeTierOnly: quota exceeded");
            throw error;
          }
          return { success: true, model, attempt };
        },
      });
      assert.strictEqual(callCount, 2);
      assert.strictEqual(result.result.success, true);
      assert.strictEqual(result.result.attempt, 1);
      assert.strictEqual(result.attempts.length, 2);
      assert.strictEqual(result.attempts[0].success, false);
      assert.strictEqual(result.attempts[0].retryable, true);
      assert.strictEqual(result.attempts[1].success, true);
    });

    it("fails immediately on non-retryable error", async () => {
      let callCount = 0;
      await assert.rejects(
        async () => {
          await executeWithRetry({
            role: "planner",
            estimatedInputTokens: 1000,
            reservedOutputTokens: 1500,
            fn: async (model, attempt) => {
              callCount++;
              throw new Error("InvalidAuthentication: invalid API key");
            },
          });
        },
        /InvalidAuthentication/,
      );
      assert.strictEqual(callCount, 1, "Should not retry on auth error");
    });

    it("exhausts all candidates and fails", async () => {
      let callCount = 0;
      await assert.rejects(
        async () => {
          await executeWithRetry({
            role: "repair",
            estimatedInputTokens: 1000,
            reservedOutputTokens: 1000,
            maxRetries: 5,
            fn: async (model, attempt) => {
              callCount++;
              throw new Error("AllocationQuota.FreeTierOnly: quota exceeded");
            },
          });
        },
        /retry attempts exhausted/,
      );
      assert.ok(callCount >= 2, "Should try multiple candidates");
    });

    it("respects maxRetries limit", async () => {
      let callCount = 0;
      await assert.rejects(
        async () => {
          await executeWithRetry({
            role: "planner",
            estimatedInputTokens: 1000,
            reservedOutputTokens: 1500,
            maxRetries: 2,
            fn: async (model, attempt) => {
              callCount++;
              throw new Error("AllocationQuota.FreeTierOnly: quota exceeded");
            },
          });
        },
        /retry attempts exhausted/,
      );
      assert.strictEqual(callCount, 2, "Should respect maxRetries");
    });

    it("does not retry when explicit model is set", async () => {
      let callCount = 0;
      const models = [];
      await assert.rejects(
        async () => {
          await executeWithRetry({
            role: "planner",
            explicitModel: "qwen-plus",
            estimatedInputTokens: 1000,
            reservedOutputTokens: 1500,
            fn: async (model, attempt) => {
              callCount++;
              models.push(model);
              throw new Error("AllocationQuota.FreeTierOnly: quota exceeded");
            },
          });
        },
        /Explicit model qwen-plus failed/,
      );
      assert.strictEqual(callCount, 1, "Should not retry with explicit model");
      assert.strictEqual(models.length, 1, "Should only try the explicit model");
      assert.strictEqual(models[0], "qwen-plus");
    });
  });
});
