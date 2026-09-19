# Security policy

## Supported status

Solforge is a public-alpha candidate produced from a private source repository. Security-sensitive interfaces may change while the project is hardened, but reports affecting the current default branch are welcome.

The `solforge-dev` signing identity and any protected development deployment are not Production trust anchors.

## Reporting a vulnerability

Use GitHub private vulnerability reporting when it is enabled for the repository. Otherwise, contact the repository owner through a private GitHub channel. Do not disclose a suspected vulnerability in a public issue, discussion, pull request, screenshot, log, or transcript.

Include only what is needed to reproduce and assess the issue:

- affected commit, endpoint, module, or workflow;
- reproduction steps using placeholder credentials;
- expected and observed behavior;
- likely impact;
- a proposed mitigation, when known.

Never include live API keys, Redis tokens, B2 credentials, private signing keys, access codes, cookies, creator data, or unredacted infrastructure logs.

## Security boundaries

Solforge treats user briefs, model output, generated plans, imported artifacts, public metadata, and client-supplied approval state as untrusted input.

The intended boundaries are:

- authentication state is held in server-side sessions;
- state-changing API requests require the application CSRF header;
- human approval is bound to the authenticated session and exact operation context;
- approval nonces are one-time and fail closed on replay;
- client-supplied `approved: true` values are insufficient;
- model output is parsed and validated before use;
- mission analysis may propose actions but does not execute them;
- B2 access used by verified-media is read-only and metadata-scoped;
- signature verification binds the receipt, package fingerprint, public key, and issuer;
- credentials and private signing keys remain outside Git;
- deployment promotion, DNS, storage mutation, purchases, and credential changes require separate explicit authorization.

## Secret handling

Do not commit or paste into reviews:

- `.env` files or provider credentials;
- Redis, database, or storage connection secrets;
- B2 application keys or full file identifiers;
- private keys, seed phrases, or signing material;
- deployment tokens or cloud service-account files;
- access codes, session cookies, or authentication headers;
- personal creator, client, collaborator, or third-party data.

If a live secret is committed or exposed, stop work, revoke or rotate it, remove it from the current tree, assess Git history and caches, and verify the cleaned repository before restoring public access.

## Development signing

The current public key and SHA-256 fingerprint are verification metadata. The matching private key is not public material.

The current issuer is `solforge-dev`. This repository does not claim hardware-backed custody, external key attestation, Production signing, or an offline trust anchor.

## Public-release safety

A passing CI run or healthy development deployment does not authorize publication or Production use. The exact exported candidate must pass the release gate and receive human approval before target-repository creation or visibility changes. See [`docs/public-release-checklist.md`](docs/public-release-checklist.md).
