import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  constantTimeSecretEqual,
  createAuthStore,
  createAuthStoreFromEnv,
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

  it("selects Upstash in production even when stale Neon variables exist", () => {
    const store = createAuthStoreFromEnv({
      env: {
        NODE_ENV: "production",
        SOLFORGE_DATABASE_URL: "postgresql://ignored.invalid/db",
        UPSTASH_REDIS_REST_URL: "https://example.invalid",
        UPSTASH_REDIS_REST_TOKEN: "test-only",
      },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ result: "PONG" }),
      }),
    });
    assert.equal(store.backend, "upstash-redis");
  });

  it("rejects Neon-only production configuration", () => {
    assert.throws(
      () =>
        createAuthStoreFromEnv({
          env: {
            NODE_ENV: "production",
            SOLFORGE_DATABASE_URL: "postgresql://ignored.invalid/db",
          },
        }),
      /requires Upstash Redis/i,
    );
  });

  it("fails closed in production without Upstash credentials", () => {
    assert.throws(
      () => createAuthStoreFromEnv({ env: { NODE_ENV: "production" } }),
      /requires Upstash Redis/i,
    );
  });
});
