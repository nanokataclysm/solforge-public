import { verifyStoredAssets } from './b2-object-verifier.mjs';
import {
  createSignedMediaPackage,
  MAX_MEDIA_ASSETS,
  verifySignedMediaPackage
} from './media-provenance.mjs';

const OPTION_KEYS = [
  'artifactId', 'artifactVersion', 'blueprintDigest', 'genblazeManifestHash',
  'assets', 'references', 'getFileInfo', 'privateKeyPem', 'publicKeyPem',
  'createdAt', 'mode', 'parentVersionDigest'
];
const ASSET_KEYS = ['assetId', 'role', 'b2ObjectKey', 'sha256', 'byteSize', 'contentType', 'provider', 'model'];
const REFERENCE_KEYS = ['assetId', 'fileId'];
const REQUIRED_STRING_OPTION_KEYS = [
  'artifactId', 'artifactVersion', 'blueprintDigest', 'genblazeManifestHash',
  'privateKeyPem', 'publicKeyPem', 'createdAt'
];

function snapshotRecord(value, allowedKeys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return null;
    if (Object.getOwnPropertySymbols(value).length) return null;

    const snapshot = Object.create(null);
    for (const name of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !allowedKeys.includes(name)) return null;
      snapshot[name] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function snapshotArray(value, keys, maxLength) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length) return null;
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maxLength) return null;
    if (Object.getOwnPropertyNames(value).length !== length + 1) return null;

    const snapshot = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      const record = snapshotRecord(descriptor.value, keys);
      if (!record) return null;
      snapshot.push(record);
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function safeOptionsSnapshot(options) {
  const envelope = snapshotRecord(options, OPTION_KEYS);
  if (!envelope) return null;
  if (!REQUIRED_STRING_OPTION_KEYS.every(name => Object.hasOwn(envelope, name) && typeof envelope[name] === 'string')) {
    return { code: 'invalid_options' };
  }
  if ((Object.hasOwn(envelope, 'mode') && typeof envelope.mode !== 'string') ||
    (Object.hasOwn(envelope, 'parentVersionDigest') && typeof envelope.parentVersionDigest !== 'string')) {
    return { code: 'invalid_options' };
  }

  const assets = snapshotArray(envelope.assets, ASSET_KEYS, MAX_MEDIA_ASSETS);
  if (!assets) return { code: 'invalid_assets' };
  const references = snapshotArray(envelope.references, REFERENCE_KEYS, MAX_MEDIA_ASSETS);
  if (!references) return { code: 'invalid_references' };
  if (typeof envelope.getFileInfo !== 'function') return { code: 'invalid_options' };

  return {
    options: Object.freeze({ ...envelope, assets, references })
  };
}

/** Verify stored assets before signing their immutable provenance receipt. */
export async function forgeVerifiedMediaPackage(options) {
  const snapshot = safeOptionsSnapshot(options);
  if (!snapshot || snapshot.code) {
    return { ok: false, stage: 'stored_asset_verification', code: snapshot?.code ?? 'invalid_options' };
  }

  const verified = await verifyStoredAssets({
    assets: snapshot.options.assets,
    references: snapshot.options.references,
    getFileInfo: snapshot.options.getFileInfo
  });
  if (!verified.ok) {
    const failure = { ok: false, stage: 'stored_asset_verification', code: verified.code };
    if (typeof verified.assetId === 'string') failure.assetId = verified.assetId;
    return failure;
  }

  try {
    const signed = createSignedMediaPackage(snapshot.options);
    const signatureCheck = verifySignedMediaPackage({
      receipt: signed.receipt,
      signature: signed.signature,
      publicKeyPem: snapshot.options.publicKeyPem
    });
    if (!signatureCheck.ok) {
      return { ok: false, stage: 'signing', code: 'signing_failed' };
    }

    return {
      ok: true,
      verifiedAssets: verified.verifiedAssets,
      package: {
        receipt: signed.receipt,
        receiptDigest: signed.receiptDigest,
        signature: signed.signature,
        publicKeyFingerprint: signed.publicKeyFingerprint
      }
    };
  } catch {
    return { ok: false, stage: 'signing', code: 'signing_failed' };
  }
}
