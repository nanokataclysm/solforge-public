#!/usr/bin/env node
import fs from "node:fs/promises";
import { verifyIndependentMediaPackage } from "../lib/independent-media-package-verifier.mjs";

const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const MAX_KEY_DOCUMENT_BYTES = 32 * 1024;
const SHA256_LOWER = /^[0-9a-f]{64}$/;

function cliFailure(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function parseArguments(argv) {
  const options = {
    packagePath: null,
    baseUrl: null,
    expectedFingerprint:
      process.env.SOLFORGE_EXPECTED_SIGNING_FINGERPRINT || null,
    trustEndpointOnly: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--package") {
      if (options.packagePath !== null || index + 1 >= argv.length) {
        cliFailure("invalid_arguments");
      }
      options.packagePath = argv[++index];
    } else if (argument === "--base-url") {
      if (options.baseUrl !== null || index + 1 >= argv.length) {
        cliFailure("invalid_arguments");
      }
      options.baseUrl = argv[++index];
    } else if (argument === "--expected-fingerprint") {
      if (
        options.expectedFingerprint !== null ||
        index + 1 >= argv.length
      ) {
        cliFailure("invalid_arguments");
      }
      options.expectedFingerprint = argv[++index];
    } else if (argument === "--trust-endpoint-only") {
      if (options.trustEndpointOnly) cliFailure("invalid_arguments");
      options.trustEndpointOnly = true;
    } else {
      cliFailure("invalid_arguments");
    }
  }

  if (!options.packagePath || !options.baseUrl) {
    cliFailure("missing_required_arguments");
  }
  if (
    options.expectedFingerprint !== null &&
    !SHA256_LOWER.test(options.expectedFingerprint)
  ) {
    cliFailure("invalid_expected_fingerprint");
  }
  if (options.expectedFingerprint && options.trustEndpointOnly) {
    cliFailure("conflicting_trust_options");
  }
  if (!options.expectedFingerprint && !options.trustEndpointOnly) {
    cliFailure("missing_trust_anchor");
  }

  return options;
}

function publicKeyUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    cliFailure("invalid_base_url");
  }

  if (url.username || url.password) cliFailure("invalid_base_url");
  const localHttp =
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    cliFailure("insecure_base_url");
  }

  url.pathname = "/api/signing/public-key";
  url.search = "";
  url.hash = "";
  return url;
}

async function readJsonFile(filePath) {
  let content;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    cliFailure("package_read_failed");
  }
  if (Buffer.byteLength(content, "utf8") > MAX_PACKAGE_BYTES) {
    cliFailure("package_too_large");
  }
  try {
    return JSON.parse(content);
  } catch {
    cliFailure("invalid_package_json");
  }
}

async function fetchPublicKeyDocument(url) {
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    cliFailure("public_key_fetch_failed");
  }
  if (response.status !== 200) cliFailure("public_key_http_error");

  let text;
  try {
    text = await response.text();
  } catch {
    cliFailure("public_key_read_failed");
  }
  if (Buffer.byteLength(text, "utf8") > MAX_KEY_DOCUMENT_BYTES) {
    cliFailure("public_key_document_too_large");
  }
  try {
    return JSON.parse(text);
  } catch {
    cliFailure("invalid_public_key_json");
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const packageResponse = await readJsonFile(options.packagePath);
  const publicKeyDocument = await fetchPublicKeyDocument(
    publicKeyUrl(options.baseUrl),
  );
  const result = verifyIndependentMediaPackage({
    packageResponse,
    publicKeyDocument,
    ...(options.expectedFingerprint
      ? { expectedFingerprint: options.expectedFingerprint }
      : {}),
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: false,
        stage: "cli",
        code:
          typeof error?.code === "string"
            ? error.code
            : "verification_failed",
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
});
