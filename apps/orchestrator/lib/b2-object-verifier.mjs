// apps/orchestrator/lib/b2-object-verifier.mjs

const ALLOWED_OPTION_KEYS = ['assets', 'references', 'getFileInfo'];
const ALLOWED_ASSET_KEYS = [
  'assetId', 'role', 'b2ObjectKey', 'sha256', 'byteSize', 'contentType', 'provider', 'model'
];
const REQUIRED_REFERENCE_KEYS = ['assetId', 'fileId'];
const B2_KEYS = ['action', 'fileId', 'fileName', 'contentLength', 'contentType', 'fileInfo'];

function plainRecordSnapshot(value, allowedKeys, exactKeys = false, rejectUnknown = true) {
  try {
    if (!value || typeof value !== 'object') return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length) return null;

    const names = Object.getOwnPropertyNames(value);
    const snapshot = Object.create(null);
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      if (!allowedKeys.includes(name)) {
        if (rejectUnknown) return null;
        continue;
      }
      snapshot[name] = descriptor.value;
    }
    if (exactKeys && (names.length !== allowedKeys.length || !allowedKeys.every(key => Object.hasOwn(snapshot, key)))) return null;
    return snapshot;
  } catch {
    return null;
  }
}

function arraySnapshot(value) {
  try {
    if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')) return null;
    const { value: length } = lengthDescriptor;
    const names = Object.getOwnPropertyNames(value);
    if (names.length !== length + 1) return null;
    const snapshot = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isTrimmedMetadata(value) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value);
}

function isValidSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export async function verifyStoredAssets(options) {
  const safeOptions = plainRecordSnapshot(options, ALLOWED_OPTION_KEYS, true);
  if (!safeOptions || typeof safeOptions.getFileInfo !== 'function') {
    return { ok: false, code: 'invalid_options' };
  }

  const assets = arraySnapshot(safeOptions.assets);
  if (!assets || assets.length < 1 || assets.length > 32) return { ok: false, code: 'invalid_assets' };

  const safeAssets = [];
  const assetIdSet = new Set();
  const objectKeySet = new Set();
  for (const asset of assets) {
    const safeAsset = plainRecordSnapshot(asset, ALLOWED_ASSET_KEYS);
    if (!safeAsset ||
      !isNonEmptyString(safeAsset.assetId) ||
      !isNonEmptyString(safeAsset.role) || !safeAsset.role.trim() ||
      !isNonEmptyString(safeAsset.b2ObjectKey) ||
      !isValidSha256(safeAsset.sha256) ||
      !Number.isSafeInteger(safeAsset.byteSize) || safeAsset.byteSize <= 0 ||
      !isNonEmptyString(safeAsset.contentType) ||
      (Object.hasOwn(safeAsset, 'provider') && !isTrimmedMetadata(safeAsset.provider)) ||
      (Object.hasOwn(safeAsset, 'model') && !isTrimmedMetadata(safeAsset.model)) ||
      assetIdSet.has(safeAsset.assetId) || objectKeySet.has(safeAsset.b2ObjectKey)) {
      return { ok: false, code: 'invalid_assets' };
    }
    assetIdSet.add(safeAsset.assetId);
    objectKeySet.add(safeAsset.b2ObjectKey);
    safeAssets.push(safeAsset);
  }

  const references = arraySnapshot(safeOptions.references);
  if (!references) return { ok: false, code: 'invalid_references' };

  const refMap = new Map();
  for (const reference of references) {
    const safeReference = plainRecordSnapshot(reference, REQUIRED_REFERENCE_KEYS, true);
    if (!safeReference || !isNonEmptyString(safeReference.assetId) || !isNonEmptyString(safeReference.fileId) || refMap.has(safeReference.assetId)) {
      return { ok: false, code: 'invalid_references' };
    }
    if (!assetIdSet.has(safeReference.assetId)) return { ok: false, code: 'unexpected_reference' };
    refMap.set(safeReference.assetId, safeReference.fileId);
  }

  for (const asset of safeAssets) {
    if (!refMap.has(asset.assetId)) return { ok: false, code: 'missing_reference' };
  }

  const verifiedAssets = [];
  for (const asset of safeAssets) {
    const fileId = refMap.get(asset.assetId);
    let response;
    try {
      response = await safeOptions.getFileInfo({ fileId });
    } catch {
      return { ok: false, code: 'b2_lookup_failed', assetId: asset.assetId };
    }

    const safeResponse = plainRecordSnapshot(response, B2_KEYS, false, false);
    if (!safeResponse) return { ok: false, code: 'invalid_b2_response', assetId: asset.assetId };
    const safeFileInfo = plainRecordSnapshot(safeResponse.fileInfo, ['src_sha256'], false, false);
    if (!safeFileInfo) return { ok: false, code: 'invalid_b2_response', assetId: asset.assetId };

    if (safeResponse.action !== 'upload') return { ok: false, code: 'b2_action_mismatch', assetId: asset.assetId };
    if (Object.hasOwn(safeResponse, 'fileId') && safeResponse.fileId !== fileId) return { ok: false, code: 'b2_file_id_mismatch', assetId: asset.assetId };
    if (safeResponse.fileName !== asset.b2ObjectKey) return { ok: false, code: 'b2_object_key_mismatch', assetId: asset.assetId };
    if (safeResponse.contentLength !== asset.byteSize) return { ok: false, code: 'b2_size_mismatch', assetId: asset.assetId };
    if (safeResponse.contentType !== asset.contentType) return { ok: false, code: 'b2_content_type_mismatch', assetId: asset.assetId };
    if (safeFileInfo.src_sha256 !== asset.sha256) return { ok: false, code: 'b2_sha256_mismatch', assetId: asset.assetId };
    verifiedAssets.push({ assetId: asset.assetId, fileId });
  }

  return { ok: true, verifiedAssets };
}
