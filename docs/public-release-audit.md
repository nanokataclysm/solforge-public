# Solforge public-release audit

## Status

This document defines and records the repository-native audit used before any public-candidate decision. It does not authorize a visibility change.

- Assessed base: `main` at `036cbfbd0262f2a39c19aca06a99368b1aa80f51`.
- Successful audit head: `ad2c6140be30b029aeb2a0be3329ee823b44d647`.
- Audit branch: `agent/public-candidate-audit`.
- Repository visibility: private.
- Production, DNS, aliases, credentials, databases, B2 objects, authentication providers, billing, and repository settings are out of scope.
- Historical branches and evidence remain intact.

## Recorded run — 2026-08-01

The final redacted audit completed successfully in GitHub Actions:

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

The scanner inventoried the current tree as:

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

The report recorded `12` medium-review assignments in `.env.example` paths. Only variable names, paths, line numbers, and truncated blob identifiers were recorded. These example-file assignments did not match a structured token format and did not fail the high-confidence gate. They still require manual review before publication.

The report recorded `557` privacy or operational occurrences across `32` repository paths:

- local operator paths: `419`;
- email-address patterns: `63`;
- session or chat identifiers: `72`;
- public IP-address patterns: `3`.

The affected path groups include:

- root operator material: `AGENTS.md` and `WORKSPACE.md`;
- MCP operator documentation: `tools/mcp/README_MCP.md`;
- internal handoffs and master handoff documents under `docs/`;
- grant, organizer, and submission material under `docs/` and `evidence/01-submission-text/`;
- transcript, provenance, screenshot-inventory, and scrubbed-chat exports under `evidence/03-proof/exports/`;
- organizer correspondence under `evidence/for-organizers/`;
- a deployment-preflight test containing email-shaped fixtures.

These privacy findings are not proof that every occurrence is unsafe. They establish the manual-review set. The repository remains **NO-GO for public visibility**.

## Why this scanner exists

A normal pull-request diff cannot answer whether a private repository is safe to publish. Public visibility exposes the current tree, reachable Git history, branches, tags, media, documentation, and operational context.

The audit therefore runs inside GitHub Actions against a full checkout and explicitly fetches repository branches and tags before scanning every reachable Git blob.

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

## Current-tree inventory

The scanner records:

- tracked file and byte counts;
- top-level and extension counts;
- binary and oversized-file counts;
- media/archive paths;
- operator, handoff, transcript, and evidence-export paths;
- secret-pattern and privacy-pattern findings.

Binary media is inventoried by path and extension but is not OCR-scanned. Screenshots, audio, video, PDFs, and archives still require manual privacy and rights review.

## Reachable-history scan

The scanner:

1. enumerates objects reachable from all locally fetched refs;
2. identifies unique Git blobs and their historical paths;
3. scans textual blobs up to 5 MiB;
4. inventories skipped binary and oversized blobs;
5. deduplicates findings by scope, detector, path, line, and blob;
6. fails the workflow when a high-confidence secret detector matches.

A passing automated scan does not prove the absence of secrets. It establishes only that the implemented detectors found no high-confidence matches in the scanned material.

## Detector classes

High-confidence secret detectors include:

- complete private-key PEM blocks;
- GitHub, OpenAI, AWS, Google, Slack, and Stripe token formats;
- non-placeholder credentials embedded in URLs;
- bearer authorization values;
- non-example uppercase environment assignments to sensitive variable names.

Medium-review detectors include:

- JWT-shaped strings;
- non-placeholder assignments in `.env.example` paths.

Privacy and operational detectors include:

- local operator home paths;
- email addresses outside explicit example domains;
- session or chat identifiers in contextual text;
- public IP addresses;
- operator handoffs, transcripts, evidence exports, and media inventory.

## Required manual review

Automation cannot decide whether the following are safe or licensed for publication:

- raw chat transcripts and generated provenance exports;
- operator handoffs and infrastructure notes;
- screenshots and image archives;
- audio and video recordings;
- organizer and submission correspondence;
- names, likenesses, client information, or third-party material;
- whether a historical credential was real, expired, revoked, or synthetic;
- whether example-file values are sufficiently obvious placeholders.

Every automated finding must be reviewed manually before the public-release checklist can be marked complete.

## Decision rule

Repository visibility remains **NO-GO** until:

1. the exact audit workflow run is reviewed;
2. medium-review example assignments are manually classified;
3. privacy and operational paths are classified file by file;
4. media ownership and privacy are reviewed;
5. current-tree and history decisions are recorded;
6. package-license metadata is reconciled;
7. the final candidate receives explicit human approval;
8. a separate operator instruction authorizes the visibility change.

## Next candidate step

Create a separate public-candidate branch from the reviewed audit baseline. That branch should exclude, relocate, or redact operator-only material; decide the evidence and media boundary; reconcile MIT versus ISC package metadata; and rerun this audit on the exact candidate head.

No repository visibility, Production, DNS, credential, B2, database, authentication-provider, billing, or repository-setting change belongs in that cleanup branch.

## Rollback

Before merge, close the audit pull request. After merge, revert the audit commit. The workflow and scanner are repository-only controls; rollback requires no deployment, DNS, B2, database, credential, or Production cleanup.
