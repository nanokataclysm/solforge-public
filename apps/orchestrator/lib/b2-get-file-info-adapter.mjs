const AUTHORIZE_URL =
  "https://api.backblazeb2.com/b2api/v4/b2_authorize_account";
const AUTH_CACHE_MS = 23 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8_000;
const RETRYABLE_AUTH_CODES = new Set([
  "bad_auth_token",
  "expired_auth_token",
]);

function stableError(code) {
  const error = new Error("Backblaze B2 request failed");
  error.code = code;
  return error;
}

function validCredential(value, maxLength) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}

function validFileId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1024 &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}

function storageApiFrom(payload) {
  const storageApi = payload?.apiInfo?.storageApi;
  if (
    !storageApi ||
    typeof storageApi !== "object" ||
    typeof payload.authorizationToken !== "string" ||
    payload.authorizationToken.length === 0 ||
    typeof storageApi.apiUrl !== "string" ||
    !Array.isArray(storageApi.allowed?.capabilities) ||
    !storageApi.allowed.capabilities.includes("readFiles")
  ) {
    throw stableError("invalid_authorization_response");
  }

  let apiUrl;
  try {
    apiUrl = new URL(storageApi.apiUrl);
  } catch {
    throw stableError("invalid_authorization_response");
  }
  if (
    apiUrl.protocol !== "https:" ||
    !(
      apiUrl.hostname === "backblazeb2.com" ||
      apiUrl.hostname.endsWith(".backblazeb2.com")
    ) ||
    apiUrl.username ||
    apiUrl.password ||
    apiUrl.search ||
    apiUrl.hash
  ) {
    throw stableError("invalid_authorization_response");
  }

  return {
    authorizationToken: payload.authorizationToken,
    apiUrl: apiUrl.origin,
  };
}

async function requestJson(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw stableError("invalid_json_response");
    }
    return { response, payload };
  } catch (error) {
    if (error?.code) throw error;
    throw stableError(
      error?.name === "AbortError" ? "request_timeout" : "request_failed",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function createB2GetFileInfo(options = {}) {
  const {
    applicationKeyId,
    applicationKey,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = Date.now,
  } = options;

  if (
    !validCredential(applicationKeyId, 256) ||
    applicationKeyId.includes(":") ||
    !validCredential(applicationKey, 512) ||
    typeof fetchImpl !== "function" ||
    typeof now !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 60_000
  ) {
    throw new Error("Invalid Backblaze B2 adapter configuration");
  }

  let cachedAuthorization = null;
  let authorizationPromise = null;
  let authorizationHttpAttemptCount = 0;
  let getFileInfoHttpAttemptCount = 0;
  let authRetryCount = 0;
  const authRetryReasonCounts = {
    bad_auth_token: 0,
    expired_auth_token: 0,
  };

  function getRequestMetrics() {
    return Object.freeze({
      authorizationHttpAttemptCount,
      getFileInfoHttpAttemptCount,
      authRetryCount,
      authRetryReasonCounts: Object.freeze({
        bad_auth_token: authRetryReasonCounts.bad_auth_token,
        expired_auth_token: authRetryReasonCounts.expired_auth_token,
      }),
    });
  }

  async function authorizeFresh() {
    authorizationHttpAttemptCount++;
    const basic = Buffer.from(
      `${applicationKeyId}:${applicationKey}`,
      "utf8",
    ).toString("base64");
    const { response, payload } = await requestJson(
      fetchImpl,
      AUTHORIZE_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${basic}`,
          Accept: "application/json",
        },
      },
      timeoutMs,
    );
    if (!response.ok) {
      throw stableError("authorization_failed");
    }

    const authorized = storageApiFrom(payload);
    return {
      ...authorized,
      expiresAt: now() + AUTH_CACHE_MS,
    };
  }

  async function authorize() {
    if (
      cachedAuthorization &&
      cachedAuthorization.expiresAt > now()
    ) {
      return cachedAuthorization;
    }
    if (!authorizationPromise) {
      authorizationPromise = authorizeFresh()
        .then((authorized) => {
          cachedAuthorization = authorized;
          return authorized;
        })
        .finally(() => {
          authorizationPromise = null;
        });
    }
    return authorizationPromise;
  }

  async function fetchFileInfo(fileId, authorized) {
    getFileInfoHttpAttemptCount++;
    const url = new URL(
      "/b2api/v4/b2_get_file_info",
      authorized.apiUrl,
    );
    url.searchParams.set("fileId", fileId);
    return requestJson(
      fetchImpl,
      url,
      {
        method: "GET",
        headers: {
          Authorization: authorized.authorizationToken,
          Accept: "application/json",
        },
      },
      timeoutMs,
    );
  }

  async function getFileInfo(request) {
    if (
      !request ||
      typeof request !== "object" ||
      Array.isArray(request) ||
      Object.getPrototypeOf(request) !== Object.prototype ||
      Object.getOwnPropertySymbols(request).length ||
      Object.getOwnPropertyNames(request).length !== 1 ||
      !Object.hasOwn(request, "fileId") ||
      !validFileId(request.fileId)
    ) {
      throw stableError("invalid_file_id");
    }

    let authorized = await authorize();
    let result = await fetchFileInfo(request.fileId, authorized);
    if (
      result.response.status === 401 &&
      RETRYABLE_AUTH_CODES.has(result.payload?.code)
    ) {
      const retryReason = result.payload.code;
      authRetryCount++;
      authRetryReasonCounts[retryReason]++;
      cachedAuthorization = null;
      authorized = await authorize();
      result = await fetchFileInfo(request.fileId, authorized);
    }

    if (!result.response.ok) {
      throw stableError("get_file_info_failed");
    }
    if (!result.payload || typeof result.payload !== "object") {
      throw stableError("invalid_file_info_response");
    }
    return result.payload;
  }

  Object.defineProperty(getFileInfo, "getRequestMetrics", {
    value: getRequestMetrics,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return getFileInfo;
}

export function createB2GetFileInfoFromEnv(
  env = process.env,
  options = {},
) {
  const applicationKeyId = env.B2_APPLICATION_KEY_ID;
  const applicationKey = env.B2_APPLICATION_KEY;
  const hasKeyId =
    typeof applicationKeyId === "string" && applicationKeyId.length > 0;
  const hasKey =
    typeof applicationKey === "string" && applicationKey.length > 0;

  if (!hasKeyId && !hasKey) return undefined;
  if (!hasKeyId || !hasKey) {
    throw new Error(
      "B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY must be configured together",
    );
  }

  return createB2GetFileInfo({
    ...options,
    applicationKeyId,
    applicationKey,
  });
}
