import {
  canonicalJson,
  publicKeyFingerprint,
  sha256,
} from "./signing.mjs";
import { verifySignedMediaPackage } from "./media-provenance.mjs";

const SHA256_LOWER = /^[0-9a-f]{64}$/;

function failure(stage, code) {
  return { ok: false, stage, code };
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (Object.getOwnPropertySymbols(value).length !== 0) return null;
  return value;
}

function dataValue(record, name) {
  const descriptor = Object.getOwnPropertyDescriptor(record, name);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) return undefined;
  return descriptor.value;
}

function cleanString(value, maxLength = 16_384) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}

function publicKeyString(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 16_384 &&
    value.trim().length > 0 &&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
  );
}

/**
 * Independently verify a verified-media package response against the public
 * signing-key document returned by GET /api/signing/public-key.
 *
 * Supplying expectedFingerprint pins the verification to a trust anchor that
 * was obtained out of band. Without it, the signature is still verified but
 * key continuity depends on the HTTPS endpoint used to fetch the key document.
 *
 * @param {{
 *   packageResponse: unknown,
 *   publicKeyDocument: unknown,
 *   expectedFingerprint?: string,
 * }} options
 */
export function verifyIndependentMediaPackage(options = {}) {
  try {
    const input = plainRecord(options);
    const packageResponse = plainRecord(
      input ? dataValue(input, "packageResponse") : null,
    );
    const publicKeyDocument = plainRecord(
      input ? dataValue(input, "publicKeyDocument") : null,
    );
    const expectedFingerprint = input
      ? dataValue(input, "expectedFingerprint")
      : undefined;

    if (!packageResponse) return failure("input", "invalid_package_response");
    if (!publicKeyDocument) {
      return failure("input", "invalid_public_key_document");
    }
    if (
      expectedFingerprint !== undefined &&
      !SHA256_LOWER.test(expectedFingerprint)
    ) {
      return failure("input", "invalid_expected_fingerprint");
    }

    const keyDocumentOk = dataValue(publicKeyDocument, "ok");
    const publicKeyPem = dataValue(publicKeyDocument, "publicKey");
    const documentFingerprint = dataValue(publicKeyDocument, "fingerprint");
    const documentAlgorithm = dataValue(publicKeyDocument, "algorithm");
    const documentIssuer = dataValue(publicKeyDocument, "issuer");

    if (
      keyDocumentOk !== true ||
      !publicKeyString(publicKeyPem) ||
      !SHA256_LOWER.test(documentFingerprint) ||
      documentAlgorithm !== "Ed25519" ||
      !cleanString(documentIssuer, 128)
    ) {
      return failure("public_key_document", "invalid_public_key_document");
    }

    const computedFingerprint = publicKeyFingerprint(publicKeyPem);
    if (computedFingerprint !== documentFingerprint) {
      return failure("public_key_document", "fingerprint_mismatch");
    }

    if (
      expectedFingerprint !== undefined &&
      computedFingerprint !== expectedFingerprint
    ) {
      return failure("pin", "fingerprint_mismatch");
    }

    const receipt = dataValue(packageResponse, "receipt");
    const receiptDigest = dataValue(packageResponse, "receiptDigest");
    const signature = dataValue(packageResponse, "signature");
    const packageFingerprint = dataValue(
      packageResponse,
      "publicKeyFingerprint",
    );
    const packageAlgorithm = dataValue(packageResponse, "signingAlgorithm");
    const packageIssuer = dataValue(packageResponse, "issuer");

    if (
      !plainRecord(receipt) ||
      !SHA256_LOWER.test(receiptDigest) ||
      !cleanString(signature) ||
      !SHA256_LOWER.test(packageFingerprint) ||
      packageAlgorithm !== "Ed25519" ||
      packageIssuer !== documentIssuer
    ) {
      return failure("package", "invalid_package_response");
    }

    if (packageFingerprint !== computedFingerprint) {
      return failure("key_binding", "package_fingerprint_mismatch");
    }

    const receiptIssuerId = dataValue(receipt, "issuerId");
    const receiptIssuer = dataValue(receipt, "issuer");
    const receiptAlgorithm = dataValue(receipt, "signingAlgorithm");
    if (
      receiptIssuerId !== computedFingerprint ||
      receiptIssuer !== documentIssuer ||
      receiptAlgorithm !== "Ed25519"
    ) {
      return failure("key_binding", "receipt_identity_mismatch");
    }

    const signatureCheck = verifySignedMediaPackage({
      receipt,
      signature,
      publicKeyPem,
    });
    if (!signatureCheck.ok) {
      return failure("signature", "signature_verification_failed");
    }

    const computedReceiptDigest = sha256(canonicalJson(receipt));
    if (computedReceiptDigest !== receiptDigest) {
      return failure("receipt", "receipt_digest_mismatch");
    }

    return {
      ok: true,
      signatureVerified: true,
      receiptDigestVerified: true,
      publicKeyDocumentVerified: true,
      packageFingerprintVerified: true,
      pinVerified: expectedFingerprint === undefined ? null : true,
      trustMode: expectedFingerprint === undefined ? "endpoint-only" : "pinned",
      fingerprint: computedFingerprint,
      algorithm: "Ed25519",
      issuer: documentIssuer,
    };
  } catch {
    return failure("input", "verification_failed");
  }
}
