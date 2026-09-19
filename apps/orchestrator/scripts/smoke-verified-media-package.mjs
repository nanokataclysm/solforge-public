#!/usr/bin/env node
/**
 * Run a local, operator-controlled verified-media package smoke.
 *
 * Starts an in-process Solforge server on 127.0.0.1, uses a real read-only
 * B2 metadata lookup, signs with an ephemeral Ed25519 key pair, and verifies
 * approval binding, receipt validity, and replay rejection.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  COOKIE_NAME,
  createApprovalStore,
} from "../lib/approval-session.mjs";
import {
  AUTH_COOKIE_NAME,
  createAuthStore,
} from "../lib/auth-session.mjs";
import { createB2GetFileInfoFromEnv } from "../lib/b2-get-file-info-adapter.mjs";
import { verifySignedMediaPackage } from "../lib/media-provenance.mjs";
import { createRateLimiter } from "../lib/rate-limit.mjs";
import { canonicalJson, sha256 } from "../lib/signing.mjs";
import { createApp } from "../server.mjs";

const STATE_HEADERS = {
  "content-type": "application/json",
  "x-solforge-csrf": "1",
};
const PLAN = Object.freeze({
  businessName: "Solforge Verified Media Smoke",
  businessSummary: "Operator-controlled local verification",
  archetype: "Technical validation",
  motif: "Bounded provenance",
  pages: ["Home", "Work", "About", "Contact"],
  palette: ["#1f2937", "#f8fafc", "#0f766e"],
});
const SHA256_LOWER = /^[0-9a-f]{64}$/;

export class VerifiedMediaSmokeError extends Error {
  constructor(stage, code, httpStatus = null) {
    super(`Verified media smoke failed at ${stage}`);
    this.name = "VerifiedMediaSmokeError";
    this.stage = stage;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function fail(stage, code, httpStatus = null) {
  throw new VerifiedMediaSmokeError(stage, code, httpStatus);
}

function cleanString(value, maxLength = 2048) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}

function validateInput(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !Buffer.isBuffer(input.sourceBuffer) ||
    input.sourceBuffer.length < 1 ||
    !cleanString(input.fileId, 1024) ||
    !cleanString(input.objectKey, 1024) ||
    !cleanString(input.contentType, 256)
  ) {
    fail("input", "invalid_input");
  }
}

function changedDigest(digest) {
  return `${digest[0] === "0" ? "1" : "0"}${digest.slice(1)}`;
}

function makeIntent(input, createdAt) {
  const sourceSha256 = sha256(input.sourceBuffer);
  const byteSize = input.sourceBuffer.length;
  return {
    artifactId: "solforge-verified-media-smoke",
    artifactVersion: "smoke-v1",
    blueprintDigest: sha256(
      canonicalJson({
        kind: "verified-media-smoke-blueprint",
        objectKey: input.objectKey,
        contentType: input.contentType,
      }),
    ),
    genblazeManifestHash: sha256(
      canonicalJson({
        kind: "verified-media-smoke-manifest",
        sourceSha256,
        byteSize,
      }),
    ),
    assets: [
      {
        assetId: "source",
        role: "source",
        b2ObjectKey: input.objectKey,
        sha256: sourceSha256,
        byteSize,
        contentType: input.contentType,
        provider: "operator",
        model: "local-source",
      },
    ],
    references: [{ assetId: "source", fileId: input.fileId }],
    createdAt,
    mode: "preview",
  };
}

async function jsonRequest(baseUrl, method, pathname, { headers = {}, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      fail("local_http", "invalid_json_response", response.status);
    }
  }
  return {
    status: response.status,
    json,
    setCookie: response.headers.get("set-cookie") ?? "",
  };
}

function cookieFrom(setCookie, name) {
  const match = setCookie.match(new RegExp(`(?:^|,\\s*)${name}=([^;]*)`));
  return match ? `${name}=${match[1]}` : "";
}

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await close(server);
    fail("local_server", "invalid_listen_address");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function startHarness(mediaGetFileInfo) {
  const demoSecret = crypto.randomBytes(32).toString("hex");
  const keys = crypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const app = await createApp({
    demoSecret,
    model: "qwen-plus",
    qwen: {
      chat: {
        completions: {
          async create() {
            throw new Error("Qwen must not be called by verified-media smoke");
          },
        },
      },
    },
    secureCookies: false,
    authStore: createAuthStore(),
    approvalStore: createApprovalStore(),
    loginRateLimiter: createRateLimiter({ max: 20, windowMs: 60_000 }),
    mediaGetFileInfo,
    mediaPrivateKeyLoader: async () => keys.privateKey,
    mediaPublicKeyLoader: async () => keys.publicKey,
  });
  const harness = await listen(app);
  const login = await jsonRequest(
    harness.baseUrl,
    "POST",
    "/api/auth/login",
    {
      headers: STATE_HEADERS,
      body: { accessCode: demoSecret },
    },
  );
  if (login.status !== 200 || !login.json?.authenticated) {
    await close(harness.server);
    fail("login", "login_failed", login.status);
  }
  const authCookie = cookieFrom(login.setCookie, AUTH_COOKIE_NAME);
  if (!authCookie) {
    await close(harness.server);
    fail("login", "missing_auth_cookie", login.status);
  }
  return {
    ...harness,
    authCookie,
    publicKeyPem: keys.publicKey,
  };
}

async function approve(harness, intent) {
  const result = await jsonRequest(
    harness.baseUrl,
    "POST",
    "/api/approve",
    {
      headers: {
        ...STATE_HEADERS,
        cookie: harness.authCookie,
      },
      body: {
        plan: PLAN,
        operation: "media-package",
        mediaIntent: intent,
      },
    },
  );
  return {
    ...result,
    approvalCookie: cookieFrom(result.setCookie, COOKIE_NAME),
  };
}

async function packageMedia(harness, approval, intent) {
  return jsonRequest(
    harness.baseUrl,
    "POST",
    "/api/media/package",
    {
      headers: {
        ...STATE_HEADERS,
        cookie: `${harness.authCookie}; ${approval.approvalCookie}`,
      },
      body: {
        plan: PLAN,
        nonce: approval.json?.nonce,
        artifactContextId: approval.json?.artifactContextId,
        mediaIntent: intent,
      },
    },
  );
}

function requireApproval(approval) {
  if (
    approval.status !== 200 ||
    !cleanString(approval.json?.nonce, 1024) ||
    !cleanString(approval.json?.artifactContextId, 1024) ||
    !SHA256_LOWER.test(approval.json?.mediaIntentDigest) ||
    !approval.approvalCookie
  ) {
    fail("approval", "approval_failed", approval.status);
  }
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function ownDataRecord(value, expectedNames) {
  let arrayValue;
  try {
    arrayValue = Array.isArray(value);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || arrayValue) {
    return null;
  }

  let prototype;
  let symbols;
  let names;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    symbols = Object.getOwnPropertySymbols(value);
    names = Object.getOwnPropertyNames(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }

  if (
    prototype !== Object.prototype ||
    symbols.length !== 0 ||
    names.length !== expectedNames.length ||
    !expectedNames.every((name) => names.includes(name))
  ) {
    return null;
  }

  const record = {};
  for (const name of expectedNames) {
    const descriptor = descriptors[name];
    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
      return null;
    }
    record[name] = descriptor.value;
  }
  return record;
}

function readB2RequestMetrics(getFileInfo) {
  let methodDescriptor;
  try {
    methodDescriptor = Object.getOwnPropertyDescriptor(
      getFileInfo,
      "getRequestMetrics",
    );
  } catch {
    fail("instrumentation", "invalid_b2_request_metrics");
  }

  if (!methodDescriptor) return null;
  if (
    !Object.hasOwn(methodDescriptor, "value") ||
    typeof methodDescriptor.value !== "function"
  ) {
    fail("instrumentation", "invalid_b2_request_metrics");
  }

  let metrics;
  try {
    metrics = Reflect.apply(methodDescriptor.value, getFileInfo, []);
  } catch {
    fail("instrumentation", "invalid_b2_request_metrics");
  }

  const metricValues = ownDataRecord(metrics, [
    "authorizationHttpAttemptCount",
    "getFileInfoHttpAttemptCount",
    "authRetryCount",
    "authRetryReasonCounts",
  ]);
  const reasonValues = ownDataRecord(
    metricValues?.authRetryReasonCounts,
    ["bad_auth_token", "expired_auth_token"],
  );

  if (
    !metricValues ||
    !reasonValues ||
    !nonNegativeSafeInteger(metricValues.authorizationHttpAttemptCount) ||
    !nonNegativeSafeInteger(metricValues.getFileInfoHttpAttemptCount) ||
    !nonNegativeSafeInteger(metricValues.authRetryCount) ||
    !nonNegativeSafeInteger(reasonValues.bad_auth_token) ||
    !nonNegativeSafeInteger(reasonValues.expired_auth_token) ||
    metricValues.authRetryCount !==
      reasonValues.bad_auth_token + reasonValues.expired_auth_token
  ) {
    fail("instrumentation", "invalid_b2_request_metrics");
  }

  return {
    authorizationHttpAttemptCount:
      metricValues.authorizationHttpAttemptCount,
    getFileInfoHttpAttemptCount: metricValues.getFileInfoHttpAttemptCount,
    authRetryCount: metricValues.authRetryCount,
    authRetryReasonCounts: {
      bad_auth_token: reasonValues.bad_auth_token,
      expired_auth_token: reasonValues.expired_auth_token,
    },
  };
}

export async function runVerifiedMediaPackageSmoke({
  input,
  getFileInfo,
  now = () => new Date(),
} = {}) {
  validateInput(input);
  if (typeof getFileInfo !== "function" || typeof now !== "function") {
    fail("input", "invalid_input");
  }

  const instant = now();
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    fail("input", "invalid_clock");
  }
  const intent = makeIntent(input, instant.toISOString());

  let b2AdapterInvocationCount = 0;
  const countedGetFileInfo = async ({ fileId }) => {
    b2AdapterInvocationCount++;
    return getFileInfo({ fileId });
  };

  const harness = await startHarness(countedGetFileInfo);
  try {
    const mutationApproval = await approve(harness, intent);
    requireApproval(mutationApproval);

    const changedIntent = {
      ...intent,
      assets: intent.assets.map((asset) => ({
        ...asset,
        sha256: changedDigest(asset.sha256),
      })),
    };
    const changedResult = await packageMedia(
      harness,
      mutationApproval,
      changedIntent,
    );
    if (
      changedResult.status !== 409 ||
      b2AdapterInvocationCount !== 0
    ) {
      fail(
        "intent_binding",
        "changed_intent_not_rejected_before_lookup",
        changedResult.status,
      );
    }

    const approval = await approve(harness, intent);
    requireApproval(approval);
    const result = await packageMedia(harness, approval, intent);
    if (result.status !== 200 || result.json?.ok !== true) {
      fail(
        "package",
        cleanString(result.json?.code, 128)
          ? result.json.code
          : `http_${result.status}`,
        result.status,
      );
    }
    if (
      result.json.mediaIntentDigest !== approval.json.mediaIntentDigest ||
      result.json.verifiedAssetCount !== 1 ||
      b2AdapterInvocationCount !== 1
    ) {
      fail("package", "unexpected_success_shape", result.status);
    }

    const receiptVerification = verifySignedMediaPackage({
      receipt: result.json.receipt,
      signature: result.json.signature,
      publicKeyPem: harness.publicKeyPem,
    });
    if (!receiptVerification.ok) {
      fail("receipt", "receipt_verification_failed");
    }

    const replay = await packageMedia(harness, approval, intent);
    if (
      ![401, 409].includes(replay.status) ||
      b2AdapterInvocationCount !== 1
    ) {
      fail("replay", "approval_replay_not_rejected", replay.status);
    }

    return {
      ok: true,
      changedIntentRejectedBeforeLookup: true,
      packageStatus: result.status,
      verifiedAssetCount: result.json.verifiedAssetCount,
      receiptVerified: true,
      replayRejected: true,
      b2LookupCount: b2AdapterInvocationCount,
      b2AdapterInvocationCount,
      b2RequestMetrics: readB2RequestMetrics(getFileInfo),
      mediaIntentDigest: result.json.mediaIntentDigest,
      receiptDigest: result.json.receiptDigest,
      publicKeyFingerprint: result.json.publicKeyFingerprint,
    };
  } finally {
    await close(harness.server);
  }
}

function requiredEnv(env, name) {
  const value = env[name];
  if (!cleanString(value, 4096)) {
    fail("configuration", `missing_${name.toLowerCase()}`);
  }
  return value;
}

export async function runCli(env = process.env) {
  const sourcePath = requiredEnv(env, "MEDIA_SOURCE_PATH");
  const sourceBuffer = await fs.readFile(path.resolve(sourcePath)).catch(() => {
    fail("configuration", "source_file_unreadable");
  });
  const getFileInfo = createB2GetFileInfoFromEnv(env);
  if (typeof getFileInfo !== "function") {
    fail("configuration", "b2_credentials_missing");
  }
  return runVerifiedMediaPackageSmoke({
    input: {
      sourceBuffer,
      fileId: requiredEnv(env, "B2_FILE_ID"),
      objectKey: requiredEnv(env, "MEDIA_B2_OBJECT_KEY"),
      contentType: requiredEnv(env, "MEDIA_CONTENT_TYPE"),
    },
    getFileInfo,
  });
}

function sanitizedFailure(error) {
  if (error instanceof VerifiedMediaSmokeError) {
    return {
      ok: false,
      stage: error.stage,
      code: error.code,
      httpStatus: error.httpStatus,
    };
  }
  return {
    ok: false,
    stage: "unexpected",
    code: "smoke_failed",
    httpStatus: null,
  };
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  runCli()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify(sanitizedFailure(error), null, 2));
      process.exitCode = 1;
    });
}
