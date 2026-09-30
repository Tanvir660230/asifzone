# Target Architecture — Asif Zone Commerce OS

**Status:** Phase 0 design, 2026-09-28. Nothing here is implemented yet unless marked ✅.
**Read first:** [MASTER_ARCHITECTURE_AUDIT.md](MASTER_ARCHITECTURE_AUDIT.md) (evidence for every "today" statement) and [SSOT_REGISTRY.md](SSOT_REGISTRY.md) (the authority for every business fact).

This document is the contract for all later phases. If an implementation needs to deviate, change this document in the same pull request and say why.

---

## 1. Goals and non-goals

**Goals**
1. Asif Zone becomes a reliable production store: every money and stock number is correct and explainable.
2. The same codebase can launch a different store by **configuration only** (setup wizard, database settings, theme, product types, flags, provider credentials). No source edits.
3. One business fact → one source of truth → one rule → one canonical calculation → many consumers.

**Non-goals (for now)**
- Multi-tenant hosting of many stores in one database. The unit of deployment stays **one store per installation** (one database). This keeps every existing query valid and matches the self-hosted installer goal. A `storeId` column is *not* introduced.
- Multi-warehouse, multi-currency *per order*, and i18n of storefront copy. The design leaves room (currency and locale are settings; stock goes through one engine) but does not build them.
- Microservices. The system stays a modular monolith with a second process (worker).
- Rewriting the catalog configuration system, payment sessions, or the storefront UI (see audit §23).

## 2. Architectural rules (enforced by review, then by lint)

1. **Single writer.** Each table has exactly one owning domain service (listed in SSOT_REGISTRY). Other code calls that service; it never writes the table directly. Reads may be direct until Phase 3; afterwards, business-critical reads go through read models.
2. **Engines are pure.** Pricing, promotion, shipping, tax, order totals, inventory decisions, metrics predicates and rounding live in `packages/shared/src/engines/*` as pure functions: no Prisma, no `fetch`, no `Date.now()` (time is an argument). The API and the web app import the *same* functions.
3. **UI renders numbers, it does not derive them.** The web app displays prices, totals, stock states and metrics from API read models. The only client-side math allowed is formatting, and optimistic previews produced by calling a shared engine with server-provided inputs.
4. **Snapshots are facts.** `Order` money fields, `OrderItem` snapshots and `PaymentSession.checkoutPayload` are immutable history. They are never recomputed from live data. Anything a later calculation needs (e.g. whether shipping was waived, unit cost) must be snapshotted at write time.
5. **Every projection has a reconciler.** If a value is stored and also derivable, there is a read-only drift report and an explicit repair command. See SSOT_REGISTRY "Reconciliation".
6. **Side effects go through events.** A domain service commits its state change and an outbox event in one transaction. Notifications, audit, caches, analytics and search react to the event.
7. **Configuration over code.** Anything that differs between two stores (country, currency, zones, copy, colours, providers, enabled features) is data with a typed schema and a default.
8. **Additive first.** Schema changes follow expand → migrate → contract (§12).
9. **Context-preservation rule.** Before adding a field, calculation, service or endpoint, look it up in SSOT_REGISTRY. If the fact exists, reuse its authority. If a new projection is unavoidable, add a registry row (authority, writer, sync, reconciler) in the same PR.

## 3. Layered structure

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Clients: storefront, admin, customer account (apps/web) · mobile · agents     │
└──────────────────────────────▲───────────────────────────────────────────────┘
                               │  /api/v1 (OpenAPI, Zod DTOs, cookie or bearer)
┌──────────────────────────────┴───────────────────────────────────────────────┐
│ HTTP adapters  apps/api/src/modules/<feature>/{routes,controller}.ts           │
│   validate → call domain service or read model → map DTO                       │
├──────────────────────────────────────────────────────────────────────────────┤
│ Read models    apps/api/src/read-models/*  (ProductView, CartQuote, OrderView, │
│                MetricValue) — compose domain data + engine output              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Domain services apps/api/src/domain/<context>/*.service.ts                     │
│   the only writers of their tables; open transactions; append outbox events    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Engines (pure)  packages/shared/src/engines/*   ◀── also imported by apps/web  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Infrastructure  Prisma · Redis cache · outbox · providers/* · config service   │
└──────────────────────────────────────────────────────────────────────────────┘
                 worker process (same image, `node dist/worker.js`):
                 outbox dispatcher · schedulers · provider sync · aggregations
```

### Target directory layout

```
apps/api/src/
  domain/
    catalog/        product.service.ts, catalog-config.service.ts, category.service.ts
    pricing/        pricing.service.ts (resolver: loads inputs, calls engines)
    promotion/      coupon.service.ts, bundle.service.ts, flash-sale.service.ts
    inventory/      inventory.service.ts (the ONLY stock writer)
    orders/         order.service.ts, order-state-machine.ts, checkout.service.ts
    payments/       payment.service.ts, refund.service.ts
    fulfilment/     courier.service.ts, return.service.ts
    customers/      customer.service.ts, loyalty.service.ts
    content/        homepage.service.ts, banner.service.ts, redirect.service.ts
    marketing/      campaign.service.ts, segment.service.ts
    config/         config.service.ts, feature-flags.ts, theme.service.ts
  read-models/      product-view.ts, cart-quote.ts, order-view.ts
  metrics/          registry.ts, sql-fragments.ts, metrics.service.ts
  events/           outbox.ts, event-types.ts, dispatcher.ts, subscribers/*
  providers/        payment/, courier/, sms/, email/, storage/, fraud/  (+ registry.ts)
  modules/          (existing HTTP adapters, thinned over time)
  worker.ts         (new entrypoint)
packages/shared/src/
  engines/          money.ts, rounding.ts, pricing.ts, promotion.ts, shipping.ts,
                    tax.ts, order-totals.ts, order-state.ts, inventory-rules.ts,
                    metrics-definitions.ts
  schemas/          (existing Zod, becomes the OpenAPI source)
```

Existing files move gradually. A module is "migrated" when its routes call only domain services/read models and it has no Prisma writes of its own.

## 4. Bounded contexts and ownership

| Context | Owns (single writer) | Publishes | Consumes |
|---|---|---|---|
| Catalog | Product, ProductVariant (except `stock`), images, type/template/attribute config, sections, relations, Category | ProductPublished/Unpublished/Updated, PriceChanged, ProductTrashed | ReviewApproved (rating projection) |
| Pricing | — (stateless resolver) | — | Catalog, Promotion, Config |
| Promotion | Coupon*, Bundle*, FlashSale* | FlashSaleStarted/Ended, CouponRedeemed/Released | OrderPlaced/Cancelled |
| Inventory | `ProductVariant.stock`, StockMovement, StockAlert | StockChanged, StockLow, StockReplenished | OrderPlaced/StatusChanged, ReturnApproved, manual adjustments |
| Orders | Order, OrderItem, OrderStatusHistory, CourierLossEvent | OrderPlaced, OrderStatusChanged (+ typed aliases), OrderTrashed/Restored | PaymentSucceeded, CourierStatusReported |
| Payments | PaymentSession, Payment, PaymentEvent, Refund, `Order.paymentStatus` projection | PaymentSucceeded/Failed, RefundRecorded | OrderPlaced |
| Fulfilment | courier fields on Order (via Orders API), ReturnRequest | CourierStatusReported, ReturnRequested/Approved/Rejected | OrderStatusChanged |
| Customers | Customer, Address, auth tokens, RewardPointsEntry, Cart mirror, Wishlist, PushSubscription | CustomerCreated/Updated/Merged, PointsAwarded/Reversed | OrderStatusChanged, RefundRecorded |
| Reviews | ProductReview | ReviewApproved/Rejected/Deleted | — |
| Content | HomepageSection, Banner, SocialLink, Redirect, GlobalSection | ContentChanged | ProductSlugChanged |
| Marketing | Segment, Campaign, CampaignRecipient, SmsTemplate, Newsletter | CampaignSent | — |
| Analytics | PageView, FunnelEvent, SearchLog, ProductViewLog, (later) fact tables | — | all events |
| Config | settings tables, FeatureFlag, Theme, ProviderConfig, InstallationState | ConfigChanged | — |
| Identity | AdminUser, AdminInvite, RefreshToken, (later) Role/Permission, ApiKey | — | — |

## 5. Central calculation engines

All engines work in **integer minor units** (`Money = { amount: number /* minor units */, currency: string }`) to end the mix of `Decimal`, string and float in today's code. Conversion happens at the DTO boundary. Rounding policy comes from `CommerceSettings` (§7).

### 5.1 Pricing pipeline (derived from current behaviour)

> **Phase 2 status:** implemented. The "Today" columns below describe the pre-Phase-2 code and are kept as the
> audit trail. The implemented engines, consumers and remaining gap (a `minSellingPrice` projection for storefront
> filter/sort) are in §16b, [PRICING_PIPELINE.md](PRICING_PIPELINE.md) and [PRICING_INVARIANTS.md](PRICING_INVARIANTS.md).

Current order of operations, reconstructed from `cart-lines.ts`, `flash-sale-pricing.ts`, `coupon.service.ts`, `bundle.service.ts` and `order.service.deriveOrderPricing`:

| Step | Today | Target rule |
|---|---|---|
| 1 List price | `variant.price ?? product.basePrice` | same — `listPrice(variant, product)` |
| 2 Compare-at | `variant.compareAtPrice ?? (variant.price ? null : product.compareAtPrice)` (UI only) | engine function; server-resolved |
| 3 Flash sale | `% or fixed off list price`, rounded 2 dp, floor 0; one sale per product (overlapping sales: last row wins, nondeterministic) | same maths; **deterministic tie-break** (best price for customer, then earliest `endsAt`); honours `FlashSaleItem.stockLimit` (decision D4) |
| 4 Line total | `unit × qty` | same |
| 5 Subtotal | Σ lines (post-flash) | same |
| 6 Coupon | on eligible lines (scope) using post-flash prices; % rounded to whole units; capped by `maxDiscountAmount` and eligible amount; FREE_SHIPPING sets a flag | same, rounding from settings |
| 7 Bundle | on matched categories; post-flash since Phase 1 (D2); side by side with the coupon | applied **before** the coupon (D9) |
| 8 Discount clamp | `min(coupon + bundle, subtotal)` | same, and record the split (`couponDiscount`, `bundleDiscount`) |
| 9 Tax | not applied anywhere (`Product.taxRate`, `StoreSetting.taxEnabled/defaultTaxRate` unused at checkout) | `TaxEngine` with mode `INCLUSIVE` (default, preserves today) or `EXCLUSIVE`; snapshot `taxAmount` (decision D3) |
| 10 Shipping | `isInsideDhaka(district) ? fee A : fee B`; waived by FREE_SHIPPING (fee still stored) | `ShippingEngine` over configured zones/rates; snapshot `shippingWaived` |
| 11 Total | `subtotal − discount + (waived ? 0 : shipping)` | `OrderTotalsEngine.total()` — the only implementation |
| 12 Post-order adjustment | `adjustOrderPrice` re-derives total, reading the live coupon type | uses `OrderTotalsEngine` with snapshotted `shippingWaived`; never reads live promo data |

Engine signatures (sketch):

```ts
// packages/shared/src/engines/pricing.ts
export function resolveUnitPrice(input: {
  variant: { price: Money | null; compareAtPrice: Money | null };
  product: { basePrice: Money; compareAtPrice: Money | null };
  flash: FlashOffer | null;            // already resolved & tie-broken
  rounding: RoundingPolicy;
}): { list: Money; selling: Money; compareAt: Money | null; appliedFlash: FlashOffer | null };

// promotion.ts
export function evaluateCoupon(coupon: CouponRule, lines: PricedLine[], ctx: CouponContext): CouponResult; // ctx carries usage counts, first-order flag, now
export function evaluateBundles(bundles: BundleRule[], lines: PricedLine[]): BundleResult | null;

// shipping.ts
export function resolveShipping(zones: ShippingZone[], address: Address, cart: CartSummary): { zoneId: string; fee: Money };

// order-totals.ts
export function computeOrderTotals(i: {
  lines: PricedLine[]; couponDiscount: Money; bundleDiscount: Money;
  shipping: Money; shippingWaived: boolean; tax: TaxResult; priceAdjustment: Money;
}): { subtotal: Money; discount: Money; shippingCharged: Money; tax: Money; total: Money };
```

API resolver: `domain/pricing/pricing.service.ts` loads variants, active flash offers, coupon, bundles, settings and zones, calls the engines, and returns a `Quote`. **Every** consumer uses it:

| Consumer | Today | Target |
|---|---|---|
| Product detail / listing / search / homepage flash feed | `withFlashSaleInfo` on `basePrice` | `ProductView.variants[].price` from `resolveUnitPrice`; product-level `priceRange {min,max}` |
| Cart drawer & cart page | localStorage price | `POST /api/v1/checkout/quote` (ids + qty in, priced lines out) |
| Checkout summary | client math | same quote, including coupon, bundle, shipping, tax, total |
| Order creation (COD, gateway initiation, admin manual order) | `deriveOrderPricing` | `PricingService.quote()` then persist snapshot |
| Price adjustment | bespoke formula | `computeOrderTotals` with snapshot inputs |
| Exchange orders | bespoke (regular price, no refund on downgrade) | `PricingService.quoteExchange()` at the current effective price (D6) |
| Invoice / order view / exports | read snapshot | read snapshot (unchanged) |
| Analytics | snapshot fields | via metrics registry |
| Storefront facets & price filter/sort | `basePrice` | a maintained `Product.minSellingPrice` projection (or view) refreshed on price/flash events — **done in Phase 3** as `ProductReadModel` (§16c) |

### 5.2 Inventory model

**Decision:** the `StockMovement` ledger is the **authoritative history**; `ProductVariant.stock` is the **transactional balance** (a materialised projection) that exists so checkout can do an atomic conditional decrement. The invariant `stock = Σ ledger.change` must always hold. Both are written only by `InventoryService`, in the same transaction, never separately.

```ts
// domain/inventory/inventory.service.ts — the only code allowed to touch ProductVariant.stock
reserveForOrder(tx, orderId, lines, { allowOversell })     // ORDER movements; conditional decrement
releaseForOrder(tx, orderId, reason)                        // CANCELLATION; idempotent per (orderId, variantId)
restockReturned(tx, orderId, [{orderItemId, qty}], reason)  // RETURN; bumps OrderItem.returnedQuantity; caps at sold − already returned
adjust(variantId, delta, reason, actor, note)               // RESTOCK/ADJUSTMENT/CORRECTION; relative deltas only
setCount(variantId, counted, actor, note)                   // stock-take: computes delta inside the txn under row lock
```

Rules:
- **Idempotency:** a release/restock for an order line can never exceed what was taken for it. Computed from the ledger (`Σ movements where orderId = X and variantId = Y`), not from order status.
- **No absolute writes** from forms. The product form sends either a delta or an expected-previous value (optimistic concurrency); a mismatch returns 409.
- **Movement reasons** (additive enum values): `ORDER`, `CANCELLATION`, `RETURN`, `EXCHANGE_OUT`, `EXCHANGE_IN`, `ORDER_DELETED`, `RESTOCK`, `ADJUSTMENT`, `STOCK_TAKE`, `OPENING_BALANCE`. Existing rows keep their reason.
- **Availability** (`InventoryRules.availableToSell`) = `stock` if `trackInventory`, else ∞ (decision D5); variant inactive / product not purchasable ⇒ 0.
- **Low stock** = `trackInventory && available ≤ product.lowStockThreshold` — the only definition; used by alerts, dashboard, reports.
- **Events:** `StockChanged` after every movement; `StockLow` when crossing the threshold downward; `StockReplenished` when crossing 0 upward (drives back-in-stock emails from *any* path).
- **Reservations for gateway payments** remain out of scope (today: no hold, oversell-with-alert at settlement). Revisit in Phase 10 if oversell alerts occur.

### 5.3 Order state machine

✅ Phase 1. Full specification: [ORDER_STATE_MACHINE.md](ORDER_STATE_MACHINE.md). The transition table lives in `packages/shared/src/order-state.ts` (pure, shared with the admin UI, which only offers legal targets) and is enforced by one transactional function in the order service; every caller (admin, bulk, courier, returns, gateway settlement) goes through it.

Key Phase 1 semantics (superseding the sketch in the Phase 0 draft):
- Pre-shipment statuses move freely among themselves; closed statuses (`CANCELLED`, `RETURNED`, `REFUNDED`) never reopen. No "reopen" command exists in Phase 1.
- `REFUNDED` remains an order status for compatibility but has **no stock effect** and requires a recorded refund (`paymentStatus = REFUNDED`) first.
- `RETURNED` always restocks (idempotently), whichever path sets it.
- COD `DELIVERED` sets `paymentStatus = PAID` (D1).

### 5.4 Payment state

`paymentStatus` remains a projection owned by the Payments context:

`UNPAID → PAID` (Payment SUCCEEDED, or COD collected on DELIVERED — decision D1), `UNPAID → FAILED` (last attempt failed), `PAID → PARTIALLY_REFUNDED → REFUNDED` (additive enum value; computed from Σ `Refund.amount` vs. amount paid). Only `PaymentService` writes it (including the manual "mark paid" for admin orders, which becomes a `Payment` row with provider `MANUAL`).

✅ **Phase 4** implements this as the Payment Ledger ([PAYMENT_LEDGER.md](PAYMENT_LEDGER.md), §16d). Every settlement is
a `Payment` row: gateway, `COD` collected at delivery, or `MANUAL`. Refunds are `Refund` rows (`REQUESTED → COMPLETED`).
The pure engine `derivePaymentPosition` (`packages/shared/src/engines/payment-ledger.ts`) derives the status, the
balance due, the cash to collect on delivery, the refundable amount and the refund due. `domain/payments/payment-ledger.service.ts`
is the only writer of `Payment`, `Refund` and the `Order.paymentStatus` projection.

### 5.5 Customer and product metrics engines

- `CustomerMetrics` (spend, order count, AOV, last order, RFM, tags) computed from the metrics registry predicates, not ad-hoc filters. Later materialised to `CustomerStats` updated by events.
- `ProductMetrics` (units sold 7/30 days, views, conversion) from the same predicates; urgency signals and admin sales panel use the same function (today they share `NOT_A_SALE`, which diverges from analytics).
- Reward points (D8): earned on `OrderDelivered` from merchandise value after discounts, excluding shipping; reversed by a negative `RewardPointsEntry` on return/refund of that merchandise.

## 6. Event architecture

**Outbox table (additive):**

```prisma
model DomainEvent {
  id            String   @id @default(cuid())
  type          String            // "order.placed", "stock.changed", ...
  aggregateType String            // "Order", "ProductVariant", ...
  aggregateId   String
  payload       Json
  version       Int      @default(1)
  occurredAt    DateTime @default(now())
  dispatchedAt  DateTime?
  attempts      Int      @default(0)
  lastError     String?
  @@index([dispatchedAt, occurredAt])
  @@index([aggregateType, aggregateId])
}
```

- Written with `tx.domainEvent.create` inside the same transaction as the state change → no lost or phantom events.
- Dispatcher (worker) polls undelivered rows (or is nudged via a BullMQ job), fans out to subscribers, marks `dispatchedAt`. Subscribers are idempotent, keyed by `(eventId, subscriber)` in a `EventDelivery` table.
- Retention: dispatched events kept 90 days (configurable), then archived/deleted by a job.

**Initial event catalogue** (payloads carry ids plus the facts subscribers need; never whole rows):

| Event | Emitted by | Subscribers |
|---|---|---|
| `product.created/updated/published/unpublished/trashed/restored` | Catalog | cache+ISR invalidation, search index, audit, sitemap |
| `product.price_changed` | Catalog | wishlist price-drop email, `minSellingPrice` projection, cache |
| `flash_sale.started/ended/changed` | Promotion (worker scheduler) | cache+ISR, `minSellingPrice` |
| `order.placed` | Orders | admin bell, admin SMS, customer SMS/email, cart-mirror clear, fraud check, analytics |
| `order.status_changed` (+ `order.confirmed/packed/shipped/delivered/cancelled/returned` aliases) | Orders | customer SMS, loyalty, courier-loss, audit, analytics |
| `payment.succeeded/failed`, `refund.recorded` | Payments | order projection, emails, loyalty reversal, cancelled-but-paid alert |
| `stock.changed`, `stock.low`, `stock.replenished` | Inventory | admin alert, back-in-stock email, cache |
| `review.approved/rejected/deleted` | Reviews | rating projection, cache |
| `customer.created/updated/merged` | Customers | segments, analytics |
| `config.changed` | Config | settings cache, ISR `layout` tag |

`notify()`, `recordAudit()`, `sendCustomerOrderSms()`, `sendPaymentConfirmationEmail()`, `notifyBackInStock()`, `notifyPriceDrop()`, `invalidateCache()` become subscribers. The generic `auditMiddleware` stays as a request log until every mutation emits a domain event, then is reduced to security-relevant requests.

## 7. Configuration architecture

A `ConfigService` is the single read path for settings (cached in Redis, busted by `config.changed`). Storage evolves additively:

| Table (new unless noted) | Holds | Public? |
|---|---|---|
| `StoreSetting` (existing) | kept as storage for current fields during migration | public fields only |
| `StoreProfile` | name, legal name, tagline, logos, favicon, contact, address, social default, email branding | public |
| `CommerceSettings` | country, currency, currency display, locale, **timezone**, weight/dimension units, price rounding (minor units, cash rounding for discounts), tax mode, phone-number rule set | public subset |
| `ShippingZone` + `ShippingZoneMatch` + `ShippingRate` | zones matched by country/division/district/postcode rules; flat/weight/free-over rates; courier return-fee estimate per zone | rates public |
| `GeoRegion` | the administrative hierarchy used by address forms (seeded "Bangladesh: 8 divisions, 64 districts, areas" from today's `packages/shared` lists) | public |
| `FeatureFlag` | `key`, `enabled`, `config Json`, `updatedBy` | public subset |
| `ContentBlock` | keyed rich content: trust badges, policy pages (privacy, terms, shipping-returns, FAQ), checkout notes, email footer | public |
| `ThemeSettings` | design tokens JSON + layout variants (§8) | public |
| `ProviderConfig` | per provider: kind, key, enabled, mode (sandbox/live), encrypted credentials, display name, sort order (§10) | admin only |
| `InstallationState` | `status` (NEW/CONFIGURING/READY), `installedAt`, schema/seed pack versions | internal |

Encryption: credentials encrypted with AES-256-GCM using a `CONFIG_ENCRYPTION_KEY` generated by the installer; env vars remain a supported override (so today's deployment keeps working unchanged).

**Feature flags (initial keys):** `wishlist`, `reviews`, `coupons`, `bundles`, `flash_sales`, `campaigns`, `sms`, `email_marketing`, `web_push`, `ai_assistant`, `customer_accounts`, `guest_checkout`, `phone_otp_login`, `google_login`, `compare`, `recently_viewed`, `live_chat`, `analytics_tracking`, `meta_pixel`, `reward_points`, `returns`, `exchanges`, `courier_integration`, `delivery_score`. Payment providers are enabled through `ProviderConfig`, not flags. Enforcement: API guard middleware `requireFeature(key)` + web `useFeature(key)`; a disabled feature's routes return 404 and its UI does not render.

**Asif Zone seed**: a config pack reproduces today's behaviour exactly (Bangladesh geo, BDT, Asia/Dhaka, Dhaka-district zone at 60 / rest at 120, current trust badges and policy copy, all flags on). Phase 6 exit criterion is that the storefront renders byte-identical HTML from the seeded config.

## 8. Theme architecture

- `ThemeSettings.tokens` (validated by a Zod schema in `packages/shared`): colour scales (`ink`, `surface`, `accent`, `sale`, semantic success/warn/error), font families (Google Fonts allowlist), radius, shadow, container width.
- `ThemeSettings.layout`: variants for header (logo left/center), footer columns, product card (image ratio, badge position, quick-view on/off), product page (gallery left/right, sticky add-to-cart), checkout (one-page/multi-step).
- Runtime delivery: the root layout reads theme via `ConfigService` (tagged fetch `config`) and emits `:root { --color-ink-900: 17 17 17; … }`. `tailwind.config.ts` maps tokens to `rgb(var(--…) / <alpha-value>)`, so existing class names (`text-ink-900`, `bg-cream-50`) keep working. `packages/ui-tokens` becomes the *default theme* seed, not a build-time constant.
- Business logic never reads theme; theme never contains business rules (e.g. "show COD badge" is derived from provider config, not a theme switch).
- Homepage (`HomepageSection`) and product-page sections (`GlobalSection`/`TemplateSection`/`ProductSection`) are already data-driven and are kept as the content model.

## 9. Installer / self-hosted platform

```
platform init  (CLI in apps/api/scripts, also run by the installer container)
  ├─ generate secrets → docker/.env (JWT×3, POSTGRES_PASSWORD, REDIS_PASSWORD, REVALIDATE_SECRET,
  │                     STEADFAST_WEBHOOK_TOKEN, CONFIG_ENCRYPTION_KEY)  — never overwrites existing values
  ├─ ask domain + email for TLS → nginx config + certbot issue
  ├─ docker compose up postgres redis → prisma migrate deploy → seed system config (NEW state)
  └─ start api, worker, web, nginx
Browser → https://<domain>/setup  (only reachable while InstallationState != READY; one-time setup token printed by CLI)
  1 Store information      → StoreProfile
  2 Admin account          → AdminUser OWNER (installer never uses seed env passwords)
  3 Branding & theme       → logo, favicon, ThemeSettings preset
  4 Region                 → CommerceSettings (country pack: geo, phone rules, currency, timezone)
  5 Shipping               → ShippingZone/Rate (country pack default suggested)
  6 Catalog starter pack   → product types/templates/presets (Apparel, Fragrance, Watch, … or blank)
  7 Payments               → ProviderConfig (COD, SSLCommerz, EPS, …) + test connection
  8 Courier                → ProviderConfig (Steadfast, manual) + test connection
  9 Email / SMS / Push     → ProviderConfig + send test message
 10 Features               → FeatureFlag toggles
 11 Health checks          → DB, Redis, migrations current, worker heartbeat, uploads writable, TLS, provider pings
 12 Ready                  → InstallationState = READY, /setup disabled, admin redirected to dashboard
```

- `NEXT_PUBLIC_*` build-time values are removed from the per-store path: site URL, pixel ids, chat ids, Google client id, VAPID public key are served from config at runtime (server components read them; client code receives them through a small `/api/v1/public-config` payload). The Docker images become store-agnostic and can be published once.
- Upgrades: `platform upgrade` = pull images → backup → `migrate deploy` → restart → health check → rollback on failure.
- Backups: existing `docker/backup.sh` generalised; restore documented and rehearsed.

## 10. Provider abstraction

```ts
// apps/api/src/providers/payment/types.ts
export interface PaymentProvider {
  key: string;                                   // "sslcommerz" | "eps" | "cod" | "manual" | ...
  kind: "gateway" | "offline";
  capabilities: { refunds: boolean; webhooks: boolean; statusPolling: boolean };
  initSession(p: InitSessionParams, cfg: ProviderCredentials): Promise<{ redirectUrl: string; providerRef: string }>;
  verify(ref: string, cfg: ProviderCredentials): Promise<VerificationResult | null>;
  parseCallback(req: CallbackRequest): { attemptRef: string; outcome: "success" | "fail" | "cancel" };
  refund?(payment: PaymentRecord, amount: Money, cfg: ProviderCredentials): Promise<RefundResult>;
}
export interface CourierProvider { key; book(order); bookBulk(orders); status(consignmentId); parseWebhook(req); balance?(); }
export interface FraudCheckProvider { key; checkPhone(phone): Promise<DeliveryHistory>; }
export interface SmsProvider { key; send(to: string, body: string): Promise<void>; }
export interface EmailProvider { key; send(msg: { to; subject; html; text? }): Promise<void>; }
export interface PushProvider { key; send(sub, payload): Promise<void>; }
export interface StorageProvider { key; put(path, bytes, contentType): Promise<{ url: string }>; delete(path): Promise<void>; }
```

- Registry: `providers/registry.ts` maps `key → implementation`; `ProviderConfig` rows decide which are enabled and supply credentials. Checkout lists methods from enabled payment providers; admin toggles move from `StoreSetting.codEnabled/onlinePaymentEnabled/epsPaymentEnabled` to `ProviderConfig.enabled` (old columns read as fallback until contract phase).
- `Order.paymentMethod` / `PaymentSession.provider` are Prisma enums today. Migration: add `paymentMethodKey String?` / `providerKey String?`, dual-write, backfill from the enum, switch readers, keep the enum columns until the contract phase.
- Existing implementations become adapters with **no behaviour change**: `sslcommerz.service.ts`, `eps.service.ts`, `lib/steadfast.ts`, `lib/sms.ts` (BulkSMSBD), `lib/mailer.ts` (Resend + dev file fallback), `lib/push.ts`, local-disk uploads (`upload.service.ts`).
- Payment callback routes become `/api/v1/payments/:providerKey/:event`; old routes stay as aliases because gateways have them registered.

## 11. Metrics architecture

`apps/api/src/metrics/registry.ts` defines each metric once:

```ts
defineMetric({
  id: "net_sales",
  label: "Net sales",
  unit: "money",
  basis: "order.createdAt",            // or "refund.completedAt", "payment.settledAt"
  predicate: SALE_ORDER,               // shared SQL fragment + Prisma where
  measure: sql`SUM(o.total) - COALESCE(SUM(r.amount), 0)`,
  timezone: "store",                   // CommerceSettings.timezone
});
```

✅ **Phase 5** implements this as the metrics registry ([METRICS_REGISTRY.md](METRICS_REGISTRY.md), §16e). The table below stays the
approved source of the definitions; realised revenue's refund term is pending PD-5.1.

**Canonical definitions** (D1 approved; implementation in Phase 5):

| Metric | Definition |
|---|---|
| `SALE_ORDER` predicate | `deletedAt IS NULL AND status <> 'CANCELLED'` and not an exchange replacement order |
| Orders (placed) | count of `SALE_ORDER` by `createdAt` — an operational count, **not** revenue |
| Gross sales | Σ `OrderItem.priceSnapshot × quantity` of *realised* orders (COD: reached `DELIVERED`/`PARTIALLY_DELIVERED`/`RETURNED`; online: `paymentStatus` reached `PAID`), by realisation date |
| Discounts | Σ `Order.discount` (coupon + bundle split via snapshot) of realised orders |
| Returns | Σ value of returned units (`returnedQuantity × priceSnapshot`, pro-rated discount), by return date |
| Refunds | Σ `Refund.amount` where `status = COMPLETED`, by `completedAt` |
| Realised revenue | Gross sales − Discounts + shipping charged + adjustments − Returns − Refunds not already counted as returns |
| Collected cash | Σ successful `Payment.verifiedAmount` + COD totals of delivered orders − refunds paid out |
| Outstanding COD | Σ `total` of COD orders placed and not yet delivered, cancelled or returned |
| AOV | Realised revenue ÷ realised orders |
| Units sold | Σ (`quantity − returnedQuantity`) over realised orders |
| COGS | Σ units × `OrderItem.unitCostSnapshot` (new snapshot column; historical rows fall back to current cost, flagged "estimated") |
| Gross profit | Realised revenue − COGS − courier loss |
| VAT (inclusive) | `taxIncludedIn(taxable amount, rate)` = `amount × r / (100 + r)` |
| Conversion rate | sessions with a `SALE_ORDER` ÷ sessions with ≥1 PageView |
| Stock value | Σ `stock × cost` over purchasable variants |
| Low-stock count | variants matching `InventoryRules.isLowStock` |
| Customer retention / repeat rate | customers with ≥2 `SALE_ORDER`s ÷ customers with ≥1 |

All surfaces — orders KPI strip, dashboard, BI, analytics pages, customer drawer, product sales panel, urgency signals, CSV exports — call `MetricsService`. Phase 5 adds `DailySalesFact`/`DailyProductFact` tables built by the worker from events, with a nightly full rebuild as reconciliation.

## 12. Migration plan (ordered)

Each step is one PR, additive unless marked **contract**. "Repair" scripts live in `apps/api/scripts/repair/`, default to dry-run, print before/after counts.

| # | Change | Type | Repair / backfill |
|---|---|---|---|
| M1 | Deploy runs `migrate deploy` in a one-shot container before `up -d` | CI | — |
| M2 | `StockMovementReason` += CANCELLATION, EXCHANGE_OUT, EXCHANGE_IN, ORDER_DELETED, STOCK_TAKE, OPENING_BALANCE | additive enum | — |
| M3 | `ProductVariant.stockVersion Int @default(0)` for optimistic stock edits | additive | — |
| M4 | Repair: stock drift report → reviewed → `OPENING_BALANCE`/`CORRECTION` movements to reconcile ledger with physical counts | script | owner approves counts |
| M5 | Repair: set `OrderItem.returnedQuantity` for orders restocked via return approval; detect over-restocked lines | script | report only first |
| M6 | `FlashSale.enabled Boolean @default(true)` (admin switch); `isActive` becomes computed-and-cached; backfill `enabled = true` | additive | — |
| M7 | `Order.shippingWaived Boolean?`, `couponDiscount Decimal?`, `taxAmount Decimal?`, `OrderItem.unitCostSnapshot Decimal?` | additive, nullable | backfill `shippingWaived` from coupon type at order time where knowable; leave others null ("unknown") |
| M8 | `PaymentStatus` += PARTIALLY_REFUNDED; `PaymentProvider`/`PaymentMethod` string key columns | additive | backfill keys from enums |
| M9 | `DomainEvent`, `EventDelivery` | additive | — |
| M10 | Config tables (§7), `GeoRegion` seed from shared lists, `ThemeSettings` seed from ui-tokens, `ContentBlock` seed from current TSX copy | additive | Asif Zone config pack |
| M11 | `ProviderConfig` | additive | populated from env on first boot (env stays authoritative override) |
| M12 | Role/Permission tables, `ApiKey` | additive | map OWNER/STAFF to default roles |
| M13 | Fact tables for metrics | additive | full rebuild job |
| M14 | Backfill `Product.typeId` for any NULL rows | script | — |
| **C1** | drop `Order.paymentSessionKey`, `paymentTransactionId` | **contract** | only after M-series releases verified; requires explicit approval |
| **C2** | drop `Product.productType` enum column | **contract** | after all readers use `typeId`, one release with no readers |
| **C3** | drop `StoreSetting` columns superseded by config tables | **contract** | after config service is the only reader |

Post-migration verification after every step: counts of products, variants, orders, order items, customers, payments unchanged; invariant suite (audit §25) green; storefront smoke (home, category, PDP, cart, checkout COD) and admin smoke (order list, order detail, product builder) pass.

## 13. API architecture

- Mount the existing routers under **both** `/api` and `/api/v1` (same handlers). New endpoints only under `/api/v1`. Breaking changes require `/api/v2` for the affected resource.
- **OpenAPI** generated from `packages/shared` Zod schemas (`@asteasolutions/zod-to-openapi` or equivalent) in CI; published at `/api/v1/openapi.json`.
- **DTO mappers** per resource: Decimal → number (or minor-unit integer for `v1` money objects `{ amount, currency, formatted }`), no Prisma rows leaking.
- **Auth**: cookies stay for the web app; `Authorization: Bearer` accepted as fallback for customer and admin tokens; `ApiKey` (hashed, scoped, rate-limited) for server-to-server and agents.
- **CORS**: `WEB_ORIGINS` comma-separated allowlist (from config).
- **Errors**: one envelope `{ error: { code, message, details } }` (today `AppError` already close).
- **Idempotency**: `Idempotency-Key` header on `POST /checkout/orders` and refunds, stored for 24 h (generalises today's Redis session lock).
- New endpoints: `POST /v1/checkout/quote`, `GET /v1/public-config`, `GET /v1/metrics/:id`, `GET /health/ready`, `GET /v1/orders/:id/transitions`.

## 14. Worker architecture

- New entrypoint `apps/api/src/worker.ts`, same Docker image, second compose service `worker` (`command: node dist/worker.js`). API starts no schedulers when `RUN_JOBS=false` (default in compose once the worker exists).
- Moves: flash-sale activation, campaign scheduler/sender, courier sync, payment reconciliation, outbox dispatcher, notification senders (SMS/email/push with retry + backoff + dead-letter), analytics aggregation, reconciliation reports (nightly, results stored and shown in admin), cart-abandonment reminders (the missing `cart-recovery` job, using `Cart.reminderSentAt`), imports/exports for large files.
- BullMQ stays the scheduler/queue; Redis gets a healthcheck; the worker exposes a heartbeat key checked by `/health/ready`.

## 15. Security & RBAC target

- Permissions (`orders.read`, `orders.transition`, `orders.adjust_price`, `refunds.create`, `inventory.adjust`, `promotions.manage`, `campaigns.send`, `catalog.manage`, `settings.manage`, `analytics.read`, …) grouped into roles; OWNER = all. `requirePermission()` replaces `requireRole()`; initial role mapping preserves today's OWNER/STAFF behaviour exactly.
- `AdminUser.isActive` and role re-checked on refresh and on sensitive actions (refund, price adjustment, settings, provider credentials).
- Rate limiting backed by Redis (`rate-limit-redis`) so limits survive restarts and replicas.
- Secrets: provider credentials encrypted at rest; never returned by the API after save (masked).

## 16. Decisions from the store owner

**Approved 2026-09-28 (Phase 1 baseline):**

| ID | Decision | Applied in Phase 1 |
|---|---|---|
| D1 | **Revenue.** COD: placed / confirmed / shipped are *not* revenue; `DELIVERED` counts toward realised (gross) revenue; `RETURNED` reverses the returned amount; refunds subtract the refunded amount. Keep **Gross Sales, Discounts, Returns, Refunds, Realised Revenue, Collected Cash, Outstanding COD** as separate metrics. COD order creation is never cash collection. | State machine: COD becomes `PAID` on `DELIVERED`; returned units tracked per line (`returnedQuantity`); refunds stay in `Refund`. Metric definitions updated in §11; dashboards migrate in Phase 5. |
| D2 | **Bundle + flash sale.** Bundle discounts operate on the effective selling price after the flash sale unless an explicit promotion rule says otherwise. Target order: regular → variant → flash → bundle → coupon/other (central stacking) → final. | Bundle matched amount now uses the post-flash price. Coupon-vs-bundle sequencing unchanged (side by side) — see [PRICING_PIPELINE.md](PRICING_PIPELINE.md) §5. |
| D3 | **Tax.** Storefront prices are tax-inclusive. Preserve subtotal, taxable amount, tax/VAT component and total; never double-charge; never recalculate historical orders. | No change to charging (tax was never added). Shared `taxIncludedIn()` helper; analytics VAT estimate corrected from the exclusive to the inclusive formula. `Order.taxAmount` snapshot for new orders is Phase 2. |

**Approved 2026-09-28 (implementation in Phase 2):** full definitions and representation notes in
[BUSINESS_DECISIONS.md](BUSINESS_DECISIONS.md), the authoritative register.

| ID | Decision |
|---|---|
| D4 | Enforce `FlashSaleItem.stockLimit`; units beyond the limit use the normal effective selling price. |
| D5 | `trackInventory = false` = unlimited sellable availability; checkout never rejects for zero stock; stock/ledger still kept. |
| D6 | Exchanges priced at the current effective selling price at quote time; difference collected or refunded centrally. |
| D7 | Coupon usage released when an order is cancelled before shipping; never after shipping. |
| D8 | Reward points on merchandise value after discounts, excluding shipping; reversed on return/refund. |
| D9 | Bundle discount first, then coupon on the resulting eligible amount (List → Variant → Flash → Bundle → Coupon → Tax → Shipping → Total). |
| D10 | Shipping VAT-inclusive by default; configurable through the centralised tax configuration only. |

No business decision is pending. D3–D10 are implemented in Phase 2 (§16b); the live pipeline is
[PRICING_PIPELINE.md](PRICING_PIPELINE.md).

## 16a. Phase 1 scope and invariants

Phase 1 fixes financial, inventory and lifecycle correctness inside the existing module layout (no `domain/` restructuring yet). Specifications: [ORDER_STATE_MACHINE.md](ORDER_STATE_MACHINE.md), [INVENTORY_INVARIANTS.md](INVENTORY_INVARIANTS.md), [PRICING_PIPELINE.md](PRICING_PIPELINE.md).

**Flash sale lifecycle.** `FlashSale.enabled` (admin intent) is separated from the schedule window (`startsAt`/`endsAt`); `FlashSale.isActive` becomes a derived cache of *live* = `enabled ∧ startsAt ≤ now ≤ endsAt`, written only by the flash-sale service (on every admin write) and the scheduler. Pricing reads `enabled` + window directly, so a sale is live the moment its window opens, with no scheduler lag.

| Situation | Semantics |
|---|---|
| Scheduled activation | enabled sale whose window opens → live (scheduler refreshes `isActive`) |
| Manual activation | set `enabled = true`: live now if inside the window, *scheduled* if before it, *ended* if after it |
| Manual disable | `enabled = false` → not live immediately; the scheduler never re-enables it |
| Expired | `now > endsAt` → not live, whatever `enabled` says |
| Reactivation after expiry | move `endsAt` into the future (with `enabled` on) |
| Editing `startsAt`/`endsAt` | live state recomputed on save; `enabled` unchanged |
| Restart after manual disable | set `enabled = true` again (only an admin can) |

Before Phase 1 the admin API silently dropped any `isActive` it was sent (the Zod schema had no such field) and only the scheduler wrote it, so a running sale could not be switched off at all.

**Deleted products.** `purchasable = product.isActive (status PUBLISHED) ∧ product.deletedAt IS NULL ∧ variant.isActive`: one shared predicate (`isPurchasable` in `packages/shared`, `PURCHASABLE_PRODUCT_WHERE` for queries), enforced at checkout and order creation (incl. admin manual orders), exchanges, wishlist add/list, stock-alert subscribe/notify, flash-sale item add and homepage feed, and bundle evaluation. A stale cart line for a trashed product fails at checkout with "no longer available".

**Phase 1 invariants** (tested): order-state matrix enforced for every caller; INV-1..INV-7 in INVENTORY_INVARIANTS.md; `isActive = (status = PUBLISHED)`; `deletedAt ≠ null ⇒ not purchasable`; `FlashSale.isActive = enabled ∧ in window` after every write/scheduler tick; COD `DELIVERED ⇒ paymentStatus ∈ {PAID, REFUNDED}`; historical order money snapshots never rewritten.

## 16b. Phase 2 scope — central pricing & quote SSOT

**One pipeline.** Pure engines in `packages/shared/src/engines` (`money`, `rounding`, `availability`, `pricing`,
`promotion`, `shipping`, `tax`, `order-totals`, `quote`) — integer minor units, no I/O, no clock. The only
orchestrator is `apps/api/src/domain/pricing/pricing.service.ts` (`quoteCart`, `priceProductsForDisplay`), with
configuration loading in `domain/pricing/pricing-config.ts`. This is the first `domain/` module of the §3 layout;
the rest of the modules keep their Phase 1 layout.

**One quote.** `POST /api/v1/checkout/quote` (+ `/quote/best-coupon`), rate-limited 120/min, optional customer /
admin identity. Every money-bearing consumer uses it or the read model built from the same engines: storefront reads,
cart, checkout, COD orders, gateway initiation (snapshot frozen for settlement), admin manual orders, exchanges,
coupon validate/best, bundle preview, price adjustment (`computeOrderTotals` over the snapshot).

**New authorities (additive).** `TaxSetting` (tax mode/rate, D10 shipping VAT) and `ShippingZone` / `ShippingZoneMatch`
/ `ShippingRate` replace the legacy `StoreSetting` tax and shipping fields as the source pricing reads. The legacy
fields stay as dual-written mirrors with a drift check (`GET /api/settings/pricing-config-drift`). They go away in a
later contract step, not in Phase 2 (rule 9).

**Snapshots.** Orders created since Phase 2 carry `pricingVersion`, the flash/coupon split, `shippingWaived`, the
shipping zone, a full tax snapshot, per-line list price, flash attribution and discount allocations. Pre-Phase-2
orders keep NULLs where history was never recorded. Registry: [SSOT_REGISTRY.md](SSOT_REGISTRY.md) B2/B4.

**Stale prices.** Clients send `quoteToken`. A changed quote at order time → 409 `QUOTE_CHANGED` with the new quote.
The flash quota is re-checked under row locks. `Idempotency-Key` makes order creation retry-safe.

**Tax ⇄ shipping** is specified as a dependency graph ([PRICING_PIPELINE.md §1a](PRICING_PIPELINE.md)): merchandise tax
depends on merchandise only, shipping tax on the resolved shipping charge only, aggregated once; the total is computed
once by `computeOrderTotals`.

**Phase 3 / read-model follow-up:** *Create canonical Product.minSellingPrice projection/read model* (storefront
filter/sort and similar-price recommendations still read `basePrice`; they never determine a charged price).

**Not in Phase 2 (recorded):** the `minSellingPrice` projection above (PRICING_INVARIANTS §12); zone/rate admin
UI; configurable rounding policy (`CommerceSettings`); coupon `usedCount` drift report; invoices and analytics
switching to the tax snapshot (Phase 5 metrics).

## 16c. Phase 3 scope — Storefront Read Model

**One storefront product.** `apps/api/src/domain/storefront/read-model.service.ts` is the Storefront Read Model:
- `presentStorefrontProducts` builds the only storefront product DTO: canonical `pricing` from the Phase 2 engine,
  plus `availability` derived from canonical inventory state (D5).
- It is used by the listing, search, PDP, by-ids (compare, quick view, recently viewed, cart checks), trending,
  recommendations and rails, the homepage flash feed and the wishlist.
- The web renders `pricing` and `availability`; it computes neither (`lib/pricing-display.ts`,
  `lib/availability-display.ts`).

**`Product.minSellingPrice` is a projection, not a column of truth.** It lives in the additive table
`ProductReadModel`, written only by the read-model service from `priceProductsForDisplay` output. SQL reads it for
price sort, price filter, facet bounds and price-relative recommendations; it is never displayed.

**Freshness without new infrastructure.** A read-time guard recomputes every stale row before the projection is read,
so a listing never sorts by a stale row. A row is stale when:
- its content fingerprint of the price inputs changed,
- a clock boundary (`validUntil`) passed,
- it is `volatile` (a live, quantity-limited offer),
- or the currency or pricing version changed.

The guard is the correctness path. The eager paths (product and flash-sale write hooks, the minute cron and a 15-minute
full rebuild) only reduce work. Reconciliation: a drift report and a rebuild, both API and CLI. These hooks become
outbox subscribers when §6 lands. Details and the Step-1 audit: [STOREFRONT_READ_MODEL.md](STOREFRONT_READ_MODEL.md).

**Found and fixed along the way:**
- The homepage flash feed returned inactive variants.
- The wishlist returned products without server pricing, so its cards showed the base price during a flash sale.
- The compare bar, cart low-stock check and exchange picker ignored D5.

**Fixed at Phase 3 sign-off (Phase 1 code, one-line change):** `inventory.service.ts` wrote `"updatedAt" = NOW()` from
raw SQL while the DB session timezone is Asia/Dhaka. That stored local time in a column Prisma reads and writes as UTC.
It now writes `NOW() AT TIME ZONE 'UTC'` (INVENTORY_INVARIANTS INV-8). Rows written before the fix keep their old
stamp. The read model never relied on `updatedAt` (it uses a content fingerprint). Product-level "low stock" was
removed at sign-off because no rule approves it; low stock stays per variant.

## 16d. Phase 4 scope — Payment Ledger (order payment & refund SSOT)

**Why this phase.** The Phase 4 audit ([PHASE_4_AUDIT.md](PHASE_4_AUDIT.md)) found every remaining S1 defect in the
payment and refund truth:
- `Order.paymentStatus` had six direct writers and no derivation.
- COD collection, manual payments and free exchanges set `PAID` with no money record.
- Refunds were capped against the total, not against what was paid. A partial refund was stored as a full one and
  blocked any further refund.
- Exchange refunds (D6) could never be paid out.
- The courier's COD amount was recomputed five times as `COD ? total : 0`, so a prepaid COD order was collected twice.

Analytics (Phase 5) depends on these facts being right, so it follows.

**One ledger.**
- **Facts:** `Payment` (every settlement) and `Refund`.
- **Pure engine:** `derivePaymentPosition`, which derives paid, refunded, pending, balance due, `codToCollect`,
  refundable, refund due and status.
- **One writer:** `apps/api/src/domain/payments/payment-ledger.service.ts`, whose commands run under the order row lock.
- **Projection:** `Order.paymentStatus`, refreshed in the same transaction as the fact that changed it.
- **Architecture guard:** `payment-ledger-writer.guard.test.ts`.

**Consumers switched.**
- Gateway settlement: now atomic with the `PENDING → CONFIRMED` transition.
- T4 COD collection: now a `COD` payment of the balance due (D1 unchanged).
- Manual orders (`markPaid`) in the order's own transaction.
- Exchange downgrade refunds: completable.
- Courier booking and labels: send and show `codToCollect`.
- Admin order page: renders the position; one payment-status label map.
- The refund queue: one predicate.
- Price adjustment: refused once money was received (P4-1).

**Additive schema.** `PaymentStatus += PARTIALLY_REFUNDED`; `PaymentProvider += COD, MANUAL`; nullable
`Payment.paymentSessionId`; audit and idempotency columns. A backfill inserts settlement rows only where the order's
own record already asserts payment. A drift report and an explicit, dry-run-by-default repair fix the projection;
nothing rewrites an order.

**Not in Phase 4:** metrics built on this ledger (collected cash, outstanding COD, refunds): Phase 5. Gateway refund
APIs: Phase 7. Outbox events: Phase 8. Refund permissions: Phase 10.

## 16e. Phase 5 scope — Metrics & Analytics SSOT

**Why this phase.** The Phase 5 audit ([PHASE_5_METRICS_AUDIT.md](PHASE_5_METRICS_AUDIT.md)) traced 85 functions:
- About 40 private definitions of "a sale".
- Revenue computed as `Σ total` of placed orders (unrealised COD, no returns or refunds, trashed and exchange orders
  included).
- Bundle discounts counted twice.
- Tax estimated from the *current* rate.
- Flash attribution guessed from time windows.
- Customer spend computed three different ways.
- `stock ≤ 5` as the low-stock rule.
- A **measured 6-hour skew** in every raw-SQL time window: naive-UTC columns compared with `NOW()` or a bound
  `timestamptz` under an Asia/Dhaka session.

**One engine.**
- `packages/shared/src/metrics` (pure):
  - business time: store timezone, half-open ranges with inclusive business dates, DST-correct;
  - canonical facts and eligibility: `SALE_ORDER`, D1 realisation;
  - snapshot valuation: returns from the stock ledger, exchange units excluded;
  - the registry;
  - a contribution-based aggregator, so a total, a day series and a product/customer grouping are the same numbers cut
    differently.
- `domain/metrics`:
  - the only fact loader (Phase 2 snapshots, Phase 4 ledger, RETURN movements);
  - the service (validation, 60 s cache, groupings, `compare=previous`);
  - reconciliation;
  - the `SALE_ORDER` query form;
  - `utcInstant`.
- API: `GET /api/v1/metrics`, `/definitions`, `/consistency`.

**Consumers switched.**
- The dashboard, orders KPI strip, every BI page and the ~40 analytics reports are cuts of the engine; response shapes
  are kept.
- CRM spend / VIP tags / RFM use `customer_net_spend`.
- The payments overview.
- The admin product sales panel and storefront urgency/trending/FBT use `units_ordered`.
- Behavioural analytics keep their own facts, but every window goes through business time.
- The web renders server numbers only. BI overview totals are no longer summed in the browser, and business dates are
  never shifted through the viewer's timezone.

**Additive schema.** `StoreSetting.timezone` (default `Asia/Dhaka`). No metric projection tables: the store's volume
doesn't need materialisation, and the read-time loader selects only orders with an event in the range.

**Pending decision:** PD-5.1, the refund term of realised revenue. `net_sales` and `refunds` are shown side by side
until it's decided.

**Deferred:** see METRICS_REGISTRY and the Phase 5 report:
- `OrderItem.unitCostSnapshot` (exact COGS);
- category/brand snapshots;
- daily fact tables (TARGET M13);
- metrics outbox subscribers (Phase 8);
- the timezone/currency move into `CommerceSettings` (Phase 6);
- permission scoping of metrics (Phase 10).

## 17. Definition of done for each phase

Tests (unit + integration + e2e) green · `tsc --noEmit` for api, web, shared · `eslint` for api and web (added to CI in Phase 1) · `next build` · migrations applied to a copy of production + drift check · invariant suite green · reconciliation reports reviewed · this document, the audit and the SSOT registry updated · remaining risks listed in the phase's PR description.
