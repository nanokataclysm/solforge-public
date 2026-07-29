# Durable authentication sessions

## Owner-run database preparation

The application performs read-only schema readiness checks at startup. It does
not create or alter tables. Before releasing this code with Neon, a database
owner must review and apply:

```text
migrations/001_auth_sessions_and_approval_context.sql
```

Apply it first to an isolated branch or staging database, verify the four
approval columns and `solforge_auth_sessions` table, then start the application.
Do not apply the migration as part of ordinary application startup. No database
migration was run as part of this change.

Startup fails closed if production has no durable credentials or if the selected
store cannot read its required table and columns. Neon is preferred when a
database URL is configured. Atomic Upstash REST operations are the fallback when
both Upstash variables are configured. In-memory stores are test/development
only, are not multi-instance safe, and lose sessions on restart; `/health`
reports the selected stores and restart behavior.

Production login retries use an atomic Upstash Redis fixed window shared across
instances. The default is five attempts per five minutes for each trusted client
IP. `LOGIN_RATE_MAX` and `LOGIN_RATE_WINDOW_MS` may tune those values. Production
startup fails closed when the Upstash credentials required by this limiter are
missing or incomplete. Development retains an explicit process-local fallback.
`/health` reports the limiter backend, scope, and multi-instance safety.

## Browser and CSRF boundary

Authentication and approval use distinct HttpOnly, `SameSite=Strict`, `Path=/`
cookies. Cookies are `Secure` in production, on Vercel, or when
`FORCE_SECURE_COOKIES=true`. Cookie clearing uses the same attributes.

Every state-changing route below requires `x-solforge-csrf: 1`:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/plan`
- `POST /api/mission/analyze`
- `POST /api/approve`
- `POST /api/build-preview`
- `POST /api/package`

The custom header is a browser cross-site request barrier, not a secret and not
a substitute for authentication. Solforge does not enable permissive CORS that
would allow arbitrary origins to send it. `SameSite=Strict` and the header do
not protect against same-origin XSS; model-controlled output must continue to be
rendered through DOM nodes and `textContent`.

## Session behavior

Login accepts the private access code once and issues an opaque bearer cookie.
Only its SHA-256 lookup value is stored. Successful login replaces an existing
valid browser session. Status reads do not extend the absolute expiry. Logout
invalidates server state before clearing cookies.

Approval records are separate and bind the authenticated session, canonical plan
digest, nonce, expiry, operation, opaque artifact context, and optional parent
version digest. Consumption is one-time and atomic in durable stores.

Operational rollback is to restore the previous application revision. The
additive table and nullable columns may remain unused; dropping them is a
separate owner-reviewed database change.
