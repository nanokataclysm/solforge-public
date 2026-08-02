import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { forgeVerifiedMediaPackage } from '../lib/verified-media-package-forge.mjs';
import { verifySignedMediaPackage } from '../lib/media-provenance.mjs';

const SHA_1 = 'a'.repeat(64);
const SHA_2 = 'b'.repeat(64);
const SHA_3 = 'c'.repeat(64);

function keys() {
  const pair = crypto.generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });
  return { privateKeyPem: pair.privateKey, publicKeyPem: pair.publicKey };
}

function options(keyPair = keys()) {
  const assets = [
    { assetId: 'one', role: 'source', b2ObjectKey: 'one.png', sha256: SHA_3, byteSize: 10, contentType: 'image/png' },
    { assetId: 'two', role: 'preview', b2ObjectKey: 'two.png', sha256: SHA_2, byteSize: 20, contentType: 'image/png' }
  ];
  const references = [{ assetId: 'one', fileId: 'file-one' }, { assetId: 'two', fileId: 'file-two' }];
  return {
    artifactId: 'artifact', artifactVersion: 'v1', blueprintDigest: SHA_1,
    genblazeManifestHash: SHA_2, assets, references, ...keyPair,
    createdAt: '2026-01-01T00:00:00.000Z',
    getFileInfo: async ({ fileId }) => {
      const asset = assets.find(({ assetId }) => references.find(reference => reference.assetId === assetId)?.fileId === fileId);
      return {
        action: 'upload', fileId, fileName: asset.b2ObjectKey,
        contentLength: asset.byteSize, contentType: asset.contentType,
        fileInfo: { src_sha256: asset.sha256 }
      };
    }
  };
}

function poisonedScalar(calls) {
  return {
    toString() { calls.toString++; throw new Error('toString'); },
    valueOf() { calls.valueOf++; throw new Error('valueOf'); },
    toJSON() { calls.toJSON++; throw new Error('toJSON'); }
  };
}

test('forge rejects every required non-string scalar before B2 lookup', async () => {
  const required = ['artifactId', 'artifactVersion', 'blueprintDigest', 'genblazeManifestHash', 'privateKeyPem', 'publicKeyPem', 'createdAt'];

  for (const field of required) {
    const input = options();
    let lookups = 0;
    input.getFileInfo = async () => { lookups++; return null; };
    input[field] = {};
    assert.deepEqual(await forgeVerifiedMediaPackage(input), { ok: false, stage: 'stored_asset_verification', code: 'invalid_options' }, field);
    assert.equal(lookups, 0, field);
  }
});

test('forge rejects hostile scalar objects without conversion or lookup', async () => {
  const blueprintCalls = { toString: 0, valueOf: 0, toJSON: 0 };
  const blueprint = options();
  let lookups = 0;
  blueprint.getFileInfo = async () => { lookups++; return null; };
  blueprint.blueprintDigest = poisonedScalar(blueprintCalls);
  assert.deepEqual(await forgeVerifiedMediaPackage(blueprint), { ok: false, stage: 'stored_asset_verification', code: 'invalid_options' });
  assert.deepEqual(blueprintCalls, { toString: 0, valueOf: 0, toJSON: 0 });
  assert.equal(lookups, 0);

  const proxy = new Proxy({}, { get() { throw new Error('proxy get'); } });
  const manifest = options();
  let proxyLookups = 0;
  manifest.getFileInfo = async () => { proxyLookups++; return null; };
  manifest.genblazeManifestHash = proxy;
  assert.deepEqual(await forgeVerifiedMediaPackage(manifest), { ok: false, stage: 'stored_asset_verification', code: 'invalid_options' });
  assert.equal(proxyLookups, 0);
});

test('forge rejects class-instance PEMs and optional scalar objects before lookup', async () => {
  class Key {
    constructor(calls) { this.calls = calls; }
    toString() { this.calls.toString++; throw new Error('toString'); }
    valueOf() { this.calls.valueOf++; throw new Error('valueOf'); }
    toJSON() { this.calls.toJSON++; throw new Error('toJSON'); }
  }
  for (const field of ['privateKeyPem', 'publicKeyPem', 'parentVersionDigest']) {
    const input = options();
    const calls = { toString: 0, valueOf: 0, toJSON: 0 };
    let lookups = 0;
    input.getFileInfo = async () => { lookups++; return null; };
    input[field] = new Key(calls);
    assert.deepEqual(await forgeVerifiedMediaPackage(input), { ok: false, stage: 'stored_asset_verification', code: 'invalid_options' }, field);
    assert.deepEqual(calls, { toString: 0, valueOf: 0, toJSON: 0 }, field);
    assert.equal(lookups, 0, field);
  }

  const mode = options();
  const calls = { toString: 0, valueOf: 0, toJSON: 0, getters: 0 };
  let modeLookups = 0;
  mode.getFileInfo = async () => { modeLookups++; return null; };
  mode.mode = Object.defineProperties({}, {
    toString: { value() { calls.toString++; throw new Error('toString'); } },
    valueOf: { value() { calls.valueOf++; throw new Error('valueOf'); } },
    toJSON: { value() { calls.toJSON++; throw new Error('toJSON'); } },
    conversionProbe: { get() { calls.getters++; throw new Error('getter'); } }
  });
  assert.deepEqual(await forgeVerifiedMediaPackage(mode), { ok: false, stage: 'stored_asset_verification', code: 'invalid_options' });
  assert.deepEqual(calls, { toString: 0, valueOf: 0, toJSON: 0, getters: 0 });
  assert.equal(modeLookups, 0);
});

test('forge snapshots custom mode and defers malformed primitive PEM evaluation', async () => {
  const input = options();
  const originalGetFileInfo = input.getFileInfo;
  input.mode = 'archive';
  input.getFileInfo = async request => {
    input.mode = 'changed-after-snapshot';
    return originalGetFileInfo(request);
  };
  const signed = await forgeVerifiedMediaPackage(input);
  assert.equal(signed.ok, true);
  assert.equal(signed.package.receipt.mode, 'archive');

  const malformed = options({ privateKeyPem: 'not a private PEM', publicKeyPem: 'not a public PEM' });
  let lookups = 0;
  const getFileInfo = malformed.getFileInfo;
  malformed.getFileInfo = async request => {
    lookups++;
    return getFileInfo(request);
  };
  assert.deepEqual(await forgeVerifiedMediaPackage(malformed), { ok: false, stage: 'signing', code: 'signing_failed' });
  assert.equal(lookups, 2);
});

test('forgeVerifiedMediaPackage signs only verified, snapshotted assets', async () => {
  const input = options();
  const result = await forgeVerifiedMediaPackage(input);

  assert.equal(result.ok, true);
  assert.deepEqual(result.verifiedAssets, [
    { assetId: 'one', fileId: 'file-one' },
    { assetId: 'two', fileId: 'file-two' }
  ]);
  assert.deepEqual(result.package.receipt.assets.map(({ assetId, b2ObjectKey }) => ({ assetId, b2ObjectKey })), [
    { assetId: 'one', b2ObjectKey: 'one.png' },
    { assetId: 'two', b2ObjectKey: 'two.png' }
  ]);
  assert.deepEqual(verifySignedMediaPackage({
    receipt: result.package.receipt,
    signature: result.package.signature,
    publicKeyPem: input.publicKeyPem
  }), { ok: true });
});

test('forge snapshots assets and references before B2 lookup', async () => {
  const input = options();
  const original = structuredClone({ assets: input.assets, references: input.references });
  const calls = [];
  input.getFileInfo = async ({ fileId }) => {
    calls.push(fileId);
    input.assets[0].b2ObjectKey = 'changed.png';
    input.assets[0].byteSize = 999;
    input.references[1].fileId = 'changed-file';
    const asset = original.assets.find(({ assetId }) => original.references.find(reference => reference.assetId === assetId).fileId === fileId);
    return { action: 'upload', fileId, fileName: asset.b2ObjectKey, contentLength: asset.byteSize, contentType: asset.contentType, fileInfo: { src_sha256: asset.sha256 } };
  };

  const result = await forgeVerifiedMediaPackage(input);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['file-one', 'file-two']);
  assert.equal(result.package.receipt.assets[0].b2ObjectKey, 'one.png');
  assert.equal(result.package.receipt.assets[0].byteSize, 10);
});

test('forge returns each verifier failure without attempting signing', async () => {
  const cases = [
    ['invalid_assets', input => { input.assets[0].sha256 = 'bad'; }],
    ['invalid_references', input => { input.references[0].fileId = ''; }],
    ['unexpected_reference', input => { input.references.push({ assetId: 'other', fileId: 'other-file' }); }],
    ['missing_reference', input => { input.references.pop(); }],
    ['b2_lookup_failed', input => { input.getFileInfo = async () => { throw new Error('b2-secret'); }; }],
    ['invalid_b2_response', input => { input.getFileInfo = async () => null; }],
    ['b2_action_mismatch', input => { input.getFileInfo = async ({ fileId }) => ({ action: 'hide', fileId, fileName: 'one.png', contentLength: 10, contentType: 'image/png', fileInfo: { src_sha256: SHA_3 } }); }],
    ['b2_file_id_mismatch', input => { input.getFileInfo = async () => ({ action: 'upload', fileId: 'wrong', fileName: 'one.png', contentLength: 10, contentType: 'image/png', fileInfo: { src_sha256: SHA_3 } }); }],
    ['b2_object_key_mismatch', input => { input.getFileInfo = async ({ fileId }) => ({ action: 'upload', fileId, fileName: 'wrong.png', contentLength: 10, contentType: 'image/png', fileInfo: { src_sha256: SHA_3 } }); }],
    ['b2_size_mismatch', input => { input.getFileInfo = async ({ fileId }) => ({ action: 'upload', fileId, fileName: 'one.png', contentLength: 99, contentType: 'image/png', fileInfo: { src_sha256: SHA_3 } }); }],
    ['b2_content_type_mismatch', input => { input.getFileInfo = async ({ fileId }) => ({ action: 'upload', fileId, fileName: 'one.png', contentLength: 10, contentType: 'image/jpeg', fileInfo: { src_sha256: SHA_3 } }); }],
    ['b2_sha256_mismatch', input => { input.getFileInfo = async ({ fileId }) => ({ action: 'upload', fileId, fileName: 'one.png', contentLength: 10, contentType: 'image/png', fileInfo: { src_sha256: SHA_2 } }); }]
  ];

  for (const [code, arrange] of cases) {
    const input = options({ privateKeyPem: 'not evaluated', publicKeyPem: 'also not evaluated' });
    arrange(input);
    const result = await forgeVerifiedMediaPackage(input);
    assert.equal(result.ok, false, code);
    assert.deepEqual(Object.keys(result).sort(), ['assetId', 'code', 'ok', 'stage'].filter(key => key !== 'assetId' || result.assetId).sort(), code);
    assert.equal(result.stage, 'stored_asset_verification', code);
    assert.equal(result.code, code, code);
  }
});

test('forge rejects unsafe envelopes and malformed arrays before lookup', async () => {
  const invalidInputs = [];
  invalidInputs.push([{ ...options(), extra: true }, 'invalid_options']);
  invalidInputs.push([Object.create(options()), 'invalid_options']);
  const symbolInput = options(); symbolInput[Symbol('x')] = true; invalidInputs.push([symbolInput, 'invalid_options']);
  const accessorInput = options(); Object.defineProperty(accessorInput, 'mode', { get() { throw new Error('nope'); }, enumerable: true }); invalidInputs.push([accessorInput, 'invalid_options']);
  invalidInputs.push([new (class Input { constructor() { Object.assign(this, options()); } })(), 'invalid_options']);
  invalidInputs.push([new Proxy(options(), { ownKeys() { throw new Error('nope'); } }), 'invalid_options']);
  const revoked = Proxy.revocable(options(), {}); revoked.revoke(); invalidInputs.push([revoked.proxy, 'invalid_options']);
  const sparse = options(); sparse.assets = [sparse.assets[0], , sparse.assets[1]]; invalidInputs.push([sparse, 'invalid_assets']);
  const extraArrayField = options(); extraArrayField.references.extra = true; invalidInputs.push([extraArrayField, 'invalid_references']);

  for (const [input, code] of invalidInputs) {
    const result = await forgeVerifiedMediaPackage(input);
    assert.deepEqual(result, { ok: false, stage: 'stored_asset_verification', code });
  }
});

test('forge reports malformed assets and references with their verifier-compatible codes', async () => {
  const badAsset = options(); badAsset.assets[0] = new (class Asset { constructor() { Object.assign(this, badAsset.assets[0]); } })();
  assert.deepEqual(await forgeVerifiedMediaPackage(badAsset), { ok: false, stage: 'stored_asset_verification', code: 'invalid_assets' });
  const badReference = options(); Object.defineProperty(badReference.references[0], 'fileId', { get() { throw new Error('nope'); }, enumerable: true });
  assert.deepEqual(await forgeVerifiedMediaPackage(badReference), { ok: false, stage: 'stored_asset_verification', code: 'invalid_references' });
});

test('forge hides signing errors, preserves optional parent digest semantics, and supports frozen input', async () => {
  const invalidKey = options({ privateKeyPem: 'bad private key', publicKeyPem: 'bad public key' });
  const failed = await forgeVerifiedMediaPackage(invalidKey);
  assert.deepEqual(failed, { ok: false, stage: 'signing', code: 'signing_failed' });
  assert.equal(JSON.stringify(failed).includes('private'), false);

  const withoutParent = options();
  Object.freeze(withoutParent.assets[0]); Object.freeze(withoutParent.assets[1]); Object.freeze(withoutParent.assets);
  Object.freeze(withoutParent.references[0]); Object.freeze(withoutParent.references[1]); Object.freeze(withoutParent.references); Object.freeze(withoutParent);
  const noParentResult = await forgeVerifiedMediaPackage(withoutParent);
  assert.equal(noParentResult.ok, true);
  assert.equal(Object.hasOwn(noParentResult.package.receipt, 'parentVersionDigest'), false);

  const withParent = options(); withParent.parentVersionDigest = SHA_1;
  const parentResult = await forgeVerifiedMediaPackage(withParent);
  assert.equal(parentResult.ok, true);
  assert.equal(parentResult.package.receipt.parentVersionDigest, SHA_1);
});


test('forge rejects oversized arrays before inspecting their entries', async () => {
  const oversizedAssets = options();
  let assetDescriptorReads = 0;
  oversizedAssets.assets = new Proxy(
    Array.from({ length: 33 }, () => oversizedAssets.assets[0]),
    {
      getOwnPropertyDescriptor(target, property) {
        if (property !== 'length') assetDescriptorReads++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      }
    }
  );
  assert.deepEqual(await forgeVerifiedMediaPackage(oversizedAssets), {
    ok: false,
    stage: 'stored_asset_verification',
    code: 'invalid_assets'
  });
  assert.equal(assetDescriptorReads, 0);

  const oversizedReferences = options();
  let referenceDescriptorReads = 0;
  oversizedReferences.references = new Proxy(
    Array.from({ length: 33 }, () => oversizedReferences.references[0]),
    {
      getOwnPropertyDescriptor(target, property) {
        if (property !== 'length') referenceDescriptorReads++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      }
    }
  );
  assert.deepEqual(await forgeVerifiedMediaPackage(oversizedReferences), {
    ok: false,
    stage: 'stored_asset_verification',
    code: 'invalid_references'
  });
  assert.equal(referenceDescriptorReads, 0);
});

test('forge never returns success for an internally unverifiable signature', async () => {
  const emptyMode = options();
  emptyMode.mode = '';
  assert.deepEqual(await forgeVerifiedMediaPackage(emptyMode), {
    ok: false,
    stage: 'signing',
    code: 'signing_failed'
  });

  const privatePair = keys();
  const publicPair = keys();
  const mismatched = options({
    privateKeyPem: privatePair.privateKeyPem,
    publicKeyPem: publicPair.publicKeyPem
  });
  assert.deepEqual(await forgeVerifiedMediaPackage(mismatched), {
    ok: false,
    stage: 'signing',
    code: 'signing_failed'
  });
});

test('forge does not mutate caller-owned inputs', async () => {
  const input = options();
  const before = structuredClone({ ...input, getFileInfo: undefined });
  const result = await forgeVerifiedMediaPackage(input);
  assert.equal(result.ok, true);
  assert.deepEqual({ ...input, getFileInfo: undefined }, before);
});
