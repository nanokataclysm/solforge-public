# Solforge on Vercel

**Repo:** `~/dev/solforge`
**App root:** `apps/orchestrator`
**Domain:** `solforge.nanokat.com`

Do not touch the apex domain, `forge.nanokat.com`, unrelated Cloudflare records,
databases, or credentials outside this bounded release.

## Authoritative security-state backend

Production uses one Upstash Redis REST database for:

- authentication sessions
- approval sessions
- login rate limiting

Required private Vercel variables:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
DASHSCOPE_API_KEY
DASHSCOPE_BASE_URL
DEMO_SHARED_SECRET
```

Remove `SOLFORGE_DATABASE_URL`, `DATABASE_URL`, and `NEON_DATABASE_URL` from the
Solforge Vercel project only after confirming no unrelated route consumes them.
The application no longer uses those variables for session state.

## Preview verification

1. Deploy the reviewed commit to Preview.
2. Confirm `/health` reports all three Upstash backends and
   `productionReadyClaim: true`.
3. Verify unauthenticated rejection.
4. Verify login, plan, approval, package, replay rejection, logout, and
   legacy-header rejection.
5. Confirm no secret values appear in logs or output.

## Production gate

Promote only after Preview passes and the operator explicitly approves the
production deployment. Existing domain and DNS state should remain unchanged.

## Rollback

Promote the previous known-good deployment and restore its matching environment
policy only if necessary. Do not manually delete Redis keys.
