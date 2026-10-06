# Nasihamart installation

Nasihamart is one more installation of this codebase (docs/STORE_DEPLOYMENT.md): the same Git commit and web image
as every other store, with its own database, Redis namespace, uploads volume, `docker/.env`, domain and certificate.
Only data and configuration differ, never code. The look comes from `STORE_THEME=nasihamart` (packages/ui-tokens). The
store's name, logo, catalog, homepage, navigation, policies, SEO, contact details and social links come from its own
database and are entered in the admin.

## 1. `docker/.env` (deployment inputs)

Start from `docker/.env.example`. The values that make this installation Nasihamart are listed below. Secrets and
provider credentials are filled in on the server only, and are never copied from another store.

```dotenv
INSTALL_ID=nasihamart            # never change it once the store is live
STORE_THEME=nasihamart
SERVER_NAME=nasihamart.com
SERVER_ALIASES=www.nasihamart.com
CERT_NAME=nasihamart.com
SITE_URL=https://nasihamart.com
PUBLIC_API_URL=https://nasihamart.com
GDRIVE_REMOTE=<rclone remote>:nasihamart-backups
COMPOSE_PROJECT_NAME=nasihamart  # its own compose project, volumes and network
POSTGRES_DB=nasihamart
# On a VPS shared with another store, give it its own host ports (a front proxy routes each domain):
# API_HOST_PORT=4100  WEB_HOST_PORT=3100  HTTP_PORT=8081  HTTPS_PORT=8444
# JWT_*, POSTGRES_PASSWORD, REDIS_PASSWORD, SEED_ADMIN_EMAIL/PASSWORD, provider credentials: new values, set on the server.
```

Pixels (`META_PIXEL_ID`, `TIKTOK_PIXEL_ID`, `CLARITY_ID`) and `GOOGLE_CLIENT_ID` are Nasihamart's own accounts, or blank.

## 2. First deployment

Follow "New store (fresh server)" in docs/STORE_DEPLOYMENT.md: certificate → `bash docker/deploy.sh` (it migrates an
empty database) → seed the first OWNER. A production seed creates only the owner, never the demo catalog. The
homepage starts with the store-neutral default sections, and the policy fields start empty, so the storefront makes no
promises until the owner sets them.

**Never** run `apps/api/scripts/sample-store` against this installation. It is a local development tool, it refuses
production and remote databases, and its content and images are placeholders.

## 3. Content the owner enters (Admin)

| What | Where |
|---|---|
| Store name, tagline, logo (light + dark backgrounds), favicon | Settings → Store & Branding |
| Search engines (verification), contact email/phone, business identity, support hours | Settings → Store & Branding / Contact & Support |
| Return window, return conditions, dispatch time | Settings → Shipping, Tax & Rewards → Store policy |
| Shipping fees, tax, Cash on Delivery / online payment | Settings → Shipping, Tax & Rewards |
| Social links, payment-method logos | Social Links, Payment Methods |
| Categories (names, order, images, SEO) — they are the navigation | Categories |
| Product types, attributes, products, images, variants, size guides | Product Builder |
| Hero, category grid, best sellers / new arrivals (product carousels), brand story, values, trust, promotional banners | Homepage |
| Shipping & Returns wording (if it should differ from the policy-generated text) | Product sections → Shipping & returns |

Every image goes through the normal upload pipeline (`/uploads/<key>`, resolved against `MEDIA_BASE_URL`). Replacing an
image is uploading a new one in the same field. No image URL is written in code.

## 4. Before launch

- [ ] Real logo (light and dark), favicon, hero, category, product, brand-story and promotional images uploaded.
- [ ] Store policy reviewed against the real returns/dispatch policy, and the Terms, Privacy and Shipping & Returns pages checked.
- [ ] Shipping fees and payment methods confirmed. A gateway shows only when its credentials exist and its toggle is on.
- [ ] Backups: the nightly `docker/gdrive-backup.sh` cron for this installation.
