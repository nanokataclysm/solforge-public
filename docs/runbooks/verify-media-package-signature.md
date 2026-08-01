# Independently verify a verified-media package

## Purpose

Use this runbook to verify a captured successful response from `POST /api/media/package` outside the Solforge server process.

The verifier:

- fetches the public Ed25519 key document from `GET /api/signing/public-key`;
- recomputes the public-key fingerprint from the returned PEM;
- compares the key document, package response, and receipt identity;
- recomputes the canonical receipt digest;
- independently verifies the Ed25519 signature;
- optionally requires an out-of-band fingerprint pin;
- prints only sanitized verification results, never the PEM, signature, receipt, or package body.

The signing private key remains server-side and is not needed by this workflow.

## Trust modes

### Pinned verification

Pinned verification is the preferred mode. Supply a 64-character lowercase SHA-256 fingerprint obtained from a separately trusted operator record, such as a password-manager entry or reviewed evidence created before the verification run.

Do not obtain the expected pin from the same public-key endpoint in the same verification run. Doing so verifies cryptographic consistency but does not establish key continuity.

### Endpoint-only verification

Endpoint-only mode verifies the package signature against the public key served by the deployment over HTTPS. It proves that the captured receipt was signed by the key returned by that endpoint, but it does not independently prove that the key is the previously trusted signing identity.

This weaker mode requires the explicit `--trust-endpoint-only` flag so it cannot be selected accidentally.

## Prepare the package response

Store the exact JSON response body returned by a successful `POST /api/media/package` request in a temporary file. Do not edit or reformat individual fields before verification.

Keep the file outside the repository, restrict it to the operator account, and delete it after evidence is recorded. The response does not contain the signing private key, but it may contain object names and package metadata that should not be published casually.

## Run pinned verification

Run from any location inside a Solforge checkout. The command resolves the repository root through Git.

```zsh
repo_root="$(git rev-parse --show-toplevel)" || exit 1
cd "$repo_root" || exit 1

npm --prefix apps/orchestrator run verify:media-package -- \
  --package "$HOME/.config/solforge/media-package-response.json" \
  --base-url "https://solforge-preview.example" \
  --expected-fingerprint "<64-lowercase-hex-fingerprint>"
```

A successful result has this shape:

```json
{
  "ok": true,
  "signatureVerified": true,
  "receiptDigestVerified": true,
  "publicKeyDocumentVerified": true,
  "packageFingerprintVerified": true,
  "pinVerified": true,
  "trustMode": "pinned",
  "fingerprint": "<64-lowercase-hex-fingerprint>",
  "algorithm": "Ed25519",
  "issuer": "solforge-dev"
}
```

The fingerprint is public verification metadata, not a credential. The command does not require the demo access code, B2 credentials, Vercel credentials, or a signing private key.

## Run endpoint-only verification

Use this only when an independently trusted fingerprint is not yet available:

```zsh
repo_root="$(git rev-parse --show-toplevel)" || exit 1
cd "$repo_root" || exit 1

npm --prefix apps/orchestrator run verify:media-package -- \
  --package "$HOME/.config/solforge/media-package-response.json" \
  --base-url "https://solforge-preview.example" \
  --trust-endpoint-only
```

A successful result reports `"trustMode": "endpoint-only"` and `"pinVerified": null`. Record that limitation explicitly in any evidence.

## Failure behavior

The verifier exits nonzero and returns only a bounded stage and code. Examples include:

- `public_key_document/fingerprint_mismatch`;
- `pin/fingerprint_mismatch`;
- `key_binding/package_fingerprint_mismatch`;
- `receipt/receipt_digest_mismatch`;
- `signature/signature_verification_failed`;
- `cli/insecure_base_url`;
- `cli/missing_trust_anchor`.

A failure must stop the release gate. Do not replace the expected fingerprint, rotate keys, modify the deployment, or retry with endpoint-only mode merely to make the check pass. Diagnose the mismatch first and obtain explicit operator approval before any credential or deployment mutation.

## Safety boundary

This verifier is read-only. It fetches one public endpoint and reads one local JSON file. It does not:

- authenticate to the application;
- create or consume approvals;
- call Qwen;
- read B2 metadata or object bytes;
- upload, modify, or delete objects;
- change Vercel, DNS, databases, credentials, or Production;
- prove that the captured response came from a particular Git commit or deployment ID.

Use the deployment runbook and bounded B2 smoke alongside this verifier when a full Preview release gate is required.

## Rollback

No service rollback is required because verification is read-only. Remove this script and runbook by reverting the repository commit that introduced them.
