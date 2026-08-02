import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { verifyIndependentMediaPackage } from "../lib/independent-media-package-verifier.mjs";
import { createSignedMediaPackage } from "../lib/media-provenance.mjs";
import { canonicalJson, sha256 } from "../lib/signing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(
  __dirname,
  "../scripts/verify-media-package-signature.mjs",
);

function fixture() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const signed = createSignedMediaPackage({
    artifactId: "independent-verification-test",
    artifactVersion: "v1",
    blueprintDigest: "a".repeat(64),
    genblazeManifestHash: "b".repeat(64),
    assets: [
      {
        assetId: "source",
        role: "source",
        b2ObjectKey: "solforge-smoke/example.jpg",
        sha256: "c".repeat(64),
        byteSize: 128,
        contentType: "image/jpeg",
      },
    ],
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    createdAt: "2026-08-01T00:00:00.000Z",
    mode: "preview",
  });

  return {
    packageResponse: {
      ok: true,
      receipt: signed.receipt,
      receiptDigest: signed.receiptDigest,
      signature: signed.signature,
      publicKeyFingerprint: signed.publicKeyFingerprint,
      signingAlgorithm: "Ed25519",
      issuer: signed.receipt.issuer,
      packageFormat: "verified-media-json-v1",
    },
    publicKeyDocument: {
      ok: true,
      publicKey,
      fingerprint: signed.publicKeyFingerprint,
      algorithm: "Ed25519",
      issuer: signed.receipt.issuer,
    },
    fingerprint: signed.publicKeyFingerprint,
  };
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: {
        ...process.env,
        SOLFORGE_EXPECTED_SIGNING_FINGERPRINT: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

describe("verifyIndependentMediaPackage", () => {
  it("verifies a package against an out-of-band fingerprint pin", () => {
    const input = fixture();
    const result = verifyIndependentMediaPackage({
      packageResponse: input.packageResponse,
      publicKeyDocument: input.publicKeyDocument,
      expectedFingerprint: input.fingerprint,
    });

    assert.deepEqual(result, {
      ok: true,
      signatureVerified: true,
      receiptDigestVerified: true,
      publicKeyDocumentVerified: true,
      packageFingerprintVerified: true,
      pinVerified: true,
      trustMode: "pinned",
      fingerprint: input.fingerprint,
      algorithm: "Ed25519",
      issuer: "solforge-dev",
    });
  });

  it("distinguishes endpoint-only verification from pinned verification", () => {
    const input = fixture();
    const result = verifyIndependentMediaPackage({
      packageResponse: input.packageResponse,
      publicKeyDocument: input.publicKeyDocument,
    });

    assert.equal(result.ok, true);
    assert.equal(result.signatureVerified, true);
    assert.equal(result.pinVerified, null);
    assert.equal(result.trustMode, "endpoint-only");
  });

  it("fails closed when the trusted fingerprint pin does not match", () => {
    const input = fixture();
    const result = verifyIndependentMediaPackage({
      packageResponse: input.packageResponse,
      publicKeyDocument: input.publicKeyDocument,
      expectedFingerprint: "d".repeat(64),
    });

    assert.deepEqual(result, {
      ok: false,
      stage: "pin",
      code: "fingerprint_mismatch",
    });
  });

  it("rejects a key document whose fingerprint does not match its PEM", () => {
    const input = fixture();
    const result = verifyIndependentMediaPackage({
      packageResponse: input.packageResponse,
      publicKeyDocument: {
        ...input.publicKeyDocument,
        fingerprint: "e".repeat(64),
      },
    });

    assert.deepEqual(result, {
      ok: false,
      stage: "public_key_document",
      code: "fingerprint_mismatch",
    });
  });

  it("rejects an incorrect receipt digest even when the signature is valid", () => {
    const input = fixture();
    const result = verifyIndependentMediaPackage({
      packageResponse: {
        ...input.packageResponse,
        receiptDigest: "f".repeat(64),
      },
      publicKeyDocument: input.publicKeyDocument,
      expectedFingerprint: input.fingerprint,
    });

    assert.deepEqual(result, {
      ok: false,
      stage: "receipt",
      code: "receipt_digest_mismatch",
    });
  });

  it("rejects a tampered receipt even when its digest is recomputed", () => {
    const input = fixture();
    const receipt = {
      ...input.packageResponse.receipt,
      artifactVersion: "tampered",
    };
    const result = verifyIndependentMediaPackage({
      packageResponse: {
        ...input.packageResponse,
        receipt,
        receiptDigest: sha256(canonicalJson(receipt)),
      },
      publicKeyDocument: input.publicKeyDocument,
      expectedFingerprint: input.fingerprint,
    });

    assert.deepEqual(result, {
      ok: false,
      stage: "signature",
      code: "signature_verification_failed",
    });
  });

  it("rejects accessor-backed public-key fields without invoking them", () => {
    const input = fixture();
    let invoked = false;
    const publicKeyDocument = { ...input.publicKeyDocument };
    Object.defineProperty(publicKeyDocument, "publicKey", {
      enumerable: true,
      get() {
        invoked = true;
        return input.publicKeyDocument.publicKey;
      },
    });

    const result = verifyIndependentMediaPackage({
      packageResponse: input.packageResponse,
      publicKeyDocument,
    });

    assert.equal(invoked, false);
    assert.deepEqual(result, {
      ok: false,
      stage: "public_key_document",
      code: "invalid_public_key_document",
    });
  });
});

describe("verify-media-package-signature CLI", () => {
  let server;
  let baseUrl;
  let tmpDir;
  let packagePath;
  let input;

  before(async () => {
    input = fixture();
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "solforge-independent-verify-"),
    );
    packagePath = path.join(tmpDir, "package.json");
    await fs.writeFile(
      packagePath,
      JSON.stringify(input.packageResponse),
      { mode: 0o600 },
    );

    server = http.createServer((request, response) => {
      if (request.url !== "/api/signing/public-key") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(input.publicKeyDocument));
    });
    server.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (server?.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("verifies a captured response without printing key or signature material", async () => {
    const result = await runCli([
      "--package",
      packagePath,
      "--base-url",
      baseUrl,
      "--expected-fingerprint",
      input.fingerprint,
    ]);

    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.trustMode, "pinned");
    assert.equal(output.signatureVerified, true);
    assert.equal(result.stdout.includes("BEGIN PUBLIC KEY"), false);
    assert.equal(result.stdout.includes(input.packageResponse.signature), false);
  });

  it("requires an explicit pin or endpoint-only acknowledgement", async () => {
    const result = await runCli([
      "--package",
      packagePath,
      "--base-url",
      baseUrl,
    ]);

    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      stage: "cli",
      code: "missing_trust_anchor",
    });
  });
});
