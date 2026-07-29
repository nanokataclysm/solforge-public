/**
 * Tiny in-memory sliding-window rate limiter (demo-scale, single instance).
 */

/**
 * @param {{ windowMs?: number, max?: number }} [options]
 */
export function createRateLimiter(options = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 20;
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  /**
   * @param {string} key
   * @returns {{ ok: true } | { ok: false, retryAfterSec: number }}
   */
  function check(key) {
    const now = Date.now();
    const bucket = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (bucket.length >= max) {
      const oldest = bucket[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
      hits.set(key, bucket);
      return { ok: false, retryAfterSec };
    }
    bucket.push(now);
    hits.set(key, bucket);
    return { ok: true };
  }

  function size() {
    return hits.size;
  }

  return { check, size, windowMs, max, multiInstanceSafe: false };
}
