# Demo data mirror

A local, sanitized, independent copy of the live Asif Zone database. It lets you build and evaluate the site against real
products, categories, variants, prices, stock, content and images without any path back to production.

## 1. Source and target

| | Database | Where | Access from this repo |
|---|---|---|---|
| **Source** (original) | `clothing_brand` | Postgres 16 in Docker on the production VPS (`/opt/asifzone/docker`), private Docker network only | **Read-only snapshot over SSH only.** No connection string for it exists in any env file. |
| **Target** (demo) | `asifzone_demo` | Local Postgres on this machine | `DATABASE_URL` / `DEMO_DATABASE_URL` in `apps/api/.env` |

The demo database is a full copy, not a view or replica. Once imported it has no link to production, so every edit in the
admin (Product Builder, prices, stock, categories, settings) changes only `asifzone_demo`.

## 2. Files

| File | Role |
|---|---|
| `apps/api/scripts/demo-data/fetch-snapshot.ts` | Step 1: read-only snapshot of production (database + uploaded images) over SSH |
| `apps/api/scripts/demo-data/import.ts` | Step 2: rebuild `asifzone_demo` from a snapshot (`pnpm --filter api demo:import`) |
| `apps/api/scripts/demo-data/sanitize.sql` | Anonymisation / removal rules (§4) |
| `apps/api/scripts/demo-data/rewrite-media.sql` | Points image URLs at the local API (§6) |
| `apps/api/scripts/demo-data/lib.ts` | Shared settings: snapshot dir, source SSH settings, target URL guard, Postgres binaries |
| `apps/api/src/config/database-guard.ts` | Runtime guards in the API (§5) |

## 3. Initial import and refresh

Prerequisites: local PostgreSQL 16+ client tools (`psql`, `pg_restore`; auto-detected under `C:\Program Files\PostgreSQL\*\bin`
or set `PG_BIN_DIR`), and the VPS SSH key `~/.ssh/asifzone_vps`.

```sh
cd apps/api
npx tsx scripts/demo-data/fetch-snapshot.ts   # 1. snapshot production (read-only); add --no-media to skip images
pnpm demo:import                              # 2. rebuild asifzone_demo from the newest snapshot
```

Refreshing later works the same way: run both steps again. The import is **idempotent and rebuilds from scratch**. Each run
restores into `asifzone_demo_staging`, sanitizes and verifies it, then replaces `asifzone_demo` with it. Any edits you made
in the demo are discarded on refresh. A failed run drops the staging database and leaves the existing demo untouched.

To import a specific snapshot: `pnpm demo:import --snapshot <file.dump> [--uploads <file.uploads.tar.gz>] [--skip-media]`.
Any `pg_dump --format=custom` archive works, for example one of the VPS backups.

**What the snapshot step does on the VPS.** It runs `docker compose exec -T -e PGOPTIONS='-c default_transaction_read_only=on'
postgres pg_dump --format=custom ...`. `pg_dump` only reads. On top of that, the session is started read-only, so Postgres itself
rejects any write it might attempt. It also runs `tar czf -` over the uploads volume. Both are streamed back over SSH; nothing
is written on the server, and no role, setting, schema or file is created there.

**Where snapshots are kept.** Raw snapshots hold unsanitized production data, so they are stored in `~/.asifzone-demo/snapshots`
(override with `DEMO_SNAPSHOT_DIR`), **outside the repo**, because the repo lives in a OneDrive-synced folder. Delete old
snapshots when you no longer need them.

Import steps, in order:

1. Restore into `asifzone_demo_staging` (marked `demo-staging`; the API refuses to start on it).
2. `prisma migrate deploy`: bring the copy up to this checkout's schema. Only the staging copy is touched. If production is
   ahead of this branch, its extra migrations are simply already applied.
3. `sanitize.sql`, in a single transaction (§4).
4. Media URL rewrite, then extract the image archive into `apps/api/uploads` (§6).
5. Upsert the local demo OWNER from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
6. Sanitization assertions. Any leftover email, phone, credential, token, gateway payload or production image URL aborts the
   import before the swap.
7. Mark the database (`asifzone.environment = 'demo'`, import time, snapshot name), then swap it in as `asifzone_demo`.
8. Rebuild the storefront read model with this checkout's pricing engine.
9. Print row counts: demo before, source snapshot, and demo after.

## 4. What is kept, anonymised, or removed

**Kept exactly:** products, variants, images, categories, product types, templates, attributes and values, materials, care
and size-guide presets, sections, FAQs, relations, SEO fields, pricing, inventory and stock movements, banners, homepage
sections, flash sales, coupons, bundles, redirects, social links, store settings (public business identity), shipping and tax
settings, order economics, line items, statuses, payment and refund amounts, approved reviews (already public on the
storefront), and aggregate analytics.

**Anonymised.** Each original value gets a stable replacement, so the same phone or email maps to the same fake everywhere and
customer-to-order links still hold:

| Data | Becomes |
|---|---|
| Customer names | `Demo Customer N` (order and address names follow the customer) |
| Emails (customers, orders, newsletter, feedback) | `userN@demo.invalid`. `.invalid` is a reserved TLD and is never deliverable. |
| Phones (customers, orders, addresses, feedback) | `019NNNNNNNN` |
| Street address lines | `House N, Demo Road` (division, district and area kept for shipping-zone realism) |
| Staff accounts | `Staff N` / `staffN@demo.invalid`, password unusable, Google link removed |
| Order notes, admin notes, customer admin notes | Removed |
| Free text in status history, stock movements, returns, refunds, payment notes, feedback, review text | Emails and phone numbers scrubbed |
| Non-approved review author names | The anonymised customer name |
| Audit log | IP addresses removed. Metadata removed for people- or order-related entries and scrubbed for the rest. |
| Page views | User agent and city removed |

**Removed:** customer password hashes and Google IDs, admin and customer refresh tokens, password-reset, email-verification
and phone-OTP tokens, customer claims, admin invites, push subscriptions, the outbox queue, admin notifications, payment gateway
raw payloads and checkout payloads, admin SMS alert phones, and rendered campaign bodies. Scheduled or sending campaigns become
drafts; unsent recipients are closed out.

Anonymised customers have no password, so they cannot log in. Register a fresh account in the demo if you need a customer
login; it exists only in `asifzone_demo`.

## 5. How production is protected

1. **No credentials.** Nothing in the repo or env files can connect to the production database. The only access is the explicit
   SSH snapshot command, which is read-only (§3).
2. **Loopback-only rule** (`database-guard.ts`, enforced in `config/env.ts` before anything else loads). Outside
   `NODE_ENV=production`, the API, every script that imports the config, and the test suite refuse to start unless
   `DATABASE_URL` points at `localhost` / `127.0.0.1` / `::1`. Production Postgres is only on the VPS's private Docker network,
   so no development process can be pointed at it by a config slip. Background jobs share the same Prisma client and the same
   guard.
3. **Demo marker check** (`server.ts` startup). The API refuses to start on:
   - `asifzone_demo_staging`, or any database marked `demo-staging`;
   - a database named `asifzone_demo` without the demo marker;
   - a marked demo database under any other name;
   - any demo database under `NODE_ENV=production`.
4. **Live providers off on the demo.** When `DATABASE_URL` is `asifzone_demo`, the API sets `LIVE_PROVIDERS=off`. SMS and
   email are logged locally (`.devmail/`), and every outbound request to a non-local host is blocked, including courier
   booking, payment gateways and Meta CAPI. This means demo orders can never book a real Steadfast parcel or message a real
   phone. `/health` reports `"liveProviders": false`. Set `DEMO_LIVE_PROVIDERS=on` only if you deliberately need a real provider
   call; it removes this protection entirely, so use sandbox credentials. Google sign-in verification is also blocked while providers
   are off.
5. **The import only writes locally.** It refuses any non-loopback target and only creates, drops or renames
   `asifzone_demo_staging` / `asifzone_demo`.

## 6. Media

Production stores uploaded images on the VPS uploads volume and records **absolute** URLs (`https://asifzone.com/uploads/...`,
via `API_ORIGIN` in `upload.service.ts`). The import:

- copies the files (snapshot `*.uploads.tar.gz`) into the local `apps/api/uploads` directory, which is gitignored. Existing
  files are kept; names are unique ids, so they do not collide.
- rewrites every `https://{asifzone.com, www.asifzone.com, 187.77.137.12, 187.127.217.33}/uploads/` URL, in every
  text/json/array column of every table, to `${API_ORIGIN}/uploads/` (default `http://localhost:4000`). Override the host
  list with `DEMO_MEDIA_SOURCE_HOSTS`.
- reports how many product image files are present.

Images are served by the local API. Uploads made in the demo are written to the local disk only; there is no storage
credential or write path to the VPS. Non-upload links in content (for example a banner linking to an `asifzone.com` page) are
left unchanged; following one just opens the live site in the browser.

## 7. Switching databases

`apps/api/.env` points at the demo by default (`DATABASE_URL=.../asifzone_demo`). To go back to the old local dev database,
set `DATABASE_URL=postgresql://postgres@localhost:5432/clothing_brand?schema=public`. Tests are unaffected: they use
`.env.test` (`clothing_brand_test`).
