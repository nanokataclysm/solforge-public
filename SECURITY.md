# Security Policy

## Supported version

Security fixes target the current default branch and the latest published release candidate.

## Reporting a vulnerability

Do not place sensitive vulnerability details, credentials, private keys, session cookies, access codes, or active exploit steps in a public issue.

Use GitHub private vulnerability reporting or a private security advisory when available. Otherwise, contact the repository maintainer privately through GitHub before sharing technical details.

Include only what is necessary to reproduce the issue safely:

- affected component;
- observed and expected behavior;
- minimal reproduction steps;
- impact assessment;
- whether any production system was touched.

Do not paste exposed secret values. Refer to them by type and location only.

## High-priority areas

- authentication bypass;
- session fixation or leakage;
- approval-digest mismatch;
- approval replay or expiry failure;
- acceptance of client-only approval claims;
- signing-key exposure;
- invalid signature acceptance;
- preview escape or unintended code execution;
- production or DNS mutation from a preview path;
- secret material in logs or generated artifacts;
- rate-limit bypass.

## Safe testing

Do not:

- test destructively against production;
- perform denial-of-service or high-volume rate-limit testing;
- access unrelated accounts, repositories, or infrastructure;
- retain or redistribute data encountered during testing;
- weaken a security assertion merely to make a test pass.

Use local or isolated preview environments whenever possible.

## Signing identity

The repository supports a development Ed25519 signing identity. Development signing is not production key custody, hardware-backed storage, or a guarantee of release provenance.

Private signing keys must never be committed to Git.
