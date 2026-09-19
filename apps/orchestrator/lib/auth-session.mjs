import crypto from "node:crypto";

export const AUTH_COOKIE_NAME = "sf_auth_session";
export const DEFAULT_AUTH_TTL_MS = 8 * 60 * 60 * 1000;

export function hashSessionToken(token) {
  if (typeof token !== "string" || !token) return "";
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function constantTimeSecretEqual(supplied, expected) {
  const suppliedDigest = crypto
    .createHash("sha256")
    .update(typeof supplied === "string" ? supplied : "")
    .digest();
  const expectedDigest = crypto
    .createHash("sha256")
    .update(typeof expected === "string" ? expected : "")
    .digest();
  return (
    typeof supplied === "string" &&
    typeof expected === "string" &&
    expected.length > 0 &&
    crypto.timingSafeEqual(suppliedDigest, expectedDigest)
  );
}

function newSession(ttlMs) {
  const token = crypto.randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashSessionToken(token),
    expiresAt: Date.now() + ttlMs,
    ttlMs,
  };
}

export function createAuthStore(options = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_AUTH_TTL_MS;
  const sessions = options.sessions ?? new Map();

  function prune(now = Date.now()) {
    for (const [tokenHash, row] of sessions) {
      if (row.expiresAt <= now) sessions.delete(tokenHash);
    }
  }

  function create() {
    prune();
    const session = newSession(ttlMs);
    sessions.set(session.tokenHash, { expiresAt: session.expiresAt });
    return session;
  }

  function get(token) {
    prune();
    const tokenHash = hashSessionToken(token);
    const row = tokenHash ? sessions.get(tokenHash) : null;
    if (!row) return { authenticated: false };
    return {
      authenticated: true,
      expiresAt: row.expiresAt,
      binding: tokenHash,
    };
  }

  function destroy(token) {
    const tokenHash = hashSessionToken(token);
    return tokenHash ? sessions.delete(tokenHash) : false;
  }

  function expire(token) {
    const row = sessions.get(hashSessionToken(token));
    if (row) row.expiresAt = Date.now() - 1;
  }

  return {
    ready: async () => {},
    create,
    get,
    destroy,
    expire,
    size: () => {
      prune();
      return sessions.size;
    },
    ttlMs,
    backend: "memory",
    multiInstanceSafe: false,
  };
}

export function createUpstashAuthStore(options = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_AUTH_TTL_MS;
  const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
  const url = (options.url ?? process.env.UPSTASH_REDIS_REST_URL ?? "").replace(
    /\/$/,
    "",
  );
  const token = options.token ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
  const keyPrefix = options.keyPrefix ?? "solforge:auth:";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!url || !token || typeof fetchImpl !== "function") {
    throw new Error("createUpstashAuthStore requires Upstash REST credentials");
  }

  async function redis(path) {
    const response = await fetchImpl(`${url}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Upstash Redis HTTP ${response.status}`);
    }
    return response.json();
  }

  function keyFor(tokenHash) {
    return encodeURIComponent(`${keyPrefix}${tokenHash}`);
  }

  async function ready() {
    await redis("/ping");
  }

  async function create() {
    const session = newSession(ttlMs);
    const payload = encodeURIComponent(
      JSON.stringify({ expiresAt: session.expiresAt }),
    );
    await redis(`/set/${keyFor(session.tokenHash)}/${payload}?EX=${ttlSec}`);
    return session;
  }

  async function get(rawToken) {
    const tokenHash = hashSessionToken(rawToken);
    if (!tokenHash) return { authenticated: false };
    const result = await redis(`/get/${keyFor(tokenHash)}`);
    if (!result?.result) return { authenticated: false };
    let row;
    try {
      row =
        typeof result.result === "string"
          ? JSON.parse(result.result)
          : result.result;
    } catch {
      return { authenticated: false };
    }
    if (!row || typeof row.expiresAt !== "number" || row.expiresAt <= Date.now()) {
      return { authenticated: false };
    }
    return {
      authenticated: true,
      expiresAt: row.expiresAt,
      binding: tokenHash,
    };
  }

  async function destroy(rawToken) {
    const tokenHash = hashSessionToken(rawToken);
    if (!tokenHash) return false;
    const result = await redis(`/del/${keyFor(tokenHash)}`);
    return Number(result?.result ?? 0) > 0;
  }

  return {
    ready,
    create,
    get,
    destroy,
    ttlMs,
    backend: "upstash-redis",
    multiInstanceSafe: true,
  };
}

export function createAuthStoreFromEnv(options = {}) {
  const env = options.env ?? process.env;
  if (env.NODE_ENV === "test") return createAuthStore(options);

  const upstashUrl = env.UPSTASH_REDIS_REST_URL ?? "";
  const upstashToken = env.UPSTASH_REDIS_REST_TOKEN ?? "";
  if (!upstashUrl || !upstashToken) {
    if (env.NODE_ENV === "production" || env.VERCEL === "1") {
      throw new Error(
        "Production requires Upstash Redis for authentication sessions",
      );
    }
    if (upstashUrl || upstashToken) {
      throw new Error("Incomplete Upstash Redis credentials");
    }
    return createAuthStore(options);
  }

  return createUpstashAuthStore({
    ...options,
    url: upstashUrl,
    token: upstashToken,
  });
}
