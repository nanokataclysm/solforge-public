# Verified media package operator smoke

## Purpose

This runbook validates the merged verified-media package path locally against one real Backblaze B2 object. It exercises the real approval and package HTTP routes, the read-only B2 adapter, stored-object verification, ephemeral Ed25519 signing, receipt verification, intent-mutation rejection, and approval replay rejection.

The smoke does not deploy anything and does not use the Production signing key.

## Safety boundary

The smoke performs metadata reads only. It does not upload, copy, hide, delete, rename, or download the B2 object. It starts an in-process Express server bound to `127.0.0.1` and uses in-memory authentication and approval stores.

Use a short-lived Backblaze application key with:

- `Read Only` access;
- restriction to the single test bucket;
- no filename prefix unless it exactly includes the test object;
- no permission to list every bucket name.

Revoke the temporary key after the run.

## Provenance-ready object requirement

The object must already contain custom file information named `src_sha256`. Its value must be the lowercase 64-character SHA-256 digest of the exact local source file.

Backblaze stores custom upload information and returns it through `b2_get_file_info`. The normal web-console upload may not add `src_sha256`; an object without it will correctly fail with `b2_sha256_mismatch`.

Object preparation is deliberately outside this read-only smoke. Do not create or replace an object without separate operator approval.

## Required values

- `B2_APPLICATION_KEY_ID`: temporary read-only key ID
- `B2_APPLICATION_KEY`: temporary application key secret
- `B2_FILE_ID`: ID of the existing test object
- `MEDIA_SOURCE_PATH`: path to the exact local source file
- `MEDIA_B2_OBJECT_KEY`: full stored B2 object name, including any folder prefix
- `MEDIA_CONTENT_TYPE`: exact MIME type stored on the B2 object

The script computes the local byte size and SHA-256. It does not accept those values from the operator.

## Run

Run from any location inside a Solforge checkout. The command resolves the repository root through Git rather than relying on an operator-specific path.

```zsh
repo_root="$(git rev-parse --show-toplevel)" || exit 1
cd "$repo_root" || exit 1

(
  set -euo pipefail
  trap 'unset B2_APPLICATION_KEY_ID B2_APPLICATION_KEY B2_FILE_ID MEDIA_SOURCE_PATH MEDIA_B2_OBJECT_KEY MEDIA_CONTENT_TYPE' EXIT

  export B2_APPLICATION_KEY_ID="$(
    python3 -c 'import sys; sys.stderr.write("Backblaze key ID: "); sys.stderr.flush(); print(input(), end="")'
  )"
  export B2_APPLICATION_KEY="$(
    python3 -c 'import getpass; print(getpass.getpass("Backblaze application key: "), end="")'
  )"
  export B2_FILE_ID="$(
    python3 -c 'import sys; sys.stderr.write("B2 file ID: "); sys.stderr.flush(); print(input(), end="")'
  )"
  export MEDIA_SOURCE_PATH="$(
    python3 -c 'import sys; sys.stderr.write("Local source path: "); sys.stderr.flush(); print(input(), end="")'
  )"
  export MEDIA_B2_OBJECT_KEY="$(
    python3 -c 'import sys; sys.stderr.write("Full B2 object name: "); sys.stderr.flush(); print(input(), end="")'
  )"
  export MEDIA_CONTENT_TYPE="$(
    python3 -c 'import sys; sys.stderr.write("Stored MIME type: "); sys.stderr.flush(); print(input(), end="")'
  )"

  cd apps/orchestrator || exit 1
  npm run smoke:verified-media
)
```

The application-key secret is hidden and none of the supplied values are written to a repository file.

## Expected success

A successful result is sanitized JSON containing:

- `ok: true`
- `changedIntentRejectedBeforeLookup: true`
- `packageStatus: 200`
- `verifiedAssetCount: 1`
- `receiptVerified: true`
- `replayRejected: true`
- `b2LookupCount: 1`
- `b2AdapterInvocationCount: 1`
- `b2RequestMetrics.authorizationHttpAttemptCount`
- `b2RequestMetrics.getFileInfoHttpAttemptCount`
- `b2RequestMetrics.authRetryCount`
- `b2RequestMetrics.authRetryReasonCounts.bad_auth_token`
- `b2RequestMetrics.authRetryReasonCounts.expired_auth_token`

`b2LookupCount` is retained as a compatibility alias for the logical adapter invocation count. It is not an HTTP request counter. `b2AdapterInvocationCount` states that meaning explicitly.

For a normal first-attempt success, the request-level metrics should report one authorization HTTP attempt, one `b2_get_file_info` HTTP attempt, and zero retries. If Backblaze rejects a cached token with `bad_auth_token` or `expired_auth_token`, the adapter can report two authorization attempts, two file-info attempts, and one retry with the matching fixed reason count.

The request metrics use a closed numeric schema. The output includes receipt and intent digests but never prints the application key, authorization token, B2 file ID, request URL, headers, or upstream response body.

## Common failures

- `authorization_failed`: key ID/secret rejected or expired
- `b2_lookup_failed`: metadata request failed
- `b2_object_key_mismatch`: supplied full object name differs from B2
- `b2_size_mismatch`: local source bytes differ from the stored object
- `b2_content_type_mismatch`: supplied MIME type differs from B2
- `b2_sha256_mismatch`: `src_sha256` is absent or differs from the local file
- `changed_intent_not_rejected_before_lookup`: approval binding regression
- `approval_replay_not_rejected`: single-use approval regression
- `invalid_b2_request_metrics`: adapter instrumentation returned an unexpected or unsafe shape

Do not weaken a mismatch check to make the smoke pass. Fix the test object or the supplied expected values.

## Cleanup

Revoke the temporary Backblaze key. The local server, in-memory sessions, ephemeral signing key, and environment variables are discarded when the process exits.
