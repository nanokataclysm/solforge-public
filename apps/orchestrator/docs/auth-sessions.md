# Durable authentication and approval sessions

## Production backend policy

Production and Vercel use Upstash Redis REST for all stateful security paths:

- authentication sessions
- one-time approval sessions
- distributed login rate limiting

Set both private runtime variables:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

Production startup fails closed when either value is missing, incomplete, or
unreachable. Database URL variables are not session-store selectors.

`/health` must report:

```text
approvalStore: upstash-redis
authStore: upstash-redis
loginRateLimitBackend: upstash-redis
loginRateLimitScope: distributed
productionReadyClaim: true
```

## Browser and CSRF boundary

Authentication and approval use distinct HttpOnly, `SameSite=Strict`, `Path=/`
cookies. Cookies are `Secure` in production, on Vercel, or when
`FORCE_SECURE_COOKIES=true`. Cookie clearing uses the same attributes.

Every state-changing route requires `x-solforge-csrf: 1`. The header is a
browser cross-site request barrier, not a secret or substitute for authentication.
Solforge does not enable permissive CORS. Same-origin XSS remains a separate
boundary; model-controlled output must continue to use DOM nodes and
`textContent`.

## Session behavior

Login accepts the private access code once and issues an opaque bearer cookie.
Only its SHA-256 lookup value is stored. Successful login replaces an existing
valid browser session. Reads do not extend absolute expiry. Logout invalidates
server state before clearing cookies.

Approval records bind the authenticated session, canonical plan digest, nonce,
expiry, operation, opaque artifact context, and optional parent version digest.
Consumption is one-time and atomic through Redis `GETDEL`.

## Rollback

Restore the previous application revision and its matching environment policy.
Do not manually delete Redis keys; TTL expiry handles stale sessions.
