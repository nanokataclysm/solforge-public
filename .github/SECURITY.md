# Security policy — NANOKAT Forge

## Supported surfaces

| Surface | Notes |
|---------|--------|
| Cloud Run demo | Public UI + gated APIs; demo token is **not** a production auth system |
| This repository | Source, docs, evidence — **never** commit live secrets |

## Report a vulnerability

Email the operator via the GitHub account owner (**nanokataclysm**) or open a **private** security advisory if enabled.

Please include:

- Affected path (repo file, API route, or demo URL behavior)
- Impact (token leak, unauthenticated write, dependency RCE, etc.)
- Reproduction without embedding live credentials

**Do not** open a public issue with keys, tokens, connection strings, or private PEMs.

## Secrets rules (contributors & agents)

1. Never commit `.env*`, Cloud Run env dumps, or `.nanokat/keys/*private*.pem`.
2. Demo shared secret and DashScope keys live only in operator env / Cloud Run config.
3. If a secret lands in git history: rotate it, notify the operator, scrub history before treating the branch as clean.
4. Client-side “NANOKAT signing” with a private key is **out of policy** — server-side only if signing ships later.

## Host note

Primary operator host is a physical MacBook Pro running **Ubuntu 26.04 LTS** (Linux), not macOS.

## Acknowledgments

Thoughtful reports that keep the demo honest and the vault empty of accidents are appreciated.
