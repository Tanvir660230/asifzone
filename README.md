# Clothing Brand E-Commerce Platform

Monorepo: `apps/web` (Next.js storefront + admin), `apps/api` (Express backend), `packages/*` (shared code). See the full architecture/roadmap at `C:\Users\tanvi\.claude\plans\ami-ekta-clothing-brand-logical-cloud.md`.

**Status**: Phases 1–5 complete — admin catalog management, storefront, cart/checkout/payments, flash sales/coupons/banners, and analytics/SEO/security hardening are all implemented. Customer accounts (login, order history, saved addresses, wishlist, password reset) are also implemented, plus an admin customer-management view, an API test suite (`pnpm --filter api test`), a Playwright end-to-end suite (`pnpm --filter web test:e2e`), and a GitHub Actions CI workflow (`.github/workflows/ci.yml`, runs once this repo has a GitHub remote). Cart stays guest/client-side by design — there's no server-side cart to merge on login. Wishlist works the same way while signed out (`/wishlist`, client-side) but merges into the account automatically on login/register.

**Not yet set up (all blocked on an external account/access this repo can't create for you):**
- **Production deployment** — no VPS/domain configured yet. Steps are below once you have Hostinger + Cloudflare access.
- **Online payments** — no SSLCommerz or EPS-PG credentials configured. COD works end-to-end regardless; add real credentials to `apps/api/.env` (`SSLCOMMERZ_STORE_ID`/`SSLCOMMERZ_STORE_PASSWORD`, or `EPS_USERNAME`/`EPS_PASSWORD`/`EPS_HASH_KEY`/`EPS_MERCHANT_ID`/`EPS_STORE_ID` — get these from EPS support at info@eps.com.bd) once you have a sandbox or live merchant account, then flip the matching toggle on in the admin Settings page (both start off there too).
- **Transactional email** — no provider configured, so password-reset emails currently only write to `apps/api/.devmail/*.html` and the server console instead of actually sending (see `apps/api/src/lib/mailer.ts`). Once you have a Resend/SendGrid/SES API key, replace the body of `sendMail()` with a real provider call — every caller stays unchanged.
- **Nightly backups** — `docker/backup.sh` exists but needs to be added to the VPS's crontab after deployment (see below); it can't run until there's a VPS.

## Prerequisites

- Node.js 20+, [pnpm](https://pnpm.io) (`npm install -g pnpm`)
- Docker Desktop (for Postgres + Redis locally, and for the production build)

## Local development

1. Start Postgres + Redis only:
   ```bash
   docker compose -f docker/docker-compose.yml up -d postgres redis
   ```
2. Copy env files:
   ```bash
   cp apps/api/.env.example apps/api/.env
   cp apps/web/.env.example apps/web/.env.local
   ```
   Edit `apps/api/.env` if you changed any DB/Redis ports. To test real online payments, fill in `SSLCOMMERZ_STORE_ID`/`SSLCOMMERZ_STORE_PASSWORD` with a free [SSLCommerz sandbox account](https://developer.sslcommerz.com/) — without it, COD still works end-to-end and the online-payment path fails gracefully with a clear error.
3. Install dependencies and set up the database:
   ```bash
   pnpm install
   pnpm --filter api prisma:migrate
   pnpm --filter api db:seed
   ```
   The seed script prints a generated admin email/password — use it to log in, then change the password.
4. Run both apps in dev mode (hot reload):
   ```bash
   pnpm dev
   ```
   - API: http://localhost:4000
   - Storefront: http://localhost:3000
   - Admin panel: http://localhost:3000/admin/login

## Production deployment (Hostinger VPS)

```bash
cp docker/.env.example docker/.env   # fill in real secrets/domain
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d --build
```

This builds and runs `postgres`, `redis`, `api`, `web`, and an `nginx` reverse proxy on port 80. Put Cloudflare in front (proxied DNS, "Full (strict)" SSL) for CDN + HTTPS. Set `NEXT_PUBLIC_SITE_URL` to the real domain so the sitemap/robots.txt/structured data emit correct URLs. Run migrations after the first deploy:

```bash
docker compose -f docker/docker-compose.yml exec api pnpm prisma migrate deploy
docker compose -f docker/docker-compose.yml exec api pnpm db:seed
```

**Nightly backups**: add `docker/backup.sh` to the VPS's crontab (`0 2 * * * /path/to/docker/backup.sh`) — it backs up both the database (`pg_dump`, gzipped) and the uploaded product/category/banner images to `/var/backups/clothing-brand`, with 14-day retention. This alone only protects against *data* mistakes (bad migration, accidental delete) — it doesn't protect against losing the VPS itself, since the backups live on the same disk. Set `RCLONE_REMOTE` (after a one-time `rclone config` on the VPS, pointed at a free Backblaze B2 or Cloudflare R2 bucket) to also copy each night's backup off-server automatically.

## Admin panel feature map

Categories · Products (variants, images, flash-sale pricing shown automatically) · Orders (status workflow, COD/online payment status) · Customers (search, view profile/addresses/orders/wishlist — read-only) · Flash Sales (scheduled campaigns, auto-activate/deactivate via cron) · Coupons (%/fixed, min order, max discount cap, usage limits, expiry) · Banners (homepage hero/promo content) · Dashboard (revenue trend, order status breakdown, top products, low-stock alerts).

## Running automated tests

- **API unit/integration tests** (Vitest + Supertest, run against your local dev database): `pnpm --filter api test`
- **Browser end-to-end tests** (Playwright, desktop + mobile, requires the API and web dev servers already running via `pnpm dev`): `pnpm --filter web test:e2e`
- Both run automatically in CI (`.github/workflows/ci.yml`) against a throwaway Postgres service once this repo is pushed to GitHub.

## Verifying end-to-end

1. Log in at `/admin/login`, confirm the dashboard shows revenue/orders/low-stock tiles (zero-state is fine on a fresh DB).
2. **Categories/Products**: add a nested category, a product with 2+ variants and images (Phase 1 flow).
3. **Storefront**: browse the homepage → category → product → add to cart → checkout with COD → confirm the order appears in admin Orders.
4. **Flash sale**: create one scheduled for "now" in admin, add a product to it, confirm the storefront shows the discounted price and countdown within a minute (cron) or immediately after an API restart.
5. **Coupon**: create one in admin, apply it at checkout, confirm the discount matches.
6. **Order tracking**: use the footer "Track Order" link with the order number + phone from step 3.
7. **Customer account**: register at `/account/register`, add a saved address, add a product to your wishlist from its product page, use "Forgot password?" on `/account/login` (in dev mode the reset link is written to `apps/api/.devmail/*.html` and logged to the API console instead of emailed), reset your password, and confirm the new password logs in. Then confirm the account shows up under admin → Customers.
8. Confirm data persists: `pnpm --filter api db:studio` opens Prisma Studio against the same database.
