import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  createSignedMediaPackage,
  verifySignedMediaPackage,
  MAX_MEDIA_ASSETS
} from "../lib/media-provenance.mjs";
import { canonicalJson, signEd25519 } from "../lib/signing.mjs";

function generateTestKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return { privateKey, publicKey };
}

const VALID_SHA256_1 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const VALID_SHA256_2 = "8a32a68a35e8083818e3ddf7a1f5f2a13cc194dc918db43b8be9037c3da872a9";
const VALID_SHA256_3 = "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b";

const validOptions = (keys) => ({
  artifactId: "art-123",
  artifactVersion: "v1",
  blueprintDigest: VALID_SHA256_1,
  genblazeManifestHash: VALID_SHA256_2,
  createdAt: "2026-01-01T00:00:00.000Z",
  assets: [
    {
      assetId: "asset-1",
      role: "background",
      b2ObjectKey: "images/bg.png",
      sha256: VALID_SHA256_3,
      byteSize: 1024,
      contentType: "image/png",
    },
  ],
  privateKeyPem: keys.privateKey,
  publicKeyPem: keys.publicKey,
});

describe("media provenance", () => {
  it("valid package signs and verifies", () => {
    const keys = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys));
    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature: pkg.signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, true);
  });

  it("rejects non-string and blank artifact identifiers during creation", () => {
    const keys = generateTestKeyPair();
    const numericId = validOptions(keys);
    numericId.artifactId = 123;
    assert.throws(() => createSignedMediaPackage(numericId), /missing artifact ID/i);

    const numericVersion = validOptions(keys);
    numericVersion.artifactVersion = 1;
    assert.throws(() => createSignedMediaPackage(numericVersion), /missing artifact version/i);

    const blankId = validOptions(keys);
    blankId.artifactId = " ";
    assert.throws(() => createSignedMediaPackage(blankId), /missing artifact ID/i);

    const blankVersion = validOptions(keys);
    blankVersion.artifactVersion = " ";
    assert.throws(() => createSignedMediaPackage(blankVersion), /missing artifact version/i);
  });

  it("deterministic canonical structure", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);
    const opts2 = {
      ...opts,
      assets: [
        {
          contentType: "image/png",
          byteSize: 1024,
          sha256: VALID_SHA256_3,
          b2ObjectKey: "images/bg.png",
          role: "background",
          assetId: "asset-1",
        },
      ],
    };
    const pkg1 = createSignedMediaPackage(opts);
    const pkg2 = createSignedMediaPackage(opts2);

    assert.equal(canonicalJson(pkg1.receipt), canonicalJson(pkg2.receipt));
  });

  it("wrong public key fails", () => {
    const keys1 = generateTestKeyPair();
    const keys2 = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys1));
    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature: pkg.signature,
      publicKeyPem: keys2.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid signature|issuer id/i);
  });

  it("changed artifact ID fails", () => {
    const keys = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys));
    pkg.receipt.artifactId = "art-999";
    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature: pkg.signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid signature/i);
  });

  it("changed blueprint digest fails", () => {
    const keys = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys));
    pkg.receipt.blueprintDigest = VALID_SHA256_2;
    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature: pkg.signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid signature/i);
  });

  it("changed Genblaze manifest hash fails", () => {
    const keys = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys));
    pkg.receipt.genblazeManifestHash = VALID_SHA256_1;
    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature: pkg.signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid signature/i);
  });

  it("changed object key fails", () => {
    const keys = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys));
    pkg.receipt.assets[0].b2ObjectKey = "images/hacked.png";
    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature: pkg.signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid signature/i);
  });

  it("changed asset SHA-256 fails", () => {
    const keys = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys));
    pkg.receipt.assets[0].sha256 = VALID_SHA256_1;
    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature: pkg.signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid signature/i);
  });

  it("changed role fails", () => {
    const keys = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys));
    pkg.receipt.assets[0].role = "hacked";
    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature: pkg.signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid signature/i);
  });

  it("changed parent-version digest fails", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);
    opts.parentVersionDigest = VALID_SHA256_1;
    const pkg = createSignedMediaPackage(opts);
    pkg.receipt.parentVersionDigest = VALID_SHA256_2;
    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature: pkg.signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid signature/i);
  });

  it("duplicate asset ID rejected", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);
    opts.assets.push({
      ...opts.assets[0],
      b2ObjectKey: "images/other.png",
    });
    assert.throws(() => createSignedMediaPackage(opts), /duplicate asset ID/i);
  });

  it("duplicate B2 object key rejected", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);
    opts.assets.push({
      ...opts.assets[0],
      assetId: "asset-2",
    });
    assert.throws(() => createSignedMediaPackage(opts), /duplicate B2 object key/i);
  });

  it("verification rejects duplicate asset IDs and B2 object keys", () => {
    const keys = generateTestKeyPair();
    const duplicateId = createSignedMediaPackage(validOptions(keys));
    duplicateId.receipt.assets.push({
      ...duplicateId.receipt.assets[0],
      b2ObjectKey: "images/other.png",
    });
    const duplicateIdResult = verifySignedMediaPackage({
      receipt: duplicateId.receipt,
      signature: signEd25519(canonicalJson(duplicateId.receipt), keys.privateKey),
      publicKeyPem: keys.publicKey,
    });
    assert.equal(duplicateIdResult.ok, false);
    assert.match(duplicateIdResult.error, /duplicate asset ID/i);

    const duplicateKey = createSignedMediaPackage(validOptions(keys));
    duplicateKey.receipt.assets.push({
      ...duplicateKey.receipt.assets[0],
      assetId: "asset-2",
    });
    const duplicateKeyResult = verifySignedMediaPackage({
      receipt: duplicateKey.receipt,
      signature: signEd25519(canonicalJson(duplicateKey.receipt), keys.privateKey),
      publicKeyPem: keys.publicKey,
    });
    assert.equal(duplicateKeyResult.ok, false);
    assert.match(duplicateKeyResult.error, /duplicate B2 object key/i);
  });

  it("malformed SHA-256 rejected", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);
    opts.blueprintDigest = "short";
    assert.throws(() => createSignedMediaPackage(opts), /malformed blueprint digest/i);

    const opts2 = validOptions(keys);
    opts2.assets[0].sha256 = "invalid-hex-!";
    assert.throws(() => createSignedMediaPackage(opts2), /malformed SHA-256/i);
  });

  it("empty asset list rejected", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);
    opts.assets = [];
    assert.throws(() => createSignedMediaPackage(opts), /empty asset list/i);
  });

  it("invalid size rejected", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);
    opts.assets[0].byteSize = -1;
    assert.throws(() => createSignedMediaPackage(opts), /invalid size/i);
  });

  it("empty role rejected", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);
    opts.assets[0].role = " ";
    assert.throws(() => createSignedMediaPackage(opts), /empty role/i);
  });

  // Additional Tamper Tests
  it("changed artifact version fails", () => {
    const keys = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys));
    pkg.receipt.artifactVersion = "v2";
    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature: pkg.signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid signature/i);
  });

  it("changed asset byteSize fails", () => {
    const keys = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys));
    pkg.receipt.assets[0].byteSize = 2048;
    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature: pkg.signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid signature/i);
  });

  it("changed asset contentType fails", () => {
    const keys = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys));
    pkg.receipt.assets[0].contentType = "image/jpeg";
    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature: pkg.signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid signature/i);
  });

  // New Required Adversarial Tests

  it("verification rejects validly signed receipt with unknown top-level field", () => {
    const keys = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys));

    // Add unknown field
    pkg.receipt.hackedField = "evil";

    // Resign the receipt
    const canonical = canonicalJson(pkg.receipt);
    const signature = signEd25519(canonical, keys.privateKey);

    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /Unknown receipt field/i);
  });

  it("verification rejects validly signed asset descriptor with unknown field", () => {
    const keys = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys));

    pkg.receipt.assets[0].token = "secret";

    const canonical = canonicalJson(pkg.receipt);
    const signature = signEd25519(canonical, keys.privateKey);

    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /Unknown asset field/i);
  });

  it("verification rejects missing required receipt field", () => {
    const keys = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys));

    delete pkg.receipt.artifactId;

    const canonical = canonicalJson(pkg.receipt);
    const signature = signEd25519(canonical, keys.privateKey);

    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /Missing required receipt field/i);
  });

  it("verification rejects inherited required receipt fields without invoking getters", () => {
    const keys = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys));
    const receipt = Object.create({
      get artifactId() {
        throw new Error("getter must not run");
      },
    });
    const { artifactId, ...ownFields } = pkg.receipt;
    Object.assign(receipt, ownFields);

    const result = verifySignedMediaPackage({
      receipt,
      signature: signEd25519(canonicalJson(receipt), keys.privateKey),
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /Missing required receipt field: artifactId/i);
  });

  it("verification rejects bogus media format/version", () => {
    const keys = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys));

    pkg.receipt.version = "2.0";

    const canonical = canonicalJson(pkg.receipt);
    const signature = signEd25519(canonical, keys.privateKey);

    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /Invalid version/i);
  });

  it("verification rejects bogus signing algorithm", () => {
    const keys = generateTestKeyPair();
    const pkg = createSignedMediaPackage(validOptions(keys));

    pkg.receipt.signingAlgorithm = "RSA";

    const canonical = canonicalJson(pkg.receipt);
    const signature = signEd25519(canonical, keys.privateKey);

    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /Invalid signing algorithm/i);
  });

  it("verification rejects invalid creation timestamp", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);
    opts.createdAt = "not-a-date";
    assert.throws(() => createSignedMediaPackage(opts), /Invalid createdAt timestamp/i);

    const pkg = createSignedMediaPackage(validOptions(keys));
    pkg.receipt.createdAt = "2026-01-01T00:00:00Z"; // Missing .000
    const canonical = canonicalJson(pkg.receipt);
    const signature = signEd25519(canonical, keys.privateKey);

    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /Invalid createdAt timestamp/i);
  });

  it("verification rejects uppercase digest", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);
    opts.blueprintDigest = VALID_SHA256_1.toUpperCase();
    assert.throws(() => createSignedMediaPackage(opts), /Malformed blueprint digest/i);

    const pkg = createSignedMediaPackage(validOptions(keys));
    pkg.receipt.blueprintDigest = VALID_SHA256_1.toUpperCase();
    const canonical = canonicalJson(pkg.receipt);
    const signature = signEd25519(canonical, keys.privateKey);

    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /Invalid blueprintDigest/i);
  });

  it("rejects zero-byte asset", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);
    opts.assets[0].byteSize = 0;
    assert.throws(() => createSignedMediaPackage(opts), /Invalid size/i);

    const pkg = createSignedMediaPackage(validOptions(keys));
    pkg.receipt.assets[0].byteSize = 0;
    const canonical = canonicalJson(pkg.receipt);
    const signature = signEd25519(canonical, keys.privateKey);

    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /Invalid asset byteSize/i);
  });

  it("rejects 33 assets", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);
    const baseAsset = opts.assets[0];
    opts.assets = Array.from({ length: 33 }, (_, i) => ({
      ...baseAsset,
      assetId: `asset-${i}`,
      b2ObjectKey: `images/bg-${i}.png`,
    }));
    assert.throws(() => createSignedMediaPackage(opts), /Exceeded maximum assets limit/i);

    opts.assets = Array.from({ length: 32 }, (_, i) => ({
      ...baseAsset,
      assetId: `asset-${i}`,
      b2ObjectKey: `images/bg-${i}.png`,
    }));
    const pkg = createSignedMediaPackage(opts);
    assert.equal(pkg.receipt.assets.length, 32);

    pkg.receipt.assets.push({
      ...baseAsset,
      assetId: "asset-33",
      b2ObjectKey: "images/bg-33.png",
    });
    const canonical = canonicalJson(pkg.receipt);
    const signature = signEd25519(canonical, keys.privateKey);
    const result = verifySignedMediaPackage({
      receipt: pkg.receipt,
      signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /Invalid assets array/i);
  });

  it("rejects null or explicitly undefined parent digest", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);
    opts.parentVersionDigest = null;
    assert.throws(() => createSignedMediaPackage(opts), /Malformed parent-version digest/i);

    opts.parentVersionDigest = undefined;
    assert.throws(() => createSignedMediaPackage(opts), /explicitly undefined is rejected/i);
  });

  it("rejects malformed provider/model disclosure", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);
    opts.assets[0].provider = "   ";
    assert.throws(() => createSignedMediaPackage(opts), /Invalid provider format/i);

    opts.assets[0].provider = "valid";
    opts.assets[0].model = "A".repeat(129);
    assert.throws(() => createSignedMediaPackage(opts), /Invalid model format/i);
  });

  it("mutation of caller inputs after creation does not affect package", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);
    const pkg = createSignedMediaPackage(opts);

    opts.assets[0].byteSize = 9999;
    opts.artifactId = "hacked";

    assert.equal(pkg.receipt.assets[0].byteSize, 1024);
    assert.equal(pkg.receipt.artifactId, "art-123");
  });

  it("frozen caller inputs succeed", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);
    Object.freeze(opts.assets[0]);
    Object.freeze(opts.assets);
    Object.freeze(opts);

    const pkg = createSignedMediaPackage(opts);
    assert.equal(pkg.receipt.assets[0].byteSize, 1024);
  });

  it("prototype-supplied toJSON function cannot alter canonical data, bypass validation, or inject fields", () => {
    const keys = generateTestKeyPair();
    const opts = validOptions(keys);

    // Attempt 1: Malicious creation (injecting/altering via toJSON on options and assets)
    const maliciousAssetProto = {
      toJSON() {
        return { ...this, hacked: true, byteSize: 1 };
      }
    };
    const maliciousAsset = Object.create(maliciousAssetProto);
    Object.assign(maliciousAsset, opts.assets[0]);
    opts.assets = [maliciousAsset];

    const maliciousOptsProto = {
      toJSON() {
        return { ...this, artifactId: "evil-art", evil: "field" };
      }
    };
    const maliciousOpts = Object.create(maliciousOptsProto);
    Object.assign(maliciousOpts, opts);

    const pkg = createSignedMediaPackage(maliciousOpts);

    assert.equal(pkg.receipt.artifactId, "art-123", "artifactId should remain unchanged");
    assert.equal(pkg.receipt.assets[0].byteSize, 1024, "byteSize should remain unchanged");
    assert.equal(pkg.receipt.evil, undefined, "unknown receipt field must not be injected");
    assert.equal(pkg.receipt.assets[0].hacked, undefined, "unknown asset field must not be injected");

    // Attempt 2: Malicious verification (inject field, attempt to hide via toJSON)
    const tamperedReceiptProto = {
      toJSON() {
        return pkg.receipt; // return valid state
      }
    };
    const tamperedReceipt = Object.create(tamperedReceiptProto);
    Object.assign(tamperedReceipt, pkg.receipt);
    tamperedReceipt.unknownField = "injected";

    const result1 = verifySignedMediaPackage({
      receipt: tamperedReceipt,
      signature: pkg.signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result1.ok, false);
    assert.match(result1.error, /Unknown receipt field/i, "structural validation must catch unknown fields despite toJSON");

    // Attempt 3: Malicious verification (alter data, attempt to hide via toJSON)
    const tamperedReceipt2 = Object.create(tamperedReceiptProto);
    Object.assign(tamperedReceipt2, pkg.receipt);
    tamperedReceipt2.artifactId = "hacked-id";

    const result2 = verifySignedMediaPackage({
      receipt: tamperedReceipt2,
      signature: pkg.signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result2.ok, false);
    assert.match(result2.error, /invalid signature/i, "canonicalization must ignore toJSON and sign altered data");

    // Attempt 4: Array-level toJSON injection
    const maliciousAssetsArray = [{ ...pkg.receipt.assets[0], byteSize: 9999 }];
    maliciousAssetsArray.toJSON = function() {
      return pkg.receipt.assets;
    };
    const tamperedReceipt3 = { ...pkg.receipt, assets: maliciousAssetsArray };

    const result3 = verifySignedMediaPackage({
      receipt: tamperedReceipt3,
      signature: pkg.signature,
      publicKeyPem: keys.publicKey,
    });
    assert.equal(result3.ok, false);
    assert.match(result3.error, /invalid signature/i, "array toJSON must be ignored");
  });
});
