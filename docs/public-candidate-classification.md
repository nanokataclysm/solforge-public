# Solforge public-candidate classification

## Decision

The initial public alpha should be produced as a **history-free clean export into a separate repository**.

The existing `nanokataclysm/solforge` repository remains private. This document does not authorize creating another repository, changing visibility, rewriting history, deleting files, or moving operator evidence.

Source baseline:

- private source repository: `nanokataclysm/solforge`;
- cleanup base: `47ef73970dd797a7d65925a4fe2b88c97304769b`;
- merged audit source head: `460ea29d53c6be4150709a3ee5fb7191ec750915`;
- high-confidence secret findings in the merged audit: `0`;
- privacy-sensitive paths covered: `32`;
- media paths covered: `36`.

The machine-readable source of truth is `tools/release-audit/public-candidate-classification.json`. Its validator is `tools/release-audit/validate_public_candidate_classification.py`.

## Why a clean export

Changing this repository to public would expose reachable history, branches, tags, operator notes, transcripts, evidence exports, and media. Removing those files only from the current tree would not remove them from Git history.

A new history-free export is safer and more reversible than rewriting the private source repository. The source repository can continue to preserve internal evidence while the public candidate receives only approved files.

No target repository has been selected or created.

## Resolved cleanup review

The cleanup review resolved every tracked `manual-review` and `rewrite-before-include` path:

- `tools/mcp/README_MCP.md` is public-include after replacing local operator paths with repository-relative setup instructions;
- `docs/runbooks/VERIFIED_MEDIA_PACKAGE_SMOKE.md` is public-include after replacing the operator checkout path with Git-based repository-root discovery;
- `docs/runbooks/verify-media-package-signature.md` is public-include after the same path-neutral rewrite;
- `docs/runbooks/vercel-solforge.md` is private-source-only because it contains private source-repository, Vercel account, project, domain, and operator-release identifiers;
- `apps/orchestrator/package.json` and `package-lock.json` now declare `MIT`, matching the root license.

The validator fails when any tracked file remains `manual-review` or `rewrite-before-include`, or when the package, lockfile, and root license no longer agree on MIT.

## Public include

The initial allowlist includes:

- application code, tests, package files, and runtime assets under `apps/`;
- model and role policy under `policy/`;
- reusable tooling under `tools/`, including the rewritten MCP README;
- CI and read-only release-audit workflows under `.github/`;
- `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE`, and `.gitignore`;
- both reviewed environment examples;
- the two rewritten verified-media verification runbooks;
- public release-audit, readiness, checklist, and classification documents.

The environment examples contain empty values, explicit placeholders, public model names, a public provider base URL, and non-secret settings only. The deployment-preflight test remains public because its email-shaped values are synthetic Git remote fixtures.

## Private source only

The initial public alpha excludes:

- `AGENTS.md`, `WORKSPACE.md`, and `.nanokat/`;
- `.gitleaksignore`, which refers to private-repository history;
- internal handoffs, grants, application material, and submission documents;
- `docs/runbooks/vercel-solforge.md`;
- all `evidence/` content, including organizer correspondence, transcripts, provenance exports, screenshots, archives, audio, and video.

This classification is conservative. A future evidence excerpt can be rewritten and reviewed in a separate PR; no evidence file is approved by default.

## Fail-closed rules

The validator requires every tracked path to match a classification rule. It also requires:

- zero tracked `manual-review` paths;
- zero tracked `rewrite-before-include` paths;
- all audited privacy-sensitive paths to remain non-public unless explicitly documented as a reviewed exception;
- every audited media path and every `evidence/` path to remain private;
- package, lockfile, and root license metadata to remain MIT;
- the source baseline to remain reachable;
- the publication strategy to keep the private source repository private;
- explicit authorization before any target repository is created.

The classification workflow prints paths and counts only. It does not print file contents, matched values, credentials, or private-key material.

## Remaining blockers

This cleanup does not create the public candidate. Before publication:

1. implement a deterministic clean-export builder from an approved source commit;
2. inspect the exact exported file list and diff;
3. run the redacted audit against the export;
4. run clean-checkout Node 24 installation and the complete test suite on the export;
5. obtain human approval of the exact export;
6. obtain separate explicit approval before creating a public repository or changing any repository setting.

## Safety boundary

This cleanup does not:

- remove, relocate, or rewrite source files or Git history;
- create a repository, branch-protection rule, release, or tag;
- change repository visibility;
- deploy or promote an application;
- change DNS, databases, B2 objects, credentials, signing keys, authentication providers, billing, or environment variables.

## Rollback

Before merge, close the cleanup PR. After merge, revert its commits. No external-service cleanup is required.
