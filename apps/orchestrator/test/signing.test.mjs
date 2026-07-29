/**
 * Tests for Ed25519 signing and package verification.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  canonicalJson,
  sha256,
  publicKeyFingerprint,
  signEd25519,
  verifyEd25519,
  createSignedPackage,
  verifySignedPackage,
} from "../lib/signing.mjs";

// Generate ephemeral test key pair (not the dev keys)
function generateTestKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return { privateKey, publicKey };
}

describe("signing", () => {
  describe("canonicalJson", () => {
    it("sorts object keys recursively", () => {
      const input = { z: 1, a: { y: 2, x: 3 }, b: [{ d: 4, c: 5 }] };
      const result = canonicalJson(input);
      const expected = JSON.stringify({
        a: { x: 3, y: 2 },
        b: [{ c: 5, d: 4 }],
        z: 1,
      });
      assert.equal(result, expected);
    });

    it("produces same output for equivalent objects", () => {
      const obj1 = { b: 2, a: 1 };
      const obj2 = { a: 1, b: 2 };
      assert.equal(canonicalJson(obj1), canonicalJson(obj2));
    });
  });

  describe("sha256", () => {
    it("computes correct digest", () => {
      const digest = sha256("hello");
      assert.equal(
        digest,
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      );
    });

    it("handles Buffer input", () => {
      const digest = sha256(Buffer.from("hello"));
      assert.equal(
        digest,
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      );
    });
  });

  describe("publicKeyFingerprint", () => {
    it("computes fingerprint from public key PEM", () => {
      const { publicKey } = generateTestKeyPair();
      const fingerprint = publicKeyFingerprint(publicKey);
      assert.equal(typeof fingerprint, "string");
      assert.equal(fingerprint.length, 64); // SHA-256 hex
    });

    it("produces same fingerprint for same key", () => {
      const { publicKey } = generateTestKeyPair();
      const fp1 = publicKeyFingerprint(publicKey);
      const fp2 = publicKeyFingerprint(publicKey);
      assert.equal(fp1, fp2);
    });
  });

  describe("signEd25519 and verifyEd25519", () => {
    it("signs and verifies data correctly", () => {
      const { privateKey, publicKey } = generateTestKeyPair();
      const data = "test message";
      const signature = signEd25519(data, privateKey);
      assert.equal(typeof signature, "string");
      const valid = verifyEd25519(data, signature, publicKey);
      assert.equal(valid, true);
    });

    it("rejects tampered data", () => {
      const { privateKey, publicKey } = generateTestKeyPair();
      const data = "test message";
      const signature = signEd25519(data, privateKey);
      const tamperedData = "test message!";
      const valid = verifyEd25519(tamperedData, signature, publicKey);
      assert.equal(valid, false);
    });

    it("rejects wrong signature", () => {
      const { privateKey, publicKey } = generateTestKeyPair();
      const data = "test message";
      signEd25519(data, privateKey);
      const wrongSignature = Buffer.from("wrong").toString("base64");
      const valid = verifyEd25519(data, wrongSignature, publicKey);
      assert.equal(valid, false);
    });

    it("rejects wrong public key", () => {
      const keys1 = generateTestKeyPair();
      const keys2 = generateTestKeyPair();
      const data = "test message";
      const signature = signEd25519(data, keys1.privateKey);
      const valid = verifyEd25519(data, signature, keys2.publicKey);
      assert.equal(valid, false);
    });
  });

  describe("createSignedPackage", () => {
    it("creates valid signed package", () => {
      const { privateKey, publicKey } = generateTestKeyPair();
      const plan = { businessName: "Test", pages: ["Home"] };
      const files = [
        { name: "index.html", content: "<html>test</html>" },
        { name: "styles.css", content: "body { margin: 0; }" },
      ];

      const pkg = createSignedPackage({
        requestId: "test-123",
        plan,
        files,
        privateKeyPem: privateKey,
        publicKeyPem: publicKey,
        mode: "preview",
        model: "qwen-plus",
      });

      assert.equal(typeof pkg.manifest, "object");
      assert.equal(typeof pkg.manifestDigest, "string");
      assert.equal(typeof pkg.receipt, "object");
      assert.equal(typeof pkg.receiptDigest, "string");
      assert.equal(typeof pkg.signature, "string");
      assert.equal(pkg.manifest.files.length, 2);
      assert.equal(pkg.receipt.manifestDigest, pkg.manifestDigest);
      assert.equal(pkg.receipt.signingAlgorithm, "Ed25519");
    });

    it("includes parent version digest when provided", () => {
      const { privateKey, publicKey } = generateTestKeyPair();
      const plan = { businessName: "Test", pages: ["Home"] };
      const files = [{ name: "index.html", content: "<html>test</html>" }];
      const parentDigest = "abc123";

      const pkg = createSignedPackage({
        requestId: "test-123",
        plan,
        files,
        parentVersionDigest: parentDigest,
        privateKeyPem: privateKey,
        publicKeyPem: publicKey,
      });

      assert.equal(pkg.manifest.parentVersionDigest, parentDigest);
    });

    it("computes correct file digests", () => {
      const { privateKey, publicKey } = generateTestKeyPair();
      const plan = { businessName: "Test", pages: ["Home"] };
      const content = "<html>test</html>";
      const files = [{ name: "index.html", content }];

      const pkg = createSignedPackage({
        requestId: "test-123",
        plan,
        files,
        privateKeyPem: privateKey,
        publicKeyPem: publicKey,
      });

      const expectedDigest = sha256(content);
      assert.equal(pkg.manifest.files[0].digest, expectedDigest);
      assert.equal(pkg.manifest.files[0].size, Buffer.byteLength(content, "utf8"));
    });
  });

  describe("verifySignedPackage", () => {
    it("verifies valid package", () => {
      const { privateKey, publicKey } = generateTestKeyPair();
      const plan = { businessName: "Test", pages: ["Home"] };
      const files = [
        { name: "index.html", content: "<html>test</html>" },
        { name: "styles.css", content: "body { margin: 0; }" },
      ];

      const pkg = createSignedPackage({
        requestId: "test-123",
        plan,
        files,
        privateKeyPem: privateKey,
        publicKeyPem: publicKey,
      });

      const result = verifySignedPackage({
        manifest: pkg.manifest,
        receipt: pkg.receipt,
        signature: pkg.signature,
        publicKeyPem: publicKey,
        files,
      });

      assert.equal(result.ok, true);
      assert.equal(result.error, undefined);
    });

    it("rejects tampered file content", () => {
      const { privateKey, publicKey } = generateTestKeyPair();
      const plan = { businessName: "Test", pages: ["Home"] };
      const files = [{ name: "index.html", content: "<html>test</html>" }];

      const pkg = createSignedPackage({
        requestId: "test-123",
        plan,
        files,
        privateKeyPem: privateKey,
        publicKeyPem: publicKey,
      });

      const tamperedFiles = [{ name: "index.html", content: "<html>hacked</html>" }];

      const result = verifySignedPackage({
        manifest: pkg.manifest,
        receipt: pkg.receipt,
        signature: pkg.signature,
        publicKeyPem: publicKey,
        files: tamperedFiles,
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /digest mismatch/i);
    });

    it("rejects tampered manifest", () => {
      const { privateKey, publicKey } = generateTestKeyPair();
      const plan = { businessName: "Test", pages: ["Home"] };
      const files = [{ name: "index.html", content: "<html>test</html>" }];

      const pkg = createSignedPackage({
        requestId: "test-123",
        plan,
        files,
        privateKeyPem: privateKey,
        publicKeyPem: publicKey,
      });

      const tamperedManifest = { ...pkg.manifest, requestId: "hacked" };

      const result = verifySignedPackage({
        manifest: tamperedManifest,
        receipt: pkg.receipt,
        signature: pkg.signature,
        publicKeyPem: publicKey,
        files,
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /manifest digest/i);
    });

    it("rejects invalid signature", () => {
      const { privateKey, publicKey } = generateTestKeyPair();
      const plan = { businessName: "Test", pages: ["Home"] };
      const files = [{ name: "index.html", content: "<html>test</html>" }];

      const pkg = createSignedPackage({
        requestId: "test-123",
        plan,
        files,
        privateKeyPem: privateKey,
        publicKeyPem: publicKey,
      });

      const wrongSignature = Buffer.from("wrong").toString("base64");

      const result = verifySignedPackage({
        manifest: pkg.manifest,
        receipt: pkg.receipt,
        signature: wrongSignature,
        publicKeyPem: publicKey,
        files,
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /invalid signature/i);
    });

    it("rejects wrong public key", () => {
      const keys1 = generateTestKeyPair();
      const keys2 = generateTestKeyPair();
      const plan = { businessName: "Test", pages: ["Home"] };
      const files = [{ name: "index.html", content: "<html>test</html>" }];

      const pkg = createSignedPackage({
        requestId: "test-123",
        plan,
        files,
        privateKeyPem: keys1.privateKey,
        publicKeyPem: keys1.publicKey,
      });

      const result = verifySignedPackage({
        manifest: pkg.manifest,
        receipt: pkg.receipt,
        signature: pkg.signature,
        publicKeyPem: keys2.publicKey,
        files,
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /invalid signature|issuer id/i);
    });

    it("rejects missing file", () => {
      const { privateKey, publicKey } = generateTestKeyPair();
      const plan = { businessName: "Test", pages: ["Home"] };
      const files = [
        { name: "index.html", content: "<html>test</html>" },
        { name: "styles.css", content: "body { margin: 0; }" },
      ];

      const pkg = createSignedPackage({
        requestId: "test-123",
        plan,
        files,
        privateKeyPem: privateKey,
        publicKeyPem: publicKey,
      });

      const incompleteFiles = [{ name: "index.html", content: "<html>test</html>" }];

      const result = verifySignedPackage({
        manifest: pkg.manifest,
        receipt: pkg.receipt,
        signature: pkg.signature,
        publicKeyPem: publicKey,
        files: incompleteFiles,
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /not found/i);
    });
  });

  describe("version branching", () => {
    it("creates child version with parent digest", () => {
      const { privateKey, publicKey } = generateTestKeyPair();
      const plan = { businessName: "Test", pages: ["Home"] };
      const filesV1 = [{ name: "index.html", content: "<html>v1</html>" }];

      const v1 = createSignedPackage({
        requestId: "v1",
        plan,
        files: filesV1,
        privateKeyPem: privateKey,
        publicKeyPem: publicKey,
      });

      const filesV2 = [{ name: "index.html", content: "<html>v2</html>" }];

      const v2 = createSignedPackage({
        requestId: "v2",
        plan,
        files: filesV2,
        parentVersionDigest: v1.manifestDigest,
        privateKeyPem: privateKey,
        publicKeyPem: publicKey,
      });

      assert.equal(v2.manifest.parentVersionDigest, v1.manifestDigest);
      assert.notEqual(v2.manifestDigest, v1.manifestDigest);
    });

    it("creates two branches from same parent", () => {
      const { privateKey, publicKey } = generateTestKeyPair();
      const plan = { businessName: "Test", pages: ["Home"] };
      const filesV1 = [{ name: "index.html", content: "<html>v1</html>" }];

      const v1 = createSignedPackage({
        requestId: "v1",
        plan,
        files: filesV1,
        privateKeyPem: privateKey,
        publicKeyPem: publicKey,
      });

      const filesV2A = [{ name: "index.html", content: "<html>v2a</html>" }];
      const filesV2B = [{ name: "index.html", content: "<html>v2b</html>" }];

      const v2a = createSignedPackage({
        requestId: "v2a",
        plan,
        files: filesV2A,
        parentVersionDigest: v1.manifestDigest,
        privateKeyPem: privateKey,
        publicKeyPem: publicKey,
      });

      const v2b = createSignedPackage({
        requestId: "v2b",
        plan,
        files: filesV2B,
        parentVersionDigest: v1.manifestDigest,
        privateKeyPem: privateKey,
        publicKeyPem: publicKey,
      });

      assert.equal(v2a.manifest.parentVersionDigest, v1.manifestDigest);
      assert.equal(v2b.manifest.parentVersionDigest, v1.manifestDigest);
      assert.notEqual(v2a.manifestDigest, v2b.manifestDigest);
    });
  });
});
