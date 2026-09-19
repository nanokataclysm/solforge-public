import {
  canonicalJson,
  sha256,
  publicKeyFingerprint,
  signEd25519,
  verifyEd25519,
  DEV_SIGNING_ISSUER,
} from "./signing.mjs";

const SHA256_REGEX_LOWER = /^[0-9a-f]{64}$/;
export const MAX_MEDIA_ASSETS = 32;

/**
 * Create a signed media package receipt.
 */
export function createSignedMediaPackage(options) {
  if (!options || typeof options !== "object") throw new Error("Missing options");

  const {
    artifactId,
    artifactVersion,
    blueprintDigest,
    genblazeManifestHash,
    assets,
    privateKeyPem,
    publicKeyPem,
    createdAt,
    mode = "preview",
  } = options;

  if (typeof artifactId !== "string" || artifactId.trim() === "") throw new Error("Missing artifact ID");
  if (typeof artifactVersion !== "string" || artifactVersion.trim() === "") throw new Error("Missing artifact version");

  if (!blueprintDigest || !SHA256_REGEX_LOWER.test(blueprintDigest)) {
    throw new Error("Malformed blueprint digest");
  }

  if (!genblazeManifestHash || !SHA256_REGEX_LOWER.test(genblazeManifestHash)) {
    throw new Error("Malformed Genblaze manifest hash");
  }

  if ('parentVersionDigest' in options) {
    if (options.parentVersionDigest === undefined) {
      throw new Error("parentVersionDigest explicitly undefined is rejected");
    }
    if (typeof options.parentVersionDigest !== "string" || !SHA256_REGEX_LOWER.test(options.parentVersionDigest)) {
      throw new Error("Malformed parent-version digest");
    }
  }

  if (!createdAt || typeof createdAt !== "string") {
    throw new Error("Missing or invalid createdAt");
  }
  const dateObj = new Date(createdAt);
  if (Number.isNaN(dateObj.getTime()) || dateObj.toISOString() !== createdAt) {
    throw new Error("Invalid createdAt timestamp. Must be canonical UTC ISO-8601");
  }

  if (!assets || !Array.isArray(assets) || assets.length === 0) {
    throw new Error("Empty asset list rejected");
  }

  if (assets.length > MAX_MEDIA_ASSETS) {
    throw new Error(`Exceeded maximum assets limit of ${MAX_MEDIA_ASSETS}`);
  }

  const assetIds = new Set();
  const b2ObjectKeys = new Set();
  const validAssets = [];
  const allowedAssetKeys = new Set([
    "assetId", "role", "b2ObjectKey", "sha256", "byteSize", "contentType", "provider", "model"
  ]);

  for (const asset of assets) {
    if (!asset || typeof asset !== "object") throw new Error("Invalid asset structure");

    for (const key of Object.keys(asset)) {
      if (!allowedAssetKeys.has(key)) {
        throw new Error(`Unknown asset field rejected: ${key}`);
      }
    }

    if (!asset.assetId) throw new Error("Missing assetId");
    if (assetIds.has(asset.assetId)) throw new Error("Duplicate asset ID rejected");
    assetIds.add(asset.assetId);

    if (!asset.b2ObjectKey) throw new Error("Missing b2ObjectKey");
    if (b2ObjectKeys.has(asset.b2ObjectKey)) throw new Error("Duplicate B2 object key rejected");
    b2ObjectKeys.add(asset.b2ObjectKey);

    if (!asset.role || typeof asset.role !== "string" || asset.role.trim() === "") {
      throw new Error("Empty role rejected");
    }

    if (!asset.sha256 || !SHA256_REGEX_LOWER.test(asset.sha256)) {
      throw new Error("Malformed SHA-256 rejected");
    }

    if (
      typeof asset.byteSize !== "number" ||
      asset.byteSize <= 0 ||
      !Number.isInteger(asset.byteSize) ||
      asset.byteSize > Number.MAX_SAFE_INTEGER
    ) {
      throw new Error("Invalid size rejected");
    }

    if (!asset.contentType || typeof asset.contentType !== "string") {
      throw new Error("Missing content type");
    }

    if ('provider' in asset) {
      const { provider } = asset;
      if (typeof provider !== "string" || provider.trim() !== provider || provider.length === 0 || provider.length > 128 || /[\x00-\x1F\x7F]/.test(provider)) {
        throw new Error("Invalid provider format");
      }
    }

    if ('model' in asset) {
      const { model } = asset;
      if (typeof model !== "string" || model.trim() !== model || model.length === 0 || model.length > 128 || /[\x00-\x1F\x7F]/.test(model)) {
        throw new Error("Invalid model format");
      }
    }

    const validAsset = {
      assetId: asset.assetId,
      role: asset.role,
      b2ObjectKey: asset.b2ObjectKey,
      sha256: asset.sha256,
      byteSize: asset.byteSize,
      contentType: asset.contentType,
    };

    if ('provider' in asset) validAsset.provider = asset.provider;
    if ('model' in asset) validAsset.model = asset.model;

    validAssets.push(validAsset);
  }

  const receipt = {
    version: "1.0",
    artifactId,
    artifactVersion,
    blueprintDigest,
    genblazeManifestHash,
    assets: validAssets,
    issuer: DEV_SIGNING_ISSUER,
    issuerId: publicKeyFingerprint(publicKeyPem),
    createdAt,
    mode,
    signingAlgorithm: "Ed25519",
  };

  if ('parentVersionDigest' in options) {
    receipt.parentVersionDigest = options.parentVersionDigest;
  }

  const receiptCanonical = canonicalJson(receipt);
  const receiptDigest = sha256(receiptCanonical);
  const signature = signEd25519(receiptCanonical, privateKeyPem);

  return {
    receipt,
    receiptDigest,
    signature,
    publicKeyFingerprint: receipt.issuerId,
  };
}

/**
 * Verify a signed media package.
 */
export function verifySignedMediaPackage(options) {
  if (!options || typeof options !== "object") {
    return { ok: false, error: "Missing options" };
  }

  const { receipt, signature, publicKeyPem } = options;

  if (typeof signature !== "string") return { ok: false, error: "Invalid signature encoding" };
  if (typeof publicKeyPem !== "string") return { ok: false, error: "Invalid public key encoding" };

  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return { ok: false, error: "Malformed receipt structure" };
  }

  const allowedReceiptKeys = new Set([
    "version", "artifactId", "artifactVersion", "blueprintDigest",
    "genblazeManifestHash", "assets", "issuer", "issuerId",
    "createdAt", "mode", "signingAlgorithm", "parentVersionDigest"
  ]);

  for (const key of Object.keys(receipt)) {
    if (!allowedReceiptKeys.has(key)) {
      return { ok: false, error: `Unknown receipt field: ${key}` };
    }
  }

  const requiredFields = [
    "version", "artifactId", "artifactVersion", "blueprintDigest",
    "genblazeManifestHash", "assets", "issuer", "issuerId",
    "createdAt", "mode", "signingAlgorithm"
  ];

  for (const field of requiredFields) {
    const descriptor = Object.getOwnPropertyDescriptor(receipt, field);
    if (!descriptor || !("value" in descriptor)) {
      return { ok: false, error: `Missing required receipt field: ${field}` };
    }
  }

  if (receipt.version !== "1.0") return { ok: false, error: "Invalid version" };
  if (receipt.signingAlgorithm !== "Ed25519") return { ok: false, error: "Invalid signing algorithm" };
  if (receipt.issuer !== DEV_SIGNING_ISSUER) return { ok: false, error: "Invalid issuer" };
  if (typeof receipt.mode !== "string" || receipt.mode === "") return { ok: false, error: "Invalid signing mode" };

  if (typeof receipt.artifactId !== "string" || receipt.artifactId.trim() === "") return { ok: false, error: "Invalid artifactId" };
  if (typeof receipt.artifactVersion !== "string" || receipt.artifactVersion.trim() === "") return { ok: false, error: "Invalid artifactVersion" };

  if (!SHA256_REGEX_LOWER.test(receipt.blueprintDigest)) return { ok: false, error: "Invalid blueprintDigest" };
  if (!SHA256_REGEX_LOWER.test(receipt.genblazeManifestHash)) return { ok: false, error: "Invalid genblazeManifestHash" };
  if (!SHA256_REGEX_LOWER.test(receipt.issuerId)) return { ok: false, error: "Invalid issuerId" };

  if (Object.hasOwn(receipt, 'parentVersionDigest')) {
    if (typeof receipt.parentVersionDigest !== "string" || !SHA256_REGEX_LOWER.test(receipt.parentVersionDigest)) {
      return { ok: false, error: "Invalid parentVersionDigest" };
    }
  }

  if (typeof receipt.createdAt !== "string") return { ok: false, error: "Invalid createdAt" };
  const dateObj = new Date(receipt.createdAt);
  if (Number.isNaN(dateObj.getTime()) || dateObj.toISOString() !== receipt.createdAt) {
    return { ok: false, error: "Invalid createdAt timestamp" };
  }

  if (!Array.isArray(receipt.assets) || receipt.assets.length === 0 || receipt.assets.length > MAX_MEDIA_ASSETS) {
    return { ok: false, error: "Invalid assets array" };
  }

  const allowedAssetKeys = new Set([
    "assetId", "role", "b2ObjectKey", "sha256", "byteSize", "contentType", "provider", "model"
  ]);
  const assetIds = new Set();
  const b2ObjectKeys = new Set();

  for (const asset of receipt.assets) {
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
      return { ok: false, error: "Malformed asset structure" };
    }
    for (const key of Object.keys(asset)) {
      if (!allowedAssetKeys.has(key)) {
        return { ok: false, error: `Unknown asset field: ${key}` };
      }
    }
    if (typeof asset.assetId !== "string" || asset.assetId === "") return { ok: false, error: "Invalid assetId" };
    if (assetIds.has(asset.assetId)) return { ok: false, error: "Duplicate asset ID rejected" };
    assetIds.add(asset.assetId);
    if (typeof asset.role !== "string" || asset.role.trim() === "") return { ok: false, error: "Invalid role" };
    if (typeof asset.b2ObjectKey !== "string" || asset.b2ObjectKey === "") return { ok: false, error: "Invalid b2ObjectKey" };
    if (b2ObjectKeys.has(asset.b2ObjectKey)) return { ok: false, error: "Duplicate B2 object key rejected" };
    b2ObjectKeys.add(asset.b2ObjectKey);
    if (typeof asset.contentType !== "string" || asset.contentType === "") return { ok: false, error: "Invalid contentType" };
    if (!SHA256_REGEX_LOWER.test(asset.sha256)) return { ok: false, error: "Invalid asset sha256" };
    if (typeof asset.byteSize !== "number" || !Number.isInteger(asset.byteSize) || asset.byteSize <= 0 || asset.byteSize > Number.MAX_SAFE_INTEGER) {
      return { ok: false, error: "Invalid asset byteSize" };
    }
    if ('provider' in asset) {
      const { provider } = asset;
      if (typeof provider !== "string" || provider.trim() !== provider || provider.length === 0 || provider.length > 128 || /[\x00-\x1F\x7F]/.test(provider)) {
        return { ok: false, error: "Invalid asset provider" };
      }
    }
    if ('model' in asset) {
      const { model } = asset;
      if (typeof model !== "string" || model.trim() !== model || model.length === 0 || model.length > 128 || /[\x00-\x1F\x7F]/.test(model)) {
        return { ok: false, error: "Invalid asset model" };
      }
    }
  }

  try {
    const receiptCanonical = canonicalJson(receipt);
    const signatureValid = verifyEd25519(receiptCanonical, signature, publicKeyPem);
    if (!signatureValid) {
      return { ok: false, error: "Invalid signature" };
    }

    const expectedFingerprint = publicKeyFingerprint(publicKeyPem);
    if (receipt.issuerId !== expectedFingerprint) {
      return {
        ok: false,
        error: "Receipt issuer ID does not match public key fingerprint",
        details: {
          expected: expectedFingerprint,
          received: receipt.issuerId,
        },
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Verification failed",
    };
  }
}
