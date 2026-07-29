import { createRateLimiter } from "./rate-limit.mjs";

const DEFAULT_WINDOW_MS = 5 * 60_000;
const DEFAULT_MAX = 5;
const DEFAULT_KEY_PREFIX = "solforge:login-rate:";

const FIXED_WINDOW_SCRIPT = [
  'local count = redis.call("INCR", KEYS[1])',
  'if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end',
  'local ttl = redis.call("PTTL", KEYS[1])',
  'return { count, ttl }',
].join("\n");

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

/**
 * Atomic, multi-instance-safe fixed-window limiter backed by Upstash Redis REST.
 *
 * @param {{
 *   url?: string,
 *   token?: string,
 *   windowMs?: number,
 *   max?: number,
 *   keyPrefix?: string,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 */
export function createUpstashLoginRateLimiter(options = {}) {
  const windowMs = positiveInteger(
    options.windowMs,
    DEFAULT_WINDOW_MS,
    "windowMs",
  );
  const max = positiveInteger(options.max, DEFAULT_MAX, "max");
  const url = (options.url ?? process.env.UPSTASH_REDIS_REST_URL ?? "").replace(
    /\/$/,
    "",
  );
  const token = options.token ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
  const keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!url || !token || typeof fetchImpl !== "function") {
    throw new Error(
      "createUpstashLoginRateLimiter requires Upstash REST credentials and fetch",
    );
  }

  async function command(body) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Upstash Redis HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (payload?.error) {
      throw new Error(`Upstash Redis error: ${payload.error}`);
    }
    return payload?.result;
  }

  async function ready() {
    const result = await command(["PING"]);
    if (result !== "PONG") {
      throw new Error("Upstash Redis readiness check failed");
    }
  }

  async function check(key) {
    const result = await command([
      "EVAL",
      FIXED_WINDOW_SCRIPT,
      "1",
      `${keyPrefix}${key}`,
      String(windowMs),
    ]);
    const count = Number(result?.[0]);
    const ttlMs = Number(result?.[1]);
    if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) {
      throw new Error("Upstash Redis returned an invalid rate-limit result");
    }
    if (count > max) {
      return {
        ok: false,
        retryAfterSec: Math.max(1, Math.ceil(Math.max(0, ttlMs) / 1000)),
      };
    }
    return { ok: true };
  }

  return {
    ready,
    check,
    windowMs,
    max,
    backend: "upstash-redis",
    scope: "distributed",
    multiInstanceSafe: true,
  };
}

/**
 * Select the login limiter without silently weakening production protection.
 *
 * @param {{ env?: NodeJS.ProcessEnv, windowMs?: number, max?: number, fetchImpl?: typeof fetch }} [options]
 */
export function createLoginRateLimiterFromEnv(options = {}) {
  const env = options.env ?? process.env;
  const windowMs = positiveInteger(
    options.windowMs ?? env.LOGIN_RATE_WINDOW_MS,
    DEFAULT_WINDOW_MS,
    "LOGIN_RATE_WINDOW_MS",
  );
  const max = positiveInteger(
    options.max ?? env.LOGIN_RATE_MAX,
    DEFAULT_MAX,
    "LOGIN_RATE_MAX",
  );

  if (env.NODE_ENV === "test") {
    const limiter = createRateLimiter({ windowMs, max });
    return {
      ...limiter,
      ready: async () => {},
      backend: "memory",
      scope: "process",
    };
  }

  const url = env.UPSTASH_REDIS_REST_URL ?? "";
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? "";

  if (url || token) {
    if (!url || !token) {
      throw new Error("Incomplete Upstash Redis credentials for login rate limiting");
    }
    return createUpstashLoginRateLimiter({
      url,
      token,
      windowMs,
      max,
      fetchImpl: options.fetchImpl,
    });
  }

  if (env.NODE_ENV === "production" || env.VERCEL === "1") {
    throw new Error("Production requires a durable login rate limiter");
  }

  const limiter = createRateLimiter({ windowMs, max });
  return {
    ...limiter,
    ready: async () => {},
    backend: "memory",
    scope: "process",
  };
}
