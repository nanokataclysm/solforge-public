/**
 * Session-bound approval gate for NANOKAT Forge preview generation.
 *
 * Opaque server session + HttpOnly cookie binding:
 * - canonical plan digest (SHA-256 of stable JSON)
 * - short TTL
 * - one-time nonce (replay rejection)
 *
 * Does not touch Ed25519 issuer keys; signing remains a separate path.
 */

import crypto from "node:crypto";

export const COOKIE_NAME = "nf_approval_session";
export const DEFAULT_TTL_MS = 10 * 60 * 1000;

function constantTimeStringEqual(left, right) {
  const leftDigest = crypto
    .createHash("sha256")
    .update(typeof left === "string" ? left : "")
    .digest();
  const rightDigest = crypto
    .createHash("sha256")
    .update(typeof right === "string" ? right : "")
    .digest();
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    crypto.timingSafeEqual(leftDigest, rightDigest)
  );
}

function validBinding(input) {
  return (
    typeof input?.authSessionHash === "string" &&
    input.authSessionHash.length > 0 &&
    typeof input?.operation === "string" &&
    input.operation.length > 0 &&
    typeof input?.artifactContextId === "string" &&
    input.artifactContextId.length > 0 &&
    (input.parentVersionDigest === null ||
      input.parentVersionDigest === undefined ||
      typeof input.parentVersionDigest === "string")
  );
}

/**
 * Stable JSON for hashing: sort object keys recursively.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return JSON.stringify(sortKeysDeep(value));
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}

/**
 * @param {unknown} plan
 * @returns {string} hex sha256
 */
export function planDigest(plan) {
  return crypto.createHash("sha256").update(canonicalJson(plan)).digest("hex");
}

/**
 * @param {string | undefined} header
 * @returns {Record<string, string>}
 */
export function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== "string") return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

/**
 * @param {string} name
 * @param {string} value
 * @param {{ maxAgeSec: number, secure?: boolean }} opts
 */
export function buildSessionCookie(name, value, opts) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(1, Math.floor(opts.maxAgeSec))}`,
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * @param {string} name
 */
export function clearSessionCookie(name, secure = false) {
  const parts = [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * In-memory approval session store (demo-scale).
 */
export function createApprovalStore(options = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  /** @type {Map<string, { planDigest: string, nonce: string, expiresAt: number, used: boolean, authSessionHash: string, operation: string, artifactContextId: string, parentVersionDigest: string | null }>} */
  const sessions = options.sessions ?? new Map();

  function prune(now = Date.now()) {
    for (const [id, row] of sessions) {
      if (row.expiresAt <= now || row.used) {
        // keep used briefly? drop used and expired
        if (row.expiresAt <= now || row.used) sessions.delete(id);
      }
    }
  }

  /**
   * Create a session bound to a plan digest.
   * @param {unknown} plan
   */
  function create(plan, binding) {
    if (!validBinding(binding)) {
      throw new Error("Approval binding is required");
    }
    prune();
    const digest = planDigest(plan);
    const sessionId = crypto.randomBytes(24).toString("base64url");
    const nonce = crypto.randomBytes(24).toString("base64url");
    const expiresAt = Date.now() + ttlMs;
    sessions.set(sessionId, {
      planDigest: digest,
      nonce,
      expiresAt,
      used: false,
      authSessionHash: binding.authSessionHash,
      operation: binding.operation,
      artifactContextId: binding.artifactContextId,
      parentVersionDigest: binding.parentVersionDigest ?? null,
    });
    return {
      sessionId,
      nonce,
      planDigest: digest,
      expiresAt,
      ttlMs,
    };
  }

  /**
   * Consume approval for preview: validates cookie session, digest, nonce; marks used.
   * @param {{ sessionId?: string, plan: unknown, nonce?: string, authSessionHash?: string, operation?: string, artifactContextId?: string, parentVersionDigest?: string | null }} input
   */
  function consume(input) {
    prune();
    const { sessionId, plan, nonce } = input;
    if (!sessionId || typeof sessionId !== "string") {
      return { ok: false, status: 401, error: "Approval session required" };
    }
    if (!nonce || typeof nonce !== "string") {
      return { ok: false, status: 401, error: "Approval nonce required" };
    }
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
      return { ok: false, status: 400, error: "A valid approved plan is required" };
    }
    if (!validBinding(input)) {
      return { ok: false, status: 400, error: "Approval context is required" };
    }

    const row = sessions.get(sessionId);
    if (!row) {
      return { ok: false, status: 401, error: "Approval session missing or expired" };
    }
    if (row.expiresAt <= Date.now()) {
      sessions.delete(sessionId);
      return { ok: false, status: 401, error: "Approval session expired" };
    }
    if (row.used) {
      return { ok: false, status: 409, error: "Approval nonce already used" };
    }

    const digest = planDigest(plan);
    if (!constantTimeStringEqual(digest, row.planDigest)) {
      return {
        ok: false,
        status: 409,
        error: "Plan does not match approved session digest",
      };
    }
    if (!constantTimeStringEqual(nonce, row.nonce)) {
      return { ok: false, status: 401, error: "Invalid approval nonce" };
    }
    if (
      !constantTimeStringEqual(input.authSessionHash, row.authSessionHash) ||
      input.operation !== row.operation ||
      !constantTimeStringEqual(input.artifactContextId, row.artifactContextId) ||
      (input.parentVersionDigest ?? null) !== row.parentVersionDigest
    ) {
      return { ok: false, status: 409, error: "Approval context does not match" };
    }

    row.used = true;
    sessions.delete(sessionId);

    return { ok: true, planDigest: digest };
  }

  /** Test/helper: inspect store size */
  function size() {
    prune();
    return sessions.size;
  }

  /** Test helper: force-expire a session */
  function expire(sessionId) {
    const row = sessions.get(sessionId);
    if (row) row.expiresAt = Date.now() - 1;
  }

  return {
    ready: async () => {},
    create,
    consume,
    size,
    expire,
    ttlMs,
    COOKIE_NAME,
    backend: "memory",
    multiInstanceSafe: false,
  };
}

/**
 * Durable approval store via Upstash Redis REST (works on Vercel multi-instance).
 * Env: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 * Uses GETDEL for atomic one-time consume. Unsupported GETDEL fails closed.
 *
 * @param {{
 *   url?: string,
 *   token?: string,
 *   ttlMs?: number,
 *   keyPrefix?: string,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 */
export function createUpstashApprovalStore(options = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
  const url = (options.url ?? process.env.UPSTASH_REDIS_REST_URL ?? "").replace(
    /\/$/,
    "",
  );
  const token = options.token ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
  const keyPrefix = options.keyPrefix ?? "solforge:approval:";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!url || !token) {
    throw new Error(
      "createUpstashApprovalStore requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN",
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createUpstashApprovalStore requires fetch");
  }

  /**
   * @param {string} pathWithQuery
   * @param {RequestInit} [init]
   */
  async function redis(pathWithQuery, init = {}) {
    const res = await fetchImpl(`${url}${pathWithQuery}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Upstash Redis HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  /**
   * @param {string} sessionId
   */
  function keyFor(sessionId) {
    return `${keyPrefix}${sessionId}`;
  }

  /**
   * @param {unknown} plan
   */
  async function ready() {
    await redis("/ping");
  }

  async function create(plan, binding) {
    if (!validBinding(binding)) {
      throw new Error("Approval binding is required");
    }
    const digest = planDigest(plan);
    const sessionId = crypto.randomBytes(24).toString("base64url");
    const nonce = crypto.randomBytes(24).toString("base64url");
    const expiresAt = Date.now() + ttlMs;
    const payload = JSON.stringify({
      planDigest: digest,
      nonce,
      expiresAt,
      used: false,
      authSessionHash: binding.authSessionHash,
      operation: binding.operation,
      artifactContextId: binding.artifactContextId,
      parentVersionDigest: binding.parentVersionDigest ?? null,
    });
    // SET key value EX seconds
    const encKey = encodeURIComponent(keyFor(sessionId));
    const encVal = encodeURIComponent(payload);
    await redis(`/set/${encKey}/${encVal}?EX=${ttlSec}`);
    return {
      sessionId,
      nonce,
      planDigest: digest,
      expiresAt,
      ttlMs,
    };
  }

  /**
   * @param {{ sessionId?: string, plan: unknown, nonce?: string, authSessionHash?: string, operation?: string, artifactContextId?: string, parentVersionDigest?: string | null }} input
   */
  async function consume(input) {
    const { sessionId, plan, nonce } = input;
    if (!sessionId || typeof sessionId !== "string") {
      return { ok: false, status: 401, error: "Approval session required" };
    }
    if (!nonce || typeof nonce !== "string") {
      return { ok: false, status: 401, error: "Approval nonce required" };
    }
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
      return { ok: false, status: 400, error: "A valid approved plan is required" };
    }
    if (!validBinding(input)) {
      return { ok: false, status: 400, error: "Approval context is required" };
    }

    const encKey = encodeURIComponent(keyFor(sessionId));
    const got = await redis(`/getdel/${encKey}`);
    const raw = got?.result ?? null;

    if (raw == null || raw === "") {
      return { ok: false, status: 401, error: "Approval session missing or expired" };
    }

    /** @type {{ planDigest: string, nonce: string, expiresAt: number, used?: boolean, authSessionHash: string, operation: string, artifactContextId: string, parentVersionDigest?: string | null }} */
    let row;
    try {
      row = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return { ok: false, status: 401, error: "Approval session corrupt" };
    }

    if (!row || typeof row.expiresAt !== "number") {
      return { ok: false, status: 401, error: "Approval session missing or expired" };
    }
    if (row.expiresAt <= Date.now()) {
      return { ok: false, status: 401, error: "Approval session expired" };
    }
    if (row.used) {
      return { ok: false, status: 409, error: "Approval nonce already used" };
    }

    const digest = planDigest(plan);
    if (!constantTimeStringEqual(digest, row.planDigest)) {
      return {
        ok: false,
        status: 409,
        error: "Plan does not match approved session digest",
      };
    }
    if (!constantTimeStringEqual(nonce, row.nonce)) {
      return { ok: false, status: 401, error: "Invalid approval nonce" };
    }
    if (
      !constantTimeStringEqual(input.authSessionHash, row.authSessionHash) ||
      input.operation !== row.operation ||
      !constantTimeStringEqual(input.artifactContextId, row.artifactContextId) ||
      (input.parentVersionDigest ?? null) !== (row.parentVersionDigest ?? null)
    ) {
      return { ok: false, status: 409, error: "Approval context does not match" };
    }

    return { ok: true, planDigest: digest };
  }

  async function size() {
    // not efficiently available over REST without SCAN; report -1
    return -1;
  }

  return {
    ready,
    create,
    consume,
    size,
    ttlMs,
    COOKIE_NAME,
    backend: "upstash-redis",
    multiInstanceSafe: true,
  };
}

/**
 * Durable approval store on Neon Postgres (preferred for Vercel multi-instance).
 * Env (first match): SOLFORGE_DATABASE_URL · DATABASE_URL · NEON_DATABASE_URL
 *
 * Schema is owner-provisioned; ordinary application startup performs no DDL.
 * Atomic consume: DELETE … RETURNING with all bindings matched.
 *
 * @param {{
 *   connectionString?: string,
 *   ttlMs?: number,
 *   sql?: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> },
 * }} [options]
 */
export function createNeonApprovalStore(options = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const connectionString =
    options.connectionString ??
    process.env.SOLFORGE_DATABASE_URL ??
    process.env.DATABASE_URL ??
    process.env.NEON_DATABASE_URL ??
    "";

  /** @type {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> } | null} */
  let sql = options.sql ?? null;
  /** @type {Promise<void> | null} */
  let readyPromise = null;

  async function getSql() {
    if (sql) return sql;
    if (!connectionString) {
      throw new Error(
        "createNeonApprovalStore requires SOLFORGE_DATABASE_URL or DATABASE_URL",
      );
    }
    const { neon } = await import("@neondatabase/serverless");
    // fullResults → { rows, fields, ... } like node-pg
    const client = neon(connectionString, { fullResults: true });
    sql = {
      async query(text, params = []) {
        const result = await client.query(text, params);
        if (result && Array.isArray(result.rows)) return result;
        if (Array.isArray(result)) return { rows: result };
        return { rows: [] };
      },
    };
    return sql;
  }

  async function ready() {
    if (!readyPromise) {
      readyPromise = (async () => {
      const client = await getSql();
        await client.query(
          `SELECT session_id, plan_digest, nonce, expires_at, used,
                  auth_session_hash, operation, artifact_context_id,
                  parent_version_digest
           FROM solforge_approval_sessions
           LIMIT 0`,
        );
      })();
    }
    return readyPromise;
  }

  /**
   * @param {unknown} plan
   */
  async function create(plan, binding) {
    if (!validBinding(binding)) {
      throw new Error("Approval binding is required");
    }
    await ready();
    const client = await getSql();
    const digest = planDigest(plan);
    const sessionId = crypto.randomBytes(24).toString("base64url");
    const nonce = crypto.randomBytes(24).toString("base64url");
    const expiresAt = Date.now() + ttlMs;
    await client.query(
      `INSERT INTO solforge_approval_sessions
         (session_id, plan_digest, nonce, expires_at, used,
          auth_session_hash, operation, artifact_context_id,
          parent_version_digest)
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), false,
               $5, $6, $7, $8)`,
      [
        sessionId,
        digest,
        nonce,
        expiresAt,
        binding.authSessionHash,
        binding.operation,
        binding.artifactContextId,
        binding.parentVersionDigest ?? null,
      ],
    );
    // best-effort prune of expired rows
    void client
      .query(
        `DELETE FROM solforge_approval_sessions WHERE expires_at < now() OR used = true`,
      )
      .catch(() => {});
    return {
      sessionId,
      nonce,
      planDigest: digest,
      expiresAt,
      ttlMs,
    };
  }

  /**
   * @param {{ sessionId?: string, plan: unknown, nonce?: string, authSessionHash?: string, operation?: string, artifactContextId?: string, parentVersionDigest?: string | null }} input
   */
  async function consume(input) {
    await ready();
    const client = await getSql();
    const { sessionId, plan, nonce } = input;
    if (!sessionId || typeof sessionId !== "string") {
      return { ok: false, status: 401, error: "Approval session required" };
    }
    if (!nonce || typeof nonce !== "string") {
      return { ok: false, status: 401, error: "Approval nonce required" };
    }
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
      return { ok: false, status: 400, error: "A valid approved plan is required" };
    }
    if (!validBinding(input)) {
      return { ok: false, status: 400, error: "Approval context is required" };
    }

    const digest = planDigest(plan);

    // Atomic one-time consume: delete only if digest+nonce match and not expired.
    const result = await client.query(
      `DELETE FROM solforge_approval_sessions
       WHERE session_id = $1
         AND plan_digest = $2
         AND nonce = $3
         AND auth_session_hash = $4
         AND operation = $5
         AND artifact_context_id = $6
         AND parent_version_digest IS NOT DISTINCT FROM $7
         AND used = false
         AND expires_at > now()
       RETURNING session_id, plan_digest`,
      [
        sessionId,
        digest,
        nonce,
        input.authSessionHash,
        input.operation,
        input.artifactContextId,
        input.parentVersionDigest ?? null,
      ],
    );
    const rows = result?.rows ?? [];
    if (rows.length === 1) {
      return { ok: true, planDigest: digest };
    }

    // Diagnose for better errors (non-atomic read of remainder)
    const existing = await client.query(
      `SELECT plan_digest, nonce, expires_at, used, auth_session_hash,
              operation, artifact_context_id, parent_version_digest
       FROM solforge_approval_sessions WHERE session_id = $1`,
      [sessionId],
    );
    const row = existing?.rows?.[0];
    if (!row) {
      return { ok: false, status: 401, error: "Approval session missing or expired" };
    }
    if (row.used) {
      return { ok: false, status: 409, error: "Approval nonce already used" };
    }
    const exp = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    if (exp && exp <= Date.now()) {
      return { ok: false, status: 401, error: "Approval session expired" };
    }
    if (!constantTimeStringEqual(row.plan_digest, digest)) {
      return {
        ok: false,
        status: 409,
        error: "Plan does not match approved session digest",
      };
    }
    if (!constantTimeStringEqual(row.nonce, nonce)) {
      return { ok: false, status: 401, error: "Invalid approval nonce" };
    }
    if (
      !constantTimeStringEqual(row.auth_session_hash, input.authSessionHash) ||
      row.operation !== input.operation ||
      !constantTimeStringEqual(row.artifact_context_id, input.artifactContextId) ||
      (row.parent_version_digest ?? null) !==
        (input.parentVersionDigest ?? null)
    ) {
      return { ok: false, status: 409, error: "Approval context does not match" };
    }
    return { ok: false, status: 401, error: "Approval session missing or expired" };
  }

  async function size() {
    await ready();
    const client = await getSql();
    const result = await client.query(
      `SELECT count(*)::int AS n FROM solforge_approval_sessions WHERE expires_at > now() AND used = false`,
    );
    return result?.rows?.[0]?.n ?? 0;
  }

  return {
    ready,
    create,
    consume,
    size,
    ttlMs,
    COOKIE_NAME,
    backend: "neon",
    multiInstanceSafe: true,
  };
}

/**
 * Select durable store from env: Neon (preferred) → Upstash → memory in dev/test.
 * @param {{ ttlMs?: number, env?: NodeJS.ProcessEnv }} [options]
 */
export function createApprovalStoreFromEnv(options = {}) {
  const env = options.env ?? process.env;
  if (env.NODE_ENV === "test") {
    return createApprovalStore(options);
  }
  const neonUrl =
    env.SOLFORGE_DATABASE_URL ||
    env.DATABASE_URL ||
    env.NEON_DATABASE_URL ||
    "";
  if (neonUrl) {
    return createNeonApprovalStore({ ...options, connectionString: neonUrl });
  }
  const url = env.UPSTASH_REDIS_REST_URL ?? "";
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? "";
  if (url || token) {
    if (!url || !token) {
      throw new Error("Incomplete Upstash Redis credentials");
    }
    return createUpstashApprovalStore({ ...options, url, token });
  }
  if (env.NODE_ENV === "production" || env.VERCEL === "1") {
    throw new Error("Production requires a durable approval session store");
  }
  return createApprovalStore(options);
}
