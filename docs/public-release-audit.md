# Solforge public-release audit

## Current status

This document records the repository-native audit that preceded the history-free public-alpha publication. The original audit was intentionally conservative and did not authorize visibility changes. Its pre-publication no-go decision was later superseded by exact export certification, explicit operator approval, and independent validation in the public target.

The history-free source is now published in [`nanokataclysm/solforge-public`](https://github.com/nanokataclysm/solforge-public). Production, DNS, credentials, databases, B2 objects, authentication providers, signing keys, billing, and deployment remain out of scope.

## Original recorded run — 2026-08-01

The redacted private-source audit completed successfully in GitHub Actions:

- workflow: `Public release audit`;
- run number: `5`;
- run ID: `30700546241`;
- report artifact ID: `8818672487`;
- artifact digest: `sha256:252d32fa8dc40ec697bd80d1f0cdd9890f8435116796bd04a0a01a16a727eb81`;
- exact scanned head: `ad2c6140be30b029aeb2a0be3329ee823b44d647`;
- matched values printed or stored: no;
- findings truncated: no;
- high-confidence secret findings: `0`;
- high-confidence gate: passed;
- Solforge CI run `103`: passed on the same head.

The scanner inventoried the private current tree as:

- tracked files: `194`;
- tracked bytes: `21,554,521`;
- binary files: `36`;
- media files: `36`;
- operator, transcript, handoff, or evidence-export paths: `21`;
- oversized current files skipped: `0`.

The reachable-history scan covered:

- reachable Git blobs: `490`;
- textual blobs scanned: `447`;
- binary blobs inventoried but not text-scanned: `43`;
- oversized historical blobs skipped: `0`;
- historical text bytes scanned: `20,456,593`.

The report recorded `12` medium-review assignments in `.env.example` paths. Only variable names, paths, line numbers, and truncated blob identifiers were recorded. These assignments did not match a structured token format and were later reviewed as explicit placeholders.

The report recorded `557` privacy or operational occurrences across `32` private-source paths:

- local operator paths: `419`;
- email-address patterns: `63`;
- session or chat identifiers: `72`;
- public IP-address patterns: `3`.

These findings established the manual-review and exclusion set. They were not copied into the history-free public repository.

## Publication certification

The approved publication baseline used private canonical source commit `fc9d4f27543e38b2a6a864a847b4888a498137dc` and produced:

- included public files: `103`;
- excluded private-source-only files: `97`;
- certified tree SHA-256: `738be5bb886c7411314644949302cde02e0a51b5162e49f9b9b453db5bcc8076`;
- certified archive SHA-256: `7a60c215852b6b730ad63096a82a98cbd3ba498cbac6536874a4f4a65144b14e`;
- private certification artifact ID: `8825790866`;
- public verification artifact ID: `8825806523`.

The public target independently rebuilt identical tree and archive hashes. Public candidate export, public release audit, and Solforge CI each passed twice on the exact public PR head before squash merge commit `e644216ab10602eb642fad32b0e10c007ce28919`.

## Why this scanner exists

A normal pull-request diff cannot answer whether a private repository is safe to publish. Public visibility can expose the current tree, reachable Git history, branches, tags, media, documentation, and operational context.

The source audit therefore runs against a full checkout and fetches repository branches and tags before scanning reachable Git blobs. The exported-target audit instead validates the history-free public tree and its public repository history.

## Redaction contract

The scanner never prints or stores matched values. Findings contain only:

- scope: current tree or reachable history;
- detector identifier;
- severity;
- repository path;
- line number when available;
- truncated Git blob identifier;
- sensitive variable name when the detector is an assignment rule.

The generated JSON report does not contain credential values, cookies, authorization headers, private-key bodies, or matched text fragments.

## Detector classes

High-confidence secret detectors include:

- complete private-key PEM blocks;
- GitHub, OpenAI, AWS, Google, Slack, and Stripe token formats;
- non-placeholder credentials embedded in URLs;
- bearer authorization values;
- non-example uppercase environment assignments to sensitive variable names.

Medium-review detectors include JWT-shaped strings and non-placeholder assignments in `.env.example` paths.

Privacy and operational detectors include local operator home paths, email addresses outside explicit example domains, session or chat identifiers, public IP addresses, handoffs, transcripts, evidence exports, and media inventory.

## Manual-review boundary

Automation cannot decide whether raw transcripts, handoffs, screenshots, audio, video, organizer correspondence, names, likenesses, client information, or third-party material are safe or licensed for publication. Those categories remain private-source-only unless separately rewritten and explicitly approved.

A passing automated scan does not prove the absence of secrets. It establishes that the implemented detectors found no high-confidence matches in the scanned material and that reviewed public exceptions remain within the allowlist.

## Ongoing decision rule

Every post-publication stabilization or release candidate must:

1. classify every tracked source path;
2. build the exact history-free export twice;
3. verify file hashes, modes, archive metadata, and exclusion boundaries;
4. run the redacted audit on the exact exported tree;
5. run clean-install Node.js 24 tests and policy checks;
6. receive explicit human approval before any new consequential external action.

Repository hardening and release tagging do not authorize Production, DNS, credential, storage, billing, authentication-provider, or signing-key changes.
