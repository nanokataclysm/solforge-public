import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../server.mjs";
import {
  COOKIE_NAME,
  createApprovalStore,
} from "../lib/approval-session.mjs";
import {
  AUTH_COOKIE_NAME,
  createAuthStore,
} from "../lib/auth-session.mjs";
import { createRateLimiter } from "../lib/rate-limit.mjs";
import { verifySignedMediaPackage } from "../lib/media-provenance.mjs";

const DEMO_SECRET = "test-demo-secret-not-real";
const STATE_HEADERS = {
  "content-type": "application/json",
  "x-solforge-csrf": "1",
};
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);

const plan = {
  businessName: "Moonlit Kiln",
  businessSummary: "Handmade ceramics",
  archetype: "Craft / artisan",
  motif: "Studio kiln",
  pages: ["Home", "Work", "About", "Contact"],
  palette: ["#9b4a35", "#f2eadf", "#202020"],
};

function mediaIntent() {
  return {
    artifactId: "artifact",
    artifactVersion: "v1",
    blueprintDigest: SHA_A,
    genblazeManifestHash: SHA_B,
    assets: [
      {
        assetId: "source",
        role: "source",
        b2ObjectKey: "media/source.png",
        sha256: SHA_C,
        byteSize: 12,
        contentType: "image/png",
        provider: "qwen",
        model: "qwen-image",
      },
    ],
    references: [{ assetId: "source", fileId: "file-source" }],
    createdAt: "2026-07-31T00:00:00.000Z",
    mode: "preview",
    parentVersionDigest: SHA_D,
  };
}

async function jsonRequest(baseUrl, method, path, { headers = {}, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? JSON.parse(text) : null,
    setCookie: response.headers.get("set-cookie") ?? "",
  };
}

function cookieFrom(setCookie, name) {
  const match = setCookie.match(new RegExp(`(?:^|,\\s*)${name}=([^;]*)`));
  return match ? `${name}=${match[1]}` : "";
}

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function startHarness(mediaGetFileInfo) {
  const keys = crypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const app = await createApp({
    demoSecret: DEMO_SECRET,
    model: "qwen-plus",
    qwen: {
      chat: {
        completions: {
          async create() {
            throw new Error("Qwen must not be called by media package tests");
          },
        },
      },
    },
    secureCookies: false,
    authStore: createAuthStore(),
    approvalStore: createApprovalStore(),
    loginRateLimiter: createRateLimiter({ max: 100, windowMs: 60_000 }),
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
      body: { accessCode: DEMO_SECRET },
    },
  );
  assert.equal(login.status, 200);
  return {
    ...harness,
    authCookie: cookieFrom(login.setCookie, AUTH_COOKIE_NAME),
    publicKeyPem: keys.publicKey,
  };
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
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
        plan,
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
        plan,
        nonce: approval.json.nonce,
        artifactContextId: approval.json.artifactContextId,
        mediaIntent: intent,
      },
    },
  );
}

test("media package approval is disabled without an injected B2 lookup", async () => {
  const harness = await startHarness(undefined);
  try {
    const result = await approve(harness, mediaIntent());
    assert.equal(result.status, 503);
    assert.equal(
      result.json.error,
      "Verified media package service unavailable",
    );
  } finally {
    await close(harness.server);
  }
});

test("media package route verifies B2 metadata and returns a valid signed receipt", async () => {
  let lookups = 0;
  const harness = await startHarness(async ({ fileId }) => {
    lookups++;
    return {
      action: "upload",
      fileId,
      fileName: "media/source.png",
      contentLength: 12,
      contentType: "image/png",
      fileInfo: { src_sha256: SHA_C },
    };
  });
  try {
    const intent = mediaIntent();
    const approval = await approve(harness, intent);
    assert.equal(approval.status, 200);
    assert.match(approval.json.mediaIntentDigest, /^[0-9a-f]{64}$/);

    const result = await packageMedia(harness, approval, intent);
    assert.equal(result.status, 200);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.mediaIntentDigest, approval.json.mediaIntentDigest);
    assert.equal(result.json.verifiedAssetCount, 1);
    assert.equal(Object.hasOwn(result.json, "verifiedAssets"), false);
    assert.equal(
      verifySignedMediaPackage({
        receipt: result.json.receipt,
        signature: result.json.signature,
        publicKeyPem: harness.publicKeyPem,
      }).ok,
      true,
    );
    assert.equal(lookups, 1);

    const replay = await packageMedia(harness, approval, intent);
    assert.equal(replay.status, 401);
    assert.equal(lookups, 1);
  } finally {
    await close(harness.server);
  }
});

test("changed media intent is rejected before any B2 lookup", async () => {
  let lookups = 0;
  const harness = await startHarness(async () => {
    lookups++;
    throw new Error("must not run");
  });
  try {
    const intent = mediaIntent();
    const approval = await approve(harness, intent);
    assert.equal(approval.status, 200);

    const changed = mediaIntent();
    changed.references[0].fileId = "other-file";
    const result = await packageMedia(harness, approval, changed);
    assert.equal(result.status, 409);
    assert.match(result.json.error, /approval context/i);
    assert.equal(lookups, 0);
  } finally {
    await close(harness.server);
  }
});

test("stored-object mismatches fail closed without returning a signature", async () => {
  const harness = await startHarness(async ({ fileId }) => ({
    action: "upload",
    fileId,
    fileName: "media/source.png",
    contentLength: 99,
    contentType: "image/png",
    fileInfo: { src_sha256: SHA_C },
  }));
  try {
    const intent = mediaIntent();
    const approval = await approve(harness, intent);
    const result = await packageMedia(harness, approval, intent);
    assert.equal(result.status, 409);
    assert.equal(result.json.code, "b2_size_mismatch");
    assert.equal(Object.hasOwn(result.json, "signature"), false);
    assert.match(result.setCookie, new RegExp(`${COOKIE_NAME}=;`));
  } finally {
    await close(harness.server);
  }
});

test("B2 lookup failures return a stable 502 without raw error details", async () => {
  const harness = await startHarness(async () => {
    throw new Error("secret upstream detail");
  });
  try {
    const intent = mediaIntent();
    const approval = await approve(harness, intent);
    const result = await packageMedia(harness, approval, intent);
    assert.equal(result.status, 502);
    assert.equal(result.json.code, "b2_lookup_failed");
    assert.equal(JSON.stringify(result.json).includes("secret upstream"), false);
  } finally {
    await close(harness.server);
  }
});
