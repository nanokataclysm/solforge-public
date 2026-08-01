// apps/orchestrator/test/b2-object-verifier.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { verifyStoredAssets } from '../lib/b2-object-verifier.mjs';

test('verifyStoredAssets - B2 Provenance Slice', async (t) => {
  const validAsset = {
    assetId: 'a1',
    role: 'source',
    b2ObjectKey: 'obj-1',
    sha256: 'a'.repeat(64),
    byteSize: 1024,
    contentType: 'image/png'
  };

  const validReference = {
    assetId: 'a1',
    fileId: 'file-1'
  };

  const validB2Response = {
    action: 'upload',
    fileId: 'file-1',
    fileName: 'obj-1',
    contentLength: 1024,
    contentType: 'image/png',
    fileInfo: {
      src_sha256: 'a'.repeat(64),
      other_field: 'ignored'
    },
    uploadTimestamp: 123456
  };

  await t.test('1. one valid asset', async () => {
    let callCount = 0;
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [validReference],
      getFileInfo: async ({ fileId }) => {
        callCount++;
        assert.strictEqual(fileId, 'file-1');
        return validB2Response;
      }
    });
    assert.deepStrictEqual(res, {
      ok: true,
      verifiedAssets: [{ assetId: 'a1', fileId: 'file-1' }]
    });
    assert.strictEqual(callCount, 1);
  });

  await t.test('2. several valid assets / 3. signed array order is preserved / 4. getFileInfo called once per asset', async () => {
    const assets = [
      validAsset,
      { ...validAsset, assetId: 'a2', b2ObjectKey: 'obj-2' }
    ];
    const references = [
      validReference,
      { assetId: 'a2', fileId: 'file-2' }
    ];

    const calls = [];
    const res = await verifyStoredAssets({
      assets,
      references,
      getFileInfo: async ({ fileId }) => {
        calls.push(fileId);
        if (fileId === 'file-1') return validB2Response;
        if (fileId === 'file-2') return {
          ...validB2Response,
          fileId: 'file-2',
          fileName: 'obj-2'
        };
      }
    });

    assert.deepStrictEqual(res, {
      ok: true,
      verifiedAssets: [
        { assetId: 'a1', fileId: 'file-1' },
        { assetId: 'a2', fileId: 'file-2' }
      ]
    });
    assert.deepStrictEqual(calls, ['file-1', 'file-2']);
  });

  await t.test('5. first failure stops later lookups', async () => {
    const assets = [
      validAsset,
      { ...validAsset, assetId: 'a2', b2ObjectKey: 'obj-2' }
    ];
    const references = [
      validReference,
      { assetId: 'a2', fileId: 'file-2' }
    ];

    let calls = 0;
    const res = await verifyStoredAssets({
      assets,
      references,
      getFileInfo: async ({ fileId }) => {
        calls++;
        return { ...validB2Response, action: 'hide' }; // fail on first
      }
    });

    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'b2_action_mismatch');
    assert.strictEqual(res.assetId, 'a1');
    assert.strictEqual(calls, 1);
  });

  await t.test('6. thrown client error fails closed / 8. raw client errors and secrets are not returned', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [validReference],
      getFileInfo: () => {
        throw new Error('SECRET_DB_PASSWORD');
      }
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'b2_lookup_failed');
    assert.strictEqual(res.assetId, 'a1');
    assert.strictEqual(JSON.stringify(res).includes('SECRET_DB_PASSWORD'), false);
  });

  await t.test('7. rejected client promise fails closed', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [validReference],
      getFileInfo: async () => {
        throw new Error('REJECTED_SECRET');
      }
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'b2_lookup_failed');
    assert.strictEqual(res.assetId, 'a1');
  });

  await t.test('9. missing reference', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [],
      getFileInfo: async () => validB2Response
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'missing_reference');
  });

  await t.test('10. extra reference / 12. reference for unknown asset', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [
        validReference,
        { assetId: 'unknown', fileId: 'f2' }
      ],
      getFileInfo: async () => validB2Response
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'unexpected_reference');
  });

  await t.test('11. duplicate reference', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [validReference, validReference],
      getFileInfo: async () => validB2Response
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'invalid_references');
  });

  await t.test('13. empty file ID', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [{ assetId: 'a1', fileId: '' }],
      getFileInfo: async () => validB2Response
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'invalid_references');
  });

  await t.test('14. unknown reference field', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [{ assetId: 'a1', fileId: 'f1', extra: 1 }],
      getFileInfo: async () => validB2Response
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'invalid_references');
  });

  await t.test('15. unknown top-level option field', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [validReference],
      getFileInfo: async () => validB2Response,
      extraOption: true
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'invalid_options');
  });

  await t.test('16. non-function getFileInfo', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [validReference],
      getFileInfo: 'not-a-func'
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'invalid_options');
  });

  await t.test('17. wrong action', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [validReference],
      getFileInfo: async () => ({ ...validB2Response, action: 'hide' })
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'b2_action_mismatch');
    assert.strictEqual(res.assetId, 'a1');
  });

  await t.test('18. wrong returned file ID', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [validReference],
      getFileInfo: async () => ({ ...validB2Response, fileId: 'wrong' })
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'b2_file_id_mismatch');
  });

  await t.test('19. wrong object key', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [validReference],
      getFileInfo: async () => ({ ...validB2Response, fileName: 'wrong-key' })
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'b2_object_key_mismatch');
  });

  await t.test('20. wrong byte size', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [validReference],
      getFileInfo: async () => ({ ...validB2Response, contentLength: 9999 })
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'b2_size_mismatch');
  });

  await t.test('21. wrong content type', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [validReference],
      getFileInfo: async () => ({ ...validB2Response, contentType: 'image/jpeg' })
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'b2_content_type_mismatch');
  });

  await t.test('22. wrong src_sha256', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [validReference],
      getFileInfo: async () => ({ ...validB2Response, fileInfo: { src_sha256: 'b'.repeat(64) } })
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'b2_sha256_mismatch');
  });

  await t.test('23. missing src_sha256', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [validReference],
      getFileInfo: async () => ({ ...validB2Response, fileInfo: {} })
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'b2_sha256_mismatch');
  });

  await t.test('24. malformed fileInfo', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [validReference],
      getFileInfo: async () => ({ ...validB2Response, fileInfo: null })
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'invalid_b2_response');
  });

  await t.test('25. uppercase SHA-256 rejected', async () => {
    const res = await verifyStoredAssets({
      assets: [{ ...validAsset, sha256: 'A'.repeat(64) }],
      references: [validReference],
      getFileInfo: async () => validB2Response
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'invalid_assets');
  });

  await t.test('26. duplicate asset ID rejected', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset, { ...validAsset, b2ObjectKey: 'obj-2' }],
      references: [validReference, { assetId: 'a1', fileId: 'file-2' }],
      getFileInfo: async () => validB2Response
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'invalid_assets');
  });

  await t.test('27. duplicate object key rejected', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset, { ...validAsset, assetId: 'a2' }],
      references: [validReference, { assetId: 'a2', fileId: 'file-2' }],
      getFileInfo: async () => validB2Response
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'invalid_assets');
  });

  await t.test('28. zero-byte asset rejected', async () => {
    const res = await verifyStoredAssets({
      assets: [{ ...validAsset, byteSize: 0 }],
      references: [validReference],
      getFileInfo: async () => validB2Response
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'invalid_assets');
  });

  await t.test('29. 32 assets accepted', async () => {
    const assets = Array.from({ length: 32 }, (_, i) => ({ ...validAsset, assetId: `a${i}`, b2ObjectKey: `o${i}` }));
    const references = Array.from({ length: 32 }, (_, i) => ({ assetId: `a${i}`, fileId: `f${i}` }));
    const res = await verifyStoredAssets({
      assets,
      references,
      getFileInfo: async ({ fileId }) => ({
        ...validB2Response,
        fileId,
        fileName: `o${fileId.slice(1)}`
      })
    });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.verifiedAssets.length, 32);
  });

  await t.test('30. 33 assets rejected', async () => {
    const assets = Array.from({ length: 33 }, (_, i) => ({ ...validAsset, assetId: `a${i}`, b2ObjectKey: `o${i}` }));
    const references = Array.from({ length: 33 }, (_, i) => ({ assetId: `a${i}`, fileId: `f${i}` }));
    const res = await verifyStoredAssets({
      assets,
      references,
      getFileInfo: async () => validB2Response
    });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.code, 'invalid_assets');
  });

  await t.test('31. caller inputs are not mutated', async () => {
    const assets = [ { ...validAsset } ];
    const references = [ { ...validReference } ];
    await verifyStoredAssets({ assets, references, getFileInfo: async () => validB2Response });
    assert.deepStrictEqual(assets, [validAsset]);
    assert.deepStrictEqual(references, [validReference]);
  });

  await t.test('32. frozen caller inputs work', async () => {
    const assets = Object.freeze([ Object.freeze({ ...validAsset }) ]);
    const references = Object.freeze([ Object.freeze({ ...validReference }) ]);
    const res = await verifyStoredAssets(Object.freeze({
      assets, references, getFileInfo: async () => validB2Response
    }));
    assert.strictEqual(res.ok, true);
  });

  await t.test('33. irrelevant documented B2 response fields are tolerated', async () => {
    const res = await verifyStoredAssets({
      assets: [validAsset],
      references: [validReference],
      getFileInfo: async () => ({
        ...validB2Response,
        accountId: 'xxx',
        bucketId: 'yyy',
        contentMd5: 'ignored',
        contentSha1: 'ignored'
      })
    });
    assert.strictEqual(res.ok, true);
  });

  await t.test('34. only plain data records are accepted without invoking getters', async () => {
    class Asset { constructor() { Object.assign(this, validAsset); } }
    const accessorAsset = { ...validAsset };
    Object.defineProperty(accessorAsset, 'role', { enumerable: true, get() { throw new Error('SECRET'); } });
    const symbolAsset = { ...validAsset, [Symbol('secret')]: true };
    for (const assets of [[new Asset()], [accessorAsset], [symbolAsset]]) {
      assert.deepStrictEqual(await verifyStoredAssets({ assets, references: [validReference], getFileInfo: async () => validB2Response }), { ok: false, code: 'invalid_assets' });
    }
    const inheritedReference = Object.create({ assetId: 'a1', fileId: 'file-1' });
    assert.strictEqual((await verifyStoredAssets({ assets: [validAsset], references: [inheritedReference], getFileInfo: async () => validB2Response })).code, 'invalid_references');
    assert.strictEqual((await verifyStoredAssets({ assets: [validAsset], references: [new (class Reference { constructor() { Object.assign(this, validReference); } })()], getFileInfo: async () => validB2Response })).code, 'invalid_references');
    assert.strictEqual((await verifyStoredAssets(new (class Options {})())).code, 'invalid_options');
  });

  await t.test('35. null-prototype records are accepted', async () => {
    const asset = Object.assign(Object.create(null), validAsset);
    const reference = Object.assign(Object.create(null), validReference);
    const fileInfo = Object.assign(Object.create(null), validB2Response.fileInfo);
    const response = Object.assign(Object.create(null), validB2Response, { fileInfo });
    const options = Object.assign(Object.create(null), { assets: [asset], references: [reference], getFileInfo: async () => response });
    assert.strictEqual((await verifyStoredAssets(options)).ok, true);
  });

  await t.test('36. hostile and revoked proxies fail closed', async () => {
    const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('SECRET'); } });
    const revoked = Proxy.revocable({ ...validAsset }, {});
    revoked.revoke();
    assert.strictEqual((await verifyStoredAssets(hostile)).code, 'invalid_options');
    assert.strictEqual((await verifyStoredAssets({ assets: [revoked.proxy], references: [validReference], getFileInfo: async () => validB2Response })).code, 'invalid_assets');
  });

  await t.test('37. hostile responses and inherited fileInfo hashes are invalid B2 responses', async () => {
    const responseGetter = { ...validB2Response };
    Object.defineProperty(responseGetter, 'fileName', { enumerable: true, get() { throw new Error('SECRET_URL'); } });
    const inheritedHash = Object.create({ src_sha256: validAsset.sha256 });
    const classFileInfo = new (class FileInfo { constructor() { this.src_sha256 = validAsset.sha256; } })();
    for (const response of [responseGetter, { ...validB2Response, fileInfo: inheritedHash }, { ...validB2Response, fileInfo: classFileInfo }, new (class Response {})()]) {
      const res = await verifyStoredAssets({ assets: [validAsset], references: [validReference], getFileInfo: async () => response });
      assert.strictEqual(res.code, 'invalid_b2_response');
      assert.strictEqual(JSON.stringify(res).includes('SECRET_URL'), false);
    }
  });

  await t.test('38. rejecting thenables and throwing toJSON never escape', async () => {
    const rejectingThenable = { get then() { throw new Error('TOKEN'); } };
    const res = await verifyStoredAssets({ assets: [validAsset], references: [validReference], getFileInfo: () => rejectingThenable });
    assert.deepStrictEqual(res, { ok: false, code: 'b2_lookup_failed', assetId: 'a1' });
    const response = { ...validB2Response, toJSON() { throw new Error('SECRET'); } };
    assert.strictEqual((await verifyStoredAssets({ assets: [validAsset], references: [validReference], getFileInfo: async () => response })).ok, true);
  });

  await t.test('39. role and provider/model contract validation', async () => {
    const invalidAssets = [
      { ...validAsset, role: undefined },
      { ...validAsset, role: '  ' },
      { ...validAsset, provider: '' },
      { ...validAsset, provider: ' provider' },
      { ...validAsset, model: '' },
      { ...validAsset, model: 'model\nname' },
      { ...validAsset, provider: 'p'.repeat(129) }
    ];
    for (const asset of invalidAssets) {
      assert.strictEqual((await verifyStoredAssets({ assets: [asset], references: [validReference], getFileInfo: async () => validB2Response })).code, 'invalid_assets');
    }
  });

  await t.test('40. response fileId is checked only when present', async () => {
    const { fileId, ...responseWithoutFileId } = validB2Response;
    assert.strictEqual((await verifyStoredAssets({
      assets: [validAsset], references: [validReference], getFileInfo: async () => responseWithoutFileId
    })).ok, true);
    assert.strictEqual((await verifyStoredAssets({
      assets: [validAsset], references: [validReference], getFileInfo: async () => ({ ...validB2Response, fileId: undefined })
    })).code, 'b2_file_id_mismatch');
  });

  await t.test('41. hostile option and reference records fail closed', async () => {
    const accessorOptions = { assets: [validAsset], references: [validReference] };
    Object.defineProperty(accessorOptions, 'getFileInfo', { enumerable: true, get() { throw new Error('SECRET'); } });
    const accessorReference = { ...validReference };
    Object.defineProperty(accessorReference, 'fileId', { enumerable: true, get() { throw new Error('SECRET'); } });
    const ownKeysOptions = new Proxy({}, { ownKeys() { throw new Error('SECRET'); } });
    const descriptorReference = new Proxy({ ...validReference }, { getOwnPropertyDescriptor() { throw new Error('SECRET'); } });
    const symbolOptions = { assets: [validAsset], references: [validReference], getFileInfo: async () => validB2Response, [Symbol('secret')]: true };
    const symbolReference = { ...validReference, [Symbol('secret')]: true };

    assert.strictEqual((await verifyStoredAssets(accessorOptions)).code, 'invalid_options');
    assert.strictEqual((await verifyStoredAssets({ assets: [validAsset], references: [accessorReference], getFileInfo: async () => validB2Response })).code, 'invalid_references');
    assert.strictEqual((await verifyStoredAssets(ownKeysOptions)).code, 'invalid_options');
    assert.strictEqual((await verifyStoredAssets({ assets: [validAsset], references: [descriptorReference], getFileInfo: async () => validB2Response })).code, 'invalid_references');
    assert.strictEqual((await verifyStoredAssets(symbolOptions)).code, 'invalid_options');
    assert.strictEqual((await verifyStoredAssets({ assets: [validAsset], references: [symbolReference], getFileInfo: async () => validB2Response })).code, 'invalid_references');
  });

  await t.test('42. second lookup waits for the first lookup to resolve', async () => {
    const assets = [validAsset, { ...validAsset, assetId: 'a2', b2ObjectKey: 'obj-2' }];
    const references = [validReference, { assetId: 'a2', fileId: 'file-2' }];
    const calls = [];
    let resolveFirst;
    const result = verifyStoredAssets({
      assets, references,
      getFileInfo: ({ fileId }) => {
        calls.push(fileId);
        if (fileId === 'file-1') return new Promise(resolve => { resolveFirst = resolve; });
        return Promise.resolve({ ...validB2Response, fileId, fileName: 'obj-2' });
      }
    });
    assert.deepStrictEqual(calls, ['file-1']);
    resolveFirst(validB2Response);
    assert.strictEqual((await result).ok, true);
    assert.deepStrictEqual(calls, ['file-1', 'file-2']);
  });
});
