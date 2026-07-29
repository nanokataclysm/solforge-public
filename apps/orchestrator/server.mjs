import crypto from "node:crypto";
import express from "express";
import OpenAI from "openai";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPreviewFromPlan } from "./lib/preview.mjs";
import { parsePlanJson, validatePlan } from "./lib/plan.mjs";
import { createRateLimiter } from "./lib/rate-limit.mjs";
import { createLoginRateLimiterFromEnv } from "./lib/login-rate-limit.mjs";
import {
  COOKIE_NAME,
  buildSessionCookie,
  clearSessionCookie,
  createApprovalStore,
  createApprovalStoreFromEnv,
  parseCookies,
} from "./lib/approval-session.mjs";
import {
  createSignedPackage,
  loadPrivateKey,
  loadPublicKey,
} from "./lib/signing.mjs";
import { modelFor } from "./lib/models.mjs";
import { runSociety } from "./lib/society.mjs";
import { executeWithRetry, estimateTokens } from "./lib/model-router.mjs";
import {
  AUTH_COOKIE_NAME,
  constantTimeSecretEqual,
  createAuthStore,
  createAuthStoreFromEnv,
} from "./lib/auth-session.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const requiredEnvironment = [
  "DASHSCOPE_API_KEY",
  "DASHSCOPE_BASE_URL",
  "DEMO_SHARED_SECRET",
];

const PLAN_SYSTEM = [
  "You are the planning orchestrator for Solforge (NANOKAT Forge).",
  "Turn a small-business website request into a safe build plan.",
  "Return only one valid JSON object with no Markdown fences.",
  "Include these properties:",
  "businessName, businessSummary, archetype, pages, palette, motif,",
  "approvalCheckpoints, validationSteps, and risks.",
  "pages must be an array of 3 to 6 short page names.",
  "palette must be an array of exactly 3 hex color strings,",
  'for example ["#8B5C3E","#F9F5F0","#3A2E26"].',
  "Do not claim that files were created or anything was deployed.",
  "Do not include HTML or script tags in any string field.",
].join(" ");

const LEGACY_AUTH_HEADER = "x-nanokat-demo-token";
const STATE_CHANGE_HEADER = "x-solforge-csrf";
const APPROVAL_OPERATIONS = new Set(["build-preview", "package"]);
const TRUST_PROXY_HOPS_ENV = "SOLFORGE_TRUST_PROXY_HOPS";

/**
 * Trust Vercel's single overwritten forwarding hop. Other proxy topologies
 * must opt in with their exact hop count; direct/local requests trust none.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function trustProxySetting(env = process.env) {
  const configured = env[TRUST_PROXY_HOPS_ENV];
  if (configured !== undefined && configured !== "") {
    if (!/^(?:0|[1-9]\d*)$/.test(configured)) {
      throw new Error(`${TRUST_PROXY_HOPS_ENV} must be a non-negative integer`);
    }
    return Number(configured) || false;
  }
  return env.VERCEL === "1" ? 1 : false;
}

/** @param {import("express").Request} request */
export function clientIpForRateLimit(request) {
  return request.ip || "unknown";
}

/** @param {string} scope @param {import("express").Request} request */
export function rateLimitKey(scope, request) {
  return `${scope}:${clientIpForRateLimit(request)}`;
}

/**
 * @param {{
 *   demoSecret?: string,
 *   model?: string,
 *   qwen?: { chat: { completions: { create: Function } } },
 *   publicDir?: string,
 *   approvalStore?: ReturnType<typeof createApprovalStore>,
 *   authStore?: ReturnType<typeof createAuthStore>,
 *   secureCookies?: boolean,
 *   rateLimiter?: ReturnType<typeof createRateLimiter>,
 *   loginRateLimiter?: ReturnType<typeof createRateLimiter>,
 *   societyModels?: { navigator: string, specialist: string, chair: string },
 *   roleTimeoutMs?: number,
 * }} [options]
 */
export async function createApp(options = {}) {
  const demoSecret =
    options.demoSecret ?? process.env.DEMO_SHARED_SECRET;
  const model = options.model ?? process.env.QWEN_PLANNER_MODEL ?? process.env.QWEN_MODEL;
  const repairModel =
    options.repairModel ?? process.env.QWEN_REPAIR_MODEL;
  const societyModels = options.societyModels ?? {
    navigator: process.env.QWEN_NAVIGATOR_MODEL,
    specialist: process.env.QWEN_SPECIALIST_MODEL,
    chair: process.env.QWEN_CHAIR_MODEL ?? process.env.QWEN_MODEL,
  };
  const roleTimeoutMs =
    options.roleTimeoutMs ?? Number(process.env.QWEN_ROLE_TIMEOUT_MS ?? 20_000);
  const publicDir =
    options.publicDir ?? path.join(__dirname, "public");
  const approvalStore =
    options.approvalStore ?? createApprovalStoreFromEnv();
  const authStore = options.authStore ?? createAuthStoreFromEnv();
  const approvalBackend = approvalStore.backend ?? "memory";
  const approvalMultiInstanceSafe = Boolean(approvalStore.multiInstanceSafe);
  const authBackend = authStore.backend ?? "memory";
  const authMultiInstanceSafe = Boolean(authStore.multiInstanceSafe);
  const sessionStoresMultiInstanceSafe =
    approvalMultiInstanceSafe && authMultiInstanceSafe;
  const secureCookies =
    options.secureCookies ??
    (process.env.NODE_ENV === "production" ||
      process.env.FORCE_SECURE_COOKIES === "true" ||
      process.env.VERCEL === "1");
  const rateLimiter =
    options.rateLimiter ??
    createRateLimiter({
      windowMs: Number(process.env.PLAN_RATE_WINDOW_MS ?? 60_000),
      max: Number(process.env.PLAN_RATE_MAX ?? 20),
    });
  const loginRateLimiter =
    options.loginRateLimiter ?? createLoginRateLimiterFromEnv();
  const loginRateLimitBackend = loginRateLimiter.backend ?? "memory";
  const loginRateLimitScope = loginRateLimiter.scope ?? "process";
  const loginRateLimitMultiInstanceSafe = Boolean(
    loginRateLimiter.multiInstanceSafe,
  );
  const multiInstanceSafe =
    sessionStoresMultiInstanceSafe && loginRateLimitMultiInstanceSafe;

  const qwen =
    options.qwen ??
    new OpenAI({
      apiKey: process.env.DASHSCOPE_API_KEY,
      baseURL: process.env.DASHSCOPE_BASE_URL,
    });

  if (!demoSecret) {
    throw new Error("Missing required environment variable: DEMO_SHARED_SECRET");
  }
  await Promise.all([
    authStore.ready(),
    approvalStore.ready(),
    loginRateLimiter.ready?.(),
  ]);

  const app = express();

  app.set("trust proxy", trustProxySetting());
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use(
    express.static(publicDir, {
      index: "index.html",
      fallthrough: true,
    }),
  );

  app.use("/api", (request, response, next) => {
    if (request.get(LEGACY_AUTH_HEADER) !== undefined) {
      return response.status(401).json({
        ok: false,
        error: "Authentication required",
      });
    }
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
      request.get(STATE_CHANGE_HEADER) !== "1"
    ) {
      return response.status(403).json({
        ok: false,
        error: "State-change header required",
      });
    }
    next();
  });

  function authTokenFrom(request) {
    return parseCookies(request.get("cookie") ?? "")[AUTH_COOKIE_NAME];
  }

  async function readAuthSession(request, response) {
    try {
      return await authStore.get(authTokenFrom(request));
    } catch (error) {
      console.error("auth_session_store_unavailable", {
        message: error instanceof Error ? error.message : "unknown",
      });
      response.status(503).json({
        ok: false,
        error: "Authentication service unavailable",
      });
      return null;
    }
  }

  async function requireAuth(request, response) {
    const session = await readAuthSession(request, response);
    if (session === null) return false;
    if (!session.authenticated) {
      response.status(401).json({
        ok: false,
        error: "Authentication required",
      });
      return false;
    }
    request.authSession = session;
    return true;
  }

  function approvalBinding(request, operation, artifactContextId, parentVersionDigest) {
    return {
      authSessionHash: request.authSession.binding,
      operation,
      artifactContextId,
      parentVersionDigest: parentVersionDigest ?? null,
    };
  }

  function artifactContextIdFrom(value) {
    return typeof value === "string" &&
      /^[A-Za-z0-9_-]{32,128}$/.test(value)
      ? value
      : null;
  }

  function parentVersionDigestFrom(value) {
    if (value === undefined || value === null || value === "") return null;
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(value)
      ? value
      : undefined;
  }

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      service: "solforge-orchestrator",
      provider: "Alibaba Cloud Model Studio",
      model,
      models: {
        planner: model,
        repair: repairModel,
        navigator: societyModels.navigator,
        specialist: societyModels.specialist,
        chair: societyModels.chair,
      },
      approvalGate: "session-bound",
      approvalStore: approvalBackend,
      approvalMultiInstanceSafe,
      authStore: authBackend,
      authMultiInstanceSafe,
      authRestartBehavior: authMultiInstanceSafe
        ? "survives-restart"
        : "lost-on-restart",
      sessionStoresMultiInstanceSafe,
      multiInstanceSafe,
      platform: process.env.VERCEL === "1" ? "vercel" : "node",
      missionSociety: "navigator+4-specialists+chair",
      authentication: "server-session",
      loginRateLimitBackend,
      loginRateLimitScope,
      loginRateLimitMultiInstanceSafe,
      productionReadyClaim: multiInstanceSafe,
    });
  });

  app.post("/api/auth/login", async (request, response) => {
    let limited;
    try {
      limited = await loginRateLimiter.check(rateLimitKey("login", request));
    } catch (error) {
      console.error("login_rate_limiter_unavailable", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return response.status(503).json({
        ok: false,
        error: "Authentication service unavailable",
      });
    }
    if (!limited.ok) {
      response.setHeader("Retry-After", String(limited.retryAfterSec));
      return response.status(429).json({
        ok: false,
        error: "Authentication failed",
      });
    }

    const accessCode =
      typeof request.body?.accessCode === "string"
        ? request.body.accessCode
        : undefined;
    if (!constantTimeSecretEqual(accessCode, demoSecret)) {
      return response.status(401).json({
        ok: false,
        error: "Authentication failed",
      });
    }

    try {
      const existingToken = authTokenFrom(request);
      if (existingToken) {
        const existing = await authStore.get(existingToken);
        if (existing.authenticated) {
          const invalidated = await authStore.destroy(existingToken);
          if (!invalidated) {
            throw new Error("Existing authentication session was not invalidated");
          }
        }
      }

      const session = await authStore.create();
      response.setHeader(
        "Set-Cookie",
        buildSessionCookie(AUTH_COOKIE_NAME, session.token, {
          maxAgeSec: Math.ceil(session.ttlMs / 1000),
          secure: secureCookies,
        }),
      );
      return response.json({
        ok: true,
        authenticated: true,
        expiresAt: new Date(session.expiresAt).toISOString(),
      });
    } catch (error) {
      console.error("auth_login_store_unavailable", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return response.status(503).json({
        ok: false,
        error: "Authentication service unavailable",
      });
    }
  });

  app.get("/api/auth/session", async (request, response) => {
    const session = await readAuthSession(request, response);
    if (session === null) return;
    return response.json({
      ok: true,
      authenticated: session.authenticated,
      ...(session.authenticated
        ? { expiresAt: new Date(session.expiresAt).toISOString() }
        : {}),
    });
  });

  app.post("/api/auth/logout", async (request, response) => {
    const token = authTokenFrom(request);
    try {
      if (token) await authStore.destroy(token);
    } catch (error) {
      console.error("auth_logout_store_unavailable", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return response.status(503).json({
        ok: false,
        error: "Authentication service unavailable",
      });
    }

    response.append(
      "Set-Cookie",
      clearSessionCookie(AUTH_COOKIE_NAME, secureCookies),
    );
    response.append(
      "Set-Cookie",
      clearSessionCookie(COOKIE_NAME, secureCookies),
    );
    return response.json({ ok: true, authenticated: false });
  });

  async function completePlan(brief, modelId) {
    const result = await qwen.chat.completions.create({
      model: modelId,
      temperature: 0.2,
      max_tokens: 1500,
      messages: [
        { role: "system", content: PLAN_SYSTEM },
        { role: "user", content: brief },
      ],
    });
    const content = result.choices[0]?.message?.content;
    if (!content) throw new Error("Qwen returned no message content");
    return { content, usage: result.usage ?? null, modelId };
  }

  app.post("/api/plan", async (request, response) => {
    if (!(await requireAuth(request, response))) return;

    const limited = rateLimiter.check(rateLimitKey("plan", request));
    if (!limited.ok) {
      response.setHeader("Retry-After", String(limited.retryAfterSec));
      return response.status(429).json({
        ok: false,
        error: "Too many plan requests; try again shortly",
      });
    }

    const brief =
      typeof request.body?.brief === "string"
        ? request.body.brief.trim()
        : "";

    if (!brief || brief.length > 8_000) {
      return response.status(400).json({
        ok: false,
        error: "brief must contain between 1 and 8,000 characters",
      });
    }

    try {
      // Use retry logic for quota/throttling errors
      const inputTokens = estimateTokens(PLAN_SYSTEM + brief);
      const retryResult = await executeWithRetry({
        role: "planner",
        explicitModel: model, // Pass explicit override or undefined for automatic routing
        estimatedInputTokens: inputTokens,
        reservedOutputTokens: 1500,
        fn: async (modelId) => await completePlan(brief, modelId),
      });

      let { content, usage, modelId } = retryResult.result;
      let plan;
      try {
        plan = parsePlanJson(content);
      } catch {
        // one-shot repair on cheaper model with retry
        const repairInputTokens = estimateTokens(content.slice(0, 6000));
        const repairRetryResult = await executeWithRetry({
          role: "repair",
          explicitModel: repairModel === "mock-qwen" ? repairModel : undefined,
          estimatedInputTokens: repairInputTokens,
          reservedOutputTokens: 1200,
          skipAllowlistCheck: repairModel === "mock-qwen",
          fn: async (repairModelId) => {
            const repair = await qwen.chat.completions.create({
              model: repairModelId,
              temperature: 0,
              max_tokens: 1200,
              messages: [
                {
                  role: "system",
                  content:
                    "Fix the following into one valid JSON website plan object only. No markdown.",
                },
                { role: "user", content: content.slice(0, 6000) },
              ],
            });
            return repair;
          },
        });
        const repair = repairRetryResult.result;
        const repaired = repair.choices[0]?.message?.content ?? "";
        plan = parsePlanJson(repaired);
        usage = repair.usage ?? usage;
        modelId = repairRetryResult.model;
        console.info("plan_repaired", {
          model: modelId,
          usage,
          attempts: repairRetryResult.attempts.length,
        });
      }

      const checked = validatePlan(plan);
      if (!checked.ok) {
        return response.status(checked.status).json({
          ok: false,
          error: checked.error,
          details: checked.details,
        });
      }

      if (usage) {
        console.info("plan_usage", { model: modelId, usage });
      }

      return response.json({
        ok: true,
        model: modelId,
        plan: checked.plan,
        usage,
      });
    } catch (error) {
      const record =
        typeof error === "object" && error !== null ? error : {};

      const nested =
        typeof record.error === "object" && record.error !== null
          ? record.error
          : {};

      const upstream = {
        status: record.status ?? null,
        code: record.code ?? nested.code ?? null,
        type: record.type ?? nested.type ?? null,
        message:
          error instanceof Error
            ? error.message
            : "Unknown upstream error",
        requestId:
          record.request_id ??
          record.requestId ??
          null,
      };

      console.error("Qwen request failed", upstream);

      return response.status(502).json({
        ok: false,
        error: "Qwen request failed",
        ...(process.env.DEBUG_ERRORS === "true"
          ? { upstream }
          : {}),
      });
    }
  });

  app.post("/api/mission/analyze", async (request, response) => {
    if (!(await requireAuth(request, response))) return;

    const limited = rateLimiter.check(rateLimitKey("mission", request));
    if (!limited.ok) {
      response.setHeader("Retry-After", String(limited.retryAfterSec));
      return response.status(429).json({
        ok: false,
        error: "Too many mission requests; try again shortly",
      });
    }

    const brief =
      typeof request.body?.brief === "string" ? request.body.brief.trim() : "";
    if (!brief || brief.length > 8_000) {
      return response.status(400).json({
        ok: false,
        error: "brief must contain between 1 and 8,000 characters",
      });
    }

    try {
      const result = await runSociety({
        qwen,
        brief,
        navigatorModel: societyModels.navigator,
        specialistModel: societyModels.specialist,
        chairModel: societyModels.chair,
        timeoutMs: roleTimeoutMs,
      });
      return response.json({ ok: true, ...result });
    } catch (error) {
      console.error("society_analysis_failed", {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return response.status(502).json({
        ok: false,
        error: "Qwen society analysis failed",
      });
    }
  });

  app.post("/api/approve", async (request, response) => {
    if (!(await requireAuth(request, response))) return;

    const plan = request.body?.plan;
    const checked = validatePlan(plan);
    if (!checked.ok) {
      return response.status(checked.status).json({
        ok: false,
        error: checked.error,
        details: checked.details,
      });
    }

    const operation =
      typeof request.body?.operation === "string"
        ? request.body.operation
        : "";
    if (!APPROVAL_OPERATIONS.has(operation)) {
      return response.status(400).json({
        ok: false,
        error: "A valid approval operation is required",
      });
    }
    const requestedArtifactContextId = request.body?.artifactContextId;
    const artifactContextId =
      requestedArtifactContextId === undefined
        ? crypto.randomBytes(24).toString("base64url")
        : artifactContextIdFrom(requestedArtifactContextId);
    if (!artifactContextId) {
      return response.status(400).json({
        ok: false,
        error: "A valid artifact context identifier is required",
      });
    }
    const parentVersionDigest = parentVersionDigestFrom(
      request.body?.parentVersionDigest,
    );
    if (
      parentVersionDigest === undefined ||
      (operation === "build-preview" && parentVersionDigest !== null)
    ) {
      return response.status(400).json({
        ok: false,
        error: "Invalid parent version context",
      });
    }

    try {
      const session = await Promise.resolve(
        approvalStore.create(
          checked.plan,
          approvalBinding(
            request,
            operation,
            artifactContextId,
            parentVersionDigest,
          ),
        ),
      );
      const maxAgeSec = Math.ceil(session.ttlMs / 1000);

      response.setHeader(
        "Set-Cookie",
        buildSessionCookie(COOKIE_NAME, session.sessionId, {
          maxAgeSec,
          secure: secureCookies,
        }),
      );

      return response.json({
        ok: true,
        planDigest: session.planDigest,
        nonce: session.nonce,
        operation,
        artifactContextId,
        parentVersionDigest,
        expiresAt: new Date(session.expiresAt).toISOString(),
        approvalGate: "session-bound",
        approvalStore: approvalBackend,
        multiInstanceSafe,
      });
    } catch (error) {
      console.error("approval_create_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return response.status(503).json({
        ok: false,
        error: "Approval session store unavailable",
      });
    }
  });

  app.post("/api/build-preview", async (request, response) => {
    if (!(await requireAuth(request, response))) return;

    const plan = request.body?.plan;
    const nonce =
      typeof request.body?.nonce === "string"
        ? request.body.nonce
        : undefined;
    const artifactContextId = artifactContextIdFrom(
      request.body?.artifactContextId,
    );

    const cookies = parseCookies(request.get("cookie") ?? "");
    const sessionId = cookies[COOKIE_NAME];

    let gate;
    try {
      gate = await Promise.resolve(
        approvalStore.consume({
          sessionId,
          plan,
          nonce,
          ...approvalBinding(
            request,
            "build-preview",
            artifactContextId,
            null,
          ),
        }),
      );
    } catch (error) {
      console.error("approval_consume_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return response.status(503).json({
        ok: false,
        error: "Approval session store unavailable",
      });
    }
    if (!gate.ok) {
      return response.status(gate.status).json({
        ok: false,
        error: gate.error,
      });
    }

    const result = buildPreviewFromPlan(plan);

    if (!result.ok) {
      const { status, error, validation } = result;
      return response.status(status).json({
        ok: false,
        error,
        ...(validation ? { validation } : {}),
      });
    }

    response.setHeader(
      "Set-Cookie",
      clearSessionCookie(COOKIE_NAME, secureCookies),
    );

    const trace = [
      "Business brief received",
      "Qwen generated a structured website plan",
      "Human approval bound to server session (plan digest + one-time nonce)",
      "Session-bound gate validated for preview",
      "Scoped preview builder invoked",
      "Plan constraints validated",
      "Multi-page isolated HTML preview rendered",
      "No production resources changed",
    ];

    return response.json({
      ok: true,
      planDigest: gate.planDigest,
      trace,
      validation: {
        ...result.validation,
        sessionBound: true,
        nonceConsumed: true,
      },
      preview: result.preview,
    });
  });

  app.post("/api/package", async (request, response) => {
    if (!(await requireAuth(request, response))) return;

    const plan = request.body?.plan;
    const nonce =
      typeof request.body?.nonce === "string"
        ? request.body.nonce
        : undefined;
    const parentVersionDigest =
      parentVersionDigestFrom(request.body?.parentVersionDigest);
    const artifactContextId = artifactContextIdFrom(
      request.body?.artifactContextId,
    );
    if (parentVersionDigest === undefined) {
      return response.status(400).json({
        ok: false,
        error: "Invalid parent version context",
      });
    }

    const cookies = parseCookies(request.get("cookie") ?? "");
    const sessionId = cookies[COOKIE_NAME];

    let gate;
    try {
      gate = await Promise.resolve(
        approvalStore.consume({
          sessionId,
          plan,
          nonce,
          ...approvalBinding(
            request,
            "package",
            artifactContextId,
            parentVersionDigest,
          ),
        }),
      );
    } catch (error) {
      console.error("approval_consume_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return response.status(503).json({
        ok: false,
        error: "Approval session store unavailable",
      });
    }
    if (!gate.ok) {
      return response.status(gate.status).json({
        ok: false,
        error: gate.error,
      });
    }

    const result = buildPreviewFromPlan(plan);
    if (!result.ok) {
      const { status, error, validation } = result;
      return response.status(status).json({
        ok: false,
        error,
        ...(validation ? { validation } : {}),
      });
    }

    try {
      const privateKeyPem = await loadPrivateKey();
      const publicKeyPem = await loadPublicKey();

      const files = result.preview.pages.map((page) => ({
        name: page.name,
        content: page.html,
      }));

      const requestId = crypto.randomBytes(16).toString("hex");
      const pkg = createSignedPackage({
        requestId,
        plan,
        files,
        parentVersionDigest,
        privateKeyPem,
        publicKeyPem,
        mode: "preview",
        model,
      });

      response.setHeader(
        "Set-Cookie",
        clearSessionCookie(COOKIE_NAME, secureCookies),
      );

      return response.json({
        ok: true,
        requestId,
        planDigest: gate.planDigest,
        manifest: pkg.manifest,
        manifestDigest: pkg.manifestDigest,
        receipt: pkg.receipt,
        receiptDigest: pkg.receiptDigest,
        signature: pkg.signature,
        publicKeyFingerprint: pkg.publicKeyFingerprint,
        files: files.map((f) => ({ name: f.name, content: f.content })),
        signingAlgorithm: "Ed25519",
        issuer: "solforge-dev",
        packageFormat: "signed-json-v1",
        warning: "Development signing identity only - not production key custody",
      });
    } catch (error) {
      console.error("package_signing_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return response.status(500).json({
        ok: false,
        error: "Package signing failed",
      });
    }
  });

  app.get("/api/signing/public-key", async (_request, response) => {
    try {
      const publicKeyPem = await loadPublicKey();
      const { publicKeyFingerprint } = await import("./lib/signing.mjs");
      const fingerprint = publicKeyFingerprint(publicKeyPem);
      return response.json({
        ok: true,
        publicKey: publicKeyPem,
        fingerprint,
        algorithm: "Ed25519",
        issuer: "solforge-dev",
        warning: "Development signing identity only - not production key custody",
      });
    } catch (error) {
      console.error("public_key_load_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return response.status(500).json({
        ok: false,
        error: "Public key unavailable",
      });
    }
  });

  return app;
}

function assertRequiredEnvironment() {
  for (const name of requiredEnvironment) {
    if (!process.env[name]) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
  }
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isMainModule()) {
  assertRequiredEnvironment();

  createApp().then((app) => {
    const port = Number(
      process.env.FC_CUSTOM_LISTEN_PORT ??
        process.env.PORT ??
        9000,
    );

    app.listen(port, "0.0.0.0", () => {
      console.log(`Solforge listening on ${port}`);
    });
  }).catch((error) => {
    console.error("Failed to create app:", error);
    process.exit(1);
  });
}
