## Summary

<!-- What does this PR do, in 1–3 sentences? Prefer “plan/preview/host/docs” over vague “improvements”. -->

## Product surface touched

- [ ] Orchestrator API (`/health`, `/api/plan`, `/api/build-preview`, …)
- [ ] Frontend (`apps/orchestrator/public/`)
- [ ] Hosting / deploy configuration
- [ ] Tests (`apps/orchestrator/test/`)
- [ ] Documentation (`README.md`, `docs/`, `.github/`)
- [ ] MCP server or agent scaffolding
- [ ] Other: <!-- … -->

## Runtime honesty

<!-- Live demo inference is Qwen (DashScope). OpenAI GPT/Codex are build-process tools unless this PR changes that. -->

- Live model path changed? **No / Yes** → <!-- which model / env -->
- Human approval gate still required before preview? **Yes / No (explain)**

## Test plan

- [ ] `cd apps/orchestrator && npm test`
- [ ] Local or Cloud Run smoke (`npm run smoke` or manual plan → approve → preview)
- [ ] No secrets in diff (`.env*`, private PEMs, demo tokens)

## Screenshots / logs

<!-- Optional: UI stills, `curl /health` JSON, test output -->

## Host note

Document any platform-specific assumptions introduced by this change.

## Merge notes

<!-- Anything for main: env vars, Cloud Run redeploy, docs. -->
