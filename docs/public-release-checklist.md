# Solforge public-alpha release checklist

This checklist controls the transition from the private source repository to a separate, history-free public alpha. A checked item reflects verified evidence rather than intention.

## Current decision — NO-GO FOR PUBLICATION

The candidate may proceed through private review. No target repository, visibility change, public release, or Production operation is authorized.

## Verified candidate controls

- [x] Keep the canonical source repository and its history private.
- [x] Use a separate history-free clean export rather than rewriting private history.
- [x] Classify every tracked source path with a fail-closed manifest.
- [x] Resolve all `manual-review` and `rewrite-before-include` dispositions.
- [x] Exclude operator files, handoffs, grants, submissions, evidence, media, workspace metadata, and private deployment documentation.
- [x] Align the root license, package metadata, and lockfile metadata on MIT.
- [x] Build from an exact Git commit rather than the working tree.
- [x] Reject unsafe paths, symlinks, submodules, unresolved classifications, case collisions, and existing destinations.
- [x] Build twice and require byte-identical archives and inventories.
- [x] Inspect the exported file inventory and confirm 103 included files and 97 private exclusions.
- [x] Verify every exported file's mode, size, Git blob, and SHA-256.
- [x] Confirm no private-source-only path appears in the export.
- [x] Confirm the export contains no media, operator handoff, or transcript path.

## Secrets and privacy

- [x] Scan the private source current tree and reachable history using redacted detectors.
- [x] Scan a one-commit history-free candidate without recording matched values.
- [x] Confirm zero high-confidence secret findings in the reviewed candidate.
- [x] Review every medium and privacy finding manually.
- [x] Confirm `.env.example` findings are explicit placeholders.
- [x] Confirm email-shaped test findings are synthetic Git repository fixtures.
- [x] Keep private signing keys and live credentials outside Git and release artifacts.
- [x] Remove stale deployment identifiers, protected URLs, private-evidence links, and operator-host details from public-facing files.
- [ ] Repeat the audit on the exact final documentation head and review any changed findings.

## Build and package consistency

- [x] Run `npm ci` on the exported candidate using Node.js 24.
- [x] Confirm zero npm vulnerabilities in the reviewed candidate run.
- [x] Run the complete automated test suite: 252 tests across 39 suites.
- [x] Run JavaScript syntax checks.
- [x] Validate development-role policy.
- [x] Compile exported Python modules.
- [x] Run exported MCP retry tests.
- [x] Build from a clean exact-commit checkout without operator-global configuration.
- [ ] Repeat all gates on the exact final documentation head.
- [ ] Run a credential-free interactive mock-provider demonstration when a stable command is documented.

## Runtime and claims

- [x] Describe Qwen as the current reference provider rather than a permanent requirement.
- [x] State that autonomous deployment, DNS, purchases, credential rotation, storage mutation, blockchain writes, and Production promotion are not shipped behavior.
- [x] Remove public and Production endpoint claims from candidate documentation and UI.
- [x] Keep protected deployment evidence and signing-custody details private.
- [x] Remove links to excluded evidence and older public-repository candidates.
- [ ] Verify every public link and rendered page from an unauthenticated session after target publication.

## Public documentation

- [x] Review and update `README.md`, `SECURITY.md`, and `CONTRIBUTING.md`.
- [x] Replace stale `.github` contribution, security, support, conduct, issue, and pull-request guidance.
- [x] Make public UI hosting and access-code copy platform-neutral.
- [x] Keep the roadmap implicit rather than presenting experimental work as committed delivery.
- [ ] Prepare concise public-alpha release notes for the exact approved candidate.
- [ ] Confirm private vulnerability reporting works in the target repository.
- [ ] Complete final human accessibility and plain-language review.

## Final candidate approval

- [ ] Exact final export workflow passes.
- [ ] Human reviewer approves the exact archive hash, tree hash, and complete file list.
- [ ] Human reviewer accepts every remaining audit finding.
- [ ] Human reviewer confirms no creator, client, collaborator, or third-party personal data is present.
- [ ] Human reviewer confirms no Production, DNS, database, storage, credential, billing, authentication-provider, or signing-key mutation is bundled.

## Target repository and settings — separate explicit authorization required

- [ ] Operator explicitly authorizes target-repository creation.
- [ ] Create the target repository from the approved history-free export.
- [ ] Configure description, homepage, topics, issues, discussions, and support surfaces.
- [ ] Enable private vulnerability reporting, secret scanning, and push protection where available.
- [ ] Configure branch protection and required checks.
- [ ] Create a public-alpha tag or release only after repository verification.
- [ ] Verify access, links, documentation rendering, license display, security reporting, and CI.

## Rollback

If publication reveals an unexpected exposure:

1. make the target repository private immediately if available;
2. preserve a sanitized incident record;
3. revoke or rotate affected credentials;
4. remove exposed material from the exported tree;
5. determine whether target history rewriting and cache invalidation are required;
6. verify the corrected export before restoring public visibility.

The private source repository remains the recovery source and must not be rewritten as part of public-alpha cleanup.
