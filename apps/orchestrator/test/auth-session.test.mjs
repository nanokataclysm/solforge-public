import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  constantTimeSecretEqual,
  createAuthStore,
  createAuthStoreFromEnv,
  createNeonAuthStore,
  createUpstashAuthStore,
  hashSessionToken,
} from "../lib/auth-session.mjs";

describe("authentication sessions", () => {
  it("stores only a hash of the opaque bearer token", () => {
    const sessions = new Map();
    const store = createAuthStore({ sessions });
    const created = store.create();

    assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(sessions.has(created.token), false);
    assert.equal(sessions.has(hashSessionToken(created.token)), true);
    assert.equal(JSON.stringify([...sessions]), JSON.stringify([...sessions]).replaceAll(created.token, ""));
  });

  it("does not extend absolute expiry on reads and invalidates on destroy", () => {
    const store = createAuthStore({ ttlMs: 60_000 });
    const created = store.create();
    const first = store.get(created.token);
    const second = store.get(created.token);

    assert.equal(first.authenticated, true);
    assert.equal(second.expiresAt, created.expiresAt);
    assert.equal(store.destroy(created.token), true);
    assert.equal(store.get(created.token).authenticated, false);
  });

  it("rejects expired sessions", () => {
    const store = createAuthStore();
    const created = store.create();
    store.expire(created.token);
    assert.equal(store.get(created.token).authenticated, false);
  });

  it("compares access codes without exposing mismatch detail", () => {
    assert.equal(constantTimeSecretEqual("correct", "correct"), true);
    assert.equal(constantTimeSecretEqual("wrong", "correct"), false);
    assert.equal(constantTimeSecretEqual(undefined, "correct"), false);
  });

  it("checks Neon schema readiness with read-only SQL", async () => {
    const queries = [];
    const store = createNeonAuthStore({
      sql: {
        async query(text) {
          queries.push(text);
          return { rows: [] };
        },
      },
    });

    await store.ready();
    assert.equal(queries.length, 1);
    assert.match(queries[0], /SELECT token_hash, expires_at/i);
    assert.doesNotMatch(queries[0], /\b(CREATE|ALTER|DROP)\b/i);
  });

  it("best-effort prunes expired Neon sessions after creation", async () => {
    const queries = [];
    const store = createNeonAuthStore({
      ttlMs: 60_000,
      sql: {
        async query(text, params = []) {
          queries.push({ text, params });
          return { rows: [] };
        },
      },
    });

    const created = await store.create();

    assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(queries.length, 3);
    assert.match(queries[0].text, /SELECT token_hash, expires_at/i);
    assert.match(queries[1].text, /INSERT INTO solforge_auth_sessions/i);
    assert.equal(queries[1].params[0], hashSessionToken(created.token));
    assert.match(
      queries[2].text,
      /DELETE FROM solforge_auth_sessions WHERE expires_at < now\(\)/i,
    );
  });

  it("uses only the token hash as the Upstash lookup key", async () => {
    const calls = [];
    const store = createUpstashAuthStore({
      url: "https://example.invalid",
      token: "test-only",
      fetchImpl: async (url) => {
        calls.push(String(url));
        return { ok: true, json: async () => ({ result: "OK" }) };
      },
    });
    const created = await store.create();
    assert.equal(calls.some((call) => call.includes(created.token)), false);
    assert.equal(
      calls.some((call) => call.includes(hashSessionToken(created.token))),
      true,
    );
  });

  it("fails closed in production without durable credentials", () => {
    assert.throws(
      () => createAuthStoreFromEnv({ env: { NODE_ENV: "production" } }),
      /durable authentication session store/i,
    );
  });
});
