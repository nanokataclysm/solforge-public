/**
 * Ed25519 signing for Solforge / NANOKAT packages.
 * Server-side only — private key never leaves the server.
 *
 * Order: files → per-file digests → canonical manifest → receipt → sign receipt.
 * API returns signed JSON (manifest + receipt + signature + file payloads metadata).
 * A downloadable ZIP container is a later packaging step and is not required for verify.
 */

export const DEV_SIGNING_ISSUER = "solforge-dev";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Canonical JSON for signing: sort object keys recursively.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return JSON.stringify(sortKeysDeep(value));
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeysDeep(value[key]);
    }
    return out;
  }
  return value;
}

/**
 * Compute SHA-256 digest of content.
 * @param {string | Buffer} content
 * @returns {string} hex digest
 */
export function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Compute SHA-256 fingerprint of a public key PEM.
 * @param {string} publicKeyPem
 * @returns {string} hex fingerprint
 */
export function publicKeyFingerprint(publicKeyPem) {
  const normalized = normalizePublicKeyPem(publicKeyPem)
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  return sha256(normalized);
}

/**
 * Ensure SPKI public key material is full PEM (Vercel env sometimes stores body only).
 * @param {string} value
 * @returns {string}
 */
export function normalizePublicKeyPem(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes("BEGIN PUBLIC KEY")) {
    return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  }
  // bare base64 SPKI
  const b64 = trimmed.replace(/\s+/g, "");
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

/**
 * Ensure PKCS8 private key material is full PEM when env stores body only.
 * @param {string} value
 * @returns {string}
 */
export function normalizePrivateKeyPem(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes("BEGIN") && trimmed.includes("PRIVATE KEY")) {
    return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  }
  const b64 = trimmed.replace(/\s+/g, "");
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`; // gitleaks:allow -- PEM envelope template; contains no key material
}

/**
 * Sign data with Ed25519 private key.
 * @param {string | Buffer} data - Data to sign
 * @param {string} privateKeyPem - Ed25519 private key in PEM format
 * @returns {string} Base64-encoded signature
 */
export function signEd25519(data, privateKeyPem) {
  const key = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(data), key);
  return signature.toString("base64");
}

/**
 * Verify Ed25519 signature.
 * @param {string | Buffer} data - Original data
 * @param {string} signatureBase64 - Base64-encoded signature
 * @param {string} publicKeyPem - Ed25519 public key in PEM format
 * @returns {boolean} True if signature is valid
 */
export function verifyEd25519(data, signatureBase64, publicKeyPem) {
  try {
    const key = crypto.createPublicKey(publicKeyPem);
    const signature = Buffer.from(signatureBase64, "base64");
    return crypto.verify(null, Buffer.from(data), key, signature);
  } catch {
    return false;
  }
}

/**
 * Load Ed25519 private key from environment or filesystem.
 * Prefers NANOKAT_SIGNING_PRIVATE_KEY_PEM env var (for Vercel),
 * falls back to filesystem path for local development.
 * @param {string} [keyPath] - Path to private key PEM file
 * @returns {Promise<string>} Private key PEM
 */
export async function loadPrivateKey(keyPath) {
  // Prefer PEM content from environment variable (Vercel deployment)
  if (process.env.NANOKAT_SIGNING_PRIVATE_KEY_PEM) {
    return normalizePrivateKeyPem(process.env.NANOKAT_SIGNING_PRIVATE_KEY_PEM);
  }

  // Fall back to filesystem for local development
  const path =
    keyPath ??
    process.env.NANOKAT_SIGNING_PRIVATE_KEY_PATH ??
    ".nanokat/keys/demo-signing-private.pem";
  try {
    return normalizePrivateKeyPem(await fs.readFile(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Failed to load signing private key from ${path}: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

/**
 * Load Ed25519 public key from environment or filesystem.
 * Prefers NANOKAT_SIGNING_PUBLIC_KEY_PEM env var (for Vercel),
 * falls back to filesystem path for local development.
 * @param {string} [keyPath] - Path to public key PEM file
 * @returns {Promise<string>} Public key PEM
 */
export async function loadPublicKey(keyPath) {
  // Prefer PEM content from environment variable (Vercel deployment)
  if (process.env.NANOKAT_SIGNING_PUBLIC_KEY_PEM) {
    return normalizePublicKeyPem(process.env.NANOKAT_SIGNING_PUBLIC_KEY_PEM);
  }

  // Fall back to filesystem for local development
  const path =
    keyPath ??
    process.env.NANOKAT_SIGNING_PUBLIC_KEY_PATH ??
    ".nanokat/keys/demo-signing-public.pem";
  try {
    return normalizePublicKeyPem(await fs.readFile(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Failed to load signing public key from ${path}: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

/**
 * Create a signed package manifest and receipt.
 *
 * @param {{
 *   requestId: string,
 *   plan: unknown,
 *   files: Array<{ name: string, content: string }>,
 *   parentVersionDigest?: string,
 *   privateKeyPem: string,
 *   publicKeyPem: string,
 *   mode?: string,
 *   model?: string,
 * }} options
 * @returns {{
 *   manifest: object,
 *   manifestDigest: string,
 *   receipt: object,
 *   receiptDigest: string,
 *   signature: string,
 *   publicKeyFingerprint: string,
 * }}
 */
export function createSignedPackage(options) {
  const {
    requestId,
    plan,
    files,
    parentVersionDigest,
    privateKeyPem,
    publicKeyPem,
    mode = "preview",
    model = "qwen-plus",
  } = options;

  // 1. Compute per-file digests
  const fileDigests = files.map((file) => ({
    name: file.name,
    digest: sha256(file.content),
    size: Buffer.byteLength(file.content, "utf8"),
  }));

  // 2. Create canonical manifest
  const manifest = {
    version: "1.0",
    requestId,
    createdAt: new Date().toISOString(),
    planDigest: sha256(canonicalJson(plan)),
    files: fileDigests,
    ...(parentVersionDigest ? { parentVersionDigest } : {}),
  };
  const manifestCanonical = canonicalJson(manifest);
  const manifestDigest = sha256(manifestCanonical);

  // 3. Create receipt (includes manifest digest)
  const receipt = {
    version: "1.0",
    manifestDigest,
    issuer: DEV_SIGNING_ISSUER,
    issuerId: publicKeyFingerprint(publicKeyPem),
    createdAt: manifest.createdAt,
    mode,
    model,
    signingAlgorithm: "Ed25519",
  };
  const receiptCanonical = canonicalJson(receipt);
  const receiptDigest = sha256(receiptCanonical);

  // 4. Sign the canonical receipt
  const signature = signEd25519(receiptCanonical, privateKeyPem);

  return {
    manifest,
    manifestDigest,
    receipt,
    receiptDigest,
    signature,
    publicKeyFingerprint: receipt.issuerId,
  };
}

/**
 * Verify a signed package.
 *
 * @param {{
 *   manifest: object,
 *   receipt: object,
 *   signature: string,
 *   publicKeyPem: string,
 *   files: Array<{ name: string, content: string }>,
 * }} options
 * @returns {{ ok: boolean, error?: string, details?: object }}
 */
export function verifySignedPackage(options) {
  const { manifest, receipt, signature, publicKeyPem, files } = options;

  try {
    // 1. Verify receipt signature
    const receiptCanonical = canonicalJson(receipt);
    const signatureValid = verifyEd25519(receiptCanonical, signature, publicKeyPem);
    if (!signatureValid) {
      return { ok: false, error: "Invalid signature" };
    }

    // 2. Verify receipt digest matches manifest digest
    const manifestCanonical = canonicalJson(manifest);
    const manifestDigest = sha256(manifestCanonical);
    if (receipt.manifestDigest !== manifestDigest) {
      return {
        ok: false,
        error: "Receipt manifest digest does not match computed manifest digest",
        details: {
          expected: receipt.manifestDigest,
          computed: manifestDigest,
        },
      };
    }

    // 3. Verify file digests
    const fileDigests = files.map((file) => ({
      name: file.name,
      digest: sha256(file.content),
    }));

    for (const manifestFile of manifest.files) {
      const actualFile = fileDigests.find((f) => f.name === manifestFile.name);
      if (!actualFile) {
        return {
          ok: false,
          error: `File ${manifestFile.name} in manifest not found in package`,
        };
      }
      if (actualFile.digest !== manifestFile.digest) {
        return {
          ok: false,
          error: `File ${manifestFile.name} digest mismatch`,
          details: {
            expected: manifestFile.digest,
            computed: actualFile.digest,
          },
        };
      }
    }

    // 4. Verify public key fingerprint
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
