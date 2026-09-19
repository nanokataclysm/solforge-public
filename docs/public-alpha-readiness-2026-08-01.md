# Solforge public-alpha readiness assessment — 2026-08-01

## Decision

**PUBLIC SOURCE PUBLISHED. NO DEPLOYMENT OR PRODUCTION PROMOTION AUTHORIZED.**

The history-free source was published to [`nanokataclysm/solforge-public`](https://github.com/nanokataclysm/solforge-public) after exact private certification and independent public-target validation. This assessment does not authorize a hosted demo, Production deployment, DNS change, credential operation, storage mutation, billing change, signing-key operation, or deletion of private source history.

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
- The publication baseline contained 103 public files and excluded 97 private-source-only files.
- The public target rebuilt the same tree and archive and passed public candidate export, public release audit, and Solforge CI twice on the exact pre-merge head.
- The existing Codex-grant repository URL and prior public history were preserved without importing private canonical history.

## Publication record

- Private canonical source commit: `fc9d4f27543e38b2a6a864a847b4888a498137dc`
- Public target merge commit: `e644216ab10602eb642fad32b0e10c007ce28919`
- Included public files: 103
- Excluded private-source-only files: 97
- Certified tree SHA-256: `738be5bb886c7411314644949302cde02e0a51b5162e49f9b9b453db5bcc8076`
- Certified archive SHA-256: `7a60c215852b6b730ad63096a82a98cbd3ba498cbac6536874a4f4a65144b14e`

## Publication stabilization

This follow-up documentation pass replaces candidate/no-go language with the verified public-alpha status and adds release notes. The exact stabilization head must pass the same export, audit, Node.js 24, and policy gates before it is mirrored into the public repository.

## Remaining work

1. Verify the publication-stabilization export, audit, tests, links, and rendered documentation.
2. Configure vulnerability reporting, branch protection, secret scanning, push protection, repository metadata, and required checks in the public repository where available.
3. Create the `v0.1.0-alpha` tag or GitHub release after the stabilized public head is verified.
4. Verify license display, security reporting, and CI from an unauthenticated session.
5. Treat any hosted demo or Production deployment as a separate, explicitly authorized project.

## Safety boundary

Private source history must not be rewritten or published. A passing source or public-target gate does not authorize Production, DNS, storage, credential, billing, authentication-provider, signing-key, or deployment changes.

## Rollback

If an unexpected exposure is discovered, make the target repository private if available, preserve a sanitized incident record, rotate affected credentials, correct the exported tree, and rerun the complete release gate before restoring public access.
