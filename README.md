# Clothing Brand E-Commerce Platform

Monorepo: `apps/web` (Next.js storefront + admin), `apps/api` (Express backend), `packages/*` (shared code). See the full architecture/roadmap at `C:\Users\tanvi\.claude\plans\ami-ekta-clothing-brand-logical-cloud.md`.

**Status**: Phases 1–5 complete — admin catalog management, storefront, cart/checkout/payments, flash sales/coupons/banners, and analytics/SEO/security hardening are all implemented. Guest checkout only (no customer accounts yet).

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

Categories · Products (variants, images, flash-sale pricing shown automatically) · Orders (status workflow, COD/online payment status) · Flash Sales (scheduled campaigns, auto-activate/deactivate via cron) · Coupons (%/fixed, min order, max discount cap, usage limits, expiry) · Banners (homepage hero/promo content) · Dashboard (revenue trend, order status breakdown, top products, low-stock alerts).

## Verifying end-to-end

1. Log in at `/admin/login`, confirm the dashboard shows revenue/orders/low-stock tiles (zero-state is fine on a fresh DB).
2. **Categories/Products**: add a nested category, a product with 2+ variants and images (Phase 1 flow).
3. **Storefront**: browse the homepage → category → product → add to cart → checkout with COD → confirm the order appears in admin Orders.
4. **Flash sale**: create one scheduled for "now" in admin, add a product to it, confirm the storefront shows the discounted price and countdown within a minute (cron) or immediately after an API restart.
5. **Coupon**: create one in admin, apply it at checkout, confirm the discount matches.
6. **Order tracking**: use the footer "Track Order" link with the order number + phone from step 3.
7. Confirm data persists: `pnpm --filter api db:studio` opens Prisma Studio against the same database.
