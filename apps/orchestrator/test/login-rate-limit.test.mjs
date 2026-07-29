import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createLoginRateLimiterFromEnv,
  createUpstashLoginRateLimiter,
} from "../lib/login-rate-limit.mjs";

describe("durable login rate limiting", () => {
  it("uses one atomic Upstash EVAL command and blocks after the configured max", async () => {
    const calls = [];
    const results = [
      { result: "PONG" },
      { result: [1, 60_000] },
      { result: [2, 59_000] },
    ];
    const limiter = createUpstashLoginRateLimiter({
      url: "https://example.invalid",
      token: "test-only",
      windowMs: 60_000,
      max: 1,
      keyPrefix: "test:",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return {
          ok: true,
          json: async () => results.shift(),
        };
      },
    });

    await limiter.ready();
    const first = await limiter.check("login:127.0.0.1");
    const second = await limiter.check("login:127.0.0.1");

    assert.deepEqual(first, { ok: true });
    assert.deepEqual(second, { ok: false, retryAfterSec: 59 });
    assert.equal(limiter.backend, "upstash-redis");
    assert.equal(limiter.scope, "distributed");
    assert.equal(limiter.multiInstanceSafe, true);

    const command = JSON.parse(calls[1].init.body);
    assert.equal(command[0], "EVAL");
    assert.equal(command[2], "1");
    assert.equal(command[3], "test:login:127.0.0.1");
    assert.equal(command[4], "60000");
    assert.match(command[1], /INCR/);
    assert.match(command[1], /PEXPIRE/);
  });

  it("does not expose the Upstash token in the request body or URL", async () => {
    const calls = [];
    const token = "super-secret-test-token";
    const limiter = createUpstashLoginRateLimiter({
      url: "https://example.invalid",
      token,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return {
          ok: true,
          json: async () => ({ result: [1, 300_000] }),
        };
      },
    });

    await limiter.check("login:203.0.113.9");
    assert.equal(calls[0].url.includes(token), false);
    assert.equal(String(calls[0].init.body).includes(token), false);
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${token}`);
  });

  it("fails closed in production without durable credentials", () => {
    assert.throws(
      () => createLoginRateLimiterFromEnv({ env: { NODE_ENV: "production" } }),
      /durable login rate limiter/i,
    );
    assert.throws(
      () =>
        createLoginRateLimiterFromEnv({
          env: {
            NODE_ENV: "production",
            UPSTASH_REDIS_REST_URL: "https://example.invalid",
          },
        }),
      /incomplete Upstash Redis credentials/i,
    );
  });

  it("preserves isolated test mode even when Vercel is simulated", async () => {
    const limiter = createLoginRateLimiterFromEnv({
      env: { NODE_ENV: "test", VERCEL: "1" },
      windowMs: 60_000,
      max: 1,
    });

    await limiter.ready();
    assert.deepEqual(await limiter.check("login:test"), { ok: true });
    assert.equal(limiter.backend, "memory");
    assert.equal(limiter.scope, "process");
    assert.equal(limiter.multiInstanceSafe, false);
  });

  it("keeps an explicit process-local fallback for development", async () => {
    const limiter = createLoginRateLimiterFromEnv({
      env: { NODE_ENV: "development" },
      windowMs: 60_000,
      max: 1,
    });

    await limiter.ready();
    assert.deepEqual(await limiter.check("login:local"), { ok: true });
    const blocked = await limiter.check("login:local");
    assert.equal(blocked.ok, false);
    assert.equal(limiter.backend, "memory");
    assert.equal(limiter.scope, "process");
    assert.equal(limiter.multiInstanceSafe, false);
  });

  it("rejects invalid window and max settings", () => {
    assert.throws(
      () =>
        createLoginRateLimiterFromEnv({
          env: { NODE_ENV: "development", LOGIN_RATE_MAX: "0" },
        }),
      /LOGIN_RATE_MAX must be a positive integer/,
    );
    assert.throws(
      () =>
        createLoginRateLimiterFromEnv({
          env: { NODE_ENV: "development", LOGIN_RATE_WINDOW_MS: "nope" },
        }),
      /LOGIN_RATE_WINDOW_MS must be a positive integer/,
    );
  });
});
