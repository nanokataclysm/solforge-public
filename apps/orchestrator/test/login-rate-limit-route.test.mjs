import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.mjs";
import { createApprovalStore } from "../lib/approval-session.mjs";
import { createAuthStore } from "../lib/auth-session.mjs";

const DEMO_SECRET = "test-demo-secret-not-real";

async function listen(app) {
  const instance = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => instance.once("listening", resolve));
  const address = instance.address();
  return {
    instance,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function close(instance) {
  await new Promise((resolve, reject) => {
    instance.close((error) => (error ? reject(error) : resolve()));
  });
}

const mockQwen = {
  chat: {
    completions: {
      async create() {
        throw new Error("Qwen should not be called by login-rate-limit tests");
      },
    },
  },
};

describe("login rate limiter HTTP boundary", () => {
  it("fails closed with a generic 503 when the limiter is unavailable", async () => {
    const app = await createApp({
      demoSecret: DEMO_SECRET,
      qwen: mockQwen,
      secureCookies: false,
      authStore: createAuthStore(),
      approvalStore: createApprovalStore(),
      loginRateLimiter: {
        backend: "upstash-redis",
        scope: "distributed",
        multiInstanceSafe: true,
        async ready() {},
        async check() {
          throw new Error("simulated Redis outage");
        },
      },
    });
    const temporary = await listen(app);

    try {
      const response = await fetch(`${temporary.url}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-solforge-csrf": "1",
        },
        body: JSON.stringify({ accessCode: DEMO_SECRET }),
      });
      const body = await response.json();

      assert.equal(response.status, 503);
      assert.deepEqual(body, {
        ok: false,
        error: "Authentication service unavailable",
      });
      assert.equal(response.headers.has("set-cookie"), false);
    } finally {
      await close(temporary.instance);
    }
  });
});
