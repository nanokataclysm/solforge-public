import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createApp, trustProxySetting } from "../server.mjs";
import { COOKIE_NAME, createApprovalStore } from "../lib/approval-session.mjs";
import { AUTH_COOKIE_NAME, createAuthStore } from "../lib/auth-session.mjs";
import { createRateLimiter } from "../lib/rate-limit.mjs";

const DEMO_SECRET = "test-demo-secret-not-real";
const STATE_HEADERS = {
  "content-type": "application/json",
  "x-solforge-csrf": "1",
};

let server;
let baseUrl;
let authCookie;

const qwenState = {
  createCalls: [],
  responseQueue: [],
  responseContent: JSON.stringify({
    businessSummary: "Mock studio",
    archetype: "Craft",
    pages: ["Home", "About"],
    palette: { primary: "#111111", secondary: "#eeeeee", accent: "#333333" },
    motif: "Mock motif",
    approvalCheckpoints: ["human"],
    validationSteps: ["preview"],
    risks: ["none"],
  }),
};

const mockQwen = {
  chat: {
    completions: {
      async create(payload) {
        qwenState.createCalls.push(payload);
        return {
          choices: [
            {
              message: {
                content:
                  qwenState.responseQueue.shift() ?? qwenState.responseContent,
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
      },
    },
  },
};

async function jsonRequest(method, path, { headers = {}, body, url = baseUrl } = {}) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  return {
    status: response.status,
    json,
    text,
    setCookie: response.headers.get("set-cookie") ?? "",
    headers: response.headers,
  };
}

function cookieFrom(setCookie, name) {
  const match = setCookie.match(new RegExp(`(?:^|,\\s*)${name}=([^;]*)`));
  return match ? `${name}=${match[1]}` : "";
}

function protectedHeaders(extra = {}) {
  return { ...STATE_HEADERS, cookie: authCookie, ...extra };
}

async function login({ cookie, secret = DEMO_SECRET, url = baseUrl, headers = {} } = {}) {
  const result = await jsonRequest("POST", "/api/auth/login", {
    url,
    headers: { ...STATE_HEADERS, ...(cookie ? { cookie } : {}), ...headers },
    body: { accessCode: secret },
  });
  return {
    ...result,
    cookie: cookieFrom(result.setCookie, AUTH_COOKIE_NAME),
  };
}

async function approve(plan, operation = "build-preview", extras = {}) {
  const result = await jsonRequest("POST", "/api/approve", {
    headers: protectedHeaders(),
    body: { plan, operation, ...extras },
  });
  assert.equal(result.status, 200, result.json?.error ?? "approve failed");
  return {
    ...result.json,
    cookie: cookieFrom(result.setCookie, COOKIE_NAME),
  };
}

async function listen(app) {
  const instance = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => instance.once("listening", resolve));
  const address = instance.address();
  return {
    instance,
    url: `http://127.0.0.1:${address.port}`,
  };
}

before(async () => {
  const app = await createApp({
    demoSecret: DEMO_SECRET,
    model: "qwen-plus",
    qwen: mockQwen,
    secureCookies: false,
    authStore: createAuthStore(),
    approvalStore: createApprovalStore(),
    loginRateLimiter: createRateLimiter({ max: 100, windowMs: 60_000 }),
  });
  ({ instance: server, url: baseUrl } = await listen(app));
  const authenticated = await login();
  assert.equal(authenticated.status, 200);
  authCookie = authenticated.cookie;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

describe("public status and browser boundary", () => {
  it("keeps health public and reports non-durable test stores explicitly", async () => {
    const { status, json } = await jsonRequest("GET", "/health");
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.authentication, "server-session");
    assert.equal(json.authStore, "memory");
    assert.equal(json.authRestartBehavior, "lost-on-restart");
    assert.equal(json.multiInstanceSafe, false);
  });

  it("requires the custom header for state changes", async () => {
    const { status, json } = await jsonRequest("POST", "/api/auth/login", {
      body: { accessCode: DEMO_SECRET },
    });
    assert.equal(status, 403);
    assert.match(json.error, /state-change header/i);
  });

  it("does not enable permissive CORS", async () => {
    const response = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { origin: "https://attacker.invalid" },
    });
    assert.equal(response.headers.has("access-control-allow-origin"), false);
  });
});

describe("front-door authentication", () => {
  it("uses the same generic failure for missing and incorrect codes", async () => {
    const missing = await jsonRequest("POST", "/api/auth/login", {
      headers: STATE_HEADERS,
      body: {},
    });
    const wrong = await login({ secret: "wrong" });
    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(missing.json.error, "Authentication failed");
    assert.equal(wrong.json.error, "Authentication failed");
  });

  it("reports safe status without extending expiry", async () => {
    const first = await jsonRequest("GET", "/api/auth/session", {
      headers: { cookie: authCookie },
    });
    const second = await jsonRequest("GET", "/api/auth/session", {
      headers: { cookie: authCookie },
    });
    assert.equal(first.json.authenticated, true);
    assert.equal(second.json.expiresAt, first.json.expiresAt);
    assert.deepEqual(Object.keys(first.json).sort(), [
      "authenticated",
      "expiresAt",
      "ok",
    ]);
  });

  it("rotates a valid session on successful login", async () => {
    const oldCookie = authCookie;
    const replacement = await login({ cookie: oldCookie });
    assert.equal(replacement.status, 200);
    assert.notEqual(replacement.cookie, oldCookie);

    const oldStatus = await jsonRequest("GET", "/api/auth/session", {
      headers: { cookie: oldCookie },
    });
    assert.equal(oldStatus.json.authenticated, false);
    authCookie = replacement.cookie;
  });

  it("bounds repeated login attempts", async () => {
    const app = await createApp({
      demoSecret: DEMO_SECRET,
      qwen: mockQwen,
      authStore: createAuthStore(),
      approvalStore: createApprovalStore(),
      loginRateLimiter: createRateLimiter({ max: 1, windowMs: 60_000 }),
    });
    const temporary = await listen(app);
    try {
      const first = await login({ secret: "wrong", url: temporary.url });
      const second = await login({ secret: "wrong", url: temporary.url });
      assert.equal(first.status, 401);
      assert.equal(second.status, 429);
      assert.equal(second.json.error, "Authentication failed");
      assert.equal(second.headers.has("retry-after"), true);
    } finally {
      await new Promise((resolve) => temporary.instance.close(resolve));
    }
  });

  it("uses the direct socket IP for every limiter when no proxy is trusted", async () => {
    const loginKeys = [];
    const requestKeys = [];
    const limiter = (keys) => ({
      multiInstanceSafe: false,
      check(key) {
        keys.push(key);
        return { ok: true, retryAfterSec: 0 };
      },
    });
    const app = await createApp({
      demoSecret: DEMO_SECRET,
      qwen: mockQwen,
      authStore: createAuthStore(),
      approvalStore: createApprovalStore(),
      loginRateLimiter: limiter(loginKeys),
      rateLimiter: limiter(requestKeys),
    });
    const temporary = await listen(app);
    try {
      const forwarded = "203.0.113.99";
      const authenticated = await login({
        url: temporary.url,
        headers: { "x-forwarded-for": forwarded },
      });
      assert.equal(authenticated.status, 200);

      const plan = await jsonRequest("POST", "/api/plan", {
        url: temporary.url,
        headers: {
          ...STATE_HEADERS,
          cookie: authenticated.cookie,
          "x-forwarded-for": forwarded,
        },
        body: { brief: " " },
      });
      const mission = await jsonRequest("POST", "/api/mission/analyze", {
        url: temporary.url,
        headers: {
          ...STATE_HEADERS,
          cookie: authenticated.cookie,
          "x-forwarded-for": forwarded,
        },
        body: { brief: " " },
      });
      assert.equal(plan.status, 400);
      assert.equal(mission.status, 400);
      assert.deepEqual(loginKeys, ["login:127.0.0.1"]);
      assert.deepEqual(requestKeys, ["plan:127.0.0.1", "mission:127.0.0.1"]);
    } finally {
      await new Promise((resolve) => temporary.instance.close(resolve));
    }
  });

  it("uses Vercel's configured single proxy hop", async () => {
    assert.equal(trustProxySetting({}), false);
    assert.equal(trustProxySetting({ VERCEL: "1" }), 1);
    assert.equal(trustProxySetting({ SOLFORGE_TRUST_PROXY_HOPS: "2" }), 2);
    assert.throws(
      () => trustProxySetting({ SOLFORGE_TRUST_PROXY_HOPS: "one" }),
      /SOLFORGE_TRUST_PROXY_HOPS/,
    );

    const loginKeys = [];
    const previousVercel = process.env.VERCEL;
    process.env.VERCEL = "1";
    let app;
    try {
      app = await createApp({
        demoSecret: DEMO_SECRET,
        qwen: mockQwen,
        authStore: createAuthStore(),
        approvalStore: createApprovalStore(),
        loginRateLimiter: {
          multiInstanceSafe: false,
          check(key) {
            loginKeys.push(key);
            return { ok: true, retryAfterSec: 0 };
          },
        },
      });
    } finally {
      if (previousVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previousVercel;
    }
    const temporary = await listen(app);
    try {
      const authenticated = await login({
        url: temporary.url,
        headers: { "x-forwarded-for": "198.51.100.24" },
      });
      assert.equal(authenticated.status, 200);
      assert.deepEqual(loginKeys, ["login:198.51.100.24"]);
    } finally {
      await new Promise((resolve) => temporary.instance.close(resolve));
    }
  });

  it("invalidates server state before logout clears cookies", async () => {
    const created = await login();
    const loggedOut = await jsonRequest("POST", "/api/auth/logout", {
      headers: { ...STATE_HEADERS, cookie: created.cookie },
      body: {},
    });
    assert.equal(loggedOut.status, 200);
    assert.match(loggedOut.setCookie, new RegExp(`${AUTH_COOKIE_NAME}=;`));
    assert.match(loggedOut.setCookie, /SameSite=Strict/);

    const status = await jsonRequest("GET", "/api/auth/session", {
      headers: { cookie: created.cookie },
    });
    assert.equal(status.json.authenticated, false);
  });
});

describe("protected plan and mission routes", () => {
  it("rejects missing auth and explicitly rejects the legacy header", async () => {
    const missing = await jsonRequest("POST", "/api/plan", {
      headers: STATE_HEADERS,
      body: { brief: "A small bakery site" },
    });
    assert.equal(missing.status, 401);

    const legacy = await jsonRequest("POST", "/api/plan", {
      headers: protectedHeaders({
        "x-nanokat-demo-token": DEMO_SECRET,
      }),
      body: { brief: "A small bakery site" },
    });
    assert.equal(legacy.status, 401);
    assert.equal(legacy.json.error, "Authentication required");
  });

  it("validates brief boundaries and plans through the mock only", async () => {
    const empty = await jsonRequest("POST", "/api/plan", {
      headers: protectedHeaders(),
      body: { brief: " " },
    });
    const oversized = await jsonRequest("POST", "/api/plan", {
      headers: protectedHeaders(),
      body: { brief: "x".repeat(8_001) },
    });
    assert.equal(empty.status, 400);
    assert.equal(oversized.status, 400);

    qwenState.createCalls.length = 0;
    const planned = await jsonRequest("POST", "/api/plan", {
      headers: protectedHeaders(),
      body: { brief: "Pottery studio in Portland" },
    });
    assert.equal(planned.status, 200);
    assert.equal(planned.json.plan.businessSummary, "Mock studio");
    assert.equal(qwenState.createCalls.length, 1);
  });

  it("requires auth for mission analysis and preserves failed specialists", async () => {
    const unauthenticated = await jsonRequest("POST", "/api/mission/analyze", {
      headers: STATE_HEADERS,
      body: { brief: "Analyze this mission" },
    });
    assert.equal(unauthenticated.status, 401);

    qwenState.createCalls.length = 0;
    qwenState.responseQueue = [
      JSON.stringify({
        mission: "Reduce florist inventory waste",
        constraints: ["limited history"],
        unknowns: ["daily spoilage"],
        risks: ["guessing demand"],
        websiteRequired: false,
        specialistRoleIds: [
          "researcher",
          "systems-analyst",
          "skeptical-analyst",
          "opportunity-strategist",
        ],
      }),
      JSON.stringify({ position: "Collect supplied evidence first" }),
      "not-json",
      JSON.stringify({ position: "Avoid false precision" }),
      JSON.stringify({ position: "Test preorders cheaply" }),
      JSON.stringify({
        actualMission: "Reduce waste",
        recommendedStrategy: ["log spoilage"],
        disagreements: ["Whether a website is useful yet"],
        uncertainties: ["Demand by category"],
        proposedActions: [],
        nonActions: ["No deployment"],
      }),
    ];
    const result = await jsonRequest("POST", "/api/mission/analyze", {
      headers: protectedHeaders(),
      body: { brief: "My florist shop loses flowers to spoilage" },
    });
    assert.equal(result.status, 200);
    assert.equal(result.json.analyses.filter((item) => !item.ok).length, 1);
    assert.deepEqual(result.json.disagreements, [
      "Whether a website is useful yet",
    ]);
    assert.equal(qwenState.createCalls.length, 6);
    qwenState.responseQueue = [];
  });
});

describe("session-bound approval", () => {
  const validPlan = {
    businessName: "Moonlit Kiln",
    businessSummary: "Handmade ceramics",
    archetype: "Craft / artisan",
    motif: "Studio kiln",
    pages: ["Home", "Work", "About", "Contact"],
    palette: ["#9b4a35", "#f2eadf", "#202020"],
  };

  async function consumePreview(session, body = {}, cookie = authCookie) {
    return jsonRequest("POST", "/api/build-preview", {
      headers: {
        ...STATE_HEADERS,
        cookie: `${cookie}; ${session.cookie}`,
      },
      body: {
        plan: validPlan,
        nonce: session.nonce,
        artifactContextId: session.artifactContextId,
        ...body,
      },
    });
  }

  it("requires front-door auth and rejects client-only approved:true", async () => {
    const noAuth = await jsonRequest("POST", "/api/approve", {
      headers: STATE_HEADERS,
      body: { plan: validPlan, operation: "build-preview" },
    });
    assert.equal(noAuth.status, 401);

    const clientOnly = await jsonRequest("POST", "/api/build-preview", {
      headers: protectedHeaders(),
      body: { approved: true, plan: validPlan },
    });
    assert.equal(clientOnly.status, 401);
  });

  it("accepts exact preview context once and rejects replay", async () => {
    const session = await approve(validPlan);
    const first = await consumePreview(session);
    assert.equal(first.status, 200);
    assert.equal(first.json.validation.sessionBound, true);
    assert.equal(first.json.planDigest, session.planDigest);

    const replay = await consumePreview(session);
    assert.equal(replay.status, 401);
  });

  it("rejects changed plan, nonce, artifact context, auth session, and operation", async () => {
    const changedPlan = await approve(validPlan);
    assert.equal(
      (
        await consumePreview(changedPlan, {
          plan: { ...validPlan, businessName: "Changed" },
        })
      ).status,
      409,
    );

    const wrongNonce = await approve(validPlan);
    assert.equal(
      (await consumePreview(wrongNonce, { nonce: "wrong" })).status,
      401,
    );

    const wrongArtifact = await approve(validPlan);
    assert.equal(
      (
        await consumePreview(wrongArtifact, {
          artifactContextId: "z".repeat(32),
        })
      ).status,
      409,
    );

    const otherLogin = await login();
    const wrongAuth = await approve(validPlan);
    assert.equal(
      (await consumePreview(wrongAuth, {}, otherLogin.cookie)).status,
      409,
    );

    const previewApproval = await approve(validPlan);
    const packageAttempt = await jsonRequest("POST", "/api/package", {
      headers: {
        ...STATE_HEADERS,
        cookie: `${authCookie}; ${previewApproval.cookie}`,
      },
      body: {
        plan: validPlan,
        nonce: previewApproval.nonce,
        artifactContextId: previewApproval.artifactContextId,
      },
    });
    assert.equal(packageAttempt.status, 409);
  });
});

describe("mission output XSS regression", () => {
  it("uses DOM text sinks instead of model-controlled innerHTML", async () => {
    const source = await fs.readFile(
      new URL("../public/mission.html", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /\.innerHTML\s*=/);
    assert.match(source, /\.textContent\s*=/);
    assert.match(source, /replaceChildren/);
  });
});
