# Store deployment — one codebase, one deployment per store (Phase 12, Phase 1 portability)

Every store is its own deployment: its own Postgres, Redis, uploads volume, `docker/.env`, domain and certificate.
All stores run the **same Git commit**; nothing in the source names a store. This is not multi-tenancy: stores never
share a database.

## What differs between stores

| Kind | Where | Examples |
|---|---|---|
| Deployment inputs | `docker/.env` (template: `docker/.env.example`) | `INSTALL_ID`, `SERVER_NAME`, `SERVER_ALIASES`, `CERT_NAME`, `GDRIVE_REMOTE`, `COMPOSE_PROJECT_NAME`, `POSTGRES_DB`, public URLs |
| Runtime public config (Phase 1A) | `docker/.env`, read by the web service at runtime | `SITE_URL`, `PUBLIC_API_URL`, `MEDIA_BASE_URL`, `META_PIXEL_ID`, `TIKTOK_PIXEL_ID`, `CLARITY_ID`, `GOOGLE_CLIENT_ID`, `WEB_PUSH_PUBLIC_KEY`, `STORE_THEME` |
| Secrets | `docker/.env` (or per-store GitHub Environment secrets) | `JWT_*`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, provider credentials |
| Provider selection | `docker/.env` | `PAYMENT_GATEWAYS`, `SMS_PROVIDER`, `EMAIL_PROVIDER`, `COURIER_PROVIDER`, `PUSH_PROVIDER` |
| Store identity & business settings | the store's database, entered in **Admin → Settings** | name, logo, favicon, legal name, address, governing law, support hours, currency, timezone, tax, shipping, payment methods, store policy (return window and conditions, dispatch time) |
| Look | `STORE_THEME` in `docker/.env` (themes: `packages/ui-tokens`, docs/DESIGN_SYSTEM.md) | `default`, `nasihamart` |

Per-store runbooks: [docs/installations/](installations/) (e.g. `nasihamart.md`).

Never copy one store's `JWT_*`, database or Redis passwords to another.

## Provider selection

| Variable | Values | Unset/blank |
|---|---|---|
| `PAYMENT_GATEWAYS` | `none`, or a comma list of `sslcommerz`, `eps` | both gateways (the store's own on/off toggles in Settings still apply) |
| `SMS_PROVIDER` | `bulksmsbd`, `none` | `bulksmsbd` |
| `EMAIL_PROVIDER` | `resend`, `none` | `resend` |
| `COURIER_PROVIDER` | `steadfast`, `none` | `steadfast` |
| `PUSH_PROVIDER` | `webpush`, `none` | `webpush` |

- `none` disables a capability: any use of it is refused with a clear "not configured" error — nothing is faked.
- An explicitly selected provider must have its credentials (see `docker/.env.example`); in production the API refuses
  to start otherwise, so `docker/deploy.sh` fails at the readiness step before traffic is switched.
- **Admin → Settings → Shipping, Tax & Rewards → Integrations** shows what is connected (names and yes/no only).

## New store (fresh server)

1. Clone the repository at the release commit into the deploy directory.
2. `cp docker/.env.example docker/.env` and fill it in (required: `SERVER_NAME`, `SERVER_ALIASES`, `CERT_NAME`,
   `GDRIVE_REMOTE`, the `JWT_*` / database / Redis secrets, public URLs).
3. Issue the TLS certificate for `SERVER_NAME` + `SERVER_ALIASES` with certbot (webroot `/var/www/certbot`), so
   `/etc/letsencrypt/live/$CERT_NAME/` exists.
4. `bash docker/deploy.sh` — preflight → backup → build → migrate → start → readiness → proxy.
5. Seed the first OWNER (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, refused if left at the development defaults).
6. In the admin: Settings (identity, logo, favicon, legal name, address, governing law, currency, timezone),
   payment methods, shipping, SKU prefix.
7. Configure the nightly backup cron for this store's `docker/gdrive-backup.sh`.

## Existing store moving to Phase 12 (e.g. the original store)

Before deploying the Phase 12 release, add to that server's `docker/.env`:

```
SERVER_NAME=<current host>
SERVER_ALIASES=www.<current host>
CERT_NAME=<current certificate directory name>
GDRIVE_REMOTE=<current rclone remote:folder>
```

`COMPOSE_PROJECT_NAME`, `POSTGRES_DB` and the provider variables may stay unset — the defaults reproduce the existing
stack exactly. After deploying, enter the legal name, address and governing law in Admin → Settings (the footer and
Terms page no longer carry a built-in address), and add the accepted payment methods (or the payment-methods image) if
the footer should keep its "We Accept" row.

## Installation identity (Phase 1)

`INSTALL_ID` (required, lowercase letters/digits/dashes) names the installation. Everything it writes to Redis lives
under `install:<INSTALL_ID>:` — cache keys, distributed locks, BullMQ queues (BullMQ `prefix`) — and its Next.js
data-cache tags carry the same prefix. Two installations can therefore share one Redis server safely. One owner:
`packages/shared/src/installation.ts` (`installationNamespace`), used by `apps/api/src/config/installation.ts` and
`apps/web/lib/runtime-config.ts`. **Never change a running store's `INSTALL_ID`**: its cache starts cold and any job still
queued under the old id is not picked up.

## Runtime configuration (Phase 1A)

The web image is built once and carries no store configuration. The web service reads its public configuration from its
environment at runtime (contract: `packages/shared/src/runtime-config.ts`; the one reader: `apps/web/lib/runtime-config.ts`)
and the root layout hands the public half to the browser. Server-only values (`API_INTERNAL_URL`, `REVALIDATE_SECRET`,
`INSTALL_ID`) never reach it. Changing a pixel id or the site URL needs a restart, not a rebuild. The pre-Phase-1
`NEXT_PUBLIC_*` names in an existing `docker/.env` are still accepted.

## Media (Phase 1B)

Uploads are stored in the database as the domain-free reference `/uploads/<storage key>` and resolved at runtime against
`MEDIA_BASE_URL` (default `/uploads`, served by nginx from this installation's uploads volume) — one resolver,
`packages/shared/src/media.ts`. Rows written before Phase 1 hold absolute URLs on the old domain; they keep rendering
(the resolver reads them as storage keys), and a controlled migration removes the domain from the data:

```bash
# on the server, inside the api container, after the deploy's own pre-deploy pg_dump:
docker compose -f docker/docker-compose.yml --env-file docker/.env exec api   node dist/cli/media-normalize.js --hosts yourdomain.com,www.yourdomain.com   # dry run: lists what would change
#   ... --apply      rewrites in one transaction; writes backups/media-normalize-<time>.json — copy it out of the
#                    container (docker compose cp api:/repo/apps/api/backups ./media-backups) and keep it
#   --revert <file>  restores the backup's values (only cells nobody edited since)
```

Only the listed hosts are rewritten (also list any old server IPs the store was served from). Rendering never depends on
it having run.

## Existing store moving to Phase 1

Add `INSTALL_ID=<a short id for this store>` to `docker/.env` (CI: the `INSTALL_ID` repository variable) — the deploy's
preflight refuses to start without it. Everything else keeps working with the existing values. Optionally rename
`NEXT_PUBLIC_*` entries to their runtime names and run the media normalization above. Redis caches start cold once (they
move under the new prefix); repeatable jobs are re-registered at startup; let a campaign that is mid-send finish before
deploying, since jobs queued under the old unprefixed names are not picked up (the outbox re-dispatches its own).

## Several installations on one VPS

Each installation is its own compose project (`COMPOSE_PROJECT_NAME`) with its own database (`POSTGRES_DB`), uploads
volume, `docker/.env` and `INSTALL_ID`. Give each its own host ports (`API_HOST_PORT`, `WEB_HOST_PORT`, `HTTP_PORT`,
`HTTPS_PORT`); only one process can own 80/443. The installation that owns them is the front proxy: its nginx includes
`docker/nginx/sites.d/*.conf`, one server-local file per extra store, routing that store's host names to its api and web
host ports. The extra store sets `HOST_BIND_IP` to the front stack's Docker network gateway (e.g. 172.18.0.1), so the
front nginx reaches those ports while they stay closed to the internet; its own nginx and certbot stay off, and its
certificate is issued by the front installation's certbot, which also renews it. Never join an extra store's containers
to the front stack's network: both stacks use the same service names (`postgres`, `api`, `web`), so names resolve
across stores. They may share one Redis server (`REDIS_URL`) — `INSTALL_ID` keeps their keys apart. Moving an
installation to its own VPS later is the same image with the same `docker/.env`, its database dump and its uploads volume.
