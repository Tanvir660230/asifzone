# Store deployment — one codebase, one deployment per store (Phase 12)

Every store is its own deployment: its own Postgres, Redis, uploads volume, `docker/.env`, domain and certificate.
All stores run the **same Git commit**; nothing in the source names a store. This is not multi-tenancy: stores never
share a database.

## What differs between stores

| Kind | Where | Examples |
|---|---|---|
| Deployment inputs | `docker/.env` (template: `docker/.env.example`) | `SERVER_NAME`, `SERVER_ALIASES`, `CERT_NAME`, `GDRIVE_REMOTE`, `COMPOSE_PROJECT_NAME`, `POSTGRES_DB`, public URLs |
| Secrets | `docker/.env` (or per-store GitHub Environment secrets) | `JWT_*`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, provider credentials |
| Provider selection | `docker/.env` | `PAYMENT_GATEWAYS`, `SMS_PROVIDER`, `EMAIL_PROVIDER`, `COURIER_PROVIDER`, `PUSH_PROVIDER` |
| Store identity & business settings | the store's database, entered in **Admin → Settings** | name, logo, favicon, legal name, address, governing law, support hours, currency, timezone, tax, shipping, payment methods |

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

## Second store on the same server

Not supported by this release: the store stack binds ports 80/443. Run each store on its own server (a shared edge
proxy is deferred).
