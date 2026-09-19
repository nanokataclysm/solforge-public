import { MAX_MEDIA_ASSETS } from "./media-provenance.mjs";
import { canonicalJson, sha256 } from "./signing.mjs";

const INTENT_KEYS = [
  "artifactId",
  "artifactVersion",
  "blueprintDigest",
  "genblazeManifestHash",
  "assets",
  "references",
  "createdAt",
  "mode",
  "parentVersionDigest",
];
const ASSET_KEYS = [
  "assetId",
  "role",
  "b2ObjectKey",
  "sha256",
  "byteSize",
  "contentType",
  "provider",
  "model",
];
const REFERENCE_KEYS = ["assetId", "fileId"];
const SHA256_LOWER = /^[0-9a-f]{64}$/;

function snapshotRecord(value, allowedKeys) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length) return null;

    const snapshot = Object.create(null);
    for (const name of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
      if (!allowedKeys.includes(name)) return null;
      snapshot[name] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function snapshotArray(value, allowedKeys) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return null;
    }
    if (Object.getOwnPropertySymbols(value).length) return null;
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length) || length < 1 || length > MAX_MEDIA_ASSETS) {
      return null;
    }
    if (Object.getOwnPropertyNames(value).length !== length + 1) return null;

    const snapshot = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
      const record = snapshotRecord(descriptor.value, allowedKeys);
      if (!record) return null;
      snapshot.push(Object.freeze(record));
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function validMetadata(value) {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= 128 &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}

export function snapshotVerifiedMediaPackageIntent(value) {
  const envelope = snapshotRecord(value, INTENT_KEYS);
  if (
    !envelope ||
    !nonEmptyString(envelope.artifactId) ||
    !envelope.artifactId.trim() ||
    !nonEmptyString(envelope.artifactVersion) ||
    !envelope.artifactVersion.trim() ||
    !SHA256_LOWER.test(envelope.blueprintDigest) ||
    !SHA256_LOWER.test(envelope.genblazeManifestHash) ||
    !nonEmptyString(envelope.createdAt)
  ) {
    return { ok: false, code: "invalid_options" };
  }

  const created = new Date(envelope.createdAt);
  if (Number.isNaN(created.getTime()) || created.toISOString() !== envelope.createdAt) {
    return { ok: false, code: "invalid_options" };
  }
  if (
    Object.hasOwn(envelope, "mode") &&
    (!nonEmptyString(envelope.mode) || !envelope.mode.trim())
  ) {
    return { ok: false, code: "invalid_options" };
  }
  if (
    Object.hasOwn(envelope, "parentVersionDigest") &&
    !SHA256_LOWER.test(envelope.parentVersionDigest)
  ) {
    return { ok: false, code: "invalid_options" };
  }

  const assets = snapshotArray(envelope.assets, ASSET_KEYS);
  if (!assets) return { ok: false, code: "invalid_assets" };
  const assetIds = new Set();
  const objectKeys = new Set();
  for (const asset of assets) {
    if (
      !nonEmptyString(asset.assetId) ||
      !nonEmptyString(asset.role) ||
      !asset.role.trim() ||
      !nonEmptyString(asset.b2ObjectKey) ||
      !SHA256_LOWER.test(asset.sha256) ||
      !Number.isSafeInteger(asset.byteSize) ||
      asset.byteSize <= 0 ||
      !nonEmptyString(asset.contentType) ||
      (Object.hasOwn(asset, "provider") && !validMetadata(asset.provider)) ||
      (Object.hasOwn(asset, "model") && !validMetadata(asset.model)) ||
      assetIds.has(asset.assetId) ||
      objectKeys.has(asset.b2ObjectKey)
    ) {
      return { ok: false, code: "invalid_assets" };
    }
    assetIds.add(asset.assetId);
    objectKeys.add(asset.b2ObjectKey);
  }

  const references = snapshotArray(envelope.references, REFERENCE_KEYS);
  if (!references) return { ok: false, code: "invalid_references" };
  const referencedIds = new Set();
  for (const reference of references) {
    if (
      !nonEmptyString(reference.assetId) ||
      !nonEmptyString(reference.fileId) ||
      referencedIds.has(reference.assetId) ||
      !assetIds.has(reference.assetId)
    ) {
      return { ok: false, code: "invalid_references" };
    }
    referencedIds.add(reference.assetId);
  }
  if (referencedIds.size !== assetIds.size) {
    return { ok: false, code: "invalid_references" };
  }

  const intent = {
    artifactId: envelope.artifactId,
    artifactVersion: envelope.artifactVersion,
    blueprintDigest: envelope.blueprintDigest,
    genblazeManifestHash: envelope.genblazeManifestHash,
    assets,
    references,
    createdAt: envelope.createdAt,
    mode: Object.hasOwn(envelope, "mode") ? envelope.mode : "preview",
  };
  if (Object.hasOwn(envelope, "parentVersionDigest")) {
    intent.parentVersionDigest = envelope.parentVersionDigest;
  }
  return { ok: true, intent: Object.freeze(intent) };
}

export function verifiedMediaPackageIntentDigest(value) {
  const snapshot = snapshotVerifiedMediaPackageIntent(value);
  if (!snapshot.ok) return snapshot;
  return {
    ok: true,
    intent: snapshot.intent,
    digest: sha256(canonicalJson(snapshot.intent)),
  };
}
