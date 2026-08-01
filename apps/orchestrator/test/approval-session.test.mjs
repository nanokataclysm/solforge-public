import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COOKIE_NAME,
  buildSessionCookie,
  clearSessionCookie,
  createApprovalStore,
  createApprovalStoreFromEnv,
  createUpstashApprovalStore,
  parseCookies,
  planDigest,
} from "../lib/approval-session.mjs";

const plan = {
  businessName: "Moonlit Kiln",
  pages: ["Home", "About"],
  palette: ["#111", "#eee", "#222"],
};
const binding = {
  authSessionHash: "a".repeat(64),
  operation: "build-preview",
  artifactContextId: "b".repeat(32),
  parentVersionDigest: null,
  operationContextDigest: null,
};

describe("planDigest", () => {
  it("is canonical and changes with plan content", () => {
    assert.equal(planDigest({ b: 1, a: 2 }), planDigest({ a: 2, b: 1 }));
    assert.notEqual(
      planDigest(plan),
      planDigest({ ...plan, businessName: "Other" }),
    );
  });
});

describe("approval cookies", () => {
  it("are HttpOnly, Strict, and round-trip encoded values", () => {
    const header = buildSessionCookie(COOKIE_NAME, "abc+/=", {
      maxAgeSec: 60,
      secure: false,
    });
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Strict/);
    assert.equal(
      parseCookies(`${COOKIE_NAME}=${encodeURIComponent("abc+/=")}`)[COOKIE_NAME],
      "abc+/=",
    );
  });

  it("uses consistent security attributes when clearing Secure cookies", () => {
    const issued = buildSessionCookie(COOKIE_NAME, "opaque", {
      maxAgeSec: 60,
      secure: true,
    });
    const cleared = clearSessionCookie(COOKIE_NAME, true);
    for (const attribute of ["Path=/", "HttpOnly", "SameSite=Strict", "Secure"]) {
      assert.match(issued, new RegExp(attribute));
      assert.match(cleared, new RegExp(attribute));
    }
    assert.match(cleared, /Max-Age=0/);
  });
});

describe("in-memory approval store", () => {
  it("requires an authenticated operation and artifact binding", () => {
    const store = createApprovalStore();
    assert.throws(() => store.create(plan), /binding/i);
    const result = store.consume({ plan, nonce: "x" });
    assert.equal(result.status, 401);
  });

  it("accepts the exact plan, nonce, and context once", () => {
    const store = createApprovalStore();
    const created = store.create(plan, binding);
    const first = store.consume({
      sessionId: created.sessionId,
      plan,
      nonce: created.nonce,
      ...binding,
    });
    assert.equal(first.ok, true);
    assert.equal(first.planDigest, created.planDigest);

    const replay = store.consume({
      sessionId: created.sessionId,
      plan,
      nonce: created.nonce,
      ...binding,
    });
    assert.equal(replay.ok, false);
    assert.match(replay.error, /missing or expired|already used/i);
  });

  it("binds an optional operation-context digest", () => {
    const operationContextDigest = "e".repeat(64);
    const contextualBinding = { ...binding, operationContextDigest };
    const store = createApprovalStore();
    const created = store.create(plan, contextualBinding);
    assert.equal(created.operationContextDigest, operationContextDigest);

    const accepted = store.consume({
      sessionId: created.sessionId,
      plan,
      nonce: created.nonce,
      ...contextualBinding,
    });
    assert.equal(accepted.ok, true);

    const mismatchStore = createApprovalStore();
    const mismatch = mismatchStore.create(plan, contextualBinding);
    const rejected = mismatchStore.consume({
      sessionId: mismatch.sessionId,
      plan,
      nonce: mismatch.nonce,
      ...contextualBinding,
      operationContextDigest: "f".repeat(64),
    });
    assert.equal(rejected.status, 409);
    assert.match(rejected.error, /context/i);
  });

  it("rejects changed plans, nonces, auth sessions, operations, artifacts, and parents", () => {
    const changes = [
      { plan: { ...plan, businessName: "Tampered" }, error: /digest/i },
      { nonce: "wrong", error: /nonce/i },
      { authSessionHash: "c".repeat(64), error: /context/i },
      { operation: "package", error: /context/i },
      { artifactContextId: "d".repeat(32), error: /context/i },
      { parentVersionDigest: "different-parent", error: /context/i },
      { operationContextDigest: "e".repeat(64), error: /context/i },
    ];

    for (const change of changes) {
      const store = createApprovalStore();
      const created = store.create(plan, binding);
      const result = store.consume({
        sessionId: created.sessionId,
        plan,
        nonce: created.nonce,
        ...binding,
        ...change,
      });
      assert.equal(result.ok, false);
      assert.match(result.error, change.error);
    }
  });

  it("rejects expired sessions", () => {
    const store = createApprovalStore();
    const created = store.create(plan, binding);
    store.expire(created.sessionId);
    const result = store.consume({
      sessionId: created.sessionId,
      plan,
      nonce: created.nonce,
      ...binding,
    });
    assert.equal(result.status, 401);
    assert.match(result.error, /expired|missing/i);
  });
});

describe("durable approval stores", () => {
  it("uses only atomic GETDEL for Upstash consumption", async () => {
    const calls = [];
    const store = createUpstashApprovalStore({
      url: "https://example.invalid",
      token: "test-only",
      fetchImpl: async (url) => {
        calls.push(String(url));
        return {
          ok: false,
          status: 500,
          text: async () => "GETDEL unsupported",
        };
      },
    });

    await assert.rejects(
      store.consume({
        sessionId: "session",
        plan,
        nonce: "nonce",
        ...binding,
      }),
      /Upstash Redis HTTP 500/,
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/getdel\//);
  });

  it("selects Upstash in production even when stale Neon variables exist", () => {
    const store = createApprovalStoreFromEnv({
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
        createApprovalStoreFromEnv({
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
      () => createApprovalStoreFromEnv({ env: { NODE_ENV: "production" } }),
      /requires Upstash Redis/i,
    );
  });
});
