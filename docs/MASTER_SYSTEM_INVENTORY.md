# ASIF ZONE — MASTER SYSTEM INVENTORY

> **Audit date:** 2026-10-05 · **Branch:** `feat/tiktok-pixel` @ `aad8219` · **Mode:** read-only. Nothing in the project was modified.
> **Scope:** the whole monorepo (`apps/api`, `apps/web`, `packages/*`, `docker/`, `.github/`). About 78k lines tracked, 974 files.
> **How to use this document:** every meaningful feature has a stable ID (`PUB-12`, `ORD-07`, …), so another agent can work through them one at a time. Paths are relative to the repo root. **"Needs Verification"** marks anything I could not confirm by reading code (for example, runtime behavior or third-party account state).
>
> **Conventions:** `API` = `apps/api/src`, `WEB` = `apps/web`, `SHARED` = `packages/shared/src`. Route strings are the real Express mount paths.

---

## 1. Technology Stack

| Layer | Technology | Where |
|---|---|---|
| Monorepo | pnpm 9 workspaces + Turborepo 2 | `pnpm-workspace.yaml`, `turbo.json` |
| Runtime | Node ≥ 20 | root `package.json` |
| Backend | Express 4, TypeScript, Zod 3 validation, `tsx` in dev | `apps/api` |
| ORM / DB | Prisma 5 (`omitApi` preview) + PostgreSQL 16 (uses `pg_trgm` for search) | `apps/api/prisma/schema.prisma` (85 models, 31 enums, 84 migrations) |
| Cache / queues | Redis 7 (ioredis) + BullMQ 6 (cron schedulers and workers) | `API/config/redis.ts`, `API/jobs/*` |
| Auth | JWT (jsonwebtoken), bcryptjs, httpOnly cookies, DB-tracked refresh tokens, double-submit CSRF | `API/lib/jwt.ts`, `customer-jwt.ts`, `middlewares/csrf.ts` |
| Security | helmet, cors, express-rate-limit, nginx `limit_req` | `API/app.ts`, `API/middlewares/rate-limit.ts`, `docker/nginx/nginx.conf` |
| Images | multer (memory) + sharp → WebP thumb/card/full (300/600/1600) | `API/modules/uploads/*` |
| Frontend | Next.js 15 (App Router, `output: standalone`), React 19, Tailwind 3 + `@tailwindcss/typography` | `apps/web` |
| Client state | TanStack Query 5, Zustand 4 (cart, wishlist, compare, quick view, search overlay, express checkout, cart drawer) | `WEB/store/*` |
| Forms | react-hook-form + @hookform/resolvers + shared Zod schemas | `SHARED/schemas/*` |
| Rich text | TipTap 3 (image, link, table, youtube, placeholder) | `WEB/components/admin/rich-text-editor.tsx` |
| Drag & drop | @dnd-kit | homepage builder, image ordering, category tree |
| Animation | framer-motion | `page-transition.tsx` and others |
| Printing | jsPDF, html-to-image, jsbarcode, qrcode.react | `WEB/components/orders/*`, `WEB/lib/label-pdf.ts` |
| Sanitization | isomorphic-dompurify (server and browser) | `product-page-view.tsx`, `live-preview-frame.tsx` |
| Shared package | `@clothing-brand/shared`: Zod schemas, pricing/tax/shipping/promotion engines, order state machine, permission map, metrics engine | `packages/shared` |
| Design tokens | `@clothing-brand/ui-tokens` (JS tokens consumed by Tailwind config) | `packages/ui-tokens` |
| AI | `@anthropic-ai/sdk` (Claude; default model env `ANTHROPIC_MODEL=claude-opus-5`) | `API/modules/ai/ai.service.ts` |
| Email | Resend (falls back to writing `.devmail/*.html` files) | `API/lib/mailer.ts` |
| SMS | BulkSMSBD (logs instead of sending when no key is set) | `API/lib/sms.ts` |
| Push | web-push (VAPID) + `public/sw.js` | `API/lib/push.ts` |
| Geo | geoip-lite (offline IP → country/region/city) | `API/modules/analytics/analytics.service.ts` |
| Testing | Vitest + Supertest (65 API test files: unit, integration, "guard" tests), Playwright (15 e2e specs, desktop + mobile) | `apps/api/**/*.test.ts`, `apps/web/e2e` |
| CI/CD | GitHub Actions: `ci.yml` (test → deploy on a self-hosted VPS runner), `validate-nginx.yml` | `.github/workflows` |
| Hosting | Docker Compose: postgres, redis, api, web, nginx, certbot (Let's Encrypt) on a VPS | `docker/docker-compose.yml`, `docker/deploy.sh`, `docker/backup.sh` |

---

## 2. Frontend Architecture

### 2.1 Route groups (`apps/web/app`)
| Group | Purpose | Layout notes |
|---|---|---|
| `(storefront)` | Home, cart, checkout, search, content pages, order confirmation, tracking, wishlist | Shares `StorefrontShell`; has a route-level `loading.tsx` (BrandLoader) |
| `(storefront-detail)` | `/product/[slug]`, `/category/[slug]`, `/preview/[id]` | Same shell, deliberately **without** the group `loading.tsx` so pages stream properly |
| `account/(auth)` | login, register, forgot/reset password, verify-email, unsubscribe, claim | Auth card layout |
| `account/(shell)` | profile, orders, order detail, addresses, returns, reward points, coupons, browsing history | Account sidebar (`account-nav.tsx`) |
| `account/(invoice)` | `/account/orders/[id]/invoice` | Print layout |
| `admin/(auth)` | `/admin/login`, `/admin/accept-invite` | |
| `admin/(shell)` | Every admin page (59 pages) | **Client-only** layout (`"use client"`): sidebar, top bar, notification bell, toaster |
| `admin/(invoice)` | `/admin/orders/[id]/invoice` | Print layout |
| `admin/(preview-frame)` | `/admin/product-preview-frame` | Iframe target for the product wizard's live preview |
| `api/revalidate` | `POST /api/revalidate` (route handler) | On-demand ISR via `revalidateTag`, protected by a shared secret |

**Page count:** 94 `page.tsx` files. 81 are client components (`"use client"`). The server-rendered ones are home, search, category, product, preview, the content pages, and browsing history.

### 2.2 Key frontend infrastructure
| Concern | Implementation |
|---|---|
| API access (client) | `WEB/lib/api-client.ts` `apiFetch`: `credentials: include`, echoes the CSRF cookie as `X-CSRF-Token`, sends `Idempotency-Key`, does one silent refresh-and-retry on a 401 (single shared refresh promise). `apiUploadWithProgress` is the XHR version for uploads with progress. |
| API access (server/ISR) | `WEB/lib/api/storefront.ts` `storefrontFetch`, using Next's fetch cache with tags (`settings`, product tags), mostly a 60s or 300s revalidate window. Each call has a `*Safe` variant with an outage fallback (`DEFAULT_STORE_SETTINGS`). |
| API client modules | 43 files under `WEB/lib/api/*` (one per domain). Admin domains use the `admin-*.ts` prefix. |
| Edge middleware | `WEB/middleware.ts`: admin-managed redirects (fetches `/api/redirects/active`, cached 300s), dynamic `/favicon.ico` redirect, and a cookie-presence gate for `/admin/*` and `/account/*`. It runs on **every** request except `_next/static` and `_next/image`. |
| Store config | `WEB/components/store-config.tsx` + `WEB/lib/store-config.ts` hold currency and timezone from settings (and throw if read outside the provider). |
| Formatting | `WEB/lib/format.ts` (money/date via store config), `SHARED/format.ts` |
| Query defaults | `WEB/app/providers.tsx`: `staleTime` 30s, `retry` 1 |
| Persistent client stores | `store/cart.ts` (persisted cart), `wishlist.ts` (guest wishlist), `compare.ts`, `express-checkout.ts` (Buy Now), `quick-view.ts`, `search-overlay.ts`, `cart-drawer.ts` |
| Hooks (10) | `use-add-to-cart`, `use-bottom-dock`, `use-can-manage-catalog`, `use-current-admin`, `use-current-customer`, `use-debounced-value`, `use-feedback-form`, `use-focus-trap`, `use-form-preview-sync`, `use-quote` |
| Admin "hint" | `WEB/lib/admin-hint.ts` marks a browser as an admin's once a session is verified, so the storefront can show admin-only overlays (`admin-sales-badge.tsx`, `category-stock-panel.tsx`) |
| Ad pixels | `WEB/lib/pixels/*`: one layer for Meta + TikTok with dedupe guards, a consent gate (currently always grants), lazy script load, and path exclusions |
| Analytics beacons | `WEB/lib/analytics.ts`: session id, 1-year visitor id, first-touch UTM/referrer, pageview + `sendBeacon` exit, funnel events, search-session correlation |
| SEO helpers | `WEB/lib/seo.ts`, `WEB/lib/structured-data.ts` (Product, ItemList, FAQ, Breadcrumb, Organization, WebSite JSON-LD) |

---

## 3. Backend Architecture

### 3.1 Layering
`app.ts` (middleware chain) → `modules/<domain>/<domain>.routes.ts` → `*.controller.ts` → `*.service.ts` → Prisma. Cross-cutting **domain services** sit in `API/domain/*`, and pure **engines** sit in `SHARED/engines/*`.

**Middleware order** (`API/app.ts`): `trust proxy 1` → helmet → cors (`WEB_ORIGIN`, credentials) → json (2 MB) → urlencoded (for SSLCommerz) → cookieParser → `correlationMiddleware` (request id + structured log) → `csrfProtection` → `auditMiddleware` → static `/uploads` (30d) → routers → 404 → `errorHandler`.

### 3.2 Domain layer (single sources of truth)
| Domain | File | Responsibility |
|---|---|---|
| Authorization | `API/domain/auth/authorization.ts` | `resolveAdminIdentity` re-reads the role and active flag from the DB on **every** request; `can()` checks permissions |
| Commerce settings | `API/domain/config/commerce-settings.ts` | Currency + timezone |
| Pricing | `API/domain/pricing/pricing.service.ts`, `pricing-config.ts` | `quoteCart`, `bestCouponFor`, `priceProductsForDisplay`, flash offers, quote token / TTL; tax and shipping-zone config, legacy dual-write, drift report |
| Payments ledger | `API/domain/payments/payment-ledger.service.ts` | The **only** writer of `Payment`, `Refund` and `Order.paymentStatus`; COD collection, manual payments, refunds, drift and repair |
| Orders | `API/domain/orders/line-snapshots.ts` | Historical cost / category / brand snapshots per order line |
| Outbox | `API/domain/outbox/*` | Transactional outbox: record, dispatch (SKIP LOCKED), process, retry, cleanup; 4 consumers |
| Metrics | `API/domain/metrics/*` | Fact loader + registry-driven metrics engine, store-time ranges, consistency check |
| Storefront read model | `API/domain/storefront/*` | `ProductReadModel` projection (selling-price sort/filter), freshness guard, rebuild, drift |
| Reliability / observability | `API/lib/observability/*`, `API/modules/ops/*` | Logger with redaction, error capture, job observation, readiness, attention signals, reliability report |

### 3.3 Shared engines (`packages/shared/src/engines`)
`money.ts` (minor-unit math), `rounding.ts`, `pricing.ts` (unit price incl. flash, splitting a line at a flash stock limit), `promotion.ts` (coupons/bundles), `shipping.ts` (zones), `tax.ts` (inclusive/exclusive, shipping VAT), `order-totals.ts`, `quote.ts` (the canonical quote), `availability.ts`, `loyalty.ts`, `payment-ledger.ts`. Plus `order-state.ts` (state machine), `permissions.ts` (RBAC), `metrics/*` (registry, aggregate, business-time, facts), `completeness.ts`, `sections.ts`, `sku.ts`, `gallery.ts`, `wizard-steps.ts`, `search-synonyms.ts`, `config/product-types.ts` (legacy hardcoded types).

### 3.4 Background jobs (BullMQ, started in `API/server.ts`)
| Job | Schedule | File | Work |
|---|---|---|---|
| Flash-sale activation | every 1 min | `jobs/flash-sale-cron.ts` | `syncFlashSaleActivation` (also runs once at boot) |
| Read-model rebuild | every 15 min | same queue | `rebuildAllReadModels` |
| Campaign scheduler | every 1 min | `jobs/campaign-scheduler-cron.ts` | `promoteDueCampaigns` |
| Campaign send worker | on demand | `jobs/campaign-send-worker.ts` | `processCampaignSend` (concurrency 10 per campaign) |
| Courier status sync | every 15 min | `jobs/courier-status-cron.ts` | `syncPendingCourierStatuses` (Steadfast) |
| Payment reconciliation | every 5 min | `jobs/payment-reconciliation-cron.ts` | `reconcileStuckEpsSessions` + `expireStalePaymentSessions` |
| Outbox dispatch | every 3 s | `jobs/outbox-worker.ts` | reap stale claims, dispatch, heartbeat |
| Outbox deliver | per event | same | `processOutboxEvent` (concurrency 5) |
| Outbox cleanup | daily 03:00 | same | retention of processed outbox rows + expired customer refresh tokens |
| Meta CAPI (legacy drain) | on demand | `jobs/meta-capi-worker.ts` | drains pre-outbox jobs; inert unless CAPI is configured |

### 3.5 Outbox consumers (`API/domain/outbox/consumers.ts`)
`customer-order-sms` (placed/confirmed/shipped/delivered/cancelled), `admin-order-alert-sms` (placed), `payment-receipt-email` (`payment.settled.v1`), `meta-capi-purchase` (`order.placed.v1`, personal data scrubbed after the send).

### 3.6 Scripts / ops
`apps/api/scripts/`: `create-e2e-staff.ts`, `payment-ledger-reconcile.ts`, `read-model-rebuild.ts`, `with-test-db.ts`. Seeds: `prisma/seed.ts` (admin + baseline data), `prisma/seed-presets.ts` (catalog presets). Deploy: `docker/deploy.sh` (backup → verify → build → migrate → switch → readiness → restart nginx), `docker/backup.sh` (pg_dump + uploads, 14-day retention, optional rclone off-site copy).

### 3.7 Validation & errors
- Zod schemas from `SHARED/schemas/*` (34 files) are applied through `middlewares/validate.ts`.
- `lib/app-error.ts` + `middlewares/error-handler.ts` map Prisma P2002/P2025/P2003 and multer errors. 5xx errors go to `captureError` and the client gets a generic message (no stack traces).

---

## 4. Database Architecture

PostgreSQL via Prisma: **85 models, 31 enums, 84 migrations**. Raw-SQL partial unique indexes that the Prisma schema can't express: one default address per customer, one PENDING return request per order, one ACTIVE payment session per order, one customer per verified phone, plus a CHECK constraint on `ProductMaterial`.

### 4.1 Identity & access
| Model | Purpose | Important fields | Relations | Used by | Concerns |
|---|---|---|---|---|---|
| `AdminUser` | Staff account | email (unique), passwordHash, googleId, `role` (OWNER/STAFF, **default OWNER**), isActive | RefreshToken, AuditLog, OrderStatusHistory, ReturnRequest, AdminInvite, StockMovement, Refund×2, Payment, Order (deletedBy) | auth, every admin action | The default role is the most privileged one. Any code path that creates an admin without an explicit role makes an OWNER. |
| `AdminInvite` | Invite-only onboarding | email, role, tokenHash, expiresAt, acceptedAt | invitedBy → AdminUser | Team page | — |
| `RefreshToken` | Admin refresh sessions (rotation) | tokenHash, revokedAt, replacedById, userAgent | AdminUser (cascade) | auth | No retention job for admin tokens (customer tokens do have one) |
| `AuditLog` | Append-only admin mutation log | action, entityType, entityId, metadata JSON, ipAddress | AdminUser (SetNull) | audit middleware, Audit Log page | Grows without bound; no retention policy |
| `Customer` | Shopper (account **or** guest placeholder) | email (unique, nullable), phone, phoneVerifiedAt, passwordHash, googleId, rewardPoints, tokenVersion, sms/emailMarketingOptIn, adminNotes, **isBlocked**, codRisk, delivery-score cache fields | Address, Order, Wishlist, tokens, claims, points ledger, Cart, StockAlert, ReturnRequest, Review, CampaignRecipient, PushSubscription | Nearly everything | `isBlocked` **is not enforced anywhere** (it only affects tags, see §24). Guest and account records share one table. |
| `CustomerRefreshToken` | DB-backed customer sessions (families, rotation, reuse detection) | familyId, tokenHash, tokenVersion, persistent, rotatedAt, revokedReason | Customer | customer-sessions.ts | — |
| `CustomerClaim` | Pending claim of a guest placeholder by email | tokenHash, passwordHash, name, phone | Customer | registration | — |
| `PasswordResetToken`, `EmailVerificationToken` | One-time tokens | tokenHash, expiresAt, usedAt | Customer | auth flows | — |
| `PhoneOtp` | OTP codes (attempt-capped) | phone, codeHash, attempts, consumedAt | — | OTP login, phone verification | No cleanup job seen (Needs Verification) |
| `Address` | Saved addresses (BD format) | division, district, area, addressLine, isDefault | Customer | account, checkout | BD-specific shape |

### 4.2 Catalog
| Model | Purpose | Important fields / notes |
|---|---|---|
| `Category` | Nested category tree | slug, parentId (self-relation), image, banner, SEO, isFeatured, sortOrder, `deletedAt` (soft delete) |
| `Product` | Core product | name, slug, description (HTML), `productType` (legacy enum mirror) + `typeId`, `attributes` JSON (legacy/size guide), brand (free text), `brandTier`, basePrice/compareAt/cost/taxRate, trackInventory, lowStockThreshold, restockDate, `isActive` **and** `status` (kept in sync), SEO/OG/canonical, care preset or override, avgRating/reviewCount (denormalized), `deletedAt` |
| `ProductVariant` | Purchasable unit | sku (unique), barcode, `size` + `color` (denormalized, unique per product), sizeLabel, colorHex, price/compareAt/cost overrides, stock, weight, isActive, primary image, sortOrder |
| `VariantAttributeValue` | Variant ↔ option value join | — |
| `Attribute` / `AttributeValue` | **Variant-option** system (Color, Fabric…) with colorHex | Separate from the template attribute system below; the naming collision is confusing (§23) |
| `ProductImage` / `VariantImage` | Product images + per-variant galleries | url, alt, caption, width/height, sortOrder |
| `ProductTypeDef` | Admin-managed product types | key, parent (family), template, legacyType, isSystem, skuCode |
| `ProductTemplate` | Reusable type config | variantDimensions JSON (≤2: size/color), sizeGuideMode, size guide preset, care preset, `requiredChecks[]`, archived |
| `AttributeDefinition` / `AttributeDefinitionOption` | Typed product fields (10 data types) | key (immutable), label, dataType, unit, helpText |
| `TemplateAttribute` | Attribute on a template | required, spec group, placeholder override, showOnStorefront |
| `ProductAttributeValue` | Typed value per product | valueText/Number/Boolean/Date/Json |
| `SpecGroup` | Grouping of spec rows on the PDP | — |
| `SizeGuidePreset` / `CareGuidePreset` / `Material` / `ProductMaterial` | Reusable size charts, care steps, materials and composition | JSON columns/rows; archived flags |
| `CatalogSetting` / `SkuCounter` | SKU pattern (`{PREFIX}-{TYPE}-{COLOR}-{SIZE}-{SEQ:3}`, prefix default **"AZ"**) and atomic counters | — |
| `GlobalSection` / `TemplateSection` / `ProductSection` | 3-level PDP section overrides (product → template → global → registry default) | — |
| `ProductFaq` | Per-product Q&A | — |
| `ProductRelation` | Curated rails (RELATED, CROSS_SELL, UPSELL, FREQUENTLY_BOUGHT, RECOMMENDED) | Falls back to the algorithm when nothing is curated |
| `ProductReadModel` | Price projection for sorting/filtering | min/max selling price, hasLiveFlashSale, sourceHash, validUntil, volatile |
| `ProductReview` | Moderated reviews (one per customer per product) | rating, status, isVerifiedPurchase |

**Catalog concerns:** two attribute systems; `Product.isActive` duplicates `status`; legacy `productType` enum alongside `typeId`; `brand` is free text (no Brand entity, which matters for multi-brand work); `attributes` JSON still carries legacy keys.

### 4.3 Orders, payments, fulfilment
| Model | Purpose | Important fields / notes |
|---|---|---|
| `Order` | Order header + **immutable pricing snapshot** | orderNumber, status (10 states), paymentMethod (COD/SSLCOMMERZ/EPS_PG), paymentStatus (ledger projection), customer/shipping snapshot (BD division/district/area), subtotal/discount/shippingFee/total, priceAdjustment, coupon/bundle links, pricingVersion, flash/coupon discount, shippingWaived, shippingZoneKey, tax snapshot, couponReleasedAt, idempotencyKey, Steadfast fields (consignmentId, status, bookedAt, booking-claim lease, trackingLink, syncedAt, syncError), partialDeliveryReconciledAt, followUpAt, callAttempts, soft delete (`deletedAt`, deletedBy), sessionId (attribution). Deprecated: `paymentSessionKey`, `paymentTransactionId`, `trackingNumber`, `carrier`. |
| `OrderItem` | Line snapshot | name/sku/size/color/price snapshots, returnedQuantity, restockedQuantity, listPrice, flash sale ids, allocated bundle/coupon discounts, `unitCostSnapshot` (omitted from reads by default), product/category/brand snapshots. **No FK to the variant** (by design). |
| `OrderStatusHistory` | Timeline | status, note, changedByAdmin |
| `ReturnRequest` | RETURN or EXCHANGE | reason, note, exchange snapshots, exchangeOrderId, status, review fields |
| `PaymentSession` | One gateway attempt | provider, status, gatewayTransactionRef (our id), providerTransactionId, `checkoutPayload` (pre-order snapshot), idempotencyKey, expiresAt (48h) |
| `Payment` | Settlement record | provider (incl. COD/MANUAL), status, amount, verifiedAmount, rawResponse, note, recordedByAdmin, backfilled |
| `PaymentEvent` | Attempt timeline | type, note, rawResponse |
| `Refund` | Manual refund record (REQUESTED → COMPLETED) | amount, method (free text), requestedBy/completedBy, idempotencyKey |
| `StockMovement` | Inventory ledger | change, reason (8 reasons), orderId (plain column), admin, note |
| `CourierLossEvent` | Estimated courier round-trip loss | amount (admin estimate), reason |
| `ShippingZone` / `ShippingZoneMatch` / `ShippingRate` | Zone-based shipping (postcode/district/division match, priority, freeOverAmount) | **No admin CRUD.** Only two legacy zones get their fee updated from the settings page (§26). |
| `TaxSetting` | Central tax config (mode INCLUSIVE/EXCLUSIVE, rates, shipping taxable) | Only enabled/rate/shippingTaxable can be edited from settings; **mode and shippingRate have no UI** |

### 4.4 Commerce, promotions, content, marketing
| Model | Purpose |
|---|---|
| `Coupon` (+`CouponProduct`, `CouponCategory`) | PERCENTAGE / FIXED / FREE_SHIPPING; scope; min order/qty; max discount; usage/per-customer limits; first-order-only; schedule; soft delete |
| `Bundle` / `BundleSuggestion` | Category-driven cross-sell discount (anchor category + N suggested categories) |
| `FlashSale` / `FlashSaleItem` | Time-boxed per-product discount with optional stock limit; `enabled` (admin switch) and `isActive` (derived) |
| `Banner` | HERO_CAROUSEL / PROMO_STRIP with mobile image, alt, schedule |
| `HomepageSection` | Ordered builder blocks (10 types), config JSON, schedule |
| `PaymentMethodOption` | Payment logos shown in the footer/checkout |
| `SocialLink` | 8 platforms incl. WHATSAPP/OTHER |
| `Redirect` | Exact-path 301/302 |
| `StoreSetting` (singleton) | Branding, currency, timezone, contacts, legacy shipping fees, courier return fees, legacy tax, reward rate, WhatsApp/call/live-chat config, payment toggles, combined payment image, Google verification |
| `SmsNotificationSetting` (singleton, admin-only) | Admin alert phones, touchpoint toggles, templates, payment email toggle |
| `SmsTemplate` | Reusable marketing SMS (`{{var}}` syntax) |
| `Segment` / `Campaign` / `CampaignRecipient` | Campaign audiences (4 hardcoded types stored as JSON), sends, per-recipient status; also used as the log for ad-hoc/bulk SMS |
| `PushSubscription` | Web push endpoints |
| `NewsletterSubscriber` | Email list |
| `Feedback` | Contact-form messages |
| `Notification` | Admin bell alerts. **Global: no per-admin read state.** |
| `WishlistItem` | With priceAtAdd/alertedAt (price-drop emails) |
| `StockAlert` | Back-in-stock subscriptions |
| `RewardPointsEntry` | Loyalty ledger |
| `Cart` / `CartItem` | Server mirror of a logged-in cart. `reminderSentAt` is **never written** (§27). |

### 4.5 Analytics data
| Model | Purpose | Concern |
|---|---|---|
| `PageView` | One row per page landing (session, visitor, path, UTM, UA, duration/scroll/clicks, geo, language, logged-in flag) | High write volume, no retention policy, raw IP not stored (good) |
| `FunnelEvent` | VARIANT_SELECTED / ADD_TO_CART / REMOVE_FROM_CART | No retention |
| `SearchLog` | Every storefront search (query, result count, suggestion, session) | Written by a **public, un-rate-limited GET** (§29) |
| `ProductViewLog` | Anonymous product views | No retention |
| `OutboxEvent` | Transactional outbox | Retention job present |

---

## 5. Authentication & RBAC

### 5.1 Admin authentication (`API/modules/auth/*`)
- **Password login** `POST /api/auth/login` (rate-limited 10 failures per 15 min; successful logins don't count).
- **Google login** `POST /api/auth/google`. It only links to an **existing, invited, active** admin, and requires `email_verified`.
- **Invite flow**: an OWNER creates an invite (`POST /api/auth/admin-invites`) → the invitee accepts with a password (`POST /api/auth/admin-invites/accept`). There is no public admin registration.
- **Session**: 15-min access JWT (`access_token` cookie, httpOnly, SameSite=strict, `typ: admin`) + 7-day rotated refresh token stored hashed in `RefreshToken`. `csrf_token` cookie (readable) is used for double-submit.
- **Refresh** `POST /api/auth/refresh` (rotation; reuse of a revoked token is detectable). **Logout** and **logout-all** (`POST /api/auth/logout-all`). **Sessions list** `GET /api/auth/sessions` exists, but **no UI uses it** (§26).
- **Per-request identity**: `requireAdmin` verifies the JWT, then **re-reads the admin from the DB** (deactivation or demotion takes effect immediately).

### 5.2 Customer authentication (`API/modules/customers/*`)
- Email/password register + login (with "remember me" choosing a persistent vs session cookie), Google sign-in, phone OTP sign-in/up, forgot/reset password, email verification + resend, claiming a guest placeholder record by email link, unsubscribe.
- **Session**: 15-min access JWT (`customer_access_token`, `typ: customer`, separate secret) + DB-backed refresh families (`CustomerRefreshToken`) with rotation, a reuse-detection grace window, and `tokenVersion` invalidation. `logout-all` exists.
- `requireCustomer` is **token-only** (no DB read). A revoked or blocked customer keeps API access until the access token expires (≤15 min). This is acceptable, but note `isBlocked` is never checked at all.
- **Identity rules (Phase 11)**: a verified phone is unique per customer; guest orders attach only through a verified identity; claims require email proof (`API/modules/customers/customer-identity.ts`).

### 5.3 Roles & permissions (`SHARED/permissions.ts`)
Roles: **OWNER**, **STAFF** (plus the implicit **Customer** and **Guest**). There are 36 permissions. OWNER holds all of them. STAFF holds everything except the 11 owner-only ones.

| Permission | OWNER | STAFF | Guards (examples) |
|---|:-:|:-:|---|
| users.manage | ✅ | ❌ | `/api/auth/admins*`, `/api/auth/admin-invites*` |
| audit.read | ✅ | ❌ | `GET /api/audit-logs` |
| catalog.read | ✅ | ✅ | product/category/catalog reads, AI status |
| catalog.manage | ✅ | ✅ | product/category/attribute/image CRUD, SKU generate |
| catalog.configure | ✅ | ❌ | `/api/catalog/*` writes (types, templates, guides, materials, SKU pattern, global sections) |
| catalog.export | ✅ | ✅ | product CSV exports |
| catalog.purge | ✅ | ❌ | permanent delete of products/categories |
| products.import | ✅ | ❌ | CSV import validate/commit |
| ai.use | ✅ | ❌ | `/api/ai/generate`, `/image-alt-text` |
| orders.read / manage / export | ✅ | ✅ | orders list/detail/status/details/hold/manual order/CSV |
| orders.adjust_price | ✅ | ✅ | `PATCH /api/orders/:id/price` |
| orders.delete | ✅ | ❌ | trash/restore/permanent (single + bulk) |
| payments.read / payments.record | ✅ | ✅ | payments overview, manual payment |
| refunds.manage | ✅ | ✅ | record/complete refunds |
| returns.manage | ✅ | ✅ | return requests |
| courier.manage | ✅ | ✅ | Steadfast book/sync/unlink/balance |
| promotions.manage | ✅ | ✅ | coupons, bundles, flash sales |
| promotions.purge | ✅ | ❌ | permanent coupon delete |
| content.manage | ✅ | ✅ | banners, homepage, reviews, feedback, payment methods, editor uploads; **also read access to redirects/social links** |
| storefront.configure | ✅ | ❌ | redirects + social links writes |
| settings.manage | ✅ | ❌ | store settings, uploads (logo/favicon/payment image), SMS settings |
| customers.read / manage / message | ✅ | ✅ | CRM list/detail/flags/manual create; ad-hoc and bulk SMS |
| loyalty.adjust | ✅ | ✅ | points adjustment |
| campaigns.manage | ✅ | ✅ | campaigns, SMS templates |
| analytics.read / export | ✅ | ✅ | analytics, BI, metrics (incl. COGS/margin); CSV exports |
| inventory.read / adjust | ✅ | ✅ | movements, reconciliation, stock map; adjustments |
| ops.read | ✅ | ✅ | outbox status, reliability, drift reports, metrics consistency, ops attention |
| ops.repair | ✅ | ❌ | outbox retry, ledger repair, read-model rebuild |

**Self-service admin routes** (`requireSelf`): `/api/auth/me`, `/api/auth/sessions`, `/api/auth/logout-all`, `/api/notifications/*`.

### 5.4 Where access control is enforced
| Layer | Mechanism | Strength |
|---|---|---|
| API (authoritative) | `requireAdmin` + `requirePermission(...)` on every admin route; `requireCustomer`; `attachCustomerIfPresent` / `attachAdminIfPresent` on guest-allowed routes | Strong. A guard test (`authorization.guard.test.ts`) introspects every route. |
| Web edge middleware | Cookie-**presence** check for `/admin/*` and `/account/*` (redirects to login) | UX only; not security |
| Admin UI | `useCurrentAdmin` (401 → login); `adminCan()` hides sidebar items (`/admin/audit-log`, `/admin/team`) and settings sub-tabs (`SMS Notifications`, `Team`, `Audit Log`); `useCanManageCatalog` hides catalog-config controls | Partial. Many STAFF-forbidden **buttons** still render and fail with a 403 (e.g. permanent delete, import, AI buttons, redirect/social-link writes). Needs Verification per page. |
| Storefront | Admin hint enables `admin-sales-badge` (its data is fetched with the admin cookie, so it is protected server-side) | OK |
| Ownership checks | `getOrderForCustomer` (owner), `trackOrder` / `retryPayment` (orderNumber + phone) | OK |

### 5.5 Role-specific UI
- The top bar shows "Owner" or "Staff".
- The sidebar filters Team and Audit Log. The settings sub-nav filters SMS Notifications, Team and Audit Log.
- The catalog setup pages hide edit controls without `catalog.configure`.
- Everything else is shown to both roles.

---

## 6. Public Website Features

### 6.1 Homepage — `WEB/app/(storefront)/page.tsx`
| ID | Feature | Implementation |
|---|---|---|
| PUB-01 | Homepage built from the admin-ordered `HomepageSection` list (toggle, order, `startsAt`/`endsAt` schedule) | `GET /api/homepage-sections/active`; `homepage-section.service.ts` |
| PUB-02 | Hero carousel (HERO_CAROUSEL banners; desktop and mobile images, alt text, links, schedule) plus a static hero fallback | `hero-carousel.tsx`, `hero.tsx`, `GET /api/banners/active` |
| PUB-03 | Trust strip (configurable icons and text) | `trust-strip.tsx`, `WEB/lib/homepage-icons.ts` |
| PUB-04 | Personalized lead section: only for returning visitors, `{category}` filled from the last-viewed category | `personalized-lead-section.tsx`, `lib/recently-viewed.ts` |
| PUB-05 | Product carousel sections (repeatable; featured/scoped lists) | `product-carousel-section.tsx`, `product-carousel.tsx` |
| PUB-06 | Flash-sale section with a live countdown | `flash-sale-section.tsx`, `countdown-timer.tsx`, `GET /api/flash-sales/active` |
| PUB-07 | Category grid (featured categories, heading override) | `category-grid.tsx` |
| PUB-08 | Brand story block | `brand-story.tsx` |
| PUB-09 | Values grid | `values-grid.tsx` |
| PUB-10 | Smart recommendations (behavioral) | `smart-recommendations.tsx`, `GET /api/products/storefront/recommended` |
| PUB-11 | Promo banner section (repeatable custom block) | `promo-banner-section.tsx` |

### 6.2 Navigation & shell
| ID | Feature | Implementation |
|---|---|---|
| PUB-12 | Sticky header: logo, or a monogram fallback built from the store name; cart, wishlist and account entry points | `header.tsx`, `store-logo-image.tsx` |
| PUB-13 | Desktop mega menu built from the category tree | `mega-menu.tsx`, `GET /api/categories/tree` |
| PUB-14 | Mobile navigation drawer | `mobile-nav.tsx` |
| PUB-15 | Mobile bottom navigation (4 key destinations) | `mobile-bottom-nav.tsx`, `use-bottom-dock.ts`, `sticky-bottom-bar-spacer.tsx` |
| PUB-16 | Footer: links, social icons, payment logos or a combined image, newsletter, contact details, Track Order link | `footer.tsx`, `social-icon.tsx` |
| PUB-17 | Breadcrumbs with BreadcrumbList JSON-LD | `storefront/breadcrumb.tsx` |
| PUB-18 | Animated page transitions (fire on path change only) | `page-transition.tsx` |
| PUB-19 | Skip-to-content link | `skip-to-content-link.tsx` |
| PUB-20 | Branded route loading states and skeletons | `brand-loader.tsx`, `skeletons/*`, `loading.tsx` files |
| PUB-21 | Storefront shell shared by both route groups (header, footer, widgets, trackers, compare bar, cart drawer, quick view) | `storefront-shell.tsx` |

### 6.3 Search
| ID | Feature | Implementation |
|---|---|---|
| PUB-22 | Instant-search overlay with suggestions (trigram search) | `search-overlay.tsx`, `GET /api/products/storefront/suggest` |
| PUB-23 | Popular searches (from SearchLog) | `GET /api/products/storefront/popular-searches` |
| PUB-24 | Recent searches (localStorage) | `lib/recent-searches.ts` |
| PUB-25 | Client-side fuzzy matching and synonyms (incl. BD terms) | `lib/fuzzy-search.ts`, `SHARED/search-synonyms.ts` |
| PUB-26 | Search results page: facets, sort, pagination, ItemList JSON-LD | `app/(storefront)/search/page.tsx` |
| PUB-27 | "Did you mean" suggestion on zero results | `no-search-results.tsx`, `findDidYouMean` in `product.service.ts` |
| PUB-28 | Sticky desktop search bar | `sticky-search-bar.tsx`, `search-trigger-button.tsx` |
| PUB-29 | Search-session correlation beacon + pixel Search event | `search-session-tracker.tsx`, `POST /api/analytics/search-session` |

### 6.4 Categories & listing
| ID | Feature | Implementation |
|---|---|---|
| PUB-30 | Category page (includes descendant categories, banner, SEO, ItemList JSON-LD) | `app/(storefront-detail)/category/[slug]/page.tsx`, `GET /api/categories/slug/:slug` |
| PUB-31 | Facet filters: sizes, colors, price range | `facet-filters.tsx`, `GET /api/products/storefront/facets` |
| PUB-32 | Sorting: newest, price ↑, price ↓, relevance (search only); price sorts use `ProductReadModel` | `sort-select.tsx`, `read-model.service.ts` |
| PUB-33 | Crawlable link-based pagination | `storefront/pagination.tsx` |
| PUB-34 | "Coming Soon" panel for live categories with no products | `coming-soon.tsx` |
| PUB-35 | Category stock panel (admin-hint only; per-category stock overview) | `category-stock-panel.tsx`, `GET /api/categories/slug/:slug/stock` (**public endpoint**, see §29) |
| PUB-36 | Product card: image, price/compare-at, promo badge (discount > new > low stock), rating, wishlist, quick view, compare, add to cart | `product-card.tsx`, `promo-badge.tsx`, `star-rating.tsx` |
| PUB-37 | Quick-view modal | `quick-view-modal.tsx`, `store/quick-view.ts` |
| PUB-38 | Product compare: floating bar + comparison modal (no dedicated page) | `compare-bar.tsx`, `store/compare.ts` |

### 6.5 Product detail — `WEB/app/(storefront-detail)/product/[slug]/page.tsx` → `product-page-view.tsx`
| ID | Feature | Implementation |
|---|---|---|
| PUB-39 | SSR/ISR product page; old slugs redirect via `findProductRedirect` | `GET /api/products/slug/:slug`, `redirects/active` |
| PUB-40 | Image gallery with per-variant galleries | `product-gallery.tsx`, `SHARED/gallery.ts` |
| PUB-41 | Variant selection (size/color pickers driven by template dimensions, stock states, "Only a few left") | `variant-selector.tsx`, `variant-option-pickers.tsx`, `lib/availability-display.ts` |
| PUB-42 | Picker dialog when Add/Buy is pressed before choosing a variant | `variant-picker-dialog.tsx` |
| PUB-43 | Add to cart, and Buy Now (express single-item checkout) | `hooks/use-add-to-cart.ts`, `store/express-checkout.ts` |
| PUB-44 | Sticky add-to-cart bar (mobile) | `sticky-add-to-cart.tsx` |
| PUB-45 | Size-guide modal (preset or product override) | `size-guide-modal.tsx` |
| PUB-46 | Configurable accordion sections: description, highlights, specifications (spec groups), material, care, shipping, returns, warranty, what's included, FAQ, video | `SHARED/sections.ts`, `lib/product-specs.ts`, `product-accordion.tsx` |
| PUB-47 | Reviews: list with average, submission (signed-in, one per product, moderated), verified-purchase badge | `product-reviews.tsx`, `GET/POST /api/reviews` |
| PUB-48 | Bundle offer ("Complete the Bundle") | `GET /api/bundles/for-product/:productId` |
| PUB-49 | Recommendation rails: related, frequently bought, cross-sell, upsell, recommended (curated, or algorithmic fallback) | `GET /api/products/:id/rail/:key`, `getRail()` |
| PUB-50 | Budget and premium alternatives rails | `GET /api/products/:id/budget-alternatives`, `/premium-alternatives` |
| PUB-51 | Recently-viewed carousel (localStorage) | `recently-viewed-carousel.tsx`, `lib/recently-viewed.ts` |
| PUB-52 | Urgency signals (real data only: views today, recent sales, low stock) | `urgency-signals.tsx`, `GET /api/products/:id/urgency-signals` |
| PUB-53 | Back-in-stock alert button (requires login) | `stock-alert-button.tsx`, `POST /api/stock-alerts` |
| PUB-54 | Wishlist button (guest local, account server-side) | `wishlist-button.tsx` |
| PUB-55 | View tracking (view log, recently viewed, pixel ViewContent, funnel VARIANT_SELECTED) | `track-product-view.tsx`, `POST /api/products/:id/view` |
| PUB-56 | Admin sales badge overlay on the PDP (admin only) | `admin-sales-badge.tsx`, `GET /api/products/:id/sales-summary` |
| PUB-57 | Admin product preview at `/preview/[id]` (any status) | `app/(storefront-detail)/preview/[id]`, `GET /api/products/:id/preview` |
| PUB-58 | Product JSON-LD (Product/Offer/AggregateRating) | `buildProductJsonLd` |

### 6.6 Cart
| ID | Feature | Implementation |
|---|---|---|
| PUB-59 | Cart page: server-quoted totals, quantity edits, remove, move to wishlist, bundle preview, recommendations (similar/trending/recently viewed) | `app/(storefront)/cart/page.tsx`, `hooks/use-quote.ts`, `POST /api/bundles/preview` |
| PUB-60 | Slide-out cart drawer | `cart-drawer.tsx`, `store/cart-drawer.ts` |
| PUB-61 | Cart icon with count | `cart-icon.tsx` |
| PUB-62 | Sticky "go to checkout" bar | `sticky-cart-bar.tsx` |
| PUB-63 | Cart reminder banner after inactivity (client-only, once per session) | `cart-reminder-banner.tsx` |
| PUB-64 | Server mirror of a signed-in customer's cart (for abandonment analytics) | `PUT /api/cart`, `cart.service.ts` |
| PUB-65 | Funnel events ADD_TO_CART / REMOVE_FROM_CART | `POST /api/analytics/funnel-event` |

### 6.7 Checkout — `WEB/app/(storefront)/checkout/page.tsx` (748 lines, client)
| ID | Feature | Implementation |
|---|---|---|
| PUB-66 | Guest or signed-in checkout form (name, phone, email, notes) | `checkoutSchema` (`SHARED/schemas/order.ts`) |
| PUB-67 | Saved-address picker with the default auto-selected | `GET /api/customers/me/addresses` |
| PUB-68 | Bangladesh address cascade: district search → area/thana (country-wide search when no district is set) → division derived | `SHARED/schemas/order.ts` (hardcoded BD geography), `SearchableSelect` |
| PUB-69 | Live canonical server quote (subtotal, flash, bundle, coupon, shipping zone, tax, total, warnings) | `POST /api/v1/checkout/quote` |
| PUB-70 | Coupon apply/remove with server rejection reasons and per-item eligibility | quote `rejectedPromotions` |
| PUB-71 | Best-coupon suggestion ("Use CODE — save X") | `POST /api/v1/checkout/quote/best-coupon` |
| PUB-72 | Payment method selection obeying store toggles (COD, SSLCommerz, EPS-PG), payment logos | `GET /api/settings`, `GET /api/payment-methods/active` |
| PUB-73 | Idempotent submission (`Idempotency-Key` derived from the payload) | `lib/idempotency.ts` |
| PUB-74 | Quote-changed protection (`QUOTE_CHANGED` 409 → re-review) | `order.controller.ts` / quote token |
| PUB-75 | Online payment: redirect to the gateway; the order is only materialised on a verified success | `initiatePendingPayment`, `settlePaymentSession` |
| PUB-76 | Payment failure/cancel return with toast messages | `?paymentError` / `?paymentCancelled` |
| PUB-77 | Express (Buy Now) checkout of a single item without touching the cart | `store/express-checkout.ts` |
| PUB-78 | Pixel InitiateCheckout / AddPaymentInfo | `lib/pixels/index.ts` |
| PUB-79 | Mobile collapsible order summary | `summaryOpen` state |

### 6.8 Post-purchase
| ID | Feature | Implementation |
|---|---|---|
| PUB-80 | Order confirmation page (unlocked with phone confirmation; remembered for the session) with Retry payment for failed online orders | `order-confirmation/[orderNumber]/page.tsx`, `POST /api/orders/track`, `POST /api/orders/:orderNumber/retry-payment` |
| PUB-81 | Pixel Purchase (deterministic event id, deduplicated with server CAPI) | `pixelPurchase`, `purchaseEventId` |
| PUB-82 | Guest order tracking (order number + phone) | `track-order/page.tsx`, `POST /api/orders/track` |

### 6.9 Content, support & engagement
| ID | Feature | Implementation |
|---|---|---|
| PUB-83 | Contact page (contact details, social links, inline form) | `contact/page.tsx`, `contact-form.tsx`, `POST /api/feedback` |
| PUB-84 | Floating contact widget: WhatsApp (prefill message), call, live chat, message form | `contact-widget.tsx`, `use-feedback-form.ts` |
| PUB-85 | Tawk.to live chat (toggled from the DB) | `live-chat-widget.tsx` |
| PUB-86 | FAQ page (grouped accordion + FAQ JSON-LD). **Content is hardcoded.** | `faq/page.tsx`, `faq-accordion.tsx` |
| PUB-87 | Shipping & Returns page. **Hardcoded** (e.g. "Inside Dhaka 1–2 days"). | `shipping-returns/page.tsx` |
| PUB-88 | Privacy Policy with a sticky table of contents and a mobile TOC select. **Hardcoded.** | `privacy-policy/page.tsx`, `mobile-toc-select.tsx` |
| PUB-89 | Terms & Conditions. **Hardcoded.** | `terms/page.tsx` |
| PUB-90 | Newsletter signup | `newsletter-form.tsx`, `POST /api/newsletter/subscribe` |
| PUB-91 | Feedback modal | `feedback-modal.tsx` |
| PUB-92 | 404 pages (root and per group) and a global error boundary | `not-found.tsx` ×3, `global-error.tsx` |

### 6.10 SEO & platform
| ID | Feature | Implementation |
|---|---|---|
| PUB-93 | Per-page metadata: title, description, canonical, OpenGraph/Twitter (logo fallback) | `lib/seo.ts`, `generateMetadata` |
| PUB-94 | Organization + WebSite JSON-LD site-wide | `app/layout.tsx`, `lib/structured-data.ts` |
| PUB-95 | Dynamic `sitemap.xml` (home, search, static pages, categories, products; **capped at 2,000 products**) | `app/sitemap.ts` |
| PUB-96 | `robots.txt` (disallows admin/account/cart/checkout/…) | `app/robots.ts` |
| PUB-97 | Admin-managed redirects applied at the edge | `middleware.ts`, `GET /api/redirects/active` |
| PUB-98 | Dynamic favicon (redirects `/favicon.ico` to the uploaded favicon) | `middleware.ts` |
| PUB-99 | Google Search Console verification meta | `StoreSetting.googleSiteVerification`, `layout.tsx` |
| PUB-100 | On-demand ISR revalidation, triggered by the API after catalog/settings changes | `app/api/revalidate/route.ts`, `API/lib/storefront-revalidate.ts`, `product.cache.ts` |
| PUB-101 | Bengali-glyph font fallback (৳ and Bengali text) | `app/layout.tsx` |

### 6.11 Tracking & integrations on the storefront
| ID | Feature | Implementation |
|---|---|---|
| PUB-102 | First-party pageview + exit beacon (duration, scroll depth, clicks), session and visitor ids, first-touch UTM/referrer | `page-view-tracker.tsx`, `lib/analytics.ts`, `POST /api/analytics/pageview`, `/pageview/:id/exit` |
| PUB-103 | Meta Pixel (browser) | `lib/pixels/meta.ts`, `components/analytics/ad-pixels.tsx` |
| PUB-104 | TikTok Pixel (browser) | `lib/pixels/tiktok.ts` |
| PUB-105 | Microsoft Clarity heatmaps (`NEXT_PUBLIC_CLARITY_ID` at build time; **not in `.env.example`**) | `heatmap-script.tsx` |
| PUB-106 | Web-push service worker (shows notifications, opens the URL on click) | `public/sw.js`, `lib/push-notifications.ts` |

**Responsive/mobile:** dedicated mobile bottom nav, mobile nav drawer, sticky add-to-cart, sticky cart bar, mobile TOC select, mobile order summary, and Playwright runs on a mobile project. There is **no PWA manifest** (push only).

---

## 7. Customer Features (accounts)

| ID | Feature | Implementation |
|---|---|---|
| CUS-01 | Register (email + password, strength meter); never takes over existing records | `account/(auth)/register`, `POST /api/customers/register`, `registerCustomer` |
| CUS-02 | Claim an existing guest record via an emailed link | `account/(auth)/claim`, `POST /api/customers/claim/confirm`, `confirmEmailClaim` |
| CUS-03 | Login with email/password + "remember me" | `POST /api/customers/login` |
| CUS-04 | Google sign-in (create, claim, or link only for verified emails) | `google-button.tsx`, `POST /api/customers/google` |
| CUS-05 | Phone OTP sign-in/sign-up (verified phone; name+email to claim/create) | `phone-otp-form.tsx`, `POST /api/customers/otp/request`, `/otp/verify` |
| CUS-06 | Forgot / reset password (revokes all sessions) | `forgot-password`, `reset-password`, `POST /api/customers/forgot-password`, `/reset-password` |
| CUS-07 | Email verification, resend, and a reminder banner | `verify-email`, `verify-email-banner.tsx`, `POST /api/customers/verify-email`, `/resend-verification` |
| CUS-08 | Logout, and logout everywhere | `account-security.tsx`, `POST /api/customers/logout`, `/logout-all` |
| CUS-09 | Silent session refresh (rotation + reuse detection) | `api-client.ts` → `POST /api/customers/refresh` |
| CUS-10 | Profile edit (name, contact) + SMS/email marketing opt-ins | `account/(shell)/page.tsx`, `PATCH /api/customers/me` |
| CUS-11 | Phone verification / change of the sign-in phone via OTP | `phone-verification-panel.tsx`, `POST /api/customers/me/phone/otp`, `/verify` |
| CUS-12 | Set / change password (other sessions signed out) | `account-security.tsx`, `POST /api/customers/me/password` |
| CUS-13 | Account overview strip (latest order, points, pending returns) | `account-overview.tsx` |
| CUS-14 | Smart order tracker (latest order progress) | `smart-order-tracker.tsx` |
| CUS-15 | Address book: create, edit, delete, set default (one default enforced in the DB) | `account/(shell)/addresses`, `/api/customers/me/addresses*` |
| CUS-16 | Order history (paginated) | `account/(shell)/orders`, `GET /api/customers/me/orders` |
| CUS-17 | Order detail: customer timeline, items with live availability, payment info | `orders/[id]/page.tsx`, `customer-order-view.ts` |
| CUS-18 | Reorder (re-adds available items to the cart) | `handleReorder` |
| CUS-19 | Printable invoice | `account/(invoice)/orders/[id]/invoice`, `invoice-document.tsx` |
| CUS-20 | Return request (reason + note) on delivered orders | `POST /api/return-requests` |
| CUS-21 | Exchange request (pick a different size/color variant) | same endpoint, `type: EXCHANGE` |
| CUS-22 | Returns list with status | `account/(shell)/returns`, `GET /api/return-requests/mine` |
| CUS-23 | Reward points balance + ledger | `account/(shell)/reward-points`, `GET /api/customers/me/points` |
| CUS-24 | Available coupons list | `account/(shell)/coupons`, `GET /api/coupons/active` |
| CUS-25 | Browsing history (local recently-viewed) | `account/(shell)/browsing-history` |
| CUS-26 | Wishlist: works signed out (local) and merges into the account on login/register | `(storefront)/wishlist`, `store/wishlist.ts`, `lib/wishlist-merge.ts`, `/api/wishlist` |
| CUS-27 | Wishlist price-drop email (on product price decrease) | `notifyPriceDrop` (`wishlist.service.ts`) |
| CUS-28 | Back-in-stock email alerts (subscribe/unsubscribe) | `stock-alert.service.ts` |
| CUS-29 | Browser push opt-in toggle (hidden without a VAPID key) | `push-notification-toggle.tsx`, `/api/customers/me/push-subscriptions` |
| CUS-30 | One-click email-marketing unsubscribe (stateless signed token) | `account/(auth)/unsubscribe`, `POST /api/customers/unsubscribe` |
| CUS-31 | Product review submit/edit (one per product; verified-purchase flag) | `POST /api/reviews`, `GET /api/reviews/mine` |
| CUS-32 | Retry payment on an own failed online order | `POST /api/orders/:orderNumber/retry-payment` |
| CUS-33 | Loyalty points earned on delivery, reversed proportionally on return/refund | `awardDeliveryPoints`, `reverseDeliveryPoints` |

**Not present:** self-service order cancellation; account deletion / data export; saved payment methods; an order-tracking map; a notification inbox for customers.

---

## 8. Admin Dashboard Features (shell, team, content, support)

| ID | Feature | Implementation |
|---|---|---|
| ADM-01 | Admin login (password) with a `next` redirect | `admin/(auth)/login`, `POST /api/auth/login` |
| ADM-02 | Admin Google login (invite-linked accounts only) | same page, `POST /api/auth/google` |
| ADM-03 | Accept invite (set password) | `admin/(auth)/accept-invite`, `POST /api/auth/admin-invites/accept` |
| ADM-04 | Silent session refresh; logout; logout from all devices | `sidebar.tsx`, `/api/auth/refresh`, `/logout`, `/logout-all` |
| ADM-05 | Sidebar: 7 groups, permission filtering, collapse (persisted), mobile drawer with focus trap | `components/admin/sidebar.tsx` |
| ADM-06 | Sub-navigation tabs grouping pages (Products, Orders, Promotions, Content, Support, Settings, Catalog, BI) | `*-subnav.tsx`, `sub-nav.tsx` |
| ADM-07 | Top bar: "View store", notification bell, admin avatar/role | `admin/(shell)/layout.tsx` |
| ADM-08 | Notification bell: 30s polling, unread count, mark one or all read, deep links | `notification-bell.tsx`, `/api/notifications` |
| ADM-09 | **Dashboard** (`/admin/dashboard`, 29 parallel queries, 30s refresh on some): KPI tiles, hero revenue card, revenue chart with range switch, visitor chart, traffic heatmap, top products, order-status breakdown, low stock, slow movers, demand forecast, cohort retention, ranked lists, attention signals, Clarity setup hint | `dashboard/page.tsx` (787 lines) |
| ADM-10 | Team: list admins, invite (role, email), revoke a pending invite, activate/deactivate, edit name/email/role, set password | `team/page.tsx`, `/api/auth/admins*`, `/api/auth/admin-invites*` |
| ADM-11 | Audit log viewer (paginated) | `audit-log/page.tsx`, `GET /api/audit-logs` |
| ADM-12 | **Homepage builder**: add section (10 types), drag reorder, toggle, schedule, configure per-type forms, image upload, delete, live preview of real storefront components | `homepage/page.tsx`, `components/admin/homepage/*`, `/api/homepage-sections*` |
| ADM-13 | **Banners**: CRUD, placement (hero/promo strip), desktop + mobile image upload, alt text, link, title/subtitle, active, schedule, reorder | `banners/page.tsx`, `banner-form.tsx`, `/api/banners*` |
| ADM-14 | **Feedback inbox**: list, search, paginate, mark read, delete | `feedback/page.tsx`, `/api/feedback*` |
| ADM-15 | **Review moderation**: list/filter, approve, reject, delete (recomputes product rating) | `reviews/page.tsx`, `/api/reviews/admin*` |
| ADM-16 | Rich-text editor (TipTap: headings, lists, links, images uploaded to the server, tables, YouTube) | `rich-text-editor.tsx`, `POST /api/uploads/editor-image` |
| ADM-17 | Shared admin UI kit: page header, empty states, table skeletons, pagination + page size, confirm dialog (typed confirmation for irreversible actions), drawer with prev/next, date-range picker | `components/admin/*`, `components/ui/*` |
| ADM-18 | Payments overview page (KPIs, attempt search, 60s refresh) | `payments/overview/page.tsx`, `/api/payment-admin/overview`, `/search` |
| ADM-19 | AI Assistant page (generate copy/SEO/marketing/email; usage display) | `ai-assistant/page.tsx` |

(Module-specific admin features are listed in §9–§19.)

---

## 9. Product Management

### 9.1 Products
| ID | Feature | Implementation |
|---|---|---|
| PRD-01 | Product list: search, category, status, product type, trash view, pagination, page size, status badges | `products/page.tsx`, `GET /api/products` |
| PRD-02 | Bulk move to Trash | `POST /api/products/bulk/delete` |
| PRD-03 | Bulk status change (DRAFT/READY/PUBLISHED/UNPUBLISHED, completeness-gated) | `POST /api/products/bulk/status` |
| PRD-04 | Bulk category change | `POST /api/products/bulk/category` |
| PRD-05 | Restore from Trash | `POST /api/products/:id/restore` |
| PRD-06 | Permanent delete (OWNER; zeroes stock when order history exists) | `DELETE /api/products/:id/permanent` |
| PRD-07 | Duplicate product as a draft, choosing what to copy (images copied on disk), with a summary | `duplicate-product-dialog.tsx`, `product-duplicate.ts`, `POST /api/products/:id/duplicate` |
| PRD-08 | **Product Builder wizard, create**: dynamic steps (Basics, Media, Pricing & Inventory, [Options & Variants], [Care & Material], [Size Guide], Page Content, SEO, Live Preview, Final Review, Publish); images staged before the product exists | `products/wizard/new`, `product-wizard/*`, `SHARED/wizard-steps.ts`, `lib/wizard/*` |
| PRD-09 | Product Builder wizard, edit (the default edit route everywhere) | `products/wizard/[id]/edit`, `lib/admin-routes.ts` |
| PRD-10 | **Classic tabbed editor** create/edit (still reachable) | `products/new`, `products/[id]/edit`, `product-form.tsx`, `product-form-state.ts` |
| PRD-11 | Live preview: the real storefront rendered in an iframe at device widths, updating as you type | `preview-pane.tsx`, `live-preview-frame.tsx`, `admin/(preview-frame)` |
| PRD-12 | Status lifecycle with a completeness gate (5 always-required checks + template-required checks) | `SHARED/completeness*.ts`, `product-status-panel.tsx` |
| PRD-13 | Completeness score + "where to fix" checklist | `product-status-panel.tsx` |
| PRD-14 | Images: multi-upload (≤10 per request, 8 MB each, magic-byte validated), progress bar, reorder, delete, alt text, caption, AI alt text, WebP renditions | `image-uploader.tsx`, `/api/products/:id/images*`, `upload.service.ts` |
| PRD-15 | Variant editor: matrix from template dimensions, SKU, barcode, size label, color hex, price/compare-at/cost override, stock, weight, active, sort order | `variant-editor.tsx` |
| PRD-16 | Per-variant image galleries (ordered; the first is primary) | `variant-gallery-picker.tsx` |
| PRD-17 | SKU auto-generation from the pattern | `POST /api/catalog/sku/generate`, `sku.service.ts`, `SHARED/sku.ts` |
| PRD-18 | Pricing: base, compare-at, cost, per-product tax rate | product schema |
| PRD-19 | Inventory settings: track inventory, low-stock threshold, restock date | product schema |
| PRD-20 | Template-driven typed attributes (10 data types, required flags, spec groups) | `attribute-fields.tsx`, `ProductAttributeValue` |
| PRD-21 | Care instructions: preset or per-product override | `care-material-section.tsx` |
| PRD-22 | Material composition (catalog material or custom name, with %) | `care-material-section.tsx` |
| PRD-23 | Size guide: inherit from the type or a product-level override | `size-guide-editor.tsx` |
| PRD-24 | Per-product page-section overrides (on/off, order, title, own content) | `section-settings-editor.tsx`, `saveProductSections` |
| PRD-25 | Product FAQ editor (add/edit/reorder/delete) | `product-content-editors.tsx` |
| PRD-26 | Curated recommendation lists (related, cross-sell, upsell, frequently bought, recommended) | `ProductRelation`, `product-picker.tsx` |
| PRD-27 | SEO: title, meta description, focus keyword, OG title/description/image, canonical override; search-result preview | wizard SEO step, `lib/seo.ts` |
| PRD-28 | Slug auto-generation, uniqueness, and an automatic redirect when the slug changes | `unique-slug.ts`, `upsertSlugRedirect` |
| PRD-29 | Brand (free text), brand tier (PREMIUM/PLATINUM/LUXURY), featured flag, sort order | product schema |
| PRD-30 | Product change history (audited field diffs, readable descriptions) | `product-history.tsx`, `product-audit.ts`, `GET /api/products/:id/history` |
| PRD-31 | Product sales summary | `GET /api/products/:id/sales-summary` |
| PRD-32 | CSV export: simple and full (products + variants) | `GET /api/products/export/csv`, `/export/full` |
| PRD-33 | CSV import: template download, validate (dry-run plan), commit | `products/import/page.tsx`, `product-csv.ts`, `/api/products/import/*` |
| PRD-34 | AI generation inside the editors (description, SEO title/meta/keywords) | `product-form.tsx`, `steps.tsx` → `/api/ai/generate` |
| PRD-35 | Cache invalidation (Redis) + storefront revalidation after every mutation | `product.cache.ts` |
| PRD-36 | Side effects of updates: price-drop emails, back-in-stock emails, read-model refresh | `product.service.ts` `updateProduct` |

### 9.2 Categories — `categories/page.tsx`, `category-tree.tsx`, `category-form.tsx`
| ID | Feature | Implementation |
|---|---|---|
| PRD-37 | Category tree with self+descendant stock badges | `GET /api/categories`, `/stock-map` |
| PRD-38 | Create/edit: name, slug, parent, active, featured, SEO, image alt text | `POST/PATCH /api/categories` |
| PRD-39 | Category image + banner upload | `/api/categories/upload-image`, `/upload-banner` |
| PRD-40 | Reorder and move (re-parent) | `/api/categories/reorder`, `/:id/move` |
| PRD-41 | Trash, restore, permanent delete (OWNER) | `DELETE /api/categories/:id`, `/restore`, `/permanent` |

### 9.3 Variant options — `/admin/attributes` ("Variant options" tab)
| ID | Feature | Implementation |
|---|---|---|
| PRD-42 | Attribute (Color, Fabric…) CRUD with values and color hex | `attributes/page.tsx`, `attribute-form.tsx`, `/api/attributes*` |

### 9.4 Catalog setup — `/admin/catalog/*` (writes need `catalog.configure`)
| ID | Feature | Implementation |
|---|---|---|
| PRD-43 | Product types: CRUD, family/parent, template link, SKU code, active/archive, system types protected | `catalog/types`, `/api/catalog/types*` |
| PRD-44 | Templates: CRUD, ≤2 variant dimensions, size-guide mode + preset, care preset, required completeness checks, attributes (required/spec group/placeholder/visibility), section overrides | `catalog/templates` (487 lines) |
| PRD-45 | Attribute definitions: CRUD (10 data types, options, unit, placeholder, help, archive) | `catalog/attributes` |
| PRD-46 | Spec groups CRUD | `catalog/spec-groups` |
| PRD-47 | Size-guide presets: CRUD, duplicate, archive (table editor) | `catalog/size-guides` |
| PRD-48 | Care-guide presets: CRUD, duplicate, archive | `catalog/care-guides` |
| PRD-49 | Materials: CRUD, archive | `catalog/materials` |
| PRD-50 | SKU settings (prefix, pattern tokens `{PREFIX} {TYPE} {COLOR} {SIZE} {SEQ:n}`) | `catalog/sku`, `/api/catalog/sku-settings` |
| PRD-51 | Global product-page sections (store-wide defaults/content) | `catalog/sections`, `/api/catalog/sections` |
| PRD-52 | Template manager modal (manage templates from inside the product editor) | `template-manager-modal.tsx` |
| PRD-53 | Catalog preset seeding script | `prisma/seed-presets.ts` (`db:seed:presets`) |

---

## 10. Order Management

| ID | Feature | Implementation |
|---|---|---|
| ORD-01 | Orders list (1,880-line page): quick tabs (Unpaid, COD, Cancelled/Returned, Follow-up due, Cancelled but paid), status / multi-status, payment status/method, search, date range, courier booked + courier status, district, trash view, sortable columns, page size, 30s auto-refresh | `orders/page.tsx`, `GET /api/orders` |
| ORD-02 | KPI strip (order stats) | `GET /api/orders/stats` |
| ORD-03 | Order drawer with previous/next navigation through the list | `ui/drawer.tsx`, `order-detail-panel.tsx` |
| ORD-04 | Full order detail page (1,572-line panel) with courier auto-sync on open when stale | `orders/[id]`, `getOrderByIdWithAutoSync` |
| ORD-05 | Status change offering only legal next states (state machine T0–T8) | `PATCH /api/orders/:id/status`, `SHARED/order-state.ts`, `applyOrderTransition` |
| ORD-06 | Edit order details (customer name/phone/email, address, notes, admin notes) | `PATCH /api/orders/:id/details` |
| ORD-07 | Confirmation-call workflow: "Hold, call back later" (follow-up time, call-attempt counter), clear hold | `POST /api/orders/:id/hold`, `/hold/clear` |
| ORD-08 | Price adjustment (signed; blocked after courier booking) | `PATCH /api/orders/:id/price` |
| ORD-09 | Partial-delivery reconciliation (declare returned units → restock + courier-loss entry) | `PATCH /api/orders/:id/reconcile-partial-delivery` |
| ORD-10 | Refunds: record (REQUESTED or COMPLETED), complete, list | `/api/orders/:id/refunds*` |
| ORD-11 | Record a manual payment (bKash/bank/cash) | `POST /api/orders/:id/payments` |
| ORD-12 | Payment ledger summary (paid, refunded, COD to collect, attempts) | `GET /api/orders/:id/payment` |
| ORD-13 | Courier per order: book with Steadfast, refresh status, unlink a stuck booking | `/api/orders/:id/courier/*` |
| ORD-14 | Bulk actions: status, trash, permanent delete, courier book, courier sync, delivery-score check, print labels | `/api/orders/bulk/*` |
| ORD-15 | Trash / restore (re-reserves stock or 409) / permanent delete (typed confirmation) | `DELETE /api/orders/:id`, `/restore`, `/permanent` |
| ORD-16 | Filtered CSV export | `GET /api/orders/export/csv` |
| ORD-17 | Manual order creation for phone/Facebook orders (customer lookup, item search, server quote, payment method) | `orders/new/page.tsx`, `POST /api/orders/admin`, `createManualOrder` |
| ORD-18 | Printable admin invoice | `admin/(invoice)/orders/[id]/invoice`, `invoice-document.tsx` |
| ORD-19 | Shipping-label printing: 3 templates (standard/compact/square), barcode + QR, options, pixel-faithful preview, PDF export, remembered preferences, bulk | `orders/print-labels/page.tsx`, `components/orders/*`, `lib/label-*.ts`, `POST /api/orders/bulk/get` |
| ORD-20 | Status timeline (who/when/note) | `OrderStatusHistory` |
| ORD-21 | Courier loss ledger (post-booking cancellations, partial returns) | `CourierLossEvent` |
| ORD-22 | Return/exchange request review (approve/reject + admin note) | `return-requests/page.tsx`, `PATCH /api/return-requests/:id` |
| ORD-23 | Approved exchange auto-creates a free replacement order | `createExchangeOrder` in `return-request.service.ts` |
| ORD-24 | Order notifications: admin bell, admin SMS alert, customer SMS per touchpoint, payment receipt email | outbox consumers, `lib/notify.ts` |
| ORD-25 | Steadfast delivery-score check right after checkout (cached on the customer) | `checkAndUpdateDeliveryScore` |
| ORD-26 | Idempotent order creation | `Order.idempotencyKey` |
| ORD-27 | Order-number generation | `lib/order-number.ts` |
| ORD-28 | Stock reserved at placement; released on cancellation/trash; coupon usage released on a pre-shipment cancel | `inventory.service.ts`, transition rules |
| ORD-29 | Admin alerts: "cancelled but paid" and "returned, refund due" | `runTransitionSideEffects` |

**Order state machine** (`SHARED/order-state.ts`): PENDING → CONFIRMED → PROCESSING → PACKED (freely among these) → SHIPPED (SHIPPED → PACKED allowed) → DELIVERED / PARTIALLY_DELIVERED → RETURNED → REFUNDED. CANCELLED is reachable from any pre-shipment state or SHIPPED. REFUNDED requires a recorded refund.

---

## 11. Customer / CRM

| ID | Feature | Implementation |
|---|---|---|
| CRM-01 | Customer list: search (also matches order numbers), tag filter (NEW, REPEAT, VIP, HIGH_SPENDER, INACTIVE, SUSPICIOUS, COD_RISK, BLOCKED), district, no-orders, last-order-within-N-days, min spend, min orders, sort by computed columns, pagination | `customers/page.tsx` (859 lines), `GET /api/customers/admin` |
| CRM-02 | Customer stats tiles | `GET /api/customers/admin/stats` |
| CRM-03 | Customer detail (drawer and `/admin/customers/[id]`): profile, addresses, orders, wishlist, SMS history, points, delivery score | `customer-detail-panel.tsx`, `GET /api/customers/admin/:id` |
| CRM-04 | Admin notes, **Blocked** flag, **COD risk** flag | `PATCH /api/customers/admin/:id` |
| CRM-05 | Manual customer creation (deduplicated by phone/email) | `POST /api/customers/admin` |
| CRM-06 | Loyalty points adjustment (with reason) | `POST /api/customers/admin/:id/points` |
| CRM-07 | Ad-hoc SMS to one customer with templates + live variable preview | `sms-composer.tsx`, `POST /api/customers/admin/:id/sms` |
| CRM-08 | Bulk SMS to selected customers | `POST /api/customers/admin/bulk/sms` |
| CRM-09 | SMS template library CRUD (`{{variable}}` syntax) | `/api/sms-templates*` |
| CRM-10 | Computed tags and risk signals (cancellations, courier holds) | `computeCustomerTags`, `computeRiskSignals`, `WEB/lib/customer-tags.ts` |
| CRM-11 | Steadfast delivery success score (bulk check from the orders list) | `checkDeliveryScoresBulk` |
| CRM-12 | Campaigns: CRUD, channel EMAIL/SMS/PUSH, audience (All, Newsletter subscribers, Customers with orders, No order in 30 days), schedule / cancel schedule, send now, per-recipient status, rich email body with images | `campaigns/page.tsx`, `/api/campaigns*`, `campaign.service.ts` |
| CRM-13 | Guest-customer resolution at checkout (verified identity only) | `findOrCreateGuestCustomer` |
| CRM-14 | Identity integrity (verified-phone uniqueness, claim flow, audit) | `customer-identity.ts` |
| CRM-15 | Loyalty drift detection (balance ≠ ledger) | `loyaltyDrift` → ops reliability report |

---

## 12. Inventory

| ID | Feature | Implementation |
|---|---|---|
| INV-01 | Stock-movement ledger: filter by reason, variant, or product (deep links); pagination | `inventory/page.tsx`, `GET /api/inventory/movements` |
| INV-02 | Adjust stock modal (RESTOCK +, ADJUSTMENT ±, DAMAGED −, LOST −, with notes) | `adjust-stock-modal.tsx`, `POST /api/inventory/variants/:variantId/adjust` |
| INV-03 | Stock reconciliation / discrepancy report (stock vs ledger) | `GET /api/inventory/reconciliation` |
| INV-04 | Low-stock alerts (dashboard table + admin notifications) | `GET /api/analytics/low-stock`, `low-stock-table.tsx` |
| INV-05 | Category stock rollup map | `GET /api/categories/stock-map` |
| INV-06 | Single stock writer (every change goes through `inventory.service.ts`; guard test enforces it) | `inventory-writer.guard.test.ts` |
| INV-07 | Idempotent restocks per order line (`restockedQuantity`) | `releaseOrderLines`, `reReserveOrderLines` |
| INV-08 | Back-in-stock notifications on replenishment | `notifyReplenished` → `notifyBackInStock` |
| INV-09 | Flash-sale stock limits (a line splits into flash + regular units) | `SHARED/engines/pricing.ts` |
| INV-10 | Inventory intelligence (turnover, dead stock, slow movers, demand forecast, movement summary) | `bi/inventory`, analytics endpoints |
| INV-11 | Opening stock recorded as a ledger row on product create / import (IMPORT reason) | `recordInitialStock` |

**Not present:** multi-warehouse/locations, purchase orders/suppliers, stock transfers, a stock-level grid view (stock is edited in the product editor or the adjust modal), barcode scanning.

---

## 13. Payment

| ID | Feature | Implementation |
|---|---|---|
| PAY-01 | Cash on Delivery (collection recorded in the ledger on DELIVERED) | `recordCodCollection` |
| PAY-02 | SSLCommerz hosted checkout: init, success/fail/cancel/IPN callbacks, server-side validation (amount from the gateway) | `sslcommerz.service.ts`, `payment.controller.ts`, `/api/payments/sslcommerz/*` |
| PAY-03 | EPS-PG: token, init, GET redirect callbacks, verification | `eps.service.ts`, `/api/payments/eps/*` |
| PAY-04 | Pre-order payment sessions: the Order is created only on a verified success (`checkoutPayload` snapshot) | `initiatePendingPayment`, `settlePaymentSession` |
| PAY-05 | Retry payment (new session; one ACTIVE session per order) | `retryPayment` |
| PAY-06 | Reconciliation cron (recover stuck EPS sessions; expire stale sessions after 48h) | `payment-reconciliation-cron.ts` |
| PAY-07 | Payment ledger (Payment + Refund rows → derived `paymentStatus` incl. PARTIALLY_REFUNDED) | `payment-ledger.service.ts`, `SHARED/engines/payment-ledger.ts` |
| PAY-08 | Manual payment recording (idempotent) | `recordManualPayment` |
| PAY-09 | Manual refunds (REQUESTED → COMPLETED, partial and repeated, idempotent) | `recordRefund`, `requestRefund`, `completeRefund` |
| PAY-10 | Payment attempt event timeline | `PaymentEvent` |
| PAY-11 | Payments overview admin page (KPIs, attempt search) | `payments/overview`, `payments-overview.service.ts` |
| PAY-12 | Ledger drift report + repair (**API only**) | `GET /api/payment-admin/ledger/drift`, `POST /ledger/repair` |
| PAY-13 | Per-method checkout toggles (COD / SSLCommerz / EPS), enforced on the server too | `StoreSetting.codEnabled/onlinePaymentEnabled/epsPaymentEnabled` |
| PAY-14 | Payment-method badges (logos): CRUD, reorder, logo upload; or a single combined image | `payment-methods/page.tsx`, `/api/payment-methods*`, settings upload |
| PAY-15 | Payment receipt email (outbox, toggleable) | `payment-receipt-email` consumer |
| PAY-16 | Ledger reconcile CLI | `scripts/payment-ledger-reconcile.ts` |
| PAY-17 | COD-to-collect on shipping labels comes from the ledger (never `total`) | `shipping-label*.tsx` |

---

## 14. Delivery & Courier

| ID | Feature | Implementation |
|---|---|---|
| DEL-01 | Zone-based shipping engine (postcode/district/division match, priority, default zone, free-over threshold) | `ShippingZone*`, `SHARED/engines/shipping.ts`, `pricing-config.ts` |
| DEL-02 | Admin-editable fees for the two seeded zones (Dhaka / Outside Dhaka), dual-written | Settings page, `applySettingsToPricingConfig` |
| DEL-03 | Shipping VAT (inclusive by default) | `SHARED/engines/tax.ts` |
| DEL-04 | Steadfast booking: single and bulk (≤500 per request), with an atomic booking claim (10-min lease) and outcome-unknown handling | `courier.service.ts`, `lib/steadfast.ts` |
| DEL-05 | Status sync: webhook (shared-secret token, re-verified server-to-server), 15-min cron, manual refresh, bulk sync, auto-sync on open | `handleSteadfastWebhook`, `syncPendingCourierStatuses` |
| DEL-06 | Steadfast status → order status mapping (delivered, partial, cancelled, hold) | `courier.service.ts` |
| DEL-07 | Fraud check / delivery success rate per phone | `getSteadfastFraudCheck` |
| DEL-08 | Steadfast wallet balance display | `GET /api/courier/steadfast/balance` |
| DEL-09 | Courier tracking link stored and shown | `Order.courierTrackingLink` |
| DEL-10 | Courier loss estimates (zone-matched return fees from settings) | `CourierLossEvent`, settings |
| DEL-11 | Shipping labels + invoices | §10 ORD-18/19 |
| DEL-12 | Bangladesh geography dataset (divisions → districts → areas/thanas) | `SHARED/schemas/order.ts` (840 lines), `SHARED/delivery.ts` |
| DEL-13 | Courier performance analytics | `GET /api/analytics/courier-performance` |

**Not present:** any courier other than Steadfast (Pathao, RedX, eCourier, Paperfly), a zone/rate admin UI, weight-based rates, delivery slots, store pickup.

---

## 15. Marketing

| ID | Feature | Implementation |
|---|---|---|
| MKT-01 | Coupons: CRUD; PERCENTAGE/FIXED/FREE_SHIPPING; scope all/products/categories; min order, min quantity, max discount; usage and per-customer limits; first-order-only; start/expiry; internal description; trash/restore/purge | `coupons/page.tsx`, `coupon-form.tsx`, `/api/coupons*` |
| MKT-02 | Coupon evaluation in the canonical pricing pipeline (eligibility, rejection reasons, best coupon) | `SHARED/engines/promotion.ts`, `pricing.service.ts` |
| MKT-03 | Flash sales: CRUD, window, enabled switch, banner image, items (percentage/fixed, optional stock limit), product picker, minute-level auto (de)activation | `flash-sales/page.tsx`, `/api/flash-sales*`, `flash-sale-cron.ts` |
| MKT-04 | Category bundles: CRUD, anchor category, suggested categories, minimum suggested categories, discount type/value, active, order | `bundles/page.tsx`, `bundle-form.tsx`, `/api/bundles*` |
| MKT-05 | Campaigns (email/SMS/push) | see CRM-12 |
| MKT-06 | Newsletter subscriber capture | `POST /api/newsletter/subscribe` |
| MKT-07 | Banners + homepage builder | ADM-12/13 |
| MKT-08 | Meta Pixel + TikTok Pixel (browser) with a shared event layer and dedupe | `WEB/lib/pixels/*`, `docs/AD_PIXELS.md` |
| MKT-09 | Meta Conversions API (server-side Purchase via the outbox; test-code guard outside production) | `API/lib/meta/*` |
| MKT-10 | UTM / referrer first-touch attribution joined to orders | `PageView`, `Order.sessionId` |
| MKT-11 | AI marketing copy, email copy, campaign suggestions | `/api/ai/generate` |
| MKT-12 | Wishlist price-drop and back-in-stock emails | CUS-27/28 |
| MKT-13 | Loyalty program (points per currency unit; earn on delivery) | `StoreSetting.rewardPointsPerCurrency`, `SHARED/engines/loyalty.ts` |
| MKT-14 | Social links (8 platforms) in the footer/contact page | `social-links/page.tsx` |

---

## 16. Analytics & Reporting

**80 analytics endpoints** under `/api/analytics/*` (4 public beacons + 76 admin reads/exports), 2 BI endpoints, 3 metrics endpoints. Services: `analytics.service.ts` (1,733 lines, ~50 raw SQL queries), `sales-analytics.service.ts` (652), `bi.service.ts`, `domain/metrics/*`.

| ID | Feature | Admin page | Endpoints |
|---|---|---|---|
| ANL-01 | Operational dashboard | `/admin/dashboard` | summary, revenue, order-status, top-products, low-stock, visitors, traffic-heatmap, slow-moving, demand-forecast, cohort-retention, … |
| ANL-02 | Executive overview (registry metrics with period-over-period change) | `/admin/bi/overview` | `/api/bi/overview`, `/api/v1/metrics` |
| ANL-03 | Visitors: active now, devices, browsers, OS, languages, geo, logged-in vs guest, entry/exit pages, engagement, returning frequency, recent sessions, traffic sources | `/admin/bi/visitors` | 13 endpoints |
| ANL-04 | Customer journey funnel (landing → repeat purchase) | `/admin/bi/journey` | `journey-funnel`, `funnel` |
| ANL-05 | Search: trends, zero-result searches, search conversion, audience, by city | `/admin/bi/search` | 6 endpoints |
| ANL-06 | Product intelligence: most viewed, trending, conversion rate, highest profit, risk, frequently-bought pairs, sales heatmap, variant and size/color performance, most added/removed from cart, most wishlisted | `/admin/bi/products` | ~15 endpoints |
| ANL-07 | Customer intelligence: insights, cohort retention, RFM table, purchase frequency, favorite payment method, purchase time, location, loyalty points | `/admin/bi/customers` | ~10 endpoints |
| ANL-08 | Marketing: campaign/UTM performance, coupon effectiveness, bundle performance, flash-sale performance, campaign delivery, discount usage | `/admin/bi/marketing` | ~7 endpoints |
| ANL-09 | Sales (by date range, groupings) | `/admin/bi/sales` | metrics + top categories/brands |
| ANL-10 | Financial: profit trend, cost breakdown (COGS, courier loss, discounts), estimated tax | `/admin/bi/financial` | 3 endpoints |
| ANL-11 | Inventory intelligence: turnover, dead stock, stock-movement summary, slow movers | `/admin/bi/inventory` | 4 endpoints |
| ANL-12 | Operations: fulfilment time, courier performance, return analytics, admin activity | `/admin/bi/operations` | 4 endpoints |
| ANL-13 | Behavior: cart abandonment, wishlist conversion, review behavior, feedback volume | `/admin/bi/behavior` | 4 endpoints |
| ANL-14 | "AI Insights": **rule-based** automated insights + best-selling prediction + demand forecast (no LLM call) | `/admin/bi/ai-insights` | `/api/bi/automated-insights`, `best-selling-prediction`, `demand-forecast` |
| ANL-15 | Lifetime yearly trend | `/admin/bi/lifetime` | `lifetime-yearly-trend` |
| ANL-16 | CSV reports: customer RFM, revenue, inventory turnover | `/admin/bi/reports` | `/api/analytics/export/*.csv` |
| ANL-17 | Reusable metrics API (registry, presets, groupBy, compare-previous, estimated/coverage flags) + definitions + consistency check | `/admin/bi/overview` (partial use) | `/api/v1/metrics`, `/definitions` (**unused by web**), `/consistency` (**unused by web**) |
| ANL-18 | One shared date range across all BI tabs (persisted) | all BI pages | `bi-date-range-context.tsx`, `date-range-picker.tsx` |
| ANL-19 | Store-timezone business days | — | `store-time.ts`, `SHARED/metrics/business-time.ts` |
| ANL-20 | Data collection: PageView (+exit), FunnelEvent, SearchLog, ProductViewLog | storefront | 4 public beacons + product view |
| ANL-21 | Order/product/customer CSV exports (operational) | orders, products | ORD-16, PRD-32 |

---

## 17. Notifications

| ID | Feature | Implementation |
|---|---|---|
| NTF-01 | Admin in-app notifications. Types: `order.created`, `order.courier_booked`, `order.courier_update`, `product.low_stock` (incl. "oversold on paid order"), `order.cancelled_but_paid`, `order.returned_refund_due`, `order.overpaid`. Shown via the bell. Global (no per-admin read state, no permission filtering). | `lib/notify.ts`, `Notification`, `/api/notifications` |
| NTF-02 | Customer order SMS: placed, confirmed, shipped, delivered, cancelled (each toggleable, editable templates with `{customerName} {orderNumber} {total} {storeName}`) | `sms-notifications/page.tsx`, `lib/order-sms.ts`, outbox |
| NTF-03 | New-order SMS alerts to several admin phones | `deliverAdminOrderAlertSms` |
| NTF-04 | Payment confirmation email (toggleable) | `lib/order-mailer.ts` |
| NTF-05 | Transactional emails: verification, password reset, claim link, back in stock, price drop, campaign emails with an unsubscribe link | `lib/mailer.ts`, `lib/email-template.ts` |
| NTF-06 | Web push (campaign channel PUSH; customer opt-in) | `lib/push.ts`, `public/sw.js` |
| NTF-07 | Transactional outbox (at-least-once, backoff, leases, personal-data scrub, retention, status/retry API) | `domain/outbox/*`, `/api/v1/outbox/*` |
| NTF-08 | Branded HTML email layout | `renderEmailLayout` |
| NTF-09 | Safe dev fallbacks (`.devmail` files, logged SMS/push, `LIVE_PROVIDERS=off` network guard) | `mailer.ts`, `sms.ts`, `provider-guard.ts` |

**Not present:** order-status emails (only payment receipt by email; status updates are SMS-only), push for order updates, admin email alerts, WhatsApp Business API messaging.

---

## 18. AI Features

| ID | Feature | Implementation |
|---|---|---|
| AI-01 | AI availability check (shows a setup hint when no key is configured) | `GET /api/ai/status` |
| AI-02 | Content generation, 7 types: product description, SEO title, meta description, SEO keywords, marketing copy, email copy, campaign suggestion (tone/audience/key points inputs) | `POST /api/ai/generate`, `ai.service.ts` |
| AI-03 | Image alt-text generation (vision) | `POST /api/ai/image-alt-text`, used in `image-uploader.tsx` |
| AI-04 | AI Assistant admin page | `ai-assistant/page.tsx` |
| AI-05 | Inline AI buttons in the product form/wizard and image uploader | `product-form.tsx`, `steps.tsx` |
| AI-06 | Cost guard: OWNER-only (`ai.use`), 30 requests per 10 min | `aiRateLimit` |

**Needs Verification:** whether the env default `ANTHROPIC_MODEL=claude-opus-5` is a valid model id for the account. Current ids are `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5-20251001`, so the default may need updating. STAFF see AI buttons but receive a 403 (Needs Verification per UI).

---

## 19. Settings

| ID | Feature | Implementation |
|---|---|---|
| SET-01 | Store & branding: name, tagline, logo, logo-on-dark, favicon, contact email/phone | `settings/page.tsx` (605 lines), `PATCH /api/settings`, upload endpoints |
| SET-02 | Currency (locked once orders exist) and timezone | `currencyChangeBlocked` |
| SET-03 | Shipping fees (Dhaka / Outside Dhaka → zone rates) | dual-write |
| SET-04 | Courier return-fee estimates | settings |
| SET-05 | Tax: enable, default rate, shipping taxable (→ `TaxSetting`) | `pricing-config.ts` |
| SET-06 | Reward points per currency unit | settings |
| SET-07 | Contact widget: WhatsApp message/label, call enable/label, live chat enable/label + Tawk ids | settings |
| SET-08 | Payment toggles + combined payment-methods image | settings |
| SET-09 | Google site verification | settings |
| SET-10 | SMS notifications: admin phones, 5 customer toggles + templates, admin alert toggle, payment email toggle | `sms-notifications/page.tsx`, `/api/sms-settings` |
| SET-11 | Payment method badges | PAY-14 |
| SET-12 | Social links CRUD (FACEBOOK, INSTAGRAM, YOUTUBE, TIKTOK, LINKEDIN, X, WHATSAPP, OTHER) | `social-links/page.tsx`, `/api/social-links*` |
| SET-13 | Redirects CRUD (exact path, 301/302, active) | `redirects/page.tsx`, `/api/redirects*` |
| SET-14 | Team management | ADM-10 |
| SET-15 | Audit log | ADM-11 |
| SET-16 | Pricing-config drift report (**API only**) | `GET /api/settings/pricing-config-drift` |
| SET-17 | Settings cache (Redis) + storefront revalidation on save | `settings.service.ts` |

**Env-only settings (no UI):** gateway credentials, Steadfast keys/webhook token, Resend, BulkSMSBD, VAPID, Google client id, Meta/TikTok pixel ids, Meta CAPI, Clarity id, Anthropic key/model, `OPS_MONITOR_TOKEN`, `REVALIDATE_SECRET`.

---

## 20. APIs

There are **~400 HTTP endpoints**: 395 in module routers, 2 in `/api/v1/checkout`, plus `/health`, `/health/ready` and `/api/v1/ops/attention`. **73** of them are public (69 module routes + the 2 quote endpoints + 2 health checks; `/api/v1/ops/attention` also accepts a monitor token). The rest need an admin session and permission, or a customer session.

### 20.1 Router map
| Mount | Router file | Public endpoints | Protected endpoints (guard) |
|---|---|---|---|
| `/health`, `/health/ready` | `app.ts` | liveness; readiness (Postgres, Redis, outbox; 503 until ready) | — |
| `/api/auth` | `auth.routes.ts` | login, google, logout, refresh, admin-invites/accept | me, sessions, logout-all (self); admins list/active/update/password, invites list/create/revoke (`users.manage`) |
| `/api/customers` | `customer.routes.ts` | register, login, logout, refresh, claim/confirm, forgot/reset password, verify-email, unsubscribe, google, otp/request, otp/verify | `/me` profile, phone otp/verify, password, addresses CRUD, orders, order detail, points, push subscriptions, resend-verification, logout-all (customer); `/admin` list/create/stats/detail/update/points/sms/bulk sms (admin perms) |
| `/api/categories` | `category.routes.ts` | tree, slug/:slug, slug/:slug/stock | list, :id, stock-map, upload image/banner, create, reorder, update, move, delete, restore, permanent |
| `/api/attributes` | `attribute.routes.ts` | list, :id | create, update, delete |
| `/api/catalog` | `catalog.routes.ts` | — | types, templates, attributes, spec-groups, size-guides, care-guides, materials, sku-settings, sku/generate, sections (39 endpoints) |
| `/api/products` | `product.routes.ts` | storefront list/facets/by-ids/trending/recommended/suggest/popular-searches, slug/:slug, :id/similar, rail/:key, frequently-bought-together, complete-your-look, budget-alternatives, upgrade-options, premium-alternatives, urgency-signals, :id/view | export csv/full, import template/validate/commit, list, :id, history, sales-summary, preview, bulk delete/status/category, create, update, delete, restore, duplicate, permanent, images upload/reorder/delete/update |
| `/api/orders` | `order.routes.ts` | create (checkout), track, :orderNumber/retry-payment | list, admin create, stats, export csv, bulk status/delete/permanent/courier book/courier sync/delivery-score/get, :id, status, details, hold, hold/clear, price, reconcile-partial-delivery, refunds (create/list/complete), payment, payments, courier book/refresh/unlink, delete, restore, permanent |
| `/api/payments` | `payment.routes.ts` | sslcommerz success/fail/cancel/ipn; eps success/fail/cancel | — |
| `/api/payment-admin` | `payment-admin.routes.ts` | — | overview, search, ledger/drift, ledger/repair |
| `/api/payment-methods` | `payment-method.routes.ts` | active | list, upload-logo, create, reorder, update, delete |
| `/api/coupons` | `coupon.routes.ts` | validate, best, active | list, :id, create, update, delete, restore, permanent |
| `/api/bundles` | `bundle.routes.ts` | for-product/:productId, preview | list, :id, create, update, delete |
| `/api/flash-sales` | `flash-sale.routes.ts` | active | list, :id, create, update, delete, items add/remove |
| `/api/banners` | `banner.routes.ts` | active | list, upload-image, create, reorder, update, delete |
| `/api/homepage-sections` | `homepage-section.routes.ts` | active | list, upload-image, create, reorder, update, delete |
| `/api/social-links` | `social-link.routes.ts` | active | list, create, update, delete |
| `/api/redirects` | `redirect.routes.ts` | active | list, :id, create, update, delete |
| `/api/settings` | `settings.routes.ts` | GET / (full StoreSetting) | pricing-config-drift, PATCH, upload logo/favicon/payment-methods image |
| `/api/sms-settings` | `sms-settings.routes.ts` | — | get, patch |
| `/api/sms-templates` | `sms-template.routes.ts` | — | CRUD |
| `/api/newsletter` | `newsletter.routes.ts` | subscribe | — |
| `/api/feedback` | `feedback.routes.ts` | submit | list, mark read, delete |
| `/api/reviews` | `review.routes.ts` | list for product | mine, submit (customer); admin list/moderate/delete |
| `/api/return-requests` | `return-request.routes.ts` | — | create, mine (customer); list, review (admin) |
| `/api/wishlist` | `wishlist.routes.ts` | — | list, add, remove (customer) |
| `/api/cart` | `cart.routes.ts` | — | PUT sync (customer) |
| `/api/stock-alerts` | `stock-alert.routes.ts` | — | subscribe, unsubscribe (customer) |
| `/api/analytics` | `analytics.routes.ts` | pageview, pageview/:id/exit, funnel-event, search-session | 73 reads + 3 CSV exports |
| `/api/bi` | `bi.routes.ts` | — | overview, automated-insights |
| `/api/inventory` | `inventory.routes.ts` | — | movements, adjust, reconciliation |
| `/api/uploads` | `upload.routes.ts` | — | editor-image |
| `/api/audit-logs` | `audit.routes.ts` | — | list |
| `/api/notifications` | `notification.routes.ts` | — | list, :id/read, read-all |
| `/api/ai` | `ai.routes.ts` | — | status, generate, image-alt-text |
| `/api/campaigns` | `campaign.routes.ts` | — | list, :id, create, update, delete, schedule, cancel-schedule, send |
| `/api/courier` | `courier.routes.ts` | steadfast/webhook (token) | steadfast/balance |
| `/api/v1/checkout` | `checkout.routes.ts` | quote, quote/best-coupon | — |
| `/api/v1/storefront/read-model` | `read-model.routes.ts` | — | drift (`ops.read`), rebuild (`ops.repair`) |
| `/api/v1/metrics` | `metrics.routes.ts` | — | metrics, definitions, consistency |
| `/api/v1/outbox` | `outbox.routes.ts` | — | status, :id/retry |
| `/api/v1/ops` | `ops.routes.ts` + `app.ts` | attention (also via `OPS_MONITOR_TOKEN` bearer) | reliability |
| (web) `/api/revalidate` | `WEB/app/api/revalidate/route.ts` | secret-header protected | — |

### 20.2 Backend endpoints with no frontend caller
`POST /api/coupons/validate`, `POST /api/coupons/best` (replaced by the v1 quote); `GET /api/auth/sessions`; `GET /api/customers/me/push-subscriptions`; `GET /api/products/:id/similar`, `/frequently-bought-together`, `/complete-your-look`, `/upgrade-options` (superseded by `/rail/:key`; the web client wrappers still exist but nothing calls them); `GET /api/payment-admin/ledger/drift`, `POST /ledger/repair`; `GET /api/settings/pricing-config-drift`; `/api/v1/outbox/*`; `/api/v1/ops/*`; `/api/v1/storefront/read-model/*`; `GET /api/v1/metrics/definitions`, `/consistency`; `GET /api/flash-sales/:id`, `GET /api/campaigns/:id` (web wrappers exist but are unused); `POST /api/campaigns/:id/schedule` (the UI schedules through create/update with `scheduledAt`; `scheduleCampaign` is unused).

---

## 21. External Integrations

| Integration | Purpose | Implementation | Config | State |
|---|---|---|---|---|
| **SSLCommerz** | Card/MFS hosted payment | `API/modules/payments/sslcommerz.service.ts`, callbacks in `payment.controller.ts` | `SSLCOMMERZ_*` + `onlinePaymentEnabled` | Code complete; account state Needs Verification |
| **EPS-PG** (eps.com.bd) | Payment gateway (redirect only, no IPN) | `eps.service.ts` (HMAC hash) | `EPS_*` + `epsPaymentEnabled` (default off) | Code complete. Live credentials exist in the untracked `AsifZone Eps/` folder. |
| **Steadfast Courier** (packzy) | Booking, bulk booking, status, fraud check, balance, webhook | `API/lib/steadfast.ts`, `courier.service.ts` | `STEADFAST_*` | Complete |
| **BulkSMSBD** | Transactional/marketing/OTP SMS | `API/lib/sms.ts` | `BULKSMSBD_*` | Complete (logs when unset) |
| **Resend** | Email | `API/lib/mailer.ts` | `RESEND_*` | Complete (`.devmail` fallback). README still says email is "not configured", so the README is stale. |
| **Web Push (VAPID)** | Browser push for campaigns | `API/lib/push.ts`, `public/sw.js`, `lib/push-notifications.ts` | `WEB_PUSH_*`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Complete |
| **Google Identity Services** | Customer and admin sign-in | `google-button.tsx`, `google-auth-library` on the API | `GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Complete |
| **Meta Pixel** | Browser ad events | `WEB/lib/pixels/meta.ts` | `NEXT_PUBLIC_META_PIXEL_ID` | Complete |
| **Meta Conversions API** | Server-side Purchase | `API/lib/meta/*`, outbox consumer | `META_*` | Complete; inert without config |
| **TikTok Pixel** | Browser ad events | `WEB/lib/pixels/tiktok.ts` | `NEXT_PUBLIC_TIKTOK_PIXEL_ID` | Complete (browser only; **no TikTok Events API server side**) |
| **Microsoft Clarity** | Heatmaps/recordings | `heatmap-script.tsx` | `NEXT_PUBLIC_CLARITY_ID` (missing from `.env.example`) | Complete |
| **Tawk.to** | Live chat | `live-chat-widget.tsx` | DB: `tawkPropertyId/WidgetId` | Complete |
| **WhatsApp** | Click-to-chat deep link with prefill (no Business API) | `contact-widget.tsx`, SocialLink WHATSAPP | DB | Complete |
| **Anthropic Claude** | AI content + alt text | `API/modules/ai/ai.service.ts` | `ANTHROPIC_API_KEY/MODEL` | Complete; model id Needs Verification |
| **geoip-lite** | IP geolocation for analytics | `analytics.service.ts` | bundled DB | Accuracy is limited |
| **Let's Encrypt / certbot** | TLS | `docker-compose.yml`, nginx | domain `asifzone.com` | Complete |
| **rclone (optional)** | Off-site backups (B2/R2) | `docker/backup.sh` | `RCLONE_REMOTE` | Optional; Needs Verification on the VPS |
| **Storage** | **Local disk** (`UPLOADS_DIR`, served by the API and nginx); no S3/R2/CDN object storage | `upload.service.ts` | — | Single-node only |
| **Cloudflare** | Mentioned in the README as the CDN/SSL front | — | — | Needs Verification |

**Not integrated:** bKash/Nagad direct APIs (only as manual-payment notes and logo badges), other BD couriers, Google Analytics/GTM, Google Merchant Center feed, Facebook catalog feed, WhatsApp Business API, error tracker SaaS (the observability layer has `registerErrorReporter` but no reporter registered; Needs Verification), S3-compatible storage.

---

## 22. UI Components

### 22.1 Primitives — `WEB/components/ui` (20)
`button` (cva variants incl. `brass`), `input`, `textarea`, `select` (native), `searchable-select` (combobox with keyboard nav), `checkbox`, `switch`, `label`, `badge`, `card` (+Header/Title/Content), `modal`, `drawer` (with optional prev/next nav), `popover`, `dropdown-menu` (built on popover), `confirm-dialog` (`useConfirmDialog`, typed-text confirmation), `toast` (+Toaster), `back-link`, `breadcrumb` (admin), `h-scroll-shadow`, `icon-picker`. These are used across nearly every admin page (Button is imported in 97 files).

### 22.2 Admin components — `WEB/components/admin` (64 + 14 homepage + 6 wizard)
- **Layout/nav:** `sidebar`, `sub-nav` + 8 `*-subnav`, `page-header`, `form-section`, `empty-state`, `table-skeleton`, `pagination`, `page-size-select`, `notification-bell`, `date-range-picker`, `bi-date-range-context`.
- **Charts/KPIs (hand-built SVG/CSS, no chart library):** `stat-tile`, `sparkline`, `hero-revenue-card`, `revenue-chart`, `revenue-chart-card`, `visitor-chart`, `traffic-heatmap`, `product-sales-heatmap`, `cohort-retention-grid`, `journey-funnel`, `ranked-bar-list`, `top-products-chart`, `order-status-breakdown`, `conversion-metric-card`, `low-stock-table`, `slow-moving-table`, `demand-forecast-table`.
- **Catalog:** `product-form` + `product-form-state`, `product-wizard/*` (wizard-shell, steps, progress-header, preview-pane, live-preview-frame, types), `variant-editor`, `variant-gallery-picker`, `image-uploader`, `attribute-fields`, `attribute-form`, `care-material-section`, `size-guide-editor`, `section-settings-editor`, `product-content-editors`, `product-history`, `product-status-panel`, `product-status-badge`, `product-picker`, `duplicate-product-dialog`, `template-manager-modal`, `category-form`, `category-tree`.
- **Orders/CRM:** `order-detail-panel` (1,572 lines), `order-status-icon`, `customer-detail-panel`, `sms-composer`, `adjust-stock-modal`.
- **Promotions/content:** `coupon-form`, `bundle-form`, `banner-form`, `rich-text-editor`, `homepage/*` (section list, add menu, config panel, per-type forms, live preview, meta).

### 22.3 Storefront components — `WEB/components/storefront` (70)
Shell/nav (`storefront-shell`, `header`, `mega-menu`, `mobile-nav`, `mobile-bottom-nav`, `footer`, `breadcrumb`, `page-hero`, `page-transition`, `skip-to-content-link`, `brand-loader`); product (`product-card`, `product-grid`, `product-carousel`, `product-gallery`, `product-showcase`, `product-page-view`, `product-page-body`, `product-accordion`, `variant-selector`, `variant-option-pickers`, `variant-picker-dialog`, `sticky-add-to-cart`, `size-guide-modal`, `product-reviews`, `star-rating`, `promo-badge`, `urgency-signals`, `wishlist-button`, `stock-alert-button`, `quick-view-modal`, `compare-bar`, `recently-viewed-carousel`, `track-product-view`, `admin-sales-badge`); listing (`facet-filters`, `sort-select`, `pagination`, `coming-soon`, `category-stock-panel`, `no-search-results`); search (`search-overlay`, `search-box`, `search-trigger-button`, `sticky-search-bar`); cart (`cart-drawer`, `cart-icon`, `sticky-cart-bar`, `cart-reminder-banner`, `order-summary-card`); homepage sections (10); support (`contact-widget`, `contact-form`, `feedback-modal`, `live-chat-widget`, `newsletter-form`, `faq-accordion`, `mobile-toc-select`); skeletons (5).

### 22.4 Account (15), Orders/print (10), Analytics trackers (4), misc
Account: nav, overview, page header, empty state, security, auth-mode toggle, Google button, OR divider, password input, strength meter, phone OTP form, phone verification panel, push toggle, smart order tracker, verify-email banner. Orders: invoice document + chrome, 3 shipping-label templates, label options/preview/capture host, barcode SVG, QR SVG. Misc: `social-icon`, `store-config`, `store-logo-image`.

**Design system:** Tailwind with custom tokens from `@clothing-brand/ui-tokens` (ink/cream/brass palette, `font-display`, `shadow-floatLg`, `ease-smooth`, `glass`, animations). There is no Storybook and no component tests (coverage comes from e2e only).

---

## 23. UX Issues (current state, no redesign)

| # | Issue | Evidence |
|---|---|---|
| UX-01 | **Two product editors** (wizard + classic tabbed) with overlapping capability. Users can reach both, and the wizard links back to the classic one, which raises maintenance and confusion. | `lib/admin-routes.ts`, `products/new`, `products/wizard/new` |
| UX-02 | **Two "Attributes" concepts**: `/admin/attributes` ("Variant options": Color/Fabric with hex values) vs `/admin/catalog/attributes` (typed product fields). Same word, different systems. | `Attribute` vs `AttributeDefinition` |
| UX-03 | **Oversized single pages**: Orders list 1,880 lines, order panel 1,572, customers 859, dashboard 787 (29 queries), checkout 748. These are slow to load and hard to scan. | line counts |
| UX-04 | **Dashboard vs BI Overview overlap.** Both show revenue/KPIs/funnels/low stock. There are 15 BI tabs in a horizontal scroll strip. | `dashboard/page.tsx`, `bi/*` |
| UX-05 | **Buttons shown that STAFF can't use** (only the sidebar and settings tabs are permission-filtered). Examples: permanent delete, CSV import, AI buttons, redirect/social-link edits; these return a 403 toast. Needs Verification per page. | `sidebar.tsx` `HREF_PERMISSION` has only 2 entries |
| UX-06 | **Hidden navigation depth**: Variant options, Import/Export, Return Requests, Banners, Reviews, Campaigns, Payment Methods, Social Links, Redirects, Team and Audit Log are only reachable via sub-tabs. The sidebar "Settings" groups 7 unrelated pages. | sidebar comments |
| UX-07 | **Generic admin branding** ("Store Console" / "SC") instead of the store's own name/logo | `sidebar.tsx`, `admin/layout.tsx` |
| UX-08 | **Legal/FAQ/shipping content is hardcoded**, so store staff can't edit it, and it mentions Dhaka-specific timings | `faq`, `shipping-returns`, `privacy-policy`, `terms` pages |
| UX-09 | **Order confirmation requires re-entering the phone** (after a session) to view your own order | `order-confirmation/[orderNumber]/page.tsx` |
| UX-10 | **No customer self-cancel**; the FAQ tells shoppers to "reach out via the contact page" | FAQ text |
| UX-11 | **Several fixed bottom bars** (mobile bottom nav, sticky cart bar, sticky add-to-cart, compare bar z-40, cart reminder, contact widget) compete for mobile space. Partly mitigated by `use-bottom-dock`. Needs Verification on small screens. | storefront components |
| UX-12 | **Admin layout is fully client-rendered**: every admin page shows skeletons first, with no SSR | `admin/(shell)/layout.tsx` |
| UX-13 | **Notifications are global**: one admin marking "read all" clears them for everyone; staff see owner-level alerts | `Notification` model |
| UX-14 | **Campaign recipients include non-opted-in customers, who are recorded as FAILED** ("has not opted in"), which inflates failure counts | `dispatchToRecipient` |
| UX-15 | **Newsletter subscribers without an account can never be messaged** (the segment maps emails to Customer rows only), and there is no admin list of subscribers | `resolveSegmentCustomers` |
| UX-16 | **Inventory page shows the movement ledger only**; there's no stock-level overview grid (stock levels live in the product editor and dashboard low-stock table) | `inventory/page.tsx` |
| UX-17 | **Loading/empty/error states**: good coverage on the storefront (route `loading.tsx` for most pages, skeletons, empty states) and the admin (TableSkeleton/EmptyState). The `(storefront-detail)` product page has **no skeleton** (`product-detail-skeleton.tsx` exists but is unused). | §27 |
| UX-18 | **Accessibility positives**: skip link, focus traps for modals/drawers, aria-labels on icon buttons in the inspected files. Not audited: colour contrast of ink/cream/brass tokens, form error announcements, keyboard support for dnd-kit lists. Needs Verification. | — |
| UX-19 | The **"AI Insights" label** suggests an LLM but is rule-based; the real AI is on a separate "AI Assistant" page | `bi/ai-insights`, `bi.service.ts` |
| UX-20 | **Manual-order and checkout duplicate the address/quote UI** (two implementations of the BD address cascade and quote display) | `orders/new/page.tsx`, `checkout/page.tsx` |
| UX-21 | **Shipping-zone, free-shipping threshold and tax mode can't be edited** in the UI although the engine supports them (merchant must ask a developer) | §26 |
| UX-22 | **Admin session list isn't viewable** (only "log out everywhere") | `GET /api/auth/sessions` unused |

---

## 24. Broken Features

These are features that exist but don't behave as their name or the UI implies.

| # | Finding | Severity | Evidence |
|---|---|---|---|
| BRK-01 | **Customer "Blocked" flag blocks nothing.** `Customer.isBlocked` is only used to compute the BLOCKED tag. Checkout, login, OTP, reviews and returns never check it. | High (merchant expectation) | `git grep isBlocked` → only `customer.service.ts` tag code |
| BRK-02 | **Refresh-skip path typo**: the web client skips refresh for `/api/customers/verify-otp`, but the real route is `/api/customers/otp/verify`. A wrong OTP triggers a pointless refresh attempt before the error is shown. | Low | `WEB/lib/api-client.ts` `SKIP_REFRESH_PATHS` |
| BRK-03 | **Sitemap stops at 2,000 products** (20 pages × 100). Larger catalogs silently drop URLs. | Low now / Medium at scale | `app/sitemap.ts` |
| BRK-04 | **Default AI model id** `claude-opus-5` may not exist (Needs Verification). If it doesn't, every AI call fails until `ANTHROPIC_MODEL` is set. | Medium (when AI is enabled) | `API/config/env.ts` |
| BRK-05 | **README is out of date**: it says email/payments/deployment aren't set up, but Resend, gateways and VPS deploy are implemented. A new developer would get a wrong picture. | Low | `README.md` |
| BRK-06 | **Stale comment reference**: `courier-status-cron.ts` cites `cart-recovery-cron.ts`, which was deleted (commit `a67edd6`) | Trivial | job file |

No runtime-crash bugs were confirmed by reading code. Behavioral verification (running the app, gateway sandboxes) **Needs Verification**.

---

## 25. Incomplete Features

| # | Feature | What exists | What's missing |
|---|---|---|---|
| INC-01 | **Abandoned-cart recovery** | `Cart` mirror, `Cart.reminderSentAt` column, abandonment analytics (1h threshold), client-side reminder banner | The recovery job/email was **removed** (commit `a67edd6`); `reminderSentAt` is never written |
| INC-02 | **Zone-based shipping** | Full engine + `ShippingZone`/`Match`/`Rate` tables with priority and `freeOverAmount` | No admin CRUD; only the two legacy fees are editable |
| INC-03 | **Tax configuration** | `TaxSetting` with INCLUSIVE/EXCLUSIVE mode and a shipping rate | Mode and shipping rate aren't exposed in settings |
| INC-04 | **Campaign segments** | `Segment.filter` JSON designed for arbitrary filters | Only 4 hardcoded segment types; no segment builder; segments aren't reusable (one is created per campaign) |
| INC-05 | **Ad-pixel consent** | Single gate `hasAdTrackingConsent()` | Always returns `true`; there is no consent banner/CMP |
| INC-06 | **PWA** | Service worker for push | No web manifest, no offline caching |
| INC-07 | **TikTok server-side events** | Browser pixel | No TikTok Events API (Meta has CAPI) |
| INC-08 | **Payment refunds via gateway** | Manual refund records | No gateway refund API calls (documented limitation) |
| INC-09 | **Ops/repair tooling** | API endpoints for outbox status/retry, ledger drift/repair, read-model drift/rebuild, pricing-config drift, metrics consistency, reliability report | No admin UI; these need curl or scripts |
| INC-10 | **Legacy-to-new migrations** (expand/contract) | `Product.productType` + `typeId`; `isActive` + `status`; `StoreSetting` tax/shipping mirrors + `TaxSetting`/`ShippingZone`; deprecated `Order.paymentSessionKey/paymentTransactionId/trackingNumber/carrier` | The "contract" phase (dropping legacy columns) hasn't happened |
| INC-11 | **Newsletter management** | Subscriber capture + unsubscribe cleanup | No admin list/export; guests can't be emailed |
| INC-12 | **Error reporting** | `registerErrorReporter` hook | No external reporter registered (Needs Verification) |
| INC-13 | **Customer order emails** | Payment receipt email | Status-change emails (SMS only) |
| INC-14 | **Brand entity** | `Product.brand` free text, `brandTier` enum | No Brand model; brand analytics key off free text |

---

## 26. Hidden Features (implemented, not exposed or hard to find)

| # | Feature | How to reach it |
|---|---|---|
| HID-01 | Ledger drift report + repair | `GET /api/payment-admin/ledger/drift`, `POST /ledger/repair` (`ops.repair`) |
| HID-02 | Outbox status + retry of failed events | `/api/v1/outbox/status`, `/:id/retry` |
| HID-03 | Reliability report (loyalty drift, stock discrepancies, …) and attention counts (also for external monitors via `OPS_MONITOR_TOKEN`) | `/api/v1/ops/reliability`, `/api/v1/ops/attention` (the dashboard does show attention signals) |
| HID-04 | Storefront read-model drift + rebuild | `/api/v1/storefront/read-model/*`, `pnpm --filter api read-model:rebuild` |
| HID-05 | Pricing-config drift (legacy mirrors vs zones/tax) | `GET /api/settings/pricing-config-drift` |
| HID-06 | Metrics definitions + consistency | `/api/v1/metrics/definitions`, `/consistency` |
| HID-07 | Admin active-sessions list | `GET /api/auth/sessions` |
| HID-08 | Shipping zones with postcode/district matching + free-over thresholds | DB only (seeded zones) |
| HID-09 | Tax mode INCLUSIVE/EXCLUSIVE, shipping tax rate | DB only |
| HID-10 | Microsoft Clarity | Build-time `NEXT_PUBLIC_CLARITY_ID` (only hinted in the dashboard, missing from `.env.example`) |
| HID-11 | Admin sales badge on PDPs + category stock panel on the storefront | Visible only after an admin login in the same browser |
| HID-12 | Admin product preview at `/preview/[id]` | From the editor |
| HID-13 | Catalog presets seed | `pnpm --filter api db:seed:presets` |
| HID-14 | Order search by customer → the customer search also matches order numbers | CRM search box |
| HID-15 | Live-provider network guard (`LIVE_PROVIDERS=off`) for e2e safety | env |
| HID-16 | Customer "remember me" session vs persistent cookie | login checkbox |

---

## 27. Dead / Unused Features

| # | Item | Evidence |
|---|---|---|
| DEAD-01 | `WEB/components/storefront/skeletons/product-detail-skeleton.tsx`: never imported | import scan |
| DEAD-02 | Web API wrappers never called: `getCompleteYourLook`, `getFrequentlyBoughtTogether`, `getUpgradeOptions`, `getActiveHomepageSectionsSafe`, `getCampaign`, `getFlashSale`, `scheduleCampaign`, `listMyPushSubscriptions`, `listRefunds` (payments-admin), `listAdminSessions`; and `getVisitorId`, `getSessionAttribution` are only used inside `lib/analytics.ts` | usage scan |
| DEAD-03 | Legacy public endpoints `POST /api/coupons/validate`, `POST /api/coupons/best` (pricing moved to `/api/v1/checkout/quote`) | no web caller |
| DEAD-04 | Product rail endpoints `/:id/similar`, `/frequently-bought-together`, `/complete-your-look`, `/upgrade-options` (still used internally as rail fallbacks, but the HTTP endpoints have no caller) | §20.2 |
| DEAD-05 | `Cart.reminderSentAt` column (never written) | INC-01 |
| DEAD-06 | Deprecated `Order.paymentSessionKey`, `paymentTransactionId`; likely `trackingNumber`/`carrier` (Steadfast fields replaced them; Needs Verification) | schema comments |
| DEAD-07 | `meta-capi-worker.ts`: drains a pre-outbox queue; nothing new writes to it | job comment |
| DEAD-08 | `SHARED/config/product-types.ts` hardcoded legacy product types (8). Types moved to the DB; this remains a fallback/seed source (Needs Verification of remaining readers). | file |
| DEAD-09 | `deploy_vps.py`, `inspect_vps.py`: Paramiko scripts for the **old shared-hosting** account (`u139868009`, port 65002). Production is now Docker on a VPS via `docker/deploy.sh` + CI. | repo root |
| DEAD-10 | `morgan` dependency (replaced by the correlation logger) | `apps/api/package.json`, `app.ts` comment |
| DEAD-11 | Root `.next/` folder (stray build output at the repo root; gitignored) | `ls` |

---

## 28. Performance Issues

| # | Concern | Location | Impact |
|---|---|---|---|
| PERF-01 | **Customer list loads every customer and every order into Node**, then filters/sorts/paginates in JS (also used for stats and BI RFM) | `loadCustomersWithComputedFields` (`customer.service.ts:716`) | O(customers × orders) per request; the code itself notes this will break at tens of thousands |
| PERF-02 | **Metrics engine loads order facts into memory**; "lifetime" loads **all orders** | `domain/metrics/facts.repository.ts` (`candidateOrderIds` returns null for lifetime) | Executive overview / lifetime pages slow down as history grows |
| PERF-03 | **Dashboard fires 29 parallel queries** (some polling every 30s); BI pages fire 10–15 each | `dashboard/page.tsx`, `bi/*` | DB load spikes per open admin tab |
| PERF-04 | **~50 raw SQL analytics queries over `PageView`/`FunnelEvent`/`SearchLog` with no retention/rollups** | `analytics.service.ts` | Linear growth of scan cost |
| PERF-05 | **Public `GET /api/products/storefront?search=` writes a `SearchLog` row and has no API-level rate limit** (only nginx 15 r/s per IP) | `product.routes.ts`, `listStorefrontProducts` | Write amplification / log flooding |
| PERF-06 | **Edge middleware on every request** fetches redirects (cached 300s via the Next fetch cache) and `/api/settings` for the favicon | `WEB/middleware.ts` | Fine when cached; a cache miss adds latency to every route |
| PERF-07 | **81 of 94 pages are client components**, including all admin pages and most account pages | `"use client"` scan | Larger JS bundles, no SSR for admin |
| PERF-08 | Heavy client libraries: TipTap, jsPDF, html-to-image, framer-motion, dnd-kit, isomorphic-dompurify (the last is server-external) | `apps/web/package.json` | `optimizePackageImports` covers only lucide/react-query/framer-motion; dynamic imports for label/PDF/editor Needs Verification |
| PERF-09 | **Local-disk image storage served by the API container** (nginx caches `/uploads/` 30d) | `upload.service.ts` | No CDN or object storage; single-node only; backups must include files |
| PERF-10 | `next/image` with AVIF/WebP + 3 WebP renditions on upload | `next.config.mjs`, `upload.service.ts` | Positive |
| PERF-11 | Redis cache for settings/products + ISR tags + on-demand revalidation | `config/redis.ts`, `product.cache.ts` | Positive |
| PERF-12 | Read model with a freshness guard: volatile flash rows recompute on every guarded read | `read-model.service.ts` | Fine; watch with many limited flash items |
| PERF-13 | Campaign send creates a recipient row for **every** customer in the segment, including non-opted-in ones | `queueCampaignSend` | Table bloat |
| PERF-14 | `AuditLog`, `PageView`, `FunnelEvent`, `SearchLog`, `ProductViewLog`, `Notification`, `PaymentEvent` have **no retention** | schema | Unbounded growth |

---

## 29. Security Issues

Overall posture is **strong**: DB-backed role resolution per request, a permission guard test over every route, separate admin/customer JWT secrets with a `typ` claim, httpOnly SameSite=strict cookies, double-submit CSRF, refresh rotation with reuse detection, gateway amounts re-verified server-side, unsigned courier webhooks re-verified, magic-byte image validation, Zod everywhere, HTML sanitized before render, CSV formula-injection guard (`lib/csv.ts`), secrets fail closed outside dev/test, HSTS/nosniff/frame headers in nginx, rate limits at two layers. Findings:

| # | Finding | Severity | Location |
|---|---|---|---|
| SEC-01 | **`isBlocked` not enforced** (see BRK-01). A blocked customer can still log in and order. | High (business) | customer/order services |
| SEC-02 | **`AdminUser.role` defaults to OWNER**. Any future code that creates an admin without an explicit role grants full privileges. | Medium | `schema.prisma` |
| SEC-03 | **No Content-Security-Policy on the web app** (helmet only protects API responses; nginx sets no CSP). Third-party scripts (Meta, TikTok, Clarity, Tawk, Google) load freely. | Medium | `nginx.conf`, `next.config.mjs` |
| SEC-04 | **Public `GET /api/settings` returns the full `StoreSetting` row**, including internal courier return-fee estimates. Nothing secret, but it's business-internal. | Low | `settings.routes.ts` |
| SEC-05 | **Public `GET /api/categories/slug/:slug/stock`** exposes per-category stock levels to anyone (meant for the admin-hint panel) | Low–Medium | `category.routes.ts` |
| SEC-06 | **Public product GETs and analytics beacons write rows** (SearchLog, ProductViewLog, PageView); only beacons/view have app rate limits | Low–Medium | §28 PERF-05 |
| SEC-07 | **Revalidate secret compared with `!==`** (not constant-time); low risk server-to-server | Low | `WEB/app/api/revalidate/route.ts` |
| SEC-08 | **`requireCustomer` is stateless**: revoked/logged-out sessions keep API access until the 15-min access token expires | Low (accepted design) | `require-customer.ts` |
| SEC-09 | **Steadfast webhook auth is a shared token in the query string** (may appear in proxy logs). Mitigated by re-verification against Steadfast. | Low | `courier.controller.ts` |
| SEC-10 | **Ad pixels fire without consent** (consent gate hard-wired to `true`). This is a privacy/compliance exposure if targeting regions with consent laws. | Medium (compliance) | `lib/pixels/consent.ts` |
| SEC-11 | **Live EPS credentials sit in `AsifZone Eps/`** inside a OneDrive-synced working tree (gitignored, so not in git). This is a cloud-sync exposure. | Medium (operational) | repo root |
| SEC-12 | **Legacy shared-hosting scripts** reference the old host/user (no password committed) | Low | `deploy_vps.py`, `inspect_vps.py` |
| SEC-13 | **Order tracking by orderNumber + phone** returns the full address/order. Rate-limited to 20 per 10 min per IP. Order numbers are `ORD-YYYYMMDD-` plus a 6-character `crypto.randomInt` suffix (~2.2 billion per day), so guessing is impractical; the phone requirement is the second factor. | Low | `trackOrder`, `lib/order-number.ts` |
| SEC-14 | **Notifications aren't permission-scoped**: STAFF see owner-only operational alerts | Low | `Notification` |
| SEC-15 | **Uploaded files are served from the API origin** with `crossOriginResourcePolicy: cross-origin`. Files are re-encoded to WebP by sharp, which neutralises polyglots. | Positive / Low | `app.ts`, `upload.service.ts` |
| SEC-16 | **AuditLog has no retention or tamper-evidence** (append-only by convention only) | Low | schema |

---

## 30. Future E-commerce OS Readiness

### 30.1 Already reusable (brand-agnostic by design)
- **Branding is DB-driven**: store name, tagline, logos, favicon, contacts, social links, payment badges, homepage builder, banners, SEO verification, currency, timezone (`StoreSetting`, `HomepageSection`, `Banner`, `SocialLink`).
- **Catalog configuration is data, not code**: product types, templates, attribute definitions, spec groups, size/care guides, materials, SKU pattern, 3-level page sections. A new brand with different product kinds needs no code change.
- **Pure shared engines** (`packages/shared/src/engines`): money, rounding, pricing, promotions, shipping zones, tax (inclusive/exclusive), quote, availability, loyalty, payment ledger, metrics registry/aggregation, order state machine, permissions. These can be lifted into an OS core package.
- **Platform infrastructure**: transactional outbox, BullMQ jobs, observability (correlation ids, redaction), readiness, idempotency keys, read model, guard tests enforcing single writers, deploy script with backup/readiness gates.
- **Provider abstractions with safe fallbacks**: mailer, SMS, push, AI, network guard.
- **Reusable UI kit**: `components/ui/*`, admin charts/KPIs, homepage section renderers, label templates.

### 30.2 Blockers for multi-brand / multi-tenant
| # | Area | Current state | What a multi-brand architecture needs |
|---|---|---|---|
| OS-01 | **No tenant/brand key on any table** | All 85 models are single-store; `StoreSetting`, `CatalogSetting`, `TaxSetting`, `SmsNotificationSetting` are `"singleton"` rows | `storeId`/`tenantId` on every business row plus row-level scoping, or a DB-per-tenant strategy; settings keyed per store |
| OS-02 | **Global uniqueness** | `Product.slug`, `Category.slug`, `ProductVariant.sku`, `Coupon.code`, `Order.orderNumber`, `Customer.email`, `AdminUser.email`, `Redirect.fromPath`, `ProductTypeDef.key`, `AttributeDefinition.key` are globally unique | Composite uniques per tenant |
| OS-03 | **Identity** | One `Customer` table and one `AdminUser` table; roles are global (OWNER/STAFF) | Tenant memberships, per-tenant roles, possibly a platform super-admin |
| OS-04 | **Hardcoded role/permission map** | `SHARED/permissions.ts` (code) | Configurable roles per tenant |
| OS-05 | **Single-origin config** | `WEB_ORIGIN`, `API_ORIGIN`, `NEXT_PUBLIC_*` build-time pixel ids, `NEXT_PUBLIC_SITE_URL` | Host-based tenant resolution in middleware; runtime (not build-time) pixel/analytics ids per tenant |
| OS-06 | **Env-level provider credentials** | SSLCommerz/EPS/Steadfast/BulkSMSBD/Resend/Meta/Google/Anthropic keys are process env | Per-tenant encrypted credential store |
| OS-07 | **Singleton caches & tags** | Redis keys (`settings`, product prefix) and Next cache tags aren't namespaced | Prefix every key/tag with the tenant |
| OS-08 | **Uploads on local disk, one directory** | `UPLOADS_DIR` | Object storage with tenant prefixes + CDN |
| OS-09 | **Jobs are global** | Crons sweep every order/session/campaign | Tenant-aware job payloads, fairness, and per-tenant provider config |
| OS-10 | **Analytics tables have no tenant column** | PageView, FunnelEvent, SearchLog… | Tenant column + partitioning/retention |
| OS-11 | **Market assumptions baked in** | BD geography in `SHARED/schemas/order.ts`, BD phone normalization (`bdPhoneSchema`, `880` prefixes), `Address` shape (division/district/area), "Dhaka / Outside Dhaka" legacy fees, `en-BD` formatting, ৳ glyph font | Pluggable locale/market packs (address schema, phone rules, geography, formats) |
| OS-12 | **Brand as free text** | `Product.brand` string | `Brand` entity (and, for an OS, brand ≠ tenant: one tenant may sell many brands) |
| OS-13 | **Hardcoded storefront content** | FAQ/Terms/Privacy/Shipping pages in code | CMS pages per tenant |
| OS-14 | **Deployment** | One docker-compose stack, one nginx `server_name asifzone.com` | Wildcard/custom-domain routing, automatic TLS per domain |

### 30.3 Suggested abstraction seams (report only)
1. A `Store`/`Tenant` model owning all `*Setting` singletons → becomes the root FK.
2. A tenant context in the existing `observability/context.ts` AsyncLocalStorage (already carries the correlation id) → Prisma middleware/extension to inject `storeId`.
3. A provider registry (`payments`, `courier`, `sms`, `email`, `pixels`) behind interfaces; today's implementations become the "Bangladesh pack".
4. Move `packages/shared/src/engines` + `order-state` + `permissions` + `metrics` into a `@os/core` package with no app imports.
5. A market pack: geography + phone + address schema + currency/locale defaults.

---

## 31. Asif Zone-Specific Dependencies

| Dependency | Where | Notes |
|---|---|---|
| Domain `asifzone.com` / `www.asifzone.com`, Let's Encrypt paths | `docker/nginx/nginx.conf`, `docker/docker-compose.yml` (certbot renewal comment) | Hardcoded |
| GitHub repo `Tanvir660230/asifzone`, old hosting user `u139868009` | `deploy_vps.py` | Legacy |
| SKU prefix default **"AZ"** and example "AZ-…" | `CatalogSetting.skuPrefix` default, `SHARED/sku.ts`, `catalog/sku/page.tsx` | Default only (editable) |
| Placeholder "e.g. Asif Zone Originals" | `product-form.tsx:250`, `product-wizard/steps.tsx:88` | Cosmetic |
| Monogram example comment "Asif Zone → AZ" | `header.tsx:17` | Comment only (logic is generic) |
| E2E fixtures use "\| Asif Zone" SEO titles and "Panjabi" products | `apps/web/e2e/*.spec.ts` | Tests |
| Product domain vocabulary: Panjabi, Pajama, Ator, Cap, Tasbih, Islamic products (prayer mats), fragrance (attar) | `schema.prisma` comments, `seed-presets.ts`, `SHARED/config/product-types.ts`, bundles copy, banner/bundle form placeholders, cart page copy | Brand/market flavored |
| Bangladesh market: BD geography dataset, `01XXXXXXXXX` phone format, `880` prefixes, BDT/৳, `Asia/Dhaka`, `en-BD` | `SHARED/schemas/order.ts`, `SHARED/schemas/common.ts`, `lib/sms.ts`, `meta/capi.ts`, `format.ts`, `money.ts`, defaults | Market-specific |
| Bangladesh providers: SSLCommerz, EPS-PG, Steadfast, BulkSMSBD; bKash/Nagad references | payments, courier, SMS modules; payment badges | Market-specific |
| Dhaka-centric copy: "Inside Dhaka 1–2 business days / Outside 3–5" | FAQ, shipping-returns pages | Hardcoded content |
| Live EPS merchant credentials | `AsifZone Eps/Live_Credentials(AsifZone)` | Untracked local folder |
| Package scope `@clothing-brand/*`, DB name `clothing_brand` | everywhere | Generic name, not Asif-specific |
| Admin console label "Store Console" | sidebar/login | Generic (not branded) |

**Conclusion:** the application code is ~95% brand-neutral. Asif Zone is coupled mainly through infrastructure config (nginx/domain), defaults (SKU prefix), seed/test data, hardcoded content pages, and above all the **Bangladesh market layer** (geography, phone, currency, providers).

---

## 32. Recommended Future Improvements (prioritised, no changes made)

**P0: correctness/business risk**
1. Enforce `isBlocked` at checkout, login/OTP, reviews and returns, or rename it to make clear it's informational (BRK-01/SEC-01).
2. Remove the OWNER default on `AdminUser.role` (SEC-02).
3. Add a Content-Security-Policy for the web app, and a consent banner wired to `hasAdTrackingConsent()` (SEC-03, SEC-10).
4. Make the category stock endpoint admin-only, or reduce it to in/out-of-stock flags (SEC-05).
5. Move the live EPS credentials out of the OneDrive-synced tree (SEC-11).

**P1: operability & merchant self-service**
6. Admin UI for shipping zones/rates/free-shipping threshold and tax mode (INC-02/03).
7. An "Ops" admin page over the hidden reliability/outbox/ledger/read-model endpoints (INC-09).
8. Per-admin notification read state + permission-aware notification types (UX-13, SEC-14).
9. A CMS for FAQ/Terms/Privacy/Shipping content (UX-08).
10. Rebuild or explicitly retire abandoned-cart recovery (INC-01) and drop `reminderSentAt` if retired.
11. Data retention/rollups for PageView/FunnelEvent/SearchLog/ProductViewLog/AuditLog/Notification (PERF-14).

**P2: performance at scale**
12. Push customer-list filtering/sorting/pagination into SQL aggregates (PERF-01).
13. Pre-aggregate daily metric facts so the lifetime/overview pages don't load every order (PERF-02).
14. Consolidate the dashboard's 29 queries into 1–3 composite endpoints (PERF-03).
15. Rate-limit or de-duplicate SearchLog writes on the public product search (PERF-05).
16. Move uploads to S3-compatible storage + CDN (PERF-09, OS-08).

**P3: UX/maintainability**
17. Pick one product editor (the wizard), then retire or merge the classic form (UX-01).
18. Rename "Variant options" vs "Product fields" to end the "Attributes" ambiguity (UX-02).
19. Split the very large pages/components (orders list, order panel, customers, dashboard, checkout) (UX-03).
20. Hide STAFF-forbidden actions using `adminCan` consistently (UX-05).
21. Delete dead code: DEAD-01…DEAD-11, legacy coupon endpoints, unused web wrappers. Run the expand/contract "contract" migrations (INC-10).
22. Update the README to the real state (BRK-05). Add `NEXT_PUBLIC_CLARITY_ID` to `.env.example`. Verify `ANTHROPIC_MODEL`.
23. Customer self-cancel for PENDING orders; order-status emails (UX-10, INC-13).

**P4: OS evolution** (see §30.3): tenant root model, tenant context + Prisma extension, provider registry, market packs, Brand entity, per-tenant credentials, namespaced caches, host-based routing.

---

## 33. Feature Count (quantitative summary)

Counts are of the **enumerated feature IDs** in this document. Each ID is a distinct, user- or system-meaningful capability. Endpoint and model counts are exact, from code.

| Group | Count | IDs |
|---|---:|---|
| Public website (storefront) features | **106** | PUB-01 … PUB-106 |
| Customer account features | **33** | CUS-01 … CUS-33 |
| Admin shell / team / content / support | **19** | ADM-01 … ADM-19 |
| Product & catalog management | **53** | PRD-01 … PRD-53 |
| Order management | **29** | ORD-01 … ORD-29 |
| Customer / CRM | **15** | CRM-01 … CRM-15 |
| Inventory | **11** | INV-01 … INV-11 |
| Payment | **17** | PAY-01 … PAY-17 |
| Delivery & courier | **13** | DEL-01 … DEL-13 |
| Marketing | **14** | MKT-01 … MKT-14 |
| Analytics & reporting | **21** | ANL-01 … ANL-21 |
| Notifications | **9** | NTF-01 … NTF-09 |
| AI | **6** | AI-01 … AI-06 |
| Settings | **17** | SET-01 … SET-17 |
| **Total enumerated meaningful features** | **363** | |

Cross-reference views of the same features:

| View | Count | Basis |
|---|---:|---|
| Frontend (storefront + account) features | 139 | PUB + CUS |
| Admin-facing features | ~200 | ADM + PRD + ORD + CRM + INV + ANL + SET + admin parts of PAY/DEL/MKT/AI (approx.) |
| Backend / business-logic features | ~95 | engines, state machine, ledger, outbox, jobs (10), consumers (4), identity, pricing, read model, reconciliation |
| Integration features | 19 integrations | §21 table |
| API endpoints (HTTP) | ~400 | 395 module routes + 2 v1 checkout + 3 app-level; 73 public |
| Analytics endpoints | 80 + 2 BI + 3 metrics | `analytics.routes.ts`, `bi.routes.ts`, `metrics.routes.ts` |
| Admin pages | 63 | 59 in `app/admin/(shell)` + 2 auth + invoice + preview frame |
| Storefront + account pages | 31 | `app/(storefront*)`, `app/account` |
| Background jobs / schedules | 10 | §3.4 |
| Database models / enums / migrations | 85 / 31 / 84 | `schema.prisma` |
| Permissions / roles | 36 / 2 (+customer, guest) | `SHARED/permissions.ts` |
| Order states / transition rules | 10 / 9 (T0–T8) | `SHARED/order-state.ts` |
| Reusable components | 20 UI primitives + ~84 admin + 70 storefront + 15 account + 10 orders + 4 analytics | `WEB/components` |
| Shared Zod schema modules | 34 | `SHARED/schemas` |
| Tests | 65 API test files, 15 Playwright specs | |
| Issues logged | UX 22 · Broken 6 · Incomplete 14 · Hidden 16 · Dead 11 · Perf 14 · Security 16 | §23–§29 |

**Needs Verification (summary):** runtime behavior of gateways/courier with real accounts; the `ANTHROPIC_MODEL` default; per-page visibility of STAFF-forbidden buttons; mobile overlap of fixed bars; accessibility/contrast; Cloudflare/rclone setup on the VPS; whether an external error reporter is registered; remaining readers of the legacy `product-types.ts`; whether `Order.trackingNumber/carrier` are still read.
