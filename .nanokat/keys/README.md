# Development signing keys

- `demo-signing-private.pem` — **never commit** (gitignored). Server-side only.
- `demo-signing-public.pem` — may be committed for verifier demos.

Issuer label for this pair: **development signing identity — not production key custody.**

See [`SECURITY.md`](../../SECURITY.md) and the signing tests under `apps/orchestrator/test/`.
