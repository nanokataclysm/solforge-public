# Solforge public-alpha readiness assessment — 2026-08-01

## Decision

**GO for final private candidate review. NO-GO for publication or repository-setting changes.**

This assessment covers the history-free candidate workflow. It does not authorize a public repository, Production deployment, DNS change, credential operation, storage mutation, billing change, signing-key operation, or deletion of private source history.

## Completed controls

- The canonical source repository and its history remain private.
- Every tracked source path is classified as `public-include` or `private-source-only`; no manual-review or rewrite disposition remains.
- Operator handoffs, transcripts, grants, submission materials, evidence, media, workspace metadata, and private deployment documentation are excluded.
- The root license, application package, and lockfile agree on MIT.
- Public instructions use repository-relative, platform-neutral commands.
- A deterministic builder reads blobs from an exact Git commit rather than the working tree.
- The builder fails closed on unsafe or unclassified paths, unresolved dispositions, symlinks, submodules, case-insensitive collisions, and existing destinations.
- The candidate is built twice and requires byte-identical archives and inventories.
- Every exported file is checked against its recorded mode, size, Git blob, and SHA-256.
- The history-free candidate audit reports no high-confidence secret finding, media file, operator handoff, or transcript path.
- The remaining audit findings are placeholder assignments in `.env.example` and synthetic Git repository fixtures in tests; they were manually reviewed.
- Node.js 24 clean installation, 252 tests across 39 suites, JavaScript syntax, role validation, Python compilation, and MCP retry tests passed.
- The reviewed candidate contains 103 public files and excludes 97 private-source-only files.

## Public-facing finalization

The final documentation pass removes stale hosting URLs, deployment identifiers, private-evidence links, operator-host details, obsolete competition language, and hard-coded links to an older public repository. Product UI copy is platform-neutral and does not claim a public or Production endpoint.

The exact branch containing this finalization must pass the same export, audit, and Node.js 24 gates before human approval.

## Remaining blockers

1. Review the exact export generated from the final documentation head.
2. Confirm its archive and tree hashes and inspect its complete file inventory.
3. Obtain explicit human approval of that exact exported tree and accepted audit findings.
4. Obtain separate operator authorization before creating a target repository or changing any repository setting.
5. Configure vulnerability reporting, branch protection, secret scanning, issue settings, and release metadata in the target repository.
6. Verify links, rendering, license display, security reporting, and CI from an unauthenticated session after publication.

## Safety boundary

Private source history must not be rewritten or published. A passing candidate gate does not authorize Production, DNS, storage, credential, billing, authentication-provider, signing-key, or deployment changes.

## Rollback

Before publication, close or revert the finalization change. After publication, make the target repository private if an unexpected exposure is discovered, preserve a sanitized incident record, rotate affected credentials, correct the exported tree, and rerun the complete release gate before restoring public access.
