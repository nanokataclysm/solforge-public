# Contributing to Solforge

Solforge is a public-alpha candidate. Contributions should improve creator workflows, provider boundaries, approval safety, provenance, test coverage, documentation, or reproducibility without weakening human control.

## Before opening a change

- Keep the scope small and reversible.
- Inspect the current repository and related tests before modifying behavior.
- Do not include credentials, private keys, personal data, internal transcripts, local paths, access codes, cookies, or infrastructure inventories.
- Do not add autonomous deployment, DNS, purchasing, storage mutation, blockchain, or credential-management behavior without explicit design and operator approval.
- Preserve the rule that model output and client-supplied approval state are untrusted.
- Add or update focused tests for behavioral changes.
- Separate verified current state from planned work and inference.

## Local setup

Use Node.js 24 to match the release gate.

```bash
cd apps/orchestrator
npm ci
npm test
```

The package declares a broader Node `>=20` compatibility floor, but release-facing work should be checked on Node 24.

Live provider, Redis, signing, and B2 checks require separately authorized development credentials. Most tests must remain deterministic and must not require paid APIs or external writes.

Environment variable names are documented in [`apps/orchestrator/.env.example`](apps/orchestrator/.env.example). Do not commit local environment files.

## Pull requests

A useful pull request explains:

- the problem being solved;
- the smallest safe change;
- files changed;
- tests and checks run, with results;
- untested areas;
- security, compatibility, storage, or deployment implications;
- risks and rollback.

Open draft pull requests by default for agent-created or incomplete work. Avoid mixing public-documentation cleanup, provider refactors, UI redesign, data migrations, and deployment changes in one pull request.

## Provider and model work

Provider-specific environment names, error shapes, and model assumptions should remain behind a small testable boundary.

A provider implementation should normalize:

- structured generation requests;
- model selection;
- response text and usage metadata;
- retryable and non-retryable errors;
- timeouts and availability failures.

Human approval, session handling, preview validation, persistence, verified-media checks, and artifact signing are application responsibilities—not model-provider responsibilities.

## Security reports

Do not report vulnerabilities in public issues or pull requests. Follow [`SECURITY.md`](SECURITY.md).

## Public-release work

Release changes must follow [`docs/public-release-checklist.md`](docs/public-release-checklist.md). A documentation or CI change never authorizes a deployment, repository-visibility change, or target-repository creation by itself.
