import test from "node:test";
import assert from "node:assert/strict";
import {
  createB2GetFileInfo,
  createB2GetFileInfoFromEnv,
} from "../lib/b2-get-file-info-adapter.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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

function fileInfo(fileId = "file-1") {
  return {
    action: "upload",
    fileId,
    fileName: "media/source.png",
    contentLength: 12,
    contentType: "image/png",
    fileInfo: { src_sha256: "a".repeat(64) },
  };
}

function emptyMetrics() {
  return {
    authorizationHttpAttemptCount: 0,
    getFileInfoHttpAttemptCount: 0,
    authRetryCount: 0,
    authRetryReasonCounts: {
      bad_auth_token: 0,
      expired_auth_token: 0,
    },
  };
}

test("environment factory is disabled when credentials are absent", () => {
  assert.equal(createB2GetFileInfoFromEnv({}), undefined);
  assert.throws(
    () =>
      createB2GetFileInfoFromEnv({
        B2_APPLICATION_KEY_ID: "key-id",
      }),
    /configured together/,
  );
});

test("authorizes with Native API v4, caches the token, and counts HTTP attempts", async () => {
  const calls = [];
  const getFileInfo = createB2GetFileInfo({
    applicationKeyId: "test-key-id",
    applicationKey: "test-application-key",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) return jsonResponse(authorization());
      return jsonResponse(fileInfo(new URL(url).searchParams.get("fileId")));
    },
  });

  assert.deepEqual(getFileInfo.getRequestMetrics(), emptyMetrics());
  assert.deepEqual(await getFileInfo({ fileId: "file-1" }), fileInfo("file-1"));
  assert.deepEqual(await getFileInfo({ fileId: "file-2" }), fileInfo("file-2"));
  assert.equal(calls.length, 3);
  assert.equal(
    calls[0].url,
    "https://api.backblazeb2.com/b2api/v4/b2_authorize_account",
  );
  assert.equal(
    Buffer.from(
      calls[0].init.headers.Authorization.slice("Basic ".length),
      "base64",
    ).toString("utf8"),
    "test-key-id:test-application-key",
  );
  assert.match(calls[1].url, /b2api\/v4\/b2_get_file_info/);
  assert.equal(calls[1].init.headers.Authorization, "token-1");
  assert.deepEqual(getFileInfo.getRequestMetrics(), {
    ...emptyMetrics(),
    authorizationHttpAttemptCount: 1,
    getFileInfoHttpAttemptCount: 2,
  });
});

test("concurrent lookups share one authorization request", async () => {
  let authorizeCalls = 0;
  const getFileInfo = createB2GetFileInfo({
    applicationKeyId: "test-key-id",
    applicationKey: "test-application-key",
    fetchImpl: async (url) => {
      if (String(url).includes("b2_authorize_account")) {
        authorizeCalls++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return jsonResponse(authorization());
      }
      return jsonResponse(fileInfo(new URL(url).searchParams.get("fileId")));
    },
  });

  await Promise.all([
    getFileInfo({ fileId: "file-1" }),
    getFileInfo({ fileId: "file-2" }),
  ]);
  assert.equal(authorizeCalls, 1);
  assert.deepEqual(getFileInfo.getRequestMetrics(), {
    ...emptyMetrics(),
    authorizationHttpAttemptCount: 1,
    getFileInfoHttpAttemptCount: 2,
  });
});

test("expired authorization is refreshed once and records the retry reason", async () => {
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
      return jsonResponse(fileInfo("file-1"));
    },
  });

  assert.deepEqual(await getFileInfo({ fileId: "file-1" }), fileInfo("file-1"));
  assert.equal(authorizeCalls, 2);
  assert.equal(infoCalls, 2);
  assert.deepEqual(getFileInfo.getRequestMetrics(), {
    authorizationHttpAttemptCount: 2,
    getFileInfoHttpAttemptCount: 2,
    authRetryCount: 1,
    authRetryReasonCounts: {
      bad_auth_token: 0,
      expired_auth_token: 1,
    },
  });
});

test("request metrics use a closed secret-free immutable schema", async () => {
  const secret = "do-not-expose-this-key";
  const getFileInfo = createB2GetFileInfo({
    applicationKeyId: "test-key-id",
    applicationKey: secret,
    fetchImpl: async (url) =>
      String(url).includes("b2_authorize_account")
        ? jsonResponse(authorization("private-token"))
        : jsonResponse(fileInfo("private-file-id")),
  });

  await getFileInfo({ fileId: "private-file-id" });
  const metrics = getFileInfo.getRequestMetrics();
  assert.deepEqual(Object.keys(metrics).sort(), [
    "authRetryCount",
    "authRetryReasonCounts",
    "authorizationHttpAttemptCount",
    "getFileInfoHttpAttemptCount",
  ]);
  assert.deepEqual(Object.keys(metrics.authRetryReasonCounts).sort(), [
    "bad_auth_token",
    "expired_auth_token",
  ]);
  assert.equal(Object.isFrozen(metrics), true);
  assert.equal(Object.isFrozen(metrics.authRetryReasonCounts), true);
  const serialized = JSON.stringify(metrics);
  for (const sensitive of [
    secret,
    "test-key-id",
    "private-token",
    "private-file-id",
  ]) {
    assert.equal(serialized.includes(sensitive), false);
  }
});

test("authorization must grant readFiles and use a Backblaze HTTPS API URL", async () => {
  for (const payload of [
    {
      authorizationToken: "token",
      apiInfo: {
        storageApi: {
          apiUrl: "https://api001.backblazeb2.com",
          allowed: { capabilities: ["listFiles"] },
        },
      },
    },
    {
      authorizationToken: "token",
      apiInfo: {
        storageApi: {
          apiUrl: "https://example.com",
          allowed: { capabilities: ["readFiles"] },
        },
      },
    },
  ]) {
    const getFileInfo = createB2GetFileInfo({
      applicationKeyId: "test-key-id",
      applicationKey: "test-application-key",
      fetchImpl: async () => jsonResponse(payload),
    });
    await assert.rejects(
      () => getFileInfo({ fileId: "file-1" }),
      (error) =>
        error.message === "Backblaze B2 request failed" &&
        error.code === "invalid_authorization_response",
    );
    assert.equal(
      getFileInfo.getRequestMetrics().authorizationHttpAttemptCount,
      1,
    );
  }
});

test("failures never expose credentials or upstream response text", async () => {
  const secret = "do-not-leak-this-key";
  const getFileInfo = createB2GetFileInfo({
    applicationKeyId: "test-key-id",
    applicationKey: secret,
    fetchImpl: async () =>
      jsonResponse(
        {
          status: 401,
          code: "unauthorized",
          message: `upstream included ${secret}`,
        },
        401,
      ),
  });

  await assert.rejects(
    () => getFileInfo({ fileId: "file-1" }),
    (error) =>
      error.message === "Backblaze B2 request failed" &&
      error.code === "authorization_failed" &&
      !String(error).includes(secret),
  );
  assert.deepEqual(getFileInfo.getRequestMetrics(), {
    ...emptyMetrics(),
    authorizationHttpAttemptCount: 1,
  });
});
