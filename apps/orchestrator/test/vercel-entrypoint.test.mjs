import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const appRoot = fileURLToPath(new URL("../", import.meta.url));

function testEnvironment(overrides = {}) {
  return {
    NODE_ENV: "test",
    VERCEL: "1",
    DEMO_SHARED_SECRET: "test-demo-secret-not-real",
    DASHSCOPE_API_KEY: "test-dashscope-key-not-real",
    DASHSCOPE_BASE_URL: "https://example.invalid/v1",
    ...overrides,
  };
}

function importEntrypoint(env, source) {
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: appRoot,
    env,
    encoding: "utf8",
    timeout: 10_000,
    killSignal: "SIGKILL",
    maxBuffer: 1024 * 1024,
  });
}

test("Vercel entrypoint resolves to an Express application with test-only stores", () => {
  const result = importEntrypoint(
    testEnvironment(),
    `
      const { default: app } = await import("./api/index.mjs");
      if (
        typeof app !== "function" ||
        typeof app.use !== "function" ||
        typeof app.listen !== "function"
      ) {
        throw new TypeError(
          "Vercel entrypoint did not resolve to an Express application",
        );
      }
    `,
  );

  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
});

test("Vercel entrypoint surfaces startup failures during import", () => {
  const result = importEntrypoint(
    testEnvironment({ NODE_ENV: "production" }),
    'await import("./api/index.mjs");',
  );

  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Production requires Upstash Redis for approval sessions/,
  );
});
