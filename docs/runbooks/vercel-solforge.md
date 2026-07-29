# Solforge on Vercel (job `59702adb9bc7`)

**Repo:** `~/dev/solforge` · **App root:** `apps/orchestrator`
**Domain target:** `solforge.nanokat.com` (Cloudflare authoritative DNS)
**Do not:** touch `~/hack/nk-forge`, Cloud Run freeze, apex, or `forge.nanokat.com`

## Durable approval store (multi-instance)

Vercel runs multiple serverless instances. In-memory sessions break
`approve → build-preview` across instances.

**Preferred: Neon Postgres** (already in the NANOKAT stack):

| Env | Purpose |
|-----|---------|
| `SOLFORGE_DATABASE_URL` | Neon pooled or direct connection string (prefer this name) |
| `DATABASE_URL` | accepted fallback |
| `NEON_DATABASE_URL` | accepted fallback |

On first use the store runs:

```sql
CREATE TABLE IF NOT EXISTS solforge_approval_sessions (
  session_id   text PRIMARY KEY,
  plan_digest  text NOT NULL,
  nonce        text NOT NULL,
  expires_at   timestamptz NOT NULL,
  used         boolean NOT NULL DEFAULT false
);
```

Use a **dedicated Neon branch** (or project) for Solforge — do **not** point this
at the Alley production owner URL unless you intentionally share. A branch on
the existing `nanokat` project is fine (e.g. `solforge-sessions`).

**Fallback: Upstash Redis REST** if no Neon URL:

| Env | Purpose |
|-----|---------|
| `UPSTASH_REDIS_REST_URL` | Redis REST base URL |
| `UPSTASH_REDIS_REST_TOKEN` | REST token |

Without either durable backend, `/health` reports `multiInstanceSafe: false` and
`productionReadyClaim: false`.

## Required secrets (Vercel project)

| Env | Required |
|-----|----------|
| `DASHSCOPE_API_KEY` | yes |
| `DASHSCOPE_BASE_URL` | yes |
| `DEMO_SHARED_SECRET` | yes |
| `SOLFORGE_DATABASE_URL` | **yes for multi-instance production (Neon)** |
| `QWEN_MODEL` / planner map | optional (defaults in `lib/models.mjs`) |
| `UPSTASH_REDIS_REST_*` | optional fallback if not using Neon |
| `NODE_ENV` | `production` on prod |
| `FORCE_SECURE_COOKIES` | optional (`VERCEL=1` enables Secure cookies) |

## Deploy sequence

```bash
cd ~/dev/solforge/apps/orchestrator
npm test
vercel link          # create/link project "solforge" (or solforge-orchestrator)
vercel env add …     # set secrets for preview + production
vercel               # preview URL
# smoke: /health, 401 without token, plan → approve → preview → replay 409
vercel --prod        # only after Upstash + smoke green + operator OK
```

## Domain (CF authoritative)

1. Vercel project → Domains → add `solforge.nanokat.com` → copy the **exact** record Vercel shows.
2. Cloudflare DNS (zone nanokat.com): add **only that record**, **DNS only** (grey cloud) first.
3. Verify TLS + `/health` on the custom host.
4. Do not change apex / forge / Workers.

## Rollback

- Vercel: promote previous deployment or `vercel rollback`
- DNS: remove/revert the single CF record for `solforge`
- Cloud Run freeze remains the Build Week pin — unchanged

## Operator gates (stop if missing)

1. Vercel CLI login (or PAT) for team `nanokataclysm`
2. DashScope + demo secret available to set on the project (not printed)
3. **Neon** branch + `SOLFORGE_DATABASE_URL` on Vercel (or Upstash fallback)
4. Cloudflare zone token / UI access for the one DNS record
5. Explicit OK to `--prod` and domain attach

## Neon setup (operator)

```bash
# Example: branch on existing project (IDs from neonctl / console)
neonctl branches create --name solforge-sessions --project-id <PROJECT_ID>
neonctl connection-string solforge-sessions --project-id <PROJECT_ID> --pooled

# Then on Vercel (do not print the URL in chat):
# vercel env add SOLFORGE_DATABASE_URL production --sensitive --value '…'
# vercel env add SOLFORGE_DATABASE_URL preview --sensitive --value '…'
# redeploy
```
