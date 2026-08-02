# Solforge public-candidate classification

## Current status

The initial public alpha was produced as a **history-free clean export into a separate repository**. The private canonical repository remains `nanokataclysm/solforge`; the approved public target is [`nanokataclysm/solforge-public`](https://github.com/nanokataclysm/solforge-public).

Publication preserved the private source history and the existing grant-facing public repository URL. It did not authorize a hosted demo, Production deployment, DNS change, credential operation, storage mutation, billing action, signing-key operation, or deletion of private evidence.

Publication baseline:

- private canonical source commit: `fc9d4f27543e38b2a6a864a847b4888a498137dc`;
- public target merge commit: `e644216ab10602eb642fad32b0e10c007ce28919`;
- public files included: `103`;
- private-source-only files excluded: `97`;
- certified tree SHA-256: `738be5bb886c7411314644949302cde02e0a51b5162e49f9b9b453db5bcc8076`;
- certified archive SHA-256: `7a60c215852b6b730ad63096a82a98cbd3ba498cbac6536874a4f4a65144b14e`;
- high-confidence secret findings: `0`.

The machine-readable source of truth is `tools/release-audit/public-candidate-classification.json`. Its validator is `tools/release-audit/validate_public_candidate_classification.py`.

## Why a clean export

Changing the private repository to public would expose reachable history, branches, tags, operator notes, transcripts, evidence exports, and media. Removing those files only from the current tree would not remove them from Git history.

A history-free export is safer and more reversible than rewriting the private source repository. The private source can preserve internal evidence while the public target receives only approved files.

## Resolved cleanup review

The cleanup review resolved every tracked `manual-review` and `rewrite-before-include` path:

- `tools/mcp/README_MCP.md` is public-include after replacing local operator paths with repository-relative setup instructions;
- `docs/runbooks/VERIFIED_MEDIA_PACKAGE_SMOKE.md` is public-include after replacing the operator checkout path with Git-based repository-root discovery;
- `docs/runbooks/verify-media-package-signature.md` is public-include after the same path-neutral rewrite;
- `docs/runbooks/vercel-solforge.md` is private-source-only because it contains private source-repository, account, project, domain, and operator-release identifiers;
- `apps/orchestrator/package.json` and `package-lock.json` declare `MIT`, matching the root license.

The validator fails when any tracked file remains `manual-review` or `rewrite-before-include`, or when the package, lockfile, and root license no longer agree on MIT.

## Public include

The allowlist includes:

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

The public alpha excludes:

- `AGENTS.md`, `WORKSPACE.md`, and `.nanokat/`;
- `.gitleaksignore`, which refers to private-repository history;
- internal handoffs, grants, application material, and submission documents;
- `docs/runbooks/vercel-solforge.md`;
- all `evidence/` content, including organizer correspondence, transcripts, provenance exports, screenshots, archives, audio, and video.

This classification remains conservative. A future evidence excerpt must be rewritten, explicitly classified, reviewed, and re-audited in a separate change.

## Fail-closed rules

The validator requires every tracked path to match a classification rule. It also requires:

- zero tracked `manual-review` paths;
- zero tracked `rewrite-before-include` paths;
- all audited privacy-sensitive paths to remain non-public unless explicitly documented as reviewed exceptions;
- every audited media path and every `evidence/` path to remain private;
- package, lockfile, and root license metadata to remain MIT;
- the private source baseline to remain reachable when validating the source repository;
- the publication strategy to keep the private source repository private;
- an exported public target to contain only `public-include` files.

The classification workflow prints paths and counts only. It does not print file contents, matched values, credentials, or private-key material.

## Post-publication controls

After publication, every stabilization change must:

1. originate in the private canonical source unless it is inherently target-specific;
2. pass the exact export, redacted audit, Node.js 24, role, Python, and MCP gates;
3. be mirrored into the public repository without importing private history;
4. pass the public-target export, release audit, and CI checks;
5. avoid deployment, DNS, credential, billing, storage, authentication-provider, or signing-key mutation unless separately authorized.

## Safety boundary

Publication did not:

- remove, relocate, or rewrite private source files or Git history;
- deploy or promote an application;
- change DNS, databases, B2 objects, credentials, signing keys, authentication providers, billing, or environment variables.

Repository hardening and release tagging remain separately verifiable post-publication steps.
