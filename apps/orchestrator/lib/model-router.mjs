/**
 * Deterministic token-max model routing for Solforge with retry fallback.
 * Reads from policy/qwen-models.json and selects models based on:
 * 1. Explicit role override (if allowlisted)
 * 2. Role support
 * 3. Context window capacity (input + output)
 * 4. Largest usable capacity
 * 5. Deterministic priority/ID tie-breaking
 * 6. Automatic retry with next candidate on quota errors
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, "../../../policy/qwen-models.json");

let cachedManifest = null;

/**
 * Load and cache the model manifest.
 * @returns {Promise<object>}
 */
async function loadManifest() {
  if (cachedManifest) return cachedManifest;
  const content = await fs.readFile(MANIFEST_PATH, "utf8");
  cachedManifest = JSON.parse(content);
  return cachedManifest;
}

/**
 * Conservative token estimation using character-based approximation.
 * Accounts for different character types:
 * - ASCII characters (~4 chars per token)
 * - Whitespace compression (~8 chars per token)
 * - Multi-byte characters (~2 chars per token)
 * Includes 5% safety margin for tokenizer variations.
 * @param {string} text
 * @returns {number}
 */
export function countTokens(text) {
  if (!text) return 0;

  // Count different character types
  let asciiChars = 0;
  let whitespace = 0;
  let multibyteChars = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 127) {
      if (code === 32 || code === 9 || code === 10 || code === 13) {
        whitespace++;
      } else {
        asciiChars++;
      }
    } else {
      multibyteChars++;
    }
  }

  // Token calculation based on character types:
  // - ASCII: ~4 chars per token
  // - Whitespace: ~8 chars per token (compressed)
  // - Multibyte: ~2 chars per token (CJK, emoji, etc.)
  const tokens = Math.ceil(
    asciiChars / 4 +
    whitespace / 8 +
    multibyteChars / 2
  );

  // Add 20% safety margin per manifest policy
  return Math.ceil(tokens * 1.2);
}

/**
 * Estimate token count (deprecated, use countTokens).
 * @param {string} text
 * @returns {number}
 * @deprecated Use countTokens() for conservative character-based approximation
 */
export function estimateTokens(text) {
  return countTokens(text);
}

/**
 * Select best model for role with deterministic token-max routing.
 * @param {object} options
 * @param {string} options.role - Agent role (planner, repair, navigator, etc.)
 * @param {string} [options.explicitModel] - Explicit model override from env
 * @param {number} [options.estimatedInputTokens=0] - Estimated input size
 * @param {number} [options.reservedOutputTokens=1500] - Reserved output size
 * @returns {Promise<{model: string, reason: string, candidates: string[]}>}
 */
export async function selectModel({
  role,
  explicitModel,
  estimatedInputTokens = 0,
  reservedOutputTokens = 1500,
}) {
  const manifest = await loadManifest();
  const { allowlist, models, roleDefaults } = manifest;

  // 1. Check explicit override
  if (explicitModel) {
    if (!allowlist.includes(explicitModel)) {
      throw new Error(
        `Model ${explicitModel} not in allowlist. Allowed: ${allowlist.join(", ")}`,
      );
    }
    const modelDef = models.find((m) => m.id === explicitModel);
    if (!modelDef) {
      throw new Error(`Model ${explicitModel} not found in manifest`);
    }
    if (!modelDef.roles.includes(role)) {
      throw new Error(
        `Model ${explicitModel} does not support role ${role}. Supports: ${modelDef.roles.join(", ")}`,
      );
    }
    return {
      model: explicitModel,
      reason: "explicit-override",
      candidates: [explicitModel],
    };
  }

  // 2. Filter by role support
  let candidates = models.filter((m) => m.roles.includes(role));
  if (candidates.length === 0) {
    throw new Error(`No models support role: ${role}`);
  }

  // 3. Filter by context capacity
  const requiredTokens = estimatedInputTokens + reservedOutputTokens;
  candidates = candidates.filter((m) => m.contextWindow >= requiredTokens);
  if (candidates.length === 0) {
    throw new Error(
      `No models have sufficient context for role ${role}. Required: ${requiredTokens} tokens`,
    );
  }

  // 4. Sort by usable capacity (context window), then priority, then ID
  candidates.sort((a, b) => {
    // Largest context window first
    if (b.contextWindow !== a.contextWindow) {
      return b.contextWindow - a.contextWindow;
    }
    // Higher priority first
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    // Lexicographic ID for deterministic tie-breaking
    return a.id.localeCompare(b.id);
  });

  const selected = candidates[0];
  return {
    model: selected.id,
    reason: "token-max-routing",
    candidates: candidates.map((c) => c.id),
  };
}

/**
 * Check if an error is retryable per manifest policy.
 * @param {Error} error
 * @returns {Promise<boolean>}
 */
export async function isRetryableError(error) {
  const manifest = await loadManifest();
  const { retryableErrors } = manifest.retryPolicy;
  const errorMessage = error.message || String(error);
  return retryableErrors.some((pattern) => errorMessage.includes(pattern));
}

/**
 * Get next candidate model after a failure.
 * @param {string} failedModel
 * @param {string[]} candidates
 * @returns {string|null}
 */
export function getNextCandidate(failedModel, candidates) {
  const idx = candidates.indexOf(failedModel);
  if (idx === -1 || idx === candidates.length - 1) return null;
  return candidates[idx + 1];
}

/**
 * Execute a function with automatic retry fallback through candidate models.
 * @param {object} options
 * @param {string} options.role - Agent role
 * @param {string} [options.explicitModel] - Explicit model override
 * @param {number} [options.estimatedInputTokens] - Input token count
 * @param {number} [options.reservedOutputTokens] - Output token reservation
 * @param {Function} options.fn - Async function to execute, receives (model, attempt) => Promise<T>
 * @param {number} [options.maxRetries] - Maximum retry attempts (default: from manifest or 3)
 * @returns {Promise<{result: any, model: string, attempts: Array<{model: string, error?: string}>}>}
 */
export async function executeWithRetry({
  role,
  explicitModel,
  estimatedInputTokens,
  reservedOutputTokens,
  fn,
  maxRetries,
}) {
  const manifest = await loadManifest();
  const maxAttempts = maxRetries ?? manifest.retryPolicy?.maxRetries ?? 3;

  // Get initial model selection
  const selection = await selectModel({
    role,
    explicitModel,
    estimatedInputTokens,
    reservedOutputTokens,
  });

  const attempts = [];
  let currentModel = selection.model;
  let candidateIndex = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await fn(currentModel, attempt);
      attempts.push({ model: currentModel, success: true });
      return {
        result,
        model: currentModel,
        attempts,
        selection,
      };
    } catch (error) {
      const isRetryable = await isRetryableError(error);
      attempts.push({
        model: currentModel,
        success: false,
        error: error.message,
        retryable: isRetryable,
      });

      if (!isRetryable) {
        // Non-retryable error, fail immediately
        throw error;
      }

      // If explicit override, do not retry with other models
      if (explicitModel) {
        throw new Error(
          `Explicit model ${explicitModel} failed for role ${role}. ` +
          `Error: ${error.message}`
        );
      }

      // Try next candidate (automatic routing only)
      const nextModel = getNextCandidate(currentModel, selection.candidates);
      if (!nextModel) {
        // No more candidates, throw exhaustion error
        throw new Error(
          `All retry attempts exhausted for role ${role}. ` +
          `Tried models: ${attempts.map(a => a.model).join(", ")}. ` +
          `Last error: ${error.message}`
        );
      }

      currentModel = nextModel;
      candidateIndex++;

      console.info("model_retry", {
        role,
        failedModel: attempts[attempt].model,
        nextModel: currentModel,
        attempt: attempt + 1,
        reason: error.message,
      });
    }
  }

  // Exhausted all retries without finding next candidate
  throw new Error(
    `All ${maxAttempts} retry attempts exhausted for role ${role}. ` +
    `Tried models: ${attempts.map(a => a.model).join(", ")}`
  );
}

/**
 * Get role default model from manifest.
 * @param {string} role
 * @returns {Promise<string>}
 */
export async function getRoleDefault(role) {
  const manifest = await loadManifest();
  const defaultModel = manifest.roleDefaults[role];
  if (!defaultModel) {
    throw new Error(`No default model for role: ${role}`);
  }
  return defaultModel;
}
