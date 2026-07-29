# Contributing to Solforge

Thank you for helping improve Solforge.

## Before changing code

1. Inspect the current implementation and tests.
2. Create a named branch.
3. Keep the change narrowly scoped and reversible.
4. Do not commit directly to the default branch.
5. Never include secrets, credentials, private keys, personal data, or populated environment files.

Node.js 20 or newer is required.

## Development loop

```bash
cd apps/orchestrator
npm ci
npm test
npm start
```

Before opening a pull request:

```bash
git diff --check
node --check apps/orchestrator/server.mjs
node --check apps/orchestrator/public/app.js
cd apps/orchestrator && npm test
```

## Product boundaries

Preserve these constraints unless a pull request explicitly proposes and justifies a change:

- human approval remains required before consequential generation;
- approval remains bound to the exact plan;
- replayed, expired, or mutated approvals remain rejected;
- preview generation does not deploy production sites;
- preview generation does not modify DNS;
- secrets are not exposed to generated artifacts;
- development signing is not represented as production key custody;
- live model calls are not added to the default unit-test suite.

## Pull requests

Report:

- what changed;
- why it changed;
- files changed;
- tests and exact results;
- what was not tested;
- risks;
- rollback instructions;
- recommended next action.

Prefer small, reviewable pull requests over broad refactors.

## Security findings

Do not open a public issue containing exploit details, credentials, private keys, cookies, or secret values. Follow [SECURITY.md](SECURITY.md).
