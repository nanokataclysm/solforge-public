import test from "node:test";
import assert from "node:assert/strict";
import {
  snapshotVerifiedMediaPackageIntent,
  verifiedMediaPackageIntentDigest,
} from "../lib/verified-media-package-intent.mjs";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

function intent() {
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
  };
}

test("intent digest is canonical and defaults mode to preview", () => {
  const first = verifiedMediaPackageIntentDigest(intent());
  const reordered = verifiedMediaPackageIntentDigest({
    references: [{ fileId: "file-source", assetId: "source" }],
    assets: [
      {
        model: "qwen-image",
        provider: "qwen",
        contentType: "image/png",
        byteSize: 12,
        sha256: SHA_C,
        b2ObjectKey: "media/source.png",
        role: "source",
        assetId: "source",
      },
    ],
    createdAt: "2026-07-31T00:00:00.000Z",
    genblazeManifestHash: SHA_B,
    blueprintDigest: SHA_A,
    artifactVersion: "v1",
    artifactId: "artifact",
  });

  assert.equal(first.ok, true);
  assert.equal(reordered.ok, true);
  assert.equal(first.digest, reordered.digest);
  assert.equal(first.intent.mode, "preview");
});

test("intent snapshot is detached from caller mutation", () => {
  const input = intent();
  const result = snapshotVerifiedMediaPackageIntent(input);
  assert.equal(result.ok, true);

  input.artifactId = "changed";
  input.assets[0].b2ObjectKey = "changed.png";
  input.references[0].fileId = "changed-file";

  assert.equal(result.intent.artifactId, "artifact");
  assert.equal(result.intent.assets[0].b2ObjectKey, "media/source.png");
  assert.equal(result.intent.references[0].fileId, "file-source");
});

test("intent rejects malformed options and unknown fields", () => {
  assert.deepEqual(
    snapshotVerifiedMediaPackageIntent({ ...intent(), createdAt: "not-a-date" }),
    { ok: false, code: "invalid_options" },
  );
  assert.deepEqual(
    snapshotVerifiedMediaPackageIntent({ ...intent(), mode: "" }),
    { ok: false, code: "invalid_options" },
  );
  assert.deepEqual(
    snapshotVerifiedMediaPackageIntent({ ...intent(), privateKeyPem: "secret" }),
    { ok: false, code: "invalid_options" },
  );
});

test("intent rejects malformed assets", () => {
  const duplicate = intent();
  duplicate.assets.push({ ...duplicate.assets[0] });
  duplicate.references.push({ assetId: "source", fileId: "other" });
  assert.deepEqual(
    snapshotVerifiedMediaPackageIntent(duplicate),
    { ok: false, code: "invalid_assets" },
  );

  const unknown = intent();
  unknown.assets[0].secret = "no";
  assert.deepEqual(
    snapshotVerifiedMediaPackageIntent(unknown),
    { ok: false, code: "invalid_assets" },
  );
});

test("intent requires one exact reference per asset", () => {
  const missing = intent();
  missing.references = [];
  assert.deepEqual(
    snapshotVerifiedMediaPackageIntent(missing),
    { ok: false, code: "invalid_references" },
  );

  const unexpected = intent();
  unexpected.references = [{ assetId: "other", fileId: "file-other" }];
  assert.deepEqual(
    snapshotVerifiedMediaPackageIntent(unexpected),
    { ok: false, code: "invalid_references" },
  );
});
