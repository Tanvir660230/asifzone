# Master Architecture Audit — Asif Zone → Commerce OS

**Phase 0 deliverable. Audit only: no application code, schema or migration was changed to produce this document.**

- Audited revision: `main` @ `35a9604` (2026-09-28), clean working tree.
- Method: read the Prisma schema in full, every API module's service layer for the money/stock paths, the storefront cart/checkout/product-page code, the admin order-entry page, all jobs, middlewares, deployment and CI files, the existing docs (`architecture-roadmap.md`, `product-catalog.md`, `product-management-report.md`, `product-builder-report.md`) and the recent commit history.
- Every finding cites a file, model, function, route or component. Line numbers are for `35a9604`.
- Companion documents: [TARGET_ARCHITECTURE.md](TARGET_ARCHITECTURE.md) (where we are going) and [SSOT_REGISTRY.md](SSOT_REGISTRY.md) (one row per business fact).

## Contents

1. Current architecture map
2. Module inventory
3. Database entity map
4. Domain boundaries
5. Current SSOT map
6. Duplicate / derived data map
7. Calculation duplication map
8. Data-flow map
9. API map
10. Caching map
11. Event / background-job map
12. Authentication / RBAC map
13. Deployment map
14. Testing map
15. Problems ranked by architectural risk
16. Recommended target architecture (summary)
17. Migration strategy
18. Installer architecture
19. Theme / configuration architecture
20. Provider abstraction architecture
21. Event architecture
22. Metrics architecture
23. What should NOT be rewritten
24. Phased implementation order
25. Verification strategy

---

## 1. Current architecture map

```
                         ┌────────────────────────── VPS (Docker Compose) ──────────────────────────┐
 Browser ── HTTPS ──▶ nginx ──▶ web  (Next.js 15, app router, ISR 60s + on-demand tags)            │
                         │        │  server components: fetch → api (lib/api/storefront.ts)          │
                         │        │  client components: React Query + apiFetch (cookies + CSRF)      │
                         │        ▼                                                                   │
                         └────▶ api  (Express 4, one Node process)                                   │
                                  ├─ 38 routers under /api/*  (no version prefix)                     │
                                  ├─ services → Prisma → PostgreSQL 16                                │
                                  ├─ Redis: read cache (config/redis.ts) + BullMQ (lib/queue.ts)       │
                                  ├─ 5 BullMQ workers/crons started inside the same process           │
                                  └─ outbound: SSLCommerz, EPS, Steadfast, BulkSMSBD, Resend,         │
                                     Web Push, Google Identity, Anthropic                             │
                          certbot (renewal loop)   postgres   redis   uploads volume (local disk)    │
                         └────────────────────────────────────────────────────────────────────────────┘
```

Monorepo (`pnpm` + `turbo`, [package.json](../package.json), [pnpm-workspace.yaml](../pnpm-workspace.yaml)):

| Package | Role | Size |
|---|---|---|
| [apps/api](../apps/api) | Express REST API, Prisma, jobs | ~24.7k lines in `src` (incl. tests) |
| [apps/web](../apps/web) | Next.js storefront + admin + customer account in one app | 69 admin route files, 73 storefront components, 84 admin components |
| [packages/shared](../packages/shared) | Zod schemas (33 files), shared types, pure helpers (completeness, SKU, sections, gallery, wizard steps, delivery, SMS templates, legacy product-type registry) | consumed by both apps via `dist/` |
| [packages/ui-tokens](../packages/ui-tokens) | Tailwind colour/font tokens (build-time JS) | 1 file |
| [packages/config](../packages/config) | shared `tsconfig` base | — |

Architectural style today: **a modular monolith organised by feature folder** (`apps/api/src/modules/<feature>/{routes,controller,service}.ts`). There is no separate domain layer; services call Prisma directly and call each other directly (e.g. `courier.service` → `order.service.updateOrderStatus`, `return-request.service` → `order.service`, `payment.service` → `order.service.insertOrderRecord`).

## 2. Module inventory

API modules ([apps/api/src/modules](../apps/api/src/modules)), mounted in [app.ts](../apps/api/src/app.ts):

| Module | Mount | Service LOC | Responsibility / notes |
|---|---|---|---|
| auth | `/api/auth` | 261 | Admin login (password + Google link), refresh rotation, invites |
| customers | `/api/customers` | 1071 | Customer auth (password, OTP, Google), profile, addresses, admin CRM, tags, risk, SMS ad-hoc sends, reward points, push subs, unsubscribe |
| categories | `/api/categories` | 393 | Tree, soft delete, stock rollups |
| attributes | `/api/attributes` | 118 | Legacy *variant option* system (Color/Fabric) |
| catalog | `/api/catalog` | 527 + presenter 186 | Product types, templates, attribute definitions, presets, sections, SKU settings |
| products | `/api/products` | 1931 + csv 635 + duplicate 228 + audit 171 | Product CRUD, status workflow, storefront listing/search/facets, recommendation rails, urgency signals, CSV import/export |
| orders | `/api/orders` | 1320 + cart-lines 58 | Checkout pricing, order creation, status changes, restock, price adjustment, partial delivery, soft delete |
| payments | `/api/payments`, `/api/payment-admin` | 573 + eps 304 + sslcommerz 118 + overview 151 | Payment sessions, settlement, reconciliation, refunds |
| payment-methods | `/api/payment-methods` | 82 | Payment *logo badges* (not providers) |
| coupons | `/api/coupons` | 320 | Coupon evaluation, best-coupon, atomic usage increment |
| bundles | `/api/bundles` | 169 | Category-anchored bundle discounts |
| flash-sales | `/api/flash-sales` | 170 + pricing 43 | Flash sale CRUD, activation sync, flash price |
| inventory | `/api/inventory` | 78 | Manual stock adjust, movement list, drift report |
| return-requests | `/api/return-requests` | 286 | Return/exchange requests and approval |
| courier | `/api/courier` | 471 (+ `lib/steadfast.ts` 283) | Steadfast booking, status sync, webhook, fraud check |
| reviews | `/api/reviews` | 155 | Reviews + moderation + rating projection |
| analytics | `/api/analytics` | **2990** | ~75 admin read endpoints, tracking beacons, CSV exports |
| bi | `/api/bi` | 319 | Executive overview, automated insights |
| campaigns | `/api/campaigns` | 299 | Segments, email/SMS/push campaigns |
| settings / sms-settings / sms-templates | `/api/settings` … | 53 / 35 / 31 | Singleton store config, SMS toggles/templates |
| homepage-sections, banners, social-links, redirects | … | 176 / 73 / 54 / 86 | Content & navigation |
| wishlist, cart, stock-alerts, newsletter, feedback, notifications, uploads, audit, ai | … | small | Supporting features |

Shared libs ([apps/api/src/lib](../apps/api/src/lib)): `mailer.ts` (Resend), `sms.ts` (BulkSMSBD), `push.ts` (web-push), `steadfast.ts`, `notify.ts` (admin bell rows), `audit.ts`, `order-sms.ts`, `order-mailer.ts`, `email-template.ts`, `queue.ts`, `csv.ts`, JWT/cookie/token helpers.

Web ([apps/web](../apps/web)): route groups `(storefront)`, `(storefront-detail)`, `account`, `admin/(shell|auth|preview-frame)`; client state in Zustand stores ([store/cart.ts](../apps/web/store/cart.ts), wishlist, compare, express-checkout …); server data via [lib/api/storefront.ts](../apps/web/lib/api/storefront.ts); admin/customer data via React Query over [lib/api-client.ts](../apps/web/lib/api-client.ts).

## 3. Database entity map

Source: [schema.prisma](../apps/api/prisma/schema.prisma) (1906 lines, 73 migrations, PostgreSQL). ~60 models grouped by context:

| Context | Models |
|---|---|
| Identity & access | `AdminUser`, `AdminInvite`, `RefreshToken`, `AuditLog` |
| Catalog (core) | `Category`, `Product`, `ProductVariant`, `ProductImage`, `VariantImage`, `ProductReview`, `ProductViewLog` |
| Catalog (configuration) | `ProductTypeDef`, `ProductTemplate`, `AttributeDefinition`, `AttributeDefinitionOption`, `TemplateAttribute`, `ProductAttributeValue`, `SpecGroup`, `SizeGuidePreset`, `CareGuidePreset`, `Material`, `ProductMaterial`, `CatalogSetting`, `SkuCounter`, `GlobalSection`, `TemplateSection`, `ProductSection`, `ProductFaq`, `ProductRelation` |
| Variant options (legacy) | `Attribute`, `AttributeValue`, `VariantAttributeValue` |
| Pricing & promotion | `Coupon`, `CouponProduct`, `CouponCategory`, `Bundle`, `BundleSuggestion`, `FlashSale`, `FlashSaleItem` |
| Inventory | `StockMovement` (ledger), `ProductVariant.stock` (balance), `StockAlert` |
| Orders & fulfilment | `Order`, `OrderItem`, `OrderStatusHistory`, `ReturnRequest`, `CourierLossEvent` |
| Payments | `PaymentSession`, `Payment`, `PaymentEvent`, `Refund` |
| Customers | `Customer`, `Address`, `RewardPointsEntry`, `PasswordResetToken`, `EmailVerificationToken`, `PhoneOtp`, `Cart`, `CartItem`, `WishlistItem`, `PushSubscription` |
| Marketing | `Segment`, `Campaign`, `CampaignRecipient`, `NewsletterSubscriber`, `SmsTemplate` |
| Analytics | `PageView`, `FunnelEvent`, `SearchLog`, `ProductViewLog` |
| Content & settings | `StoreSetting` (singleton), `SmsNotificationSetting` (singleton), `HomepageSection`, `Banner`, `SocialLink`, `PaymentMethodOption`, `Redirect`, `Feedback`, `Notification` |

Structural notes:
- `OrderItem.variantId`, `StockMovement.orderId`, `FunnelEvent.productId` and `ReturnRequest.orderItemId/requestedVariantId` are deliberately **not** foreign keys (history must outlive the catalog row). Consequence: every consumer joins manually (e.g. `attachLiveItemInfo`, [order.service.ts:398](../apps/api/src/modules/orders/order.service.ts#L398)).
- Three partial unique indexes exist only in raw migrations (one default address per customer, one PENDING return per order, one ACTIVE payment session per order) — documented in schema comments.
- Singletons: `StoreSetting`, `SmsNotificationSetting`, `CatalogSetting` (id `"singleton"`, lazily created).
- No tenant/store key on any table — single-store by construction (see `architecture-roadmap.md` §1).

## 4. Domain boundaries (as they exist)

| Context | Owning module(s) | Leaks across the boundary |
|---|---|---|
| Catalog | products, catalog, categories, attributes | Price & flash-price computed here too (`withFlashSaleInfo`); sales figures (`NOT_A_SALE`) computed here |
| Pricing/Promotion | flash-sales, coupons, bundles, `orders/cart-lines.ts` | No pricing module; the pipeline is assembled inside `orders/deriveOrderPricing` |
| Inventory | inventory (manual only) | Most stock writes live in `order.service`, `return-request.service`, `product.service` |
| Orders | orders | Owns stock restock rules, courier-loss ledger, reward-point trigger, SMS triggers |
| Payments | payments | Materialises Orders (`insertOrderRecord`) at settlement |
| Fulfilment | courier | Drives order status through `updateOrderStatus` |
| Customers | customers | Computes spend/tags/RFM used by analytics and BI |
| Analytics/BI | analytics, bi, payments-overview | Each re-derives order/revenue/stock rules in raw SQL |
| Content | homepage-sections, banners, social-links, redirects, settings | — |
| Marketing | campaigns, customers (ad-hoc SMS) | — |

The boundaries are **feature folders, not enforced contexts**: any service may import Prisma and write any table.

## 5. Current SSOT map (summary — full detail in [SSOT_REGISTRY.md](SSOT_REGISTRY.md))

| Fact | Authority today | Projection(s) | Writer discipline | Verdict |
|---|---|---|---|---|
| Product type | `Product.typeId → ProductTypeDef` | `Product.productType` (legacy enum mirror) | `product.service` only | Good; legacy nullable `typeId` still resolved by fallback |
| Product visibility | `Product.status` | `Product.isActive` (= status==PUBLISHED) | single writer in `product.service` ([L1369](../apps/api/src/modules/products/product.service.ts#L1369), [L1506](../apps/api/src/modules/products/product.service.ts#L1506), [L1780](../apps/api/src/modules/products/product.service.ts#L1780)) | Good — but `deletedAt` is a third, unsynchronised visibility axis (see R2) |
| Unit list price | `ProductVariant.price ?? Product.basePrice` | — | product service | Rule correct server-side, re-implemented 7+ times (§7) |
| Stock on hand | `ProductVariant.stock` (atomic counter) | `StockMovement` ledger (should sum to stock) | **5 modules** write both | At risk: known double-restock and lost-update paths (R1, R4) |
| Rating | `ProductReview (APPROVED)` | `Product.avgRating/reviewCount` | `review.service.recomputeProductRating` | Good; no reconciliation job |
| Delivery score | Steadfast `fraud_check` API | `Customer.delivery*` columns (cache) | `customer.service.checkAndUpdateDeliveryScore` | Acceptable (external truth cache) |
| Reward points balance | `RewardPointsEntry` ledger | `Customer.rewardPoints` | `customer.service` (2 paths) | Good discipline; no reversal on return/refund |
| Flash sale live | `FlashSale.startsAt/endsAt` **and** `isActive` | `isActive` flipped by cron | cron + admin both write `isActive` | Conflicting (R6) |
| Coupon usage | `Order.couponId` rows | `Coupon.usedCount` | incremented in order txn, never decremented | Two definitions (R7) |
| Order money | `Order.subtotal/discount/shippingFee/priceAdjustment/total` snapshot | — | `insertOrderRecord`, `adjustOrderPrice`, exchange creation | Correct as snapshot; formula duplicated (§7) |
| Payment state | `PaymentSession` + `Payment` + `Refund` | `Order.paymentStatus` | `syncOrderPaymentStatus` choke point + `refundOrderPayment` + `createManualOrder` | Mostly good; refund also representable as `Order.status=REFUNDED` |
| Revenue / AOV / units sold | none — recomputed per query | Redis caches (60–900 s) | n/a | **No canonical definition** (R5) |

## 6. Duplicate / derived data map

Master data vs. transaction snapshot vs. projection vs. cache:

| Field | Class | Justification | Sync mechanism | Drift detection |
|---|---|---|---|---|
| `Product.productType` | Legacy projection of `typeId` | rollback safety, stale clients | written with `typeId` in `createProduct/updateProduct` | none |
| `Product.isActive` | Projection of `status` | dozens of `isActive` filters | same write | none (single writer makes it safe) |
| `Product.avgRating`, `reviewCount` | Projection of `ProductReview` | listing performance | `recomputeProductRating` on moderate/delete | none |
| `ProductVariant.size/color` | Denormalised from `VariantAttributeValue`/template dims | storefront filters, carts, orders | product write path | none |
| `ProductVariant.stock` | Operational balance | atomic conditional decrement | written beside a `StockMovement` row (mostly) | `GET /api/inventory/reconciliation` ([inventory.service.ts:63](../apps/api/src/modules/inventory/inventory.service.ts#L63)), manual, read-only |
| `Customer.rewardPoints` | Projection of `RewardPointsEntry` | balance display | same txn as ledger row | none |
| `Customer.delivery*` | Cache of external API | avoid calling Steadfast per page | on checkout + bulk action | `deliveryScoreCheckedAt` timestamp |
| `Coupon.usedCount` | Counter | atomic usage-limit enforcement | `incrementCouponUsage` in order txn | none; `permanentlyDeleteCoupon` already distrusts it ([coupon.service.ts:310](../apps/api/src/modules/coupons/coupon.service.ts#L310)) |
| `FlashSale.isActive` | Ambiguous: admin switch **and** time projection | fast query filter | cron every minute + admin PATCH | none |
| `Order.paymentStatus` | Projection of Payment/Refund | cheap filters | `syncOrderPaymentStatus`, `refundOrderPayment`, `createManualOrder(markPaid)` | none |
| `Order.courierStatus` | Cache of Steadfast status | display, filters | webhook + 15-min cron + manual | `courierStatusSyncedAt`, `courierSyncError` |
| `Order.paymentSessionKey`, `paymentTransactionId` | **Deprecated**, no readers | awaiting drop migration | — | — |
| `Order.subtotal/discount/bundleDiscount/shippingFee/priceAdjustment/total` | **Transaction snapshot** (immutable facts) | legal/financial record | written once; `total` and `priceAdjustment` rewritten by `adjustOrderPrice` | none |
| `OrderItem.*Snapshot`, `priceSnapshot` | **Transaction snapshot** | history survives catalog edits | written once | — |
| `OrderItem.returnedQuantity` | Transaction fact | partial-delivery reconciliation | `reconcilePartialDelivery` only — **not** by full return approval | — |
| `ReturnRequest.*Snapshot` | Transaction snapshot | — | — | — |
| `WishlistItem.priceAtAdd` | Snapshot (basePrice only) | price-drop baseline | on add | — |
| `SearchLog.suggestion` | Cached derived value | avoid recomputing trigram | write time | — |
| `Cart/CartItem` | One-way mirror of browser cart | abandonment detection | debounced sync from web | — (`Cart.reminderSentAt` has no writer, see R11) |
| `PaymentSession.checkoutPayload` | Snapshot of quote at initiation | charge exactly what was quoted | initiation | — |

Snapshots that are **missing** (facts recomputed from live data later, so history is not reproducible):
- Cost at time of sale — BI COGS uses *current* `costPrice` ([bi.service.ts:98](../apps/api/src/modules/bi/bi.service.ts#L98) comment says so).
- Whether shipping was waived — `adjustOrderPrice` re-reads the *live* coupon's type to decide ([order.service.ts:1075-1078](../apps/api/src/modules/orders/order.service.ts#L1075-L1078)); editing that coupon later changes the recomputed total.
- Coupon-only discount — derivable only as `discount - bundleDiscount`.
- Tax — never computed or stored.

## 7. Calculation duplication map

### 7.1 Unit selling price (`variant.price ?? product.basePrice`, then flash sale)

| # | Location | Formula | Correct vs. checkout? |
|---|---|---|---|
| 1 | [orders/cart-lines.ts:23](../apps/api/src/modules/orders/cart-lines.ts#L23) `effectivePrice` | flash(variant.price ?? basePrice) | **Canonical (what is charged)** |
| 2 | [products/product.service.ts:278](../apps/api/src/modules/products/product.service.ts#L278) `withFlashSaleInfo` | flash(**basePrice**) | ✗ ignores variant price |
| 3 | [flash-sales/flash-sale.service.ts:86](../apps/api/src/modules/flash-sales/flash-sale.service.ts#L86) homepage feed | flash(**basePrice**) | ✗ |
| 4 | [bundles/bundle.service.ts:112](../apps/api/src/modules/bundles/bundle.service.ts#L112) | variant.price ?? basePrice, **no flash** | ✗ bundle discount computed on a different base than the subtotal |
| 5 | [orders/order.service.ts:438](../apps/api/src/modules/orders/order.service.ts#L438) `attachLiveItemInfo` (Reorder) | no flash | ✗ (display) |
| 6 | [return-requests/return-request.service.ts:184](../apps/api/src/modules/return-requests/return-request.service.ts#L184) exchange | no flash | policy choice, undocumented |
| 7 | [web/hooks/use-add-to-cart.ts:39](../apps/web/hooks/use-add-to-cart.ts#L39) → persisted in localStorage cart | `variant.price ?? (flashPrice ?? basePrice)` | ✗ variant-priced item during a flash sale shows un-discounted price |
| 8 | [web/components/storefront/product-showcase.tsx:84](../apps/web/components/storefront/product-showcase.tsx#L84) | `flashPrice ?? variant.price ?? basePrice` | ✗ shows flash-of-basePrice for a variant with its own price |
| 9 | [web/app/admin/(shell)/orders/new/page.tsx:174](../apps/web/app/admin/(shell)/orders/new/page.tsx#L174) | `flashPrice ?? v.price ?? basePrice` | ✗ same as #8 |
| 10 | `product-card.tsx`, `quick-view-modal.tsx`, `compare-bar.tsx`, `structured-data.ts:49`, `live-preview-frame.tsx:85`, `promo-badge.tsx` | `flashPrice ?? basePrice` | product-level "from" price; acceptable only if labelled as such |
| 11 | Sorting/filtering/facets ([product.service.ts:306](../apps/api/src/modules/products/product.service.ts#L306), [L594](../apps/api/src/modules/products/product.service.ts#L594), trending filter ~L927) | `basePrice` only | ✗ price filter ignores variant and flash prices |

**Concrete failure:** a Panjabi with `basePrice 2000`, one variant `price 2400`, in a 10% flash sale. Product page shows ৳1800 (flash of base), cart line stores ৳2400 (variant, no flash), checkout summary sums ৳2400, server charges ৳2160. Three different numbers for one line.

### 7.2 Order total

| Location | Formula |
|---|---|
| [order.service.ts:105-107](../apps/api/src/modules/orders/order.service.ts#L105-L107) `deriveOrderPricing` | `subtotal − discount + (freeShip ? 0 : shippingFee)` |
| [order.service.ts:1079](../apps/api/src/modules/orders/order.service.ts#L1079) `adjustOrderPrice` | `subtotal − discount + shippingOwed(live coupon) + priceAdjustment` |
| [return-request.service.ts:184-190](../apps/api/src/modules/return-requests/return-request.service.ts#L184-L190) exchange order | `max(0, newValue − paidValue)`, `shippingFee 0` |
| [checkout/page.tsx:343-347](../apps/web/app/(storefront)/checkout/page.tsx#L343-L347) | `max(0, subtotal − couponDiscount − bundleDiscount) + shipping` from **localStorage prices** |

### 7.3 Shipping fee
Server: `isInsideDhaka(district) ? shippingFeeDhaka : shippingFeeOutsideDhaka` ([order.service.ts:105](../apps/api/src/modules/orders/order.service.ts#L105)); client repeats it ([checkout/page.tsx:220-227](../apps/web/app/(storefront)/checkout/page.tsx#L220-L227)) with hard-coded fallbacks `SHIPPING_FEE_*_FALLBACK = 60/120` ([packages/shared/src/schemas/order.ts](../packages/shared/src/schemas/order.ts)); courier-loss fee repeats the zone rule ([order.service.ts:831](../apps/api/src/modules/orders/order.service.ts#L831)). The zone rule itself is centralised in [packages/shared/src/delivery.ts](../packages/shared/src/delivery.ts) — good — but it is a hard-coded country rule.

### 7.4 "Is this order a sale?" / revenue

| Definition | Where |
|---|---|
| `status != 'CANCELLED'` (≈50 inline SQL copies, none exclude `deletedAt`) | [analytics.service.ts](../apps/api/src/modules/analytics/analytics.service.ts) (`NON_REVENUE_STATUSES`, L11, and raw SQL e.g. L86, L142, L577 …), [bi.service.ts:96](../apps/api/src/modules/bi/bi.service.ts#L96) |
| `status NOT IN (CANCELLED, REFUNDED)` | [product.service.ts:1064](../apps/api/src/modules/products/product.service.ts#L1064) `NOT_A_SALE` (sales summary, urgency signals, trending, FBT) |
| **no status filter**, excludes deleted, server-local "today" | [order.service.ts:719](../apps/api/src/modules/orders/order.service.ts#L719) `getOrderStats.todayRevenue` (includes cancelled) |
| `status != CANCELLED`, Asia/Dhaka day, includes deleted | [bi.service.ts:57](../apps/api/src/modules/bi/bi.service.ts#L57) `revenueToday` |
| `status != CANCELLED`, UTC day | [analytics.service.ts:70](../apps/api/src/modules/analytics/analytics.service.ts#L70) `getRevenueSeries` |
| customer spend: `!= CANCELLED`, excludes deleted | [customer.service.ts:587](../apps/api/src/modules/customers/customer.service.ts#L587) |
| customer spend: `!= CANCELLED`, **includes** deleted | [customer.service.ts:738](../apps/api/src/modules/customers/customer.service.ts#L738) (same customer drawer's order counts exclude deleted) |
| line revenue `Σ qty × priceSnapshot` (pre-discount, no shipping) | `getTopProducts` [analytics.service.ts:~130](../apps/api/src/modules/analytics/analytics.service.ts) |

Result: the orders page, the dashboard, BI and the customer drawer can show four different "revenue" numbers for the same day, none of which nets out `Refund` rows.

### 7.5 Low stock

| Definition | Where |
|---|---|
| `remaining ≤ product.lowStockThreshold AND trackInventory` (from a pre-transaction read) | [order.service.ts:281-293](../apps/api/src/modules/orders/order.service.ts#L281-L293) |
| `stock ≤ 5` hard-coded, ignores threshold/trackInventory/variant.isActive/deletedAt | [analytics.service.ts:204](../apps/api/src/modules/analytics/analytics.service.ts#L204) dashboard `lowStockCount` |
| `stock ≤ threshold(query param, default 5)` | [analytics.service.ts:170](../apps/api/src/modules/analytics/analytics.service.ts#L170) |
| storefront "only N left" uses `lowStockThreshold` | `VariantSelector` props ([product-showcase.tsx](../apps/web/components/storefront/product-showcase.tsx)) |

### 7.6 Discount math
Coupon percentage rounds to whole currency units ([coupon.service.ts:67](../apps/api/src/modules/coupons/coupon.service.ts#L67)); bundle percentage rounds to whole units ([bundle.service.ts:130](../apps/api/src/modules/bundles/bundle.service.ts#L130)); flash price rounds to 2 decimals ([flash-sale-pricing.ts:39](../apps/api/src/modules/flash-sales/flash-sale-pricing.ts#L39)). Three rounding policies in one pipeline; no currency-precision setting.

## 8. Data-flow map

### 8.1 Checkout (COD)
```
web cart (localStorage, prices frozen at add time)
  → checkout page: client subtotal/shipping/total; coupon preview POST /coupons/validate {code, subtotal(client), items}
  → POST /api/orders  (order.controller.create)
      deriveOrderPricing: findOrCreateGuestCustomer → resolveCartLines (live prices + flash) → active/stock checks
        → evaluateCoupon → evaluateBundleForItems → getSettings (payment toggles, shipping)
      Redis session lock (order-create-lock:<sessionId>) + duplicate lookup
      insertOrderRecord TX: conditional stock decrements → Order+Items+History → StockMovement rows → coupon usedCount++
      post-commit fire-and-forget: notify(), SMS (customer+admin), clearCart, Steadfast fraud check, low-stock notify
```
### 8.2 Checkout (SSLCommerz / EPS)
`initiatePendingPayment` prices the cart (same `deriveOrderPricing`), snapshots `{input, pricing, itemSnapshots}` into `PaymentSession.checkoutPayload`, **creates no Order and reserves no stock**, redirects to the gateway. `settlePaymentSession` (callback/IPN/cron) atomically claims the session, verifies amount, materialises the Order via `insertOrderRecord(..., allowOversell: true)` — stock may go negative with an admin alert ([payment.service.ts:294](../apps/api/src/modules/payments/payment.service.ts#L294)).

### 8.3 Order lifecycle
Admin dropdown / bulk / Steadfast webhook / 15-min cron / return approval → `updateOrderStatus` ([order.service.ts:836](../apps/api/src/modules/orders/order.service.ts#L836)): row lock, restock if moving *into* CANCELLED/REFUNDED from anything else, courier-loss ledger, status history, delivery points on DELIVERED, SMS. **No transition table** — any status can move to any status.

### 8.4 Storefront catalog read
Server component → `storefrontFetch` (Next fetch cache 60 s, tags `product:<slug>`, `products:listing`) → API → Redis `products:*` cache → Prisma. Product mutation → `invalidateCache` → Redis prefix delete + POST `web/api/revalidate` with tags ([product.cache.ts](../apps/api/src/modules/products/product.cache.ts)).

### 8.5 Analytics
Browser beacons → `/api/analytics/{pageview,exit,funnel-event}` → `PageView`/`FunnelEvent`. Admin dashboards → ~75 endpoints each running its own raw SQL over `Order`/`OrderItem`/`PageView`, cached 60–300 s in Redis.

## 9. API map

- 38 routers, all under `/api/<feature>` ([app.ts:67-102](../apps/api/src/app.ts#L67-L102)); `/health` liveness only (no DB/Redis readiness).
- No `/api/v1`, no OpenAPI. Request validation is Zod via `validate()` middleware using `packages/shared` schemas — a good base for contracts.
- Public (unauthenticated) surfaces: catalog reads, categories, settings `GET /api/settings`, coupons `validate/best/active`, bundles preview, flash-sales active, orders `POST /` and `/track`, payments callbacks, courier webhook, analytics beacons, reviews list, redirects active, homepage sections, banners, social links, newsletter, feedback.
- Response shapes are ad hoc per endpoint (`{ product }`, `{ items, total, page }`, bare arrays for analytics); Prisma `Decimal` fields serialise as strings, so clients re-`Number()` everything.
- Admin analytics exposes ~75 GET endpoints, one per chart ([analytics.routes.ts](../apps/api/src/modules/analytics/analytics.routes.ts)).

## 10. Caching map

| Layer | Keys / scope | TTL | Invalidation |
|---|---|---|---|
| Redis read cache ([config/redis.ts](../apps/api/src/config/redis.ts)) | `products:*` | varies | `cacheDelByPrefix("products:")` on product/catalog/flash-sale/review changes |
| | `settings:singleton` | 300 s | on settings update |
| | `analytics:*` | 300 s | TTL only |
| | `bi:executive-overview`, `payments:overview` | 60 s | TTL only |
| | trending pool | 900 s | TTL only |
| Next.js fetch cache ([lib/api/storefront.ts:19](../apps/web/lib/api/storefront.ts#L19)) | per fetch | 60 s | tags `product:<id|slug>`, `products:listing` via `/api/revalidate` |
| Next middleware ([middleware.ts](../apps/web/middleware.ts)) | redirects list, favicon | 300 s | TTL only (product page does a tagged lookup to close the gap) |
| Browser | cart/wishlist/compare (localStorage), recently viewed | unbounded | none — **cart prices never refresh** |
| Uploads | `express.static`, `maxAge 30d` | 30 d | filename-based |

Gaps: flash-sale create/update/activation only clears Redis, not the Next.js tags ([flash-sale.service.ts:54](../apps/api/src/modules/flash-sales/flash-sale.service.ts#L54)) → storefront shows the old price up to 60 s after a sale starts/ends. Coupon/bundle/settings changes have no storefront tag. Analytics caches can disagree with each other for up to 5 minutes.

## 11. Event / background-job map

No domain-event abstraction exists. Side effects are direct calls, mostly fire-and-forget promises inside the request process.

| Job ([apps/api/src/jobs](../apps/api/src/jobs)) | Schedule | Does |
|---|---|---|
| `flash-sale-cron` | every minute (+ once at boot) | flips `FlashSale.isActive` to match window |
| `campaign-scheduler-cron` | every minute | promotes due campaigns to send queue |
| `campaign-send-worker` | queue `CAMPAIGN_SEND_QUEUE` | sends campaign to recipients |
| `courier-status-cron` | every 15 min | re-polls Steadfast for non-terminal booked orders |
| `payment-reconciliation-cron` | every 5 min | EPS status recovery + expire stale sessions |

All five are started **inside the API process** ([server.ts:26-30](../apps/api/src/server.ts#L26-L30)). There is no retry/dead-letter for SMS/email/push (inline `fetch`, errors logged). Comments reference a `cart-recovery-cron.ts` that does not exist ([courier-status-cron.ts:11](../apps/api/src/jobs/courier-status-cron.ts#L11)); `Cart.reminderSentAt` has no writer.

Implicit "events" today (the hooks a formal event bus would replace):

| Trigger | Side effects (inline) |
|---|---|
| Order inserted | `notify(order.created)`, customer SMS, admin SMS, clear cart mirror, Steadfast fraud check, low-stock notify, oversold notify |
| Status changed | status history row, restock, courier-loss row, delivery points, cancelled-but-paid notify, customer SMS |
| Payment settled | Payment row, PaymentEvent, order sync, SMS, confirmation email |
| Product saved | audit events, Redis + ISR invalidation, back-in-stock email, wishlist price-drop email |
| Review moderated | rating projection, product cache invalidation |
| Any admin write | generic `AuditLog` row via `auditMiddleware` |

## 12. Authentication / RBAC map

- **Admin**: JWT access cookie (15 m) + DB-tracked rotating refresh tokens; roles `OWNER | STAFF` ([require-admin.ts](../apps/api/src/middlewares/require-admin.ts)). Role is read from the JWT; `AdminUser.isActive` is not re-checked per request, so a deactivated admin keeps access until the access token expires.
- **Customer**: separate JWT secrets; `tokenVersion` for revocation; guest checkout attaches optionally.
- **CSRF**: double-submit cookie with an exemption list ([csrf.ts](../apps/api/src/middlewares/csrf.ts)).
- **Rate limits**: `express-rate-limit` with the default in-memory store ([rate-limit.ts](../apps/api/src/middlewares/rate-limit.ts)) — per-process, resets on deploy, not shared across replicas.
- **Authorisation granularity**: OWNER-only is applied to ~31 routes (settings, catalog config, deletes, imports, AI, redirects, social links, SMS settings). **STAFF can**: record refunds, adjust order prices, change any order status, create/edit coupons and flash sales, send campaigns and ad-hoc SMS, adjust stock. There is no permission model finer than two roles.
- Cookie-only auth, single CORS origin ([app.ts:55](../apps/api/src/app.ts#L55)) — already documented in `architecture-roadmap.md` §2.

## 13. Deployment map

- **Primary**: self-hosted GitHub runner on the VPS → writes `docker/.env` from GitHub secrets → `docker compose up -d --build` → `prisma migrate deploy` inside the new api container → restart nginx ([ci.yml](../.github/workflows/ci.yml)).
- Services: postgres 16, redis 7 (password, no healthcheck), api, web, nginx, certbot ([docker-compose.yml](../docker/docker-compose.yml)); `docker/backup.sh` for Postgres.
- Order-of-operations risk: new api code starts **before** migrations are applied; there is no expand/contract discipline enforced.
- Uploads live on a named Docker volume on one host (no object storage abstraction).
- `NEXT_PUBLIC_*` values are baked at image build time — a new store domain requires a rebuild.
- A second, legacy deployment path exists: [deploy_vps.py](../deploy_vps.py) / [inspect_vps.py](../inspect_vps.py) target a shared-hosting account over password SSH (now read from `VPS_SSH_PASSWORD`, no longer committed). Its credential appeared in earlier git history; rotation should be confirmed.
- CI gates: `pnpm audit --audit-level critical`, migrations applied, **schema-drift check** (`prisma migrate diff --exit-code`), seed, typecheck api+web, API tests, web build, Playwright e2e. **Lint is not run in CI.**

## 14. Testing map

API: Vitest, real Postgres, sequential files, destructive-cleanup guard ([test-guard.ts](../apps/api/src/test-guard.ts)), isolated test DB ([scripts/with-test-db.ts](../apps/api/scripts/with-test-db.ts)). Web: Playwright only (no unit tests).

| Area | Test files (cases) | Coverage verdict |
|---|---|---|
| Products / catalog | 14 files (~230 cases) + 11 e2e specs | Strong |
| Orders | `order.integration.test.ts` (13) | COD create, stock decrement, coupon usage, retry payment, Dhaka fee |
| Payments | `payment.integration.test.ts` (13) | Settlement idempotency, failure/cancel, refunds, pre-order sessions — strong |
| Customers | 1 file (6) + 2 e2e | auth only |
| Wishlist | 1 file (5) | basic |
| **Analytics (2990 LOC), BI, coupons (rules), bundles, flash sales, inventory, returns/exchanges, courier, campaigns, reviews, settings, homepage** | **0** | none |

No test asserts that storefront price = cart price = charged price, that `stock == Σ ledger` after any flow, or that two dashboards agree.

---

## 15. Problems ranked by architectural risk

Severity: **S1** money or stock can be wrong in production today · **S2** a business number is ambiguous or drifts · **S3** blocks the reusable-platform goal · **S4** maintainability.

| ID | Sev | Problem | Evidence | Consequence |
|---|---|---|---|---|
| R1 | S1 | **Inventory double/triple restock and resurrection.** Approving a RETURN restocks the full quantity via `restockReturnedOrderItems` without setting `OrderItem.returnedQuantity`; a later `RETURNED → REFUNDED` status change restocks again (`restockNeeded` only checks the previous status isn't CANCELLED/REFUNDED); soft-deleting a RETURNED order restocks a third time. Same for a reconciled PARTIALLY_DELIVERED order moved to REFUNDED. With no transition table, `CANCELLED → CONFIRMED/SHIPPED` ships goods whose stock was already credited back. `updateOrderStatus` restocks with `update` (throws if the variant was hard-deleted) while other paths use `updateMany`. | [order.service.ts:868-888](../apps/api/src/modules/orders/order.service.ts#L868-L888), [L1113-1146](../apps/api/src/modules/orders/order.service.ts#L1113-L1146), [L1154](../apps/api/src/modules/orders/order.service.ts#L1154); [return-request.service.ts:144-151](../apps/api/src/modules/return-requests/return-request.service.ts#L144-L151) | Phantom stock → oversell; ledger reflects it, so drift report won't flag it |
| R2 | S1 | **Trashed products remain purchasable.** `deleteProduct` sets only `deletedAt` (status/isActive unchanged); checkout checks `product.isActive` and `variant.isActive` but not `deletedAt`. Any cart already holding the variant can still order it. | [product.service.ts:1721](../apps/api/src/modules/products/product.service.ts#L1721); [order.service.ts:68](../apps/api/src/modules/orders/order.service.ts#L68) | Orders for withdrawn products |
| R3 | S1 | **Displayed price ≠ cart price ≠ charged price** for variant-priced items during a flash sale; bundle discount computed on non-flash prices; cart prices frozen in localStorage; checkout totals computed client-side. | §7.1, §7.2 | Customer sees one total, pays another (COD collects server total) |
| R4 | S1 | **Lost-update on product-form stock.** The form sends an absolute `stock`; the ledger delta is computed against `existing` read *before* the transaction. A sale committed in between is overwritten and the ledger no longer sums to stock. | [product.service.ts:1644-1653](../apps/api/src/modules/products/product.service.ts#L1644-L1653) | Under-counted sales, drift |
| R5 | S2 | **Revenue has ≥6 definitions**; analytics/BI include soft-deleted orders, returned and refunded orders, never net `Refund` rows; "today" uses server-local time in one place, Asia/Dhaka in another, UTC in a third. Customer drawer `totalSpent` includes deleted orders while its counts exclude them. | §7.4 | Owners cannot trust any headline number |
| R6 | S2 | **`FlashSale.isActive` has two meanings.** The cron activates *any* sale inside its window with `isActive=false`, so an admin who switches a running sale off is overridden within a minute. A product in two overlapping live sales gets whichever row Prisma returns last (`map.set` per item, no ordering). | [flash-sale.service.ts:153-170](../apps/api/src/modules/flash-sales/flash-sale.service.ts#L153-L170); [flash-sale-pricing.ts:12-36](../apps/api/src/modules/flash-sales/flash-sale-pricing.ts#L12-L36) | Cannot stop a mispriced sale without deleting it; nondeterministic price |
| R7 | S2 | **Coupon usage has two definitions.** `usedCount` is incremented per order and never released on cancel/delete; `perCustomerLimit`/`firstOrderOnly` count orders excluding deleted but including cancelled; `findBestCoupon` ignores per-customer rules and suggests coupons checkout will reject. | [coupon.service.ts:104-121](../apps/api/src/modules/coupons/coupon.service.ts#L104-L121), [L131](../apps/api/src/modules/coupons/coupon.service.ts#L131), [L166](../apps/api/src/modules/coupons/coupon.service.ts#L166) | Limited coupons exhaust early; bad suggestions |
| R8 | S2 | **Refund state split.** Refund is both `Order.status=REFUNDED` (admin dropdown, triggers restock) and `Order.paymentStatus=REFUNDED` (via `Refund`, no restock). BI counts either. Partial refunds collapse to REFUNDED. COD orders never become PAID on delivery. Reward points (earned on `total` incl. shipping) are never reversed on return/refund. | [payment.service.ts:529-565](../apps/api/src/modules/payments/payment.service.ts#L529-L565); [bi.service.ts:149](../apps/api/src/modules/bi/bi.service.ts#L149); [customer.service.ts:953](../apps/api/src/modules/customers/customer.service.ts#L953) | Ambiguous financial state |
| R9 | S2 | **Inventory semantics undefined.** `trackInventory=false` still blocks checkout at 0 stock; `FlashSaleItem.stockLimit` is accepted by the API but enforced nowhere; back-in-stock alerts fire only from the product form (not manual adjust, cancellation or returns); low-stock has three definitions (§7.5). | [schemas/flash-sale.ts:26](../packages/shared/src/schemas/flash-sale.ts#L26); [product.service.ts:1684-1691](../apps/api/src/modules/products/product.service.ts#L1684-L1691) | Admin settings silently ignored |
| R10 | S2 | **Multi-step flows without one transaction.** Return approval = request update, then `updateOrderStatus` (own txn), then restock (own txn). Manual order = create, then separate `markPaid` update. Partial failure leaves inconsistent state. | [return-request.service.ts:127-155](../apps/api/src/modules/return-requests/return-request.service.ts#L127-L155); [order.service.ts:380-391](../apps/api/src/modules/orders/order.service.ts#L380-L391) | Half-applied business operations |
| R11 | S2 | **Customer-visible soft-deleted orders.** `listCustomerOrders` doesn't filter `deletedAt`; detail 404s the same order. | [customer.service.ts:1006](../apps/api/src/modules/customers/customer.service.ts#L1006) | Confusing account page |
| R12 | S3 | **Country-specific business rules hard-coded**: 64 Bangladesh districts/divisions, `isInsideDhaka`, BD phone schema, `৳`/BDT formatting, `Asia/Dhaka`, two-zone shipping, delivery-day estimates, SMS provider, trust badges ("7-day easy returns"), email `BRAND_NAME = "ASIF ZONE"`, policy pages as TSX, default product type `"CLOTHING"`. | [packages/shared/src/schemas/order.ts](../packages/shared/src/schemas/order.ts), [delivery.ts](../packages/shared/src/delivery.ts), [email-template.ts:1](../apps/api/src/lib/email-template.ts#L1), [product-showcase.tsx:17](../apps/web/components/storefront/product-showcase.tsx#L17), [product.service.ts:1197](../apps/api/src/modules/products/product.service.ts#L1197) | New store requires code edits |
| R13 | S3 | **Providers are hard-wired.** `PaymentMethod`/`PaymentProvider` are Prisma enums; gateway choice is a ternary; enablement flags are three bespoke `StoreSetting` columns; credentials only via env; Steadfast called directly from courier/customer services; SMS/email/push/storage are single implementations. | [payment.service.ts:89](../apps/api/src/modules/payments/payment.service.ts#L89), [L123-126](../apps/api/src/modules/payments/payment.service.ts#L123-L126); [env.ts](../apps/api/src/config/env.ts) | New provider = migration + code |
| R14 | S3 | **No configuration, feature-flag or theme system.** Features are always on; theme tokens are build-time JS; `NEXT_PUBLIC_*` baked at build. | [packages/ui-tokens/src/index.js](../packages/ui-tokens/src/index.js); [docker-compose.yml](../docker/docker-compose.yml) web build args | Per-store rebuilds |
| R15 | S3 | **Workers and side effects in the request process.** SMS/email/push are fire-and-forget promises with no retry; five crons share the API process. | [server.ts](../apps/api/src/server.ts) | Lost notifications; cannot scale API independently |
| R16 | S3 | **Coarse RBAC** (2 roles, role in JWT, no `isActive` recheck); rate limits in memory. | §12 | Insufficient for multi-staff stores |
| R17 | S3 | **API contract**: no versioning, no OpenAPI, cookie-only, single CORS origin, Decimal-as-string. | §9 | Blocks mobile/headless/agents |
| R18 | S4 | **Test gaps** on analytics, BI, coupons, bundles, flash sales, inventory, returns, courier, campaigns. | §14 | Refactors of these areas are unprotected |
| R19 | S4 | **Analytics monolith**: 2990-line service, ~75 endpoints, raw SQL literals; customer computations load every customer and order into Node. | [analytics.service.ts](../apps/api/src/modules/analytics/analytics.service.ts); [customer.service.ts:587](../apps/api/src/modules/customers/customer.service.ts#L587) | Slow, inconsistent, hard to change |
| R20 | S4 | **Deploy ordering & ops**: migrations after container start; no readiness endpoint; lint not in CI; Redis without healthcheck; dead fields (`Order.paymentSessionKey`, `paymentTransactionId`, `Cart.reminderSentAt`) and a referenced-but-missing cron file. | §13; schema Order L916-921 | Deploy-time breakage risk |

## 16. Recommended target architecture (summary)

Full specification: [TARGET_ARCHITECTURE.md](TARGET_ARCHITECTURE.md). In one paragraph: keep the modular monolith and the Express/Next/Prisma stack; introduce an explicit **domain layer** per bounded context in `apps/api/src/domain/<context>` whose services are the *only* writers of their tables; move all business math into **pure calculation engines** in `packages/shared/src/engines` (no I/O, identical on server and client) fed by API-side resolvers; expose **resolved read models** (a variant's selling price, a cart quote, a metric value) so the UI renders numbers instead of computing them; add a transactional **outbox** so secondary systems (audit, notifications, cache, analytics, search) subscribe to domain events processed by a separate **worker** container; make everything store-specific **configuration data** (store profile, locale/currency/timezone, shipping zones, feature flags, theme tokens, provider configs) with a first-run **setup wizard**.

## 17. Migration strategy (summary)

- **Expand → migrate → contract** for every schema change. New columns/tables are additive and nullable or defaulted; code is switched over behind the new authority; the old field is dropped only after (a) every reader is migrated, (b) a reconciliation run shows zero drift in production, (c) one release has shipped with no reader.
- **Deploy order fix first**: run `prisma migrate deploy` in a one-shot container *before* `up -d` so new code never meets an old schema; only additive migrations may ship in the same release as the code that needs them.
- **Every projection gets a reconciler** (read-only report first, repair command second, requiring an explicit flag and writing its own audit/ledger rows).
- **Data repairs are scripts, not migrations**: `apps/api/scripts/repair/*.ts`, idempotent, dry-run by default, with before/after counts.
- Legacy fields kept until contract phase: `Product.productType`, `Product.isActive`, `Order.paymentSessionKey/paymentTransactionId`, `Product.attributes` JSON residue, `SHIPPING_FEE_*_FALLBACK`.
- Detailed ordered list: TARGET_ARCHITECTURE.md §12.

## 18. Installer architecture (summary)

Current: none. Fresh install = clone, set ~40 env vars by hand, `docker compose up`, run seeds (`seed.ts`, `seed-presets.ts`), create admin via seed env vars. Target: an `InstallationState` singleton gates a `/setup` wizard; a `platform init` CLI generates internal secrets (JWT, Postgres, Redis, revalidate, webhook token) into `docker/.env`; the wizard collects store profile, admin account, locale/currency/timezone, shipping zones, theme, product starter pack, provider credentials (stored encrypted in DB), feature flags; then runs health checks and flips the store to `READY`. See TARGET_ARCHITECTURE.md §9.

## 19. Theme / configuration architecture (summary)

Current: `StoreSetting` holds branding (name, logos, favicon), contact, shipping fees, tax, payment toggles, chat widget, SEO verification — a mix of profile, commerce rules and feature flags in one public row. Homepage is already data-driven (`HomepageSection`, `Banner`); product page sections are data-driven (`GlobalSection/TemplateSection/ProductSection`). Colours/fonts are build-time tokens. Target: split into `StoreProfile` (public), `CommerceSettings` (currency, locale, timezone, country, tax mode, rounding), `ShippingZone/ShippingRate`, `FeatureFlag`, `ThemeSettings` (token JSON → CSS custom properties at runtime), `ContentBlock` for trust badges/policies/email branding. See TARGET_ARCHITECTURE.md §7-8.

## 20. Provider abstraction architecture (summary)

Current: SSLCommerz/EPS/Steadfast/BulkSMSBD/Resend/web-push/local-disk are concrete modules called directly. Target: `PaymentProvider`, `CourierProvider`, `SmsProvider`, `EmailProvider`, `StorageProvider`, `FraudCheckProvider` interfaces in `apps/api/src/providers/<kind>/`, a registry keyed by string provider id, a `ProviderConfig` table (enabled, mode, encrypted credentials, display name), and `PaymentMethod` stored as a string key rather than a Prisma enum (additive column first). See TARGET_ARCHITECTURE.md §10.

## 21. Event architecture (summary)

Current: implicit, inline side effects (§11). Target: `DomainEvent` outbox table written inside the business transaction; a dispatcher in the worker process delivers to subscribers (audit, notifications, SMS/email, cache invalidation, analytics projections, search) with retries and idempotency keys. Initial catalogue: `OrderPlaced`, `OrderStatusChanged` (+ typed aliases), `PaymentSucceeded/Failed`, `RefundRecorded`, `StockChanged`, `StockLow`, `StockReplenished`, `ProductPublished/Unpublished/Updated`, `PriceChanged`, `FlashSaleStarted/Ended`, `ReviewApproved`, `CustomerCreated/Merged`. See TARGET_ARCHITECTURE.md §6.

## 22. Metrics architecture (summary)

Current: each endpoint writes its own SQL (§7.4). Target: a `metrics` module holding **one registered definition per metric** (predicate, measure, time basis, timezone, currency), a shared SQL fragment builder (`saleOrderPredicate()`, `storeLocalDay()`), and a `MetricsService.compute(metricId, range, dims)` used by dashboard, BI, reports, exports and customer views. Later, daily aggregate tables (`DailySalesFact`) refreshed by the worker. Owner decisions required on revenue recognition (see TARGET_ARCHITECTURE.md §11).

## 23. What should NOT be rewritten

These are sound, tested, and should be extended rather than replaced:

1. **Configuration-driven catalog** — `ProductTypeDef`, `ProductTemplate`, `AttributeDefinition`, `TemplateAttribute`, `ProductAttributeValue`, presets, sections, relations, completeness gate, SKU generator, wizard steps. (`docs/product-catalog.md`, P0–P13.)
2. **Payment session / settlement model** — `PaymentSession` + `Payment` + `PaymentEvent`, atomic claim, amount re-verification, pre-order sessions, reconciliation cron, `syncOrderPaymentStatus` choke point.
3. **Conditional-update concurrency pattern** — `updateMany where stock >= qty`, raw conditional coupon increment, `SELECT … FOR UPDATE` on order status, Redis session lock for double-submit.
4. **Order snapshots** — `OrderItem.*Snapshot`, `Order` money fields, `PaymentSession.checkoutPayload`.
5. **Ledgers** — `StockMovement`, `RewardPointsEntry`, `OrderStatusHistory`, `PaymentEvent`, `CourierLossEvent`, `AuditLog` + product audit diff.
6. **Storefront revalidation** — tagged Next fetch cache + `/api/revalidate` + Redis prefix invalidation.
7. **Shared Zod schemas** in `packages/shared` as the request contract.
8. **Test infrastructure** — isolated test DB, destructive-cleanup guard, sequential integration tests, Playwright matrix, CI schema-drift check.
9. **Data-driven content** — `HomepageSection`, `Banner`, `SocialLink`, `Redirect`, `GlobalSection`.
10. **Steadfast partial-delivery reconciliation** and courier-loss ledger (fix their restock interplay, keep the model).

## 24. Exact phased implementation order

| Phase | Goal | Key deliverables | Exit criteria |
|---|---|---|---|
| **1 — Core SSOT / domain foundation** | Stop S1 defects; establish single writers | Order state machine (transition table) · `InventoryEngine` as sole stock writer (restock idempotent per order line, `returnedQuantity` set on every return path, relative-delta stock edits) · purchase guard on `deletedAt` + `deleteProduct` unpublishes · flash-sale `isActive` split into admin switch vs. computed state · `domain/` folder skeleton + lint rule forbidding cross-context table writes · reconciliation reports for stock, ratings, points, coupon usage | Invariant tests green; stock drift report = 0 on staging copy of prod |
| **2 — Central calculation engines** | One pricing pipeline | `packages/shared/src/engines/{pricing,promotion,shipping,tax,order-totals,rounding}` pure functions + golden tests · API `PricingService` resolver · `POST /api/checkout/quote` · bundle/flash ordering decided and encoded | Contract test: PDP price = cart quote = order line for 20 fixture scenarios |
| **3 — API / read-model consolidation** | Resolved read models | Variant `sellingPrice` object in product DTOs · `/api/v1` alias mount · OpenAPI generated from Zod · DTO mappers (Decimal → number/minor units) · bearer-token fallback · CORS allowlist | Old routes unchanged; OpenAPI published in CI |
| **4 — Admin / storefront migration** | UI renders, never computes | Storefront, cart drawer, checkout, admin order-entry consume quote/read models; localStorage cart stores ids+qty only and re-quotes | Grep gate: no price math in `apps/web` outside engines |
| **5 — Analytics / BI consolidation** | One metric per number | `metrics` module + registry · migrate dashboard, BI, orders KPI, customer drawer, exports · timezone from settings · (later) daily fact tables | Cross-surface metric equality tests; owner sign-off on definitions |
| **6 — Configuration, flags, theme** | Zero-code store settings | `StoreProfile/CommerceSettings/ShippingZone/FeatureFlag/ThemeSettings/ContentBlock` · runtime CSS variables · geography as data | Asif Zone runs with identical output from seeded config |
| **7 — Provider abstraction** | Pluggable integrations | Provider interfaces + registry + `ProviderConfig` (encrypted) · SSLCommerz/EPS/Steadfast/BulkSMSBD/Resend/web-push/local-disk as implementations · `paymentMethodKey` string column | Add a fake provider in tests without touching Order/Checkout |
| **8 — Worker / event architecture** | Decouple side effects | `DomainEvent` outbox · worker container · subscribers for audit/notify/SMS/email/cache/analytics · retries + DLQ | API boots with jobs disabled; notifications survive API restarts |
| **9 — Installer / self-hosted** | New store without code | `platform init` CLI, `/setup` wizard, readiness checks, seed packs, backup/restore docs | Fresh VM → live demo store with no file edits |
| **10 — Production hardening** | Operability | Permissions model, Redis-backed rate limits, observability (structured logs, metrics, error tracking), load tests, contract phase (drop legacy fields), DR drills | SLOs defined and met |

Each phase ends with: tests, `tsc --noEmit` (api, web, shared), lint, build, `prisma migrate deploy` on a prod-like copy + schema-drift check, reconciliation reports, doc updates to this file, TARGET_ARCHITECTURE.md and SSOT_REGISTRY.md, and a recorded risk list.

## 25. Verification strategy

1. **Invariant suite** (SQL + Vitest), runnable against any database:
   - `ProductVariant.stock = Σ StockMovement.change` per variant.
   - For every order: `Σ restock movements ≤ Σ ORDER movements` per variant/order (no over-restock).
   - `Product.isActive = (status = 'PUBLISHED')`; `deletedAt IS NOT NULL ⇒ status <> 'PUBLISHED'` (after Phase 1).
   - `avgRating/reviewCount` = aggregate of APPROVED reviews.
   - `Customer.rewardPoints = Σ RewardPointsEntry.points`.
   - `Coupon.usedCount` = count of qualifying orders under the chosen definition.
   - `Order.total = subtotal − discount + shippingCharged + priceAdjustment` (with snapshotted `shippingWaived`).
   - `Order.paymentStatus` consistent with Payment/Refund rows.
2. **Contract tests**: one fixture catalog (base price, variant override, flash %, flash fixed, coupon each scope, bundle, free shipping, both zones) asserted through product DTO, cart quote, order creation, invoice, and metrics.
3. **Golden tests** for each pure engine (table-driven, including rounding edge cases).
4. **Shadow comparison** before switching any dashboard: compute old and new metric side by side for 30/90/365 days on a prod snapshot; differences must be explained by a documented definition change.
5. **Migration rehearsal**: restore latest backup into staging, run migrations + repair scripts in dry-run, diff counts of products/orders/customers/stock before and after.
6. **E2E**: extend Playwright with a purchase journey that asserts the same total on PDP, cart, checkout and order confirmation, and an admin return/refund journey that asserts stock.
7. **Operational checks**: `/health/ready` (DB, Redis, migrations current, workers heartbeat) gated in deploy.
