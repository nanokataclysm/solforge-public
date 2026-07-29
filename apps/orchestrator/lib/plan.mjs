/**
 * Plan validation for Solforge / NANOKAT Forge.
 * Shared by /api/plan (post-model), /api/approve, and preview.
 */

const MAX_STRING = 2_000;
const MAX_PAGES = 6;
const MIN_PAGES = 1;

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {string | null}
 */
function asTrimmedString(value, max = MAX_STRING) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t || t.length > max) return null;
  return t;
}

/**
 * @param {unknown} plan
 * @returns {{ ok: true, plan: object } | { ok: false, status: number, error: string, details?: string[] }}
 */
export function validatePlan(plan) {
  const details = [];

  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return { ok: false, status: 400, error: "A valid plan object is required" };
  }

  const businessName = asTrimmedString(plan.businessName, 200);
  const businessSummary = asTrimmedString(plan.businessSummary, MAX_STRING);
  if (!businessSummary && !businessName) {
    details.push("businessName or businessSummary required");
  }

  if (plan.pages !== undefined && !Array.isArray(plan.pages)) {
    details.push("pages must be an array when present");
  }
  if (Array.isArray(plan.pages)) {
    if (plan.pages.length < MIN_PAGES || plan.pages.length > MAX_PAGES) {
      details.push(`pages must have ${MIN_PAGES}–${MAX_PAGES} items`);
    }
  }

  if (
    plan.palette !== undefined &&
    !Array.isArray(plan.palette) &&
    (typeof plan.palette !== "object" || plan.palette === null)
  ) {
    details.push("palette must be an array or object when present");
  }

  // Reject obvious script-ish free text in name/summary
  for (const [key, val] of [
    ["businessName", plan.businessName],
    ["businessSummary", plan.businessSummary],
  ]) {
    if (typeof val === "string" && /<\s*script/i.test(val)) {
      details.push(`${key} must not contain script tags`);
    }
  }

  if (details.length > 0) {
    return {
      ok: false,
      status: 422,
      error: "Plan failed validation",
      details,
    };
  }

  return { ok: true, plan };
}

/**
 * Strip markdown fences and parse JSON plan from model text.
 * @param {string} content
 * @returns {unknown}
 */
export function parsePlanJson(content) {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("empty model content");
  }
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(normalized);
}
