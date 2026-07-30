# Solforge

Human-gated AI website planning for small businesses, creators, and independent teams.

**Status:** Public alpha

**Demo:** https://solforge.nanokat.com

Solforge turns a creative brief into a structured Qwen-generated website plan, requires explicit human approval, renders an isolated preview, and produces a cryptographically signed JSON package.

## What it does

1. Accepts a project brief.
2. Uses Qwen to create a structured plan.
3. Requires a front-door authenticated session.
4. Presents the exact plan for human approval.
5. Binds approval to the plan digest, expiry, and one-time nonce.
6. Generates an isolated HTML preview.
7. Produces a signed JSON package.
8. Exposes the Ed25519 public key for independent verification.

## Safety boundaries

- No silent production deployment.
- No DNS mutation from the preview workflow.
- No client-only `approved: true` shortcut.
- No secret access during preview generation.
- Approval rejects changed plans, expiry, and replay.
- Login retries are bounded.
- Development signing is not represented as production key custody.

## Stack

| Layer | Implementation |
|---|---|
| Interface | HTML, CSS, and browser JavaScript |
| Service | Node.js and Express |
| Inference | Qwen through a DashScope-compatible API |
| Authentication | HttpOnly session cookie |
| Approval | Server-bound plan digest and one-time nonce |
| Durable state | Configurable server-side storage |
| Signing | Ed25519 signed JSON packages |
| Hosting | Vercel-compatible orchestrator |

## Repository layout

```text
apps/orchestrator/  Application, interface, and tests
policy/             Model and operating policy
tools/              Validation and local tooling
docs/               Public technical documentation
.github/            CI and repository metadata
```

## Local development

Requirements: Node.js 20 or newer and npm.

```bash
cd apps/orchestrator
npm ci
npm test
npm start
```

Live Qwen inference additionally requires the environment variables documented in `.env.example`. Never commit populated environment files or secret values.

## Verification

```bash
git diff --check
node --check apps/orchestrator/server.mjs
node --check apps/orchestrator/public/app.js
cd apps/orchestrator && npm test
```

Changes affecting authentication, approval binding, signing, preview isolation, or deployment boundaries require focused security review.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Read [SECURITY.md](SECURITY.md). Do not place credentials, cookies, private keys, or active exploit details in public issues.

## License

See [LICENSE](LICENSE).
