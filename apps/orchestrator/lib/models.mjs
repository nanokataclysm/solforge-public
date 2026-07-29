/**
 * Solforge Qwen role → model map with deterministic token-max routing.
 * Uses policy/qwen-models.json manifest for model selection.
 * Supports explicit overrides via environment variables.
 */

import { selectModel, getRoleDefault, estimateTokens } from "./model-router.mjs";

/** Roles exposed on MCP and shell map */
export const WIRED_ROLES = Object.freeze([
  "planner",
  "repair",
  "navigator",
  "specialist",
  "chair",
  "builder",
]);

/**
 * Get explicit model override from environment for a role.
 * @param {string} role
 * @returns {string|undefined}
 */
function getExplicitOverride(role) {
  const roleUpper = role.toUpperCase();
  return (
    process.env[`QWEN_${roleUpper}_MODEL`] ||
    (role === "planner" || role === "chair" ? process.env.QWEN_MODEL : undefined)
  );
}

/**
 * Select model for role using deterministic token-max routing.
 * @param {string} role
 * @param {object} [options]
 * @param {string} [options.inputText] - Input text for token estimation
 * @param {number} [options.estimatedInputTokens] - Pre-calculated input tokens
 * @param {number} [options.reservedOutputTokens] - Reserved output tokens
 * @returns {Promise<{model: string, reason: string, candidates: string[]}>}
 */
export async function selectModelForRole(role, options = {}) {
  const explicitModel = getExplicitOverride(role);
  const estimatedInputTokens =
    options.estimatedInputTokens ??
    (options.inputText ? estimateTokens(options.inputText) : 0);
  const reservedOutputTokens = options.reservedOutputTokens ?? 1500;

  return selectModel({
    role,
    explicitModel,
    estimatedInputTokens,
    reservedOutputTokens,
  });
}

/**
 * Get model for role (backward compatibility).
 * Uses environment override or manifest default.
 * @param {string} role
 * @returns {Promise<string>}
 */
export async function modelFor(role) {
  const explicitModel = getExplicitOverride(role);
  if (explicitModel) {
    // Validate override through router
    const result = await selectModel({
      role,
      explicitModel,
      estimatedInputTokens: 0,
      reservedOutputTokens: 1500,
    });
    return result.model;
  }
  return getRoleDefault(role);
}

/**
 * Shell / env export block (no secrets).
 * @returns {Promise<string>}
 */
export async function exportEnvBlock() {
  const lines = ["# Solforge / NANOKAT Qwen model map — no secrets"];
  for (const role of WIRED_ROLES) {
    const model = await modelFor(role);
    const roleUpper = role.toUpperCase();
    lines.push(`export QWEN_${roleUpper}_MODEL="${model}"`);
  }
  lines.push(`export QWEN_MODEL="${await modelFor("planner")}"`);
  return lines.join("\n") + "\n";
}

// Re-export for convenience
export { estimateTokens } from "./model-router.mjs";
