# Solforge

Solforge is a human-gated AI creation system that turns a creator or small-business brief into a structured plan, requires explicit approval before protected operations, and can issue cryptographically signed artifact packages for independent verification.

> **Status:** public-alpha source is published from a separately verified, history-free export in [`nanokataclysm/solforge-public`](https://github.com/nanokataclysm/solforge-public). The private source repository remains canonical. No public demo or Production endpoint is claimed.

## What works now

- Qwen planning through Alibaba Cloud Model Studio's OpenAI-compatible API.
- Server-side authentication sessions with HttpOnly cookies.
- CSRF-header enforcement for state-changing API requests.
- Human approval bound to the authenticated session, exact operation context, and one-time nonce.
- Validated, isolated HTML preview generation.
- Bounded Navigator → specialist → Council Chair analysis that proposes actions without executing them.
- Ed25519-signed JSON packages and a public-key endpoint.
- Verified-media packages that fail closed when stored B2 metadata does not match the approved intent.
- An independent verifier for the public-key document, fingerprint binding, canonical receipt digest, and Ed25519 signature.

Solforge does **not** autonomously deploy websites, change DNS, purchase services, rotate credentials, mutate storage objects, publish blockchain transactions, or promote builds to Production.

## Release verification

The public-candidate gate operates on an exact Git commit and:

- exports only paths classified `public-include`;
- rejects unresolved classifications, unsafe paths, symlinks, submodules, and destination collisions;
- builds the directory tree, archive, and inventory twice and requires byte-identical results;
- verifies every exported file against its recorded mode, size, Git blob, and SHA-256;
- scans a one-commit, history-free candidate without printing matched values;
- installs dependencies and runs the complete application suite on Node.js 24;
- validates JavaScript syntax, role policy, Python modules, and MCP retry behavior.

The publication baseline passed 252 tests across 39 suites with zero test failures and zero npm vulnerabilities. The exported candidate contained no media files, operator handoffs, transcripts, or high-confidence secret findings. Detailed operator and deployment evidence remains private and is intentionally excluded from the public repository.

No public demo or Production endpoint is claimed by this repository.

## Architecture

| Layer | Current implementation |
|---|---|
| Runtime | Node.js and Express under `apps/orchestrator` |
| Release contract | Node.js 24 with clean-install and exact-export validation |
| Reference model provider | Qwen through the DashScope-compatible API |
| Session, approval, and login-limit state | Upstash Redis REST in multi-instance deployments |
| Preview boundary | Validated plan rendered as isolated HTML |
| Verified-media lookup | Read-only Backblaze B2 metadata checks |
| Artifact signing | Ed25519 JSON envelopes using the `solforge-dev` development identity |
| Independent verification | Public-key document, fingerprint pin, receipt digest, and signature checks |

Qwen is the current reference provider. Provider portability is a planned direction, not a claim that additional providers are already implemented.

## API overview

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Report provider, model, storage backends, and multi-instance safety state |
| `POST` | `/api/auth/login` | Create an authenticated server session from the configured access code |
| `GET` | `/api/auth/session` | Inspect the current authentication state |
| `POST` | `/api/auth/logout` | Invalidate the current authentication session |
| `POST` | `/api/plan` | Convert a brief into a validated structured plan |
| `POST` | `/api/mission/analyze` | Run bounded multi-role analysis without executing proposed actions |
| `POST` | `/api/approve` | Bind approval to an exact operation and intent context |
| `POST` | `/api/build-preview` | Produce an isolated preview after valid approval |
| `POST` | `/api/package` | Produce a signed JSON package after valid approval |
| `POST` | `/api/media/package` | Verify approved B2-backed media metadata and issue a signed receipt |
| `GET` | `/api/signing/public-key` | Return the public Ed25519 key document and fingerprint |

State-changing `/api` requests require the application's CSRF header. Authentication details and live credentials belong in private operator configuration, not documentation or source control.

## Local development

Use Node.js 24 to match the release gate. The package retains a broader Node `>=20` compatibility floor.

```bash
cd apps/orchestrator
npm ci
npm test
npm start
```

Environment variable names and placeholder-only guidance are in [`apps/orchestrator/.env.example`](apps/orchestrator/.env.example). Do not commit `.env` files, provider keys, Redis tokens, B2 credentials, cookies, or signing keys.

Useful development commands include:

```bash
npm run preflight:preview
npm run smoke:verified-media
npm run verify:media-package -- --help
```

Live-provider, storage, signing, and deployment checks require separately authorized credentials and must not be run against Production without explicit operator approval.

## Security and publication status

Solforge treats briefs, model output, generated plans, imported artifacts, and client-supplied approval state as untrusted input. Human approval is enforced server-side and bound to exact request context.

Read [`SECURITY.md`](SECURITY.md) before reporting a vulnerability and [`CONTRIBUTING.md`](CONTRIBUTING.md) before proposing changes.

The history-free public source has been published after exact private-source certification and independent validation in the public target. Repository hardening, release tagging, and any later deployment remain separate operational steps. The controlling record is [`docs/public-release-checklist.md`](docs/public-release-checklist.md).

## License

Solforge is licensed under the MIT License. The root license, package metadata, and lockfile metadata agree on MIT.
