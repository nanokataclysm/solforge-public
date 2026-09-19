import test from "node:test";
import assert from "node:assert/strict";
import { createB2GetFileInfo } from "../lib/b2-get-file-info-adapter.mjs";
import { sha256 } from "../lib/signing.mjs";
import {
  VerifiedMediaSmokeError,
  runVerifiedMediaPackageSmoke,
} from "../scripts/smoke-verified-media-package.mjs";

function smokeInput() {
  return {
    sourceBuffer: Buffer.from("verified-media-smoke-source"),
    fileId: "file-source",
    objectKey: "media/source.png",
    contentType: "image/png",
  };
}

function matchingMetadata(input = smokeInput()) {
  return {
    action: "upload",
    fileId: input.fileId,
    fileName: input.objectKey,
    contentLength: input.sourceBuffer.length,
    contentType: input.contentType,
    fileInfo: { src_sha256: sha256(input.sourceBuffer) },
  };
}

function authorization(token = "token-1") {
  return {
    authorizationToken: token,
    apiInfo: {
      storageApi: {
        apiUrl: "https://api001.backblazeb2.com",
        allowed: {
          capabilities: ["readFiles"],
          buckets: [{ id: "bucket", name: "test-bucket" }],
          namePrefix: "media/",
        },
      },
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function assertSmokeError(error, stage, code) {
  return (
    error instanceof VerifiedMediaSmokeError &&
    error.stage === stage &&
    error.code === code
  );
}

test("runs the real approval route, signs, verifies, and rejects replay", async () => {
  const input = smokeInput();
  let lookups = 0;
  const result = await runVerifiedMediaPackageSmoke({
    input,
    getFileInfo: async ({ fileId }) => {
      lookups++;
      assert.equal(fileId, input.fileId);
      return matchingMetadata(input);
    },
    now: () => new Date("2026-07-31T08:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.changedIntentRejectedBeforeLookup, true);
  assert.equal(result.packageStatus, 200);
  assert.equal(result.verifiedAssetCount, 1);
  assert.equal(result.receiptVerified, true);
  assert.equal(result.replayRejected, true);
  assert.equal(result.b2LookupCount, 1);
  assert.equal(result.b2AdapterInvocationCount, 1);
  assert.equal(result.b2RequestMetrics, null);
  assert.equal(lookups, 1);
  assert.match(result.mediaIntentDigest, /^[0-9a-f]{64}$/);
  assert.match(result.receiptDigest, /^[0-9a-f]{64}$/);
  assert.match(result.publicKeyFingerprint, /^[0-9a-f]{64}$/);
});

test("surfaces exact adapter HTTP attempts and retry reason counts", async () => {
  const input = smokeInput();
  let authorizeCalls = 0;
  let infoCalls = 0;
  const getFileInfo = createB2GetFileInfo({
    applicationKeyId: "test-key-id",
    applicationKey: "test-application-key",
    fetchImpl: async (url) => {
      if (String(url).includes("b2_authorize_account")) {
        authorizeCalls++;
        return jsonResponse(authorization(`token-${authorizeCalls}`));
      }
      infoCalls++;
      if (infoCalls === 1) {
        return jsonResponse(
          { status: 401, code: "expired_auth_token", message: "expired" },
          401,
        );
      }
      return jsonResponse(matchingMetadata(input));
    },
  });

  const result = await runVerifiedMediaPackageSmoke({
    input,
    getFileInfo,
    now: () => new Date("2026-07-31T08:00:00.000Z"),
  });

  assert.equal(result.b2LookupCount, 1);
  assert.equal(result.b2AdapterInvocationCount, 1);
  assert.deepEqual(result.b2RequestMetrics, {
    authorizationHttpAttemptCount: 2,
    getFileInfoHttpAttemptCount: 2,
    authRetryCount: 1,
    authRetryReasonCounts: {
      bad_auth_token: 0,
      expired_auth_token: 1,
    },
  });
  assert.equal(authorizeCalls, 2);
  assert.equal(infoCalls, 2);
});

test("stored size mismatch fails closed", async () => {
  const input = smokeInput();
  await assert.rejects(
    () =>
      runVerifiedMediaPackageSmoke({
        input,
        getFileInfo: async () => ({
          ...matchingMetadata(input),
          contentLength: input.sourceBuffer.length + 1,
        }),
        now: () => new Date("2026-07-31T08:00:00.000Z"),
      }),
    (error) => assertSmokeError(error, "package", "b2_size_mismatch"),
  );
});

test("missing source SHA-256 metadata fails closed", async () => {
  const input = smokeInput();
  await assert.rejects(
    () =>
      runVerifiedMediaPackageSmoke({
        input,
        getFileInfo: async () => ({
          ...matchingMetadata(input),
          fileInfo: {},
        }),
        now: () => new Date("2026-07-31T08:00:00.000Z"),
      }),
    (error) => assertSmokeError(error, "package", "b2_sha256_mismatch"),
  );
});

test("upstream failures are reduced to stable non-sensitive codes", async () => {
  const secret = "upstream-secret-that-must-not-leak";
  await assert.rejects(
    () =>
      runVerifiedMediaPackageSmoke({
        input: smokeInput(),
        getFileInfo: async () => {
          throw new Error(secret);
        },
        now: () => new Date("2026-07-31T08:00:00.000Z"),
      }),
    (error) =>
      assertSmokeError(error, "package", "b2_lookup_failed") &&
      !String(error).includes(secret),
  );
});

test("invalid request metrics fail closed instead of leaking arbitrary fields", async () => {
  const getFileInfo = async () => matchingMetadata();
  Object.defineProperty(getFileInfo, "getRequestMetrics", {
    value: () => ({
      authorizationHttpAttemptCount: 1,
      getFileInfoHttpAttemptCount: 1,
      authRetryCount: 0,
      authRetryReasonCounts: {
        bad_auth_token: 0,
        expired_auth_token: 0,
      },
      secret: "must-not-be-returned",
    }),
  });

  await assert.rejects(
    () =>
      runVerifiedMediaPackageSmoke({
        input: smokeInput(),
        getFileInfo,
        now: () => new Date("2026-07-31T08:00:00.000Z"),
      }),
    (error) =>
      assertSmokeError(
        error,
        "instrumentation",
        "invalid_b2_request_metrics",
      ) && !String(error).includes("must-not-be-returned"),
  );
});

test("hostile metrics hooks and records map to the stable instrumentation error", async () => {
  const secret = "hostile-metrics-secret";
  const cases = [];

  const throwingHook = async () => matchingMetadata();
  Object.defineProperty(throwingHook, "getRequestMetrics", {
    get() {
      throw new Error(secret);
    },
  });
  cases.push(throwingHook);

  const revokedRecord = async () => matchingMetadata();
  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  Object.defineProperty(revokedRecord, "getRequestMetrics", {
    value: () => revocable.proxy,
  });
  cases.push(revokedRecord);

  let getterCalled = false;
  const accessorRecord = async () => matchingMetadata();
  const metricsWithAccessor = {
    authorizationHttpAttemptCount: 1,
    getFileInfoHttpAttemptCount: 1,
    authRetryReasonCounts: {
      bad_auth_token: 0,
      expired_auth_token: 0,
    },
  };
  Object.defineProperty(metricsWithAccessor, "authRetryCount", {
    enumerable: true,
    get() {
      getterCalled = true;
      throw new Error(secret);
    },
  });
  Object.defineProperty(accessorRecord, "getRequestMetrics", {
    value: () => metricsWithAccessor,
  });
  cases.push(accessorRecord);

  for (const getFileInfo of cases) {
    await assert.rejects(
      () =>
        runVerifiedMediaPackageSmoke({
          input: smokeInput(),
          getFileInfo,
          now: () => new Date("2026-07-31T08:00:00.000Z"),
        }),
      (error) =>
        assertSmokeError(
          error,
          "instrumentation",
          "invalid_b2_request_metrics",
        ) && !String(error).includes(secret),
    );
  }
  assert.equal(getterCalled, false);
});

test("invalid input is rejected before B2 lookup", async () => {
  let lookups = 0;
  await assert.rejects(
    () =>
      runVerifiedMediaPackageSmoke({
        input: {
          ...smokeInput(),
          objectKey: "  ",
        },
        getFileInfo: async () => {
          lookups++;
          return matchingMetadata();
        },
      }),
    (error) => assertSmokeError(error, "input", "invalid_input"),
  );
  assert.equal(lookups, 0);
});
