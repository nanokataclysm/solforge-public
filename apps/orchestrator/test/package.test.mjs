/**
 * Tests for /api/package endpoint (signed package generation).
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../server.mjs";
import { createApprovalStore } from "../lib/approval-session.mjs";
import { createAuthStore } from "../lib/auth-session.mjs";

const DEMO_SECRET = "test-demo-secret-not-real";
const STATE_HEADERS = {
  "Content-Type": "application/json",
  "x-solforge-csrf": "1",
};

/** @type {import('http').Server} */
let server;
/** @type {string} */
let baseUrl;
let authCookie;

function requestHeaders(extra = {}) {
  return { ...STATE_HEADERS, Cookie: authCookie, ...extra };
}

function cookiePair(setCookie) {
  return setCookie?.split(";")[0] ?? "";
}

// Generate ephemeral test key pair
function generateTestKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return { privateKey, publicKey };
}

describe("POST /api/package", () => {
  const mockPlan = {
    businessName: "Test Studio",
    businessSummary: "A test business",
    archetype: "studio",
    pages: ["Home", "About", "Contact"],
    palette: ["#8B5C3E", "#F9F5F0", "#3A2E26"],
    motif: "warm",
  };

  function createMockQwen() {
    return {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify(mockPlan),
                },
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        },
      },
    };
  }

  before(async () => {
    const keys = generateTestKeyPair();
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "solforge-test-"));
    const privateKeyPath = path.join(tmpDir, "private.pem");
    const publicKeyPath = path.join(tmpDir, "public.pem");

    await fs.writeFile(privateKeyPath, keys.privateKey, { mode: 0o600 });
    await fs.writeFile(publicKeyPath, keys.publicKey);

    process.env.NANOKAT_SIGNING_PRIVATE_KEY_PATH = privateKeyPath;
    process.env.NANOKAT_SIGNING_PUBLIC_KEY_PATH = publicKeyPath;
    process.env._TEST_TMP_DIR = tmpDir;

    const app = await createApp({
      demoSecret: DEMO_SECRET,
      qwen: createMockQwen(),
      authStore: createAuthStore(),
      approvalStore: createApprovalStore(),
      model: "mock-qwen",
    });

    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: STATE_HEADERS,
      body: JSON.stringify({ accessCode: DEMO_SECRET }),
    });
    assert.equal(loginRes.status, 200);
    authCookie = cookiePair(loginRes.headers.get("set-cookie"));
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    const tmpDir = process.env._TEST_TMP_DIR;
    if (tmpDir) {
      const fs = await import("node:fs/promises");
      await fs.rm(tmpDir, { recursive: true, force: true });
      delete process.env._TEST_TMP_DIR;
    }
    delete process.env.NANOKAT_SIGNING_PRIVATE_KEY_PATH;
    delete process.env.NANOKAT_SIGNING_PUBLIC_KEY_PATH;
  });

  it("requires authentication", async () => {
    const res = await fetch(`${baseUrl}/api/package`, {
      method: "POST",
      headers: STATE_HEADERS,
      body: JSON.stringify({ plan: mockPlan }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.ok, false);
  });

  it("requires approval session", async () => {
    const res = await fetch(`${baseUrl}/api/package`, {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({ plan: mockPlan }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /approval session/i);
  });

  it("generates signed package after approval", async () => {
    // 1. Approve plan
    const approveRes = await fetch(`${baseUrl}/api/approve`, {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({ plan: mockPlan, operation: "package" }),
    });

    assert.equal(approveRes.status, 200);
    const approveBody = await approveRes.json();
    assert.equal(approveBody.ok, true);

    const sessionCookie = cookiePair(approveRes.headers.get("set-cookie"));
    const nonce = approveBody.nonce;

    // 2. Generate signed package
    const pkgRes = await fetch(`${baseUrl}/api/package`, {
      method: "POST",
      headers: requestHeaders({ Cookie: `${authCookie}; ${sessionCookie}` }),
      body: JSON.stringify({
        plan: mockPlan,
        nonce,
        artifactContextId: approveBody.artifactContextId,
      }),
    });

    assert.equal(pkgRes.status, 200);
    const pkgBody = await pkgRes.json();
    assert.equal(pkgBody.ok, true);
    assert.equal(typeof pkgBody.requestId, "string");
    assert.equal(typeof pkgBody.manifest, "object");
    assert.equal(typeof pkgBody.manifestDigest, "string");
    assert.equal(typeof pkgBody.receipt, "object");
    assert.equal(typeof pkgBody.signature, "string");
    assert.equal(pkgBody.signingAlgorithm, "Ed25519");
    assert.equal(pkgBody.issuer, "solforge-dev");
    assert.equal(pkgBody.packageFormat, "signed-json-v1");
    assert.match(pkgBody.warning, /development signing identity/i);

    // Verify manifest structure (page count follows preview normalizer — not fixed)
    assert.equal(pkgBody.manifest.version, "1.0");
    assert.equal(Array.isArray(pkgBody.manifest.files), true);
    assert.ok(pkgBody.manifest.files.length >= 1);
    assert.ok(
      pkgBody.manifest.files.every(
        (f) => typeof f.name === "string" && typeof f.digest === "string",
      ),
    );

    // Verify receipt structure
    assert.equal(pkgBody.receipt.version, "1.0");
    assert.equal(pkgBody.receipt.manifestDigest, pkgBody.manifestDigest);
    assert.equal(pkgBody.receipt.issuer, "solforge-dev");
    assert.equal(pkgBody.receipt.signingAlgorithm, "Ed25519");
  });

  it("supports parent version digest for branching", async () => {
    const parentDigest = "abc123parent";
    const approveRes = await fetch(`${baseUrl}/api/approve`, {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({
        plan: mockPlan,
        operation: "package",
        parentVersionDigest: parentDigest,
      }),
    });

    const approveBody = await approveRes.json();
    const sessionCookie = cookiePair(approveRes.headers.get("set-cookie"));
    const nonce = approveBody.nonce;

    const pkgRes = await fetch(`${baseUrl}/api/package`, {
      method: "POST",
      headers: requestHeaders({ Cookie: `${authCookie}; ${sessionCookie}` }),
      body: JSON.stringify({
        plan: mockPlan,
        nonce,
        artifactContextId: approveBody.artifactContextId,
        parentVersionDigest: parentDigest,
      }),
    });

    assert.equal(pkgRes.status, 200);
    const pkgBody = await pkgRes.json();
    assert.equal(pkgBody.ok, true);
    assert.equal(pkgBody.manifest.parentVersionDigest, parentDigest);
  });

  it("rejects reuse for another parent version", async () => {
    const approveRes = await fetch(`${baseUrl}/api/approve`, {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({
        plan: mockPlan,
        operation: "package",
        parentVersionDigest: "parent-one",
      }),
    });
    const approved = await approveRes.json();
    const approvalCookie = cookiePair(approveRes.headers.get("set-cookie"));

    const pkgRes = await fetch(`${baseUrl}/api/package`, {
      method: "POST",
      headers: requestHeaders({
        Cookie: `${authCookie}; ${approvalCookie}`,
      }),
      body: JSON.stringify({
        plan: mockPlan,
        nonce: approved.nonce,
        artifactContextId: approved.artifactContextId,
        parentVersionDigest: "parent-two",
      }),
    });
    assert.equal(pkgRes.status, 409);
  });
});

describe("GET /api/signing/public-key", () => {
  let pkServer;
  let pkBaseUrl;

  before(async () => {
    const keys = generateTestKeyPair();
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "solforge-test-"));
    const privateKeyPath = path.join(tmpDir, "private.pem");
    const publicKeyPath = path.join(tmpDir, "public.pem");

    await fs.writeFile(privateKeyPath, keys.privateKey, { mode: 0o600 });
    await fs.writeFile(publicKeyPath, keys.publicKey);

    process.env.NANOKAT_SIGNING_PUBLIC_KEY_PATH = publicKeyPath;
    process.env._TEST_PK_TMP_DIR = tmpDir;

    const app = await createApp({
      demoSecret: "test-secret",
      qwen: {
        chat: {
          completions: {
            create: async () => ({
              choices: [{ message: { content: "{}" } }],
            }),
          },
        },
      },
      approvalStore: createApprovalStore(),
      authStore: createAuthStore(),
    });

    pkServer = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => pkServer.once("listening", resolve));
    const address = pkServer.address();
    pkBaseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (pkServer) {
      await new Promise((resolve) => pkServer.close(resolve));
    }
    const tmpDir = process.env._TEST_PK_TMP_DIR;
    if (tmpDir) {
      const fs = await import("node:fs/promises");
      await fs.rm(tmpDir, { recursive: true, force: true });
      delete process.env._TEST_PK_TMP_DIR;
    }
    delete process.env.NANOKAT_SIGNING_PUBLIC_KEY_PATH;
  });

  it("returns public key and fingerprint", async () => {
    const res = await fetch(`${pkBaseUrl}/api/signing/public-key`);

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.publicKey, "string");
    assert.match(body.publicKey, /BEGIN PUBLIC KEY/);
    assert.equal(typeof body.fingerprint, "string");
    assert.equal(body.fingerprint.length, 64); // SHA-256 hex
    assert.equal(body.algorithm, "Ed25519");
    assert.equal(body.issuer, "solforge-dev");
    assert.match(body.warning, /development signing identity/i);
  });
});
