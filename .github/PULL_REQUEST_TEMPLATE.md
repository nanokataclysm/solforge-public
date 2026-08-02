## Summary

<!-- What does this PR change, and why is it the smallest safe change? -->

## Product surface touched

- [ ] Orchestrator API
- [ ] Frontend (`apps/orchestrator/public/`)
- [ ] Authentication or approval boundary
- [ ] Provider, persistence, media, or signing integration
- [ ] Deployment or runtime configuration
- [ ] Tests
- [ ] Public documentation or release tooling
- [ ] MCP or agent tooling
- [ ] Other: <!-- describe -->

## Runtime honesty

- Reference model path changed? **No / Yes** → <!-- provider/model -->
- Human approval gate remains required? **Yes / No** → <!-- explain -->
- Any autonomous external write, deploy, DNS, purchase, or credential behavior added? **No / Yes** → <!-- explain -->

## Validation

- [ ] `cd apps/orchestrator && npm test`
- [ ] Relevant syntax, policy, Python, MCP, or export checks
- [ ] No secrets, private keys, access codes, cookies, or personal data in the diff
- [ ] Claims distinguish implemented, planned, and out-of-scope behavior

## Evidence

<!-- Provide concise, redacted test output or screenshots. Never paste live credentials or private logs. -->

## Risks and rollback

<!-- What could fail, what was not tested, and how should this change be reverted? -->
