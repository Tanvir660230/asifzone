# SSOT Registry — one row per business fact

**Status:** Phase 0 baseline, 2026-09-28 (`main` @ `35a9604`).
**Rule:** before adding a field, calculation, service or endpoint, find the fact here. Reuse its authority. If you must add a projection, add or update its row in the same PR (authority, writer, sync, reconciler). Evidence for every "today" statement: [MASTER_ARCHITECTURE_AUDIT.md](MASTER_ARCHITECTURE_AUDIT.md). Target services and engines: [TARGET_ARCHITECTURE.md](TARGET_ARCHITECTURE.md).

**Approved business decisions (2026-09-28):** all of D1–D10 — the register is [BUSINESS_DECISIONS.md](BUSINESS_DECISIONS.md). Highlights: D1 revenue recognition (COD is realised at `DELIVERED`; returns and refunds subtracted separately; creation is never cash collection), D2 bundles on the post-flash price, D3 tax-inclusive prices with an inclusive VAT component. Details and the Phase 1 changes: [TARGET_ARCHITECTURE.md §16–16a](TARGET_ARCHITECTURE.md), [ORDER_STATE_MACHINE.md](ORDER_STATE_MACHINE.md), [INVENTORY_INVARIANTS.md](INVENTORY_INVARIANTS.md), [PRICING_PIPELINE.md](PRICING_PIPELINE.md).

**Phase 4 (2026-09-29):** the payment and refund truth has one owner, the Payment Ledger
([PAYMENT_LEDGER.md](PAYMENT_LEDGER.md)). See B5 and invariants I9, I23–I26. Audit and duplicate-truth matrix:
[PHASE_4_AUDIT.md](PHASE_4_AUDIT.md).

**Legend.** *Status today*: ✅ single authority and single writer · ⚠️ authority clear but duplicated logic or a writer outside the owner · ❌ conflicting definitions or known drift path. *Class*: **M** master data · **S** transaction snapshot (immutable history — not duplication) · **P** projection/cache (derivable, must be reconciled) · **D** computed on demand (never stored).

---

## Part A — Contested facts (the seven questions)

### A1. Product type — `Product.typeId` vs `Product.productType`
1. **Authority:** `Product.typeId → ProductTypeDef` (M).
2. **Projection:** `Product.productType` = `ProductTypeDef.legacyType` (P, legacy enum mirror; `CUSTOM` for admin-created types).
3. **Writer:** `product.service` `createProduct`/`updateProduct` via `resolveTypeForWrite` ([product.service.ts:1184](../apps/api/src/modules/products/product.service.ts#L1184)). Target: `domain/catalog/product.service`.
4. **Recalculation:** on every product write that resolves a type.
5. **Drift detection:** none today. Target: report rows where `typeId IS NULL` or `productType <> type.legacyType`.
6. **Repair:** script M14 backfills `typeId` from `productType` key; then re-mirror `productType`.
7. **API:** product DTO exposes `type {id,key,name}`; `productType` kept in DTO until contract C2. Readers resolve `typeId ?? key(productType)` only inside `typeForRow` ([product.service.ts:154](../apps/api/src/modules/products/product.service.ts#L154)). Status: ✅ (fallback default `"CLOTHING"` at [L1197](../apps/api/src/modules/products/product.service.ts#L1197) must become a configured default type).

### A2. Product visibility — `Product.status` vs `Product.isActive` (and `deletedAt`)
1. **Authority:** `Product.status` (M) for lifecycle; `Product.deletedAt` (M) for trash.
2. **Projection:** `Product.isActive = (status = PUBLISHED)` (P).
3. **Writer:** `product.service` only ([L1369](../apps/api/src/modules/products/product.service.ts#L1369), [L1506](../apps/api/src/modules/products/product.service.ts#L1506), [L1780](../apps/api/src/modules/products/product.service.ts#L1780)).
4. **Recalculation:** same statement as the status write.
5. **Drift detection:** none; add invariant `isActive = (status='PUBLISHED')`.
6. **Repair:** `UPDATE Product SET isActive = (status='PUBLISHED')`.
7. **API:** DTO exposes `status` and a derived `purchasable` (= PUBLISHED ∧ ¬deleted ∧ ≥1 active variant). Status before Phase 1: ❌ — `deleteProduct` set only `deletedAt` and checkout ignored it. **Phase 1:** one predicate `isPurchasable` (shared) / `PURCHASABLE_PRODUCT_WHERE` (queries) = published ∧ not trashed ∧ variant active, enforced at checkout, order creation, exchanges, wishlist, stock alerts, flash-sale feed/items and bundles. Trashing still leaves `status` untouched so *Restore* returns the product exactly as it was.

### A3. Unit price — `Product.basePrice` vs `ProductVariant.price`
1. **Authority:** list price = `ProductVariant.price` when set, else `Product.basePrice` (both M). Selling price = list price after the active flash offer (D).
2. **Projection:** `ProductReadModel.minSellingPrice` / `maxSellingPrice` / `listPriceOfMin` (P, Phase 3) for sort/filter/facets/price neighbours — see B2 and [STOREFRONT_READ_MODEL.md](STOREFRONT_READ_MODEL.md).
3. **Writer:** `product.service` (master prices). Selling price is never written; it is computed by `PricingEngine.resolveUnitPrice`.
4. **Recalculation:** on demand; projection refreshed on `product.price_changed`, `flash_sale.started/ended`.
5. **Drift detection:** contract test "PDP price = quote price = order line price"; projection report comparing stored min/max with engine output.
6. **Repair:** rebuild projection job.
7. **API:** `ProductView.variants[].price {list, selling, compareAt, flash}` and `ProductView.priceRange`; `POST /v1/checkout/quote`. Status: ✅ Phase 2 — one implementation (`resolveUnitPrice`); read model `product.pricing {from,to,listFrom,compareAt,flash,variants[id]{list,selling,compareAt,flash}}`; `POST /api/v1/checkout/quote` live; contract test PDP = quote = order in `pricing.integration.test.ts`. Still open: the `minSellingPrice` projection for sort/filter.

### A4. Stock — `ProductVariant.stock` vs `StockMovement`
1. **Authority:** `StockMovement` ledger is the authoritative history; `ProductVariant.stock` is the transactional balance used for atomic conditional decrements. Invariant: `stock = Σ change`.
2. **Projection:** `ProductVariant.stock` (P, materialised in the same transaction); category stock rollups (D); storefront "only N left" (D).
3. **Writer:** today five modules — `order.service` (checkout, cancel, delete, return, partial delivery), `return-request.service` (exchange), `product.service` (create/edit/remove variant), `inventory.service` (manual). Target: `InventoryService` only.
4. **Recalculation:** each movement writes both in one transaction.
5. **Drift detection:** `GET /api/inventory/reconciliation` (`getStockDiscrepancies`, [inventory.service.ts:63](../apps/api/src/modules/inventory/inventory.service.ts#L63)) — read-only, manual. Target: nightly job + over-restock check per order line (Σ restock ≤ Σ sold).
6. **Repair:** admin adjustment with reason (never silent); M4/M5 scripts for historical gaps.
7. **API:** `ProductView.variants[].availability {state: in_stock|low|out, quantity?}` (quantity exposure governed by setting); admin inventory endpoints. Status before Phase 1: ❌ — double-restock, resurrection and lost-update paths (audit R1, R4). **Phase 1:** single writer `inventory.service.ts` (architecture test), per-line idempotency via `OrderItem.restockedQuantity`, compare-and-set form edits, new reasons `CANCELLATION`/`IMPORT`/`DAMAGED`/`LOST`. Rules: [INVENTORY_INVARIANTS.md](INVENTORY_INVARIANTS.md).

### A5. Rating — `Product.avgRating/reviewCount` vs `ProductReview`
1. **Authority:** `ProductReview` rows with `status = APPROVED` (M).
2. **Projection:** `Product.avgRating`, `Product.reviewCount` (P). The PDP breakdown (`getRatingBreakdown`) is computed live (D) — same predicate.
3. **Writer:** `review.service.recomputeProductRating` ([review.service.ts:13](../apps/api/src/modules/reviews/review.service.ts#L13)) on moderate/delete.
4. **Recalculation:** full aggregate per product on each qualifying change (not incremental — good).
5. **Drift detection:** none. Add invariant query.
6. **Repair:** recompute all products (idempotent).
7. **API:** product DTO `rating {average, count}`; reviews endpoint for breakdown. Status: ✅.

### A6. Customer delivery success rate — `Customer.delivery*` vs courier statistics
1. **Authority:** the courier's fraud-check service (Steadfast `fraud_check`) — external truth about the phone number across all merchants.
2. **Projection:** `Customer.deliveryTotalParcels/SuccessParcels/CancelledParcels/SuccessRate/ScoreCheckedAt` (P, cache). Our *own* delivery history per customer is a different fact (D from `Order`), not stored.
3. **Writer:** `customer.service.checkAndUpdateDeliveryScore` ([customer.service.ts:975](../apps/api/src/modules/customers/customer.service.ts#L975)) — on checkout (fire-and-forget) and admin bulk action. Target: `FraudCheckProvider` + customer service, triggered by `order.placed` event.
4. **Recalculation:** `successRate` computed from the three counts, never trusted from the provider.
5. **Drift detection:** staleness via `deliveryScoreCheckedAt`; target: refresh if older than a configured age when an order is placed.
6. **Repair:** re-run check.
7. **API:** admin order list/detail `deliveryScore`; never public. Status: ✅ (label it "courier network score" vs. "our history" in the UI to avoid conflating the two).

### A7. Flash sale live state — `FlashSale.isActive` vs `startsAt/endsAt`
1. **Authority:** target — `FlashSale.enabled` (M, admin switch) **and** the window `startsAt ≤ now ≤ endsAt` (M). Live = enabled ∧ in window (D).
2. **Projection:** `FlashSale.isActive` (P, cache of "live" for indexing).
3. **Writer:** before Phase 1 only the `syncFlashSaleActivation` cron wrote `isActive` ([flash-sale.service.ts:153](../apps/api/src/modules/flash-sales/flash-sale.service.ts#L153)); the admin API silently dropped `isActive` (not in the Zod schema), so a running sale could not be switched off at all. **Phase 1:** admin writes `enabled`; the flash-sale service (on every write) and the scheduler derive `isActive`; the scheduler never touches `enabled`.
4. **Recalculation:** every minute and on every flash-sale write.
5. **Drift detection:** report rows where `isActive ≠ (enabled ∧ in window)`.
6. **Repair:** re-run sync.
7. **API:** `activeFlashSale` in product DTOs; pricing reads `enabled` + window directly (no scheduler lag). Deterministic tie-break for overlapping sales is Phase 2. Status: ✅ after Phase 1 (lifecycle table in TARGET_ARCHITECTURE §16a).

### A8. Coupon usage — `Coupon.usedCount` vs redemptions
1. **Authority:** orders carrying `couponId` that satisfy the *redemption predicate* (`deletedAt IS NULL` and not cancelled before shipping — decision D7, approved; implemented in Phase 2).
2. **Projection:** `Coupon.usedCount` (P, counter used for atomic limit enforcement).
3. **Writer:** `incrementCouponUsage` inside the order transaction ([coupon.service.ts](../apps/api/src/modules/coupons/coupon.service.ts)); since Phase 2, decremented once by the T6 pre-shipment cancellation (`releasesCouponUsage`, guarded by `Order.couponReleasedAt`). Trash does not release (not a D7 case).
4. **Recalculation:** increment in-transaction (conditional raw UPDATE — keep).
5. **Drift detection:** report `usedCount` vs. predicate count per coupon.
6. **Repair:** set `usedCount` to predicate count (logged).
7. **API:** admin coupon DTO `usage {count, limit, perCustomerLimit}`; per-customer and first-order checks use the same predicate, including in `findBestCoupon`. Status: ⚠️ Phase 2 — one predicate for per-customer checks and best-coupon (`couponId ∧ deletedAt IS NULL ∧ couponReleasedAt IS NULL`, evaluated by the one coupon engine); the `usedCount`-vs-predicate drift report is still to build.

### A9. Analytics / BI numbers vs order, payment and product truth
1. **Authority:** transaction snapshots (`Order`, `OrderItem`, `Payment`, `Refund`, `StockMovement`, `PageView`, `FunnelEvent`) — never live catalog prices.
2. **Projection:** Redis caches (60–900 s) today; target daily fact tables (P) rebuilt nightly.
3. **Writer:** none (read side). Target: `MetricsService` + worker aggregations.
4. **Recalculation:** on demand with TTL cache; target incremental on events + nightly rebuild.
5. **Drift detection:** cross-surface equality tests; fact table vs. raw query comparison nightly.
6. **Repair:** rebuild facts.
7. **API:** `GET /v1/metrics/:id?from&to&dims` backed by the registry; existing analytics endpoints re-implemented on top. Status: ❌ (audit §7.4, R5).

---

## Part B — Full registry

### B1. Catalog

| Fact | Class | Authoritative source | Authoritative service | Projection / cache | Consumers | Mutation path | Reconciliation | Status |
|---|---|---|---|---|---|---|---|---|
| Product identity & copy | M | `Product` | product.service | Redis `products:*`, Next tags `product:*` | storefront, admin, search, JSON-LD, sitemap | `POST/PATCH /api/products` | cache TTL + on-demand revalidate | ✅ |
| Product type | M/P | `Product.typeId` | product.service | `productType` | validation, presenter, wizard, SKU | same | A1 | ✅ |
| Lifecycle / visibility | M/P | `Product.status`, `deletedAt` | product.service | `isActive` | every storefront query, checkout | status endpoints, trash | A2 | ❌ |
| Attribute values | M | `ProductAttributeValue` (+ `Product.attributes` JSON residue for undefined keys/size guide) | product.service + catalog config | resolved view in DTO | PDP specs, filters, completeness | product write | none needed | ✅ |
| Type/template/attribute config | M | `ProductTypeDef`, `ProductTemplate`, `TemplateAttribute`, `AttributeDefinition`, presets | catalog.service | Redis via product cache prefix | admin builder, validation, presenter | `/api/catalog/*` (OWNER for settings) | — | ✅ |
| Variant options | M/P | template `variantDimensions` + `VariantAttributeValue` | product.service | `ProductVariant.size/color` | cart, orders, filters | product write | none | ⚠️ two option systems (`Attribute` legacy + template dims) |
| SKU | M | `ProductVariant.sku` (unique) | product.service + `SkuCounter` | — | orders (snapshot), CSV, labels | product write / generator | unique index | ✅ |
| Images / galleries | M | `ProductImage`, `VariantImage` | product.service | `ProductVariant.imageId` (first of gallery) | PDP, cards, cart thumbnails | media endpoints | `syncVariantGallery` keeps primary = first | ✅ |
| Slug & redirects | M | `Product.slug`, `Redirect` | product.service, redirect.service | Next middleware cache 300 s, tagged lookup | routing, SEO | product write → `upsertSlugRedirect` | chain collapse on write | ✅ |
| Completeness | D | shared `computeCompleteness` | shared engine | — | builder meter, publish gate | — | same fn client+server | ✅ |
| Page sections / FAQ / relations | M | `GlobalSection`/`TemplateSection`/`ProductSection`, `ProductFaq`, `ProductRelation` | catalog/product services | resolved in DTO | PDP | admin editors | — | ✅ |
| Category tree | M | `Category` | category.service | Next cache | nav, filters, coupons, bundles | `/api/categories` | — | ✅ |
| Category stock rollup | D | `ProductVariant.stock` | category.service | Next cache 60 s | category page | — | — | ⚠️ should use `productAvailability` (Phase 3 engine; not migrated — admin-facing rollup) |
| Rating & review count | P | `ProductReview` (APPROVED) | review.service | `Product.avgRating/reviewCount` | cards, PDP, JSON-LD | moderation | A5 | ✅ |
| Product views | M | `ProductViewLog` | products (beacon) | — | urgency, analytics | beacon | — | ✅ |

### B2. Pricing & promotion

| Fact | Class | Authoritative source | Authoritative service | Projection / cache | Consumers | Mutation path | Reconciliation | Status |
|---|---|---|---|---|---|---|---|---|
| List price | M | `ProductVariant.price ?? Product.basePrice` | product.service | — | pricing engine | product write | — | ✅ |
| Compare-at price | M | `ProductVariant.compareAtPrice ?? Product.compareAtPrice` | product.service | resolved by `resolveUnitPrice` into `product.pricing` | PDP, badges | product write | validation `compareAt > price` | ✅ Phase 2 (server-resolved) |
| Cost price | M | `ProductVariant.costPrice ?? Product.costPrice` | product.service | — | margin UI, BI COGS | product write | — | ⚠️ not snapshotted at sale (M7) |
| Selling (flash) price | D | `resolveUnitPrice` (`packages/shared/src/engines/pricing.ts`) over list price + live flash offer | PricingService (`domain/pricing/pricing.service.ts`) | `product.pricing` read model (`priceProductsForDisplay`); compat `activeFlashSale.flashPrice = pricing.from`; `OrderItem.priceSnapshot` S; `ProductReadModel.minSellingPrice` P for sort/filter/neighbours (Phase 3) | PDP, cards, search, suggestions, homepage, flash feed, wishlist, cart, checkout, orders, reorder | — | A3; PDP = quote = order test; read-model contract test | ✅ Phase 2 + Phase 3 (no storefront path uses `basePrice`) |
| Storefront product DTO | D | `presentStorefrontProducts` (`domain/storefront/read-model.service.ts`): canonical `pricing` + `availability` + compat `activeFlashSale` | Storefront Read Model | — (computed per read) | every storefront product endpoint (listing, search, PDP, by-ids, trending, recommendations, rails, flash feed, wishlist) | — | contract test (same pricing/availability across endpoints) | ✅ Phase 3 |
| Canonical selling-price projection (`minSellingPrice`, `maxSellingPrice`, `listPriceOfMin`, `hasLiveFlashSale`) | P | pricing engine output (`priceProductsForDisplay` → `resolveUnitPrice`) | Storefront Read Model (`refreshReadModels` — sole writer) | table `ProductReadModel` (`sourceHash`, `validUntil`, `volatile`, `computedAt`) | listing price sort/filter, facet bounds, similar/budget/upgrade/premium | read-time guard (`ensureFreshReadModels`); eager refresh after product/flash writes; minute cron; 15-min full rebuild | `GET /api/v1/storefront/read-model/drift`; `POST …/rebuild`; `pnpm --filter api read-model:rebuild` | ✅ Phase 3 |
| Storefront availability / stock state | D | `productAvailability` / `variantStockState` over `ProductVariant.stock` (inventory.service is the only writer) + `trackInventory` (D5) + `lowStockThreshold` (LOW_STOCK is per variant only; product level = UNLIMITED / IN_STOCK / OUT_OF_STOCK) | Storefront Read Model | — (never stored) | cards, PDP, compare, cart low-stock, exchange picker, JSON-LD | — | derived per read; PDP stock re-read live under its cache | ✅ Phase 3 |
| Flash sale live | M/P | `enabled` + window | flash-sale service | `isActive` | pricing, homepage | admin writes `enabled`; service + scheduler derive `isActive` | A7 | ✅ Phase 1 |
| Flash stock limit | M | `FlashSaleItem.stockLimit` (limit) | flash-sale service | — | pricing | admin | — | ✅ Phase 2 (D4 enforced) |
| Flash units sold (quota consumed) | D | Σ (`OrderItem.quantity − restockedQuantity`) over lines with `flashSaleItemId` — released only when units come back to stock (PI-4.3) | PricingService `flashUnitsSold` | — (no counter) | quote, order claim (`FOR UPDATE`) | order creation writes attribution; release/return write `restockedQuantity` | derived, nothing to drift | ✅ Phase 2 |
| Flash attribution of a line | S | `OrderItem.flashSaleId`, `flashSaleItemId` (NULL = not flash-priced / pre-Phase-2) | OrderService (`insertOrderRecord`), ReturnService (exchange) | — | flash units sold, analytics | creation only | verification query (PRICING_INVARIANTS §10) | ✅ Phase 2 |
| Coupon rules | M | `Coupon`, `CouponProduct`, `CouponCategory` | coupon.service | — | checkout, best-coupon, listing | `/api/coupons` | business-rule validation on write | ✅ |
| Coupon discount | D | `evaluateCoupon` (`engines/promotion.ts`), after the bundle (D9) | PricingService | `Order.couponDiscount` S, `OrderItem.couponDiscountAllocated` S | quote, checkout, validate/best, admin order, coupon-form preview | — | backfilled from own snapshot (`discount − bundleDiscount`) | ✅ Phase 2 (client subtotal ignored) |
| Coupon usage | P | redemption predicate: orders with `couponId` and `couponReleasedAt IS NULL` | coupon.service / OrderService | `Coupon.usedCount` (+1 at creation, −1 once on D7 release) | limit checks, admin | order txn; T6 pre-shipment cancel (`releasesCouponUsage`) | A8 (report still to build) | ⚠️ Phase 2: D7 release implemented; usedCount-vs-predicate report pending |
| Coupon release | S | `Order.couponReleasedAt` | OrderService `applyOrderTransition` | — | per-customer redemption count, release idempotency | T6 from PENDING/CONFIRMED/PROCESSING/PACKED | set once, never cleared | ✅ Phase 2 |
| Bundle discount | D | `evaluateBundles` (`engines/promotion.ts`) on post-flash line amounts (D2), before the coupon (D9) | PricingService | `Order.bundleDiscount` S, `OrderItem.bundleDiscountAllocated` S | quote, cart/checkout, bundle preview endpoint | — | — | ✅ Phase 2 |
| Shipping zones & rates | M | `ShippingZone` (key, priority, isDefault, isActive), `ShippingZoneMatch` (POSTCODE/DISTRICT/DIVISION), `ShippingRate` (fee, freeOverAmount) | pricing-config (`loadShippingZones`) | legacy mirrors `StoreSetting.shippingFeeDhaka/OutsideDhaka` = rates of zones `dhaka-district` / `default` (dual-written by settings.service) | quote, courier return fee zone, JSON-LD (mirror) | settings PATCH (dual-write, one txn) | `pricingConfigDrift` / `GET /api/settings/pricing-config-drift` | ✅ Phase 2 (no zone admin UI yet) |
| Shipping fee | D | `resolveShipping` (`engines/shipping.ts`) over zones | PricingService | `Order.shippingFee` S, `Order.shippingZoneKey` S | quote, checkout, order, courier loss | — | — | ✅ Phase 2 (client duplicate + fallbacks removed) |
| Shipping waived | S | quote result (FREE_SHIPPING coupon or zone `freeOverAmount`) | OrderService | `Order.shippingWaived` (NULL = unproven pre-Phase-2 row) | price adjustment, metrics | creation only; backfill only where own arithmetic proves it | verification query | ✅ Phase 2 |
| Tax configuration | M | `TaxSetting` singleton (enabled, mode INCLUSIVE/EXCLUSIVE, defaultRate, shippingTaxable (D10, default true), shippingRate) | pricing-config (`loadTaxConfig`) | legacy mirrors `StoreSetting.taxEnabled/defaultTaxRate` (dual-written) | quote, exchange, analytics estimate (mirror) | settings PATCH (dual-write; `shippingTaxable` only on TaxSetting) | `pricingConfigDrift` | ✅ Phase 2 |
| Tax (VAT component) | D | `computeTax` (`engines/tax.ts`); `taxIncludedIn()` delegates to it | PricingService | `Order.taxMode, taxRate, shippingTaxRate, taxableAmount, taxAmount, shippingTaxAmount` S (new orders only; NULL = not recorded) | quote, invoices (to adopt), analytics estimate | creation only | never recomputed (I17) | ✅ Phase 2 |
| Rounding policy | M | `DEFAULT_ROUNDING_POLICY` (`engines/rounding.ts`) — flash MINOR, % discounts MAJOR, tax MINOR | pricing engines | — | all engines | code (target: `CommerceSettings`) | engine tests | ✅ Phase 2 (one policy; not yet configurable) |
| Quote | D | `buildQuote` via `quoteCart` | PricingService | none stored; token = sha256(fingerprint)[:40], `expiresAt` +15 min advisory | cart, checkout, admin order, coupon/bundle endpoints, order creation | `POST /api/v1/checkout/quote` | stale token → 409 `QUOTE_CHANGED` | ✅ Phase 2 |
| Cart line price (web) | P (display cache) | the quote | web `store/cart.ts` | `CartItem.price` | pixel value only | add to cart | re-quoted on every render | ✅ Phase 2 (never summed) |

### B3. Inventory

| Fact | Class | Authoritative source | Authoritative service | Projection / cache | Consumers | Mutation path | Reconciliation | Status |
|---|---|---|---|---|---|---|---|---|
| Stock on hand | P (balance) | `StockMovement` Σ | inventory.service | `ProductVariant.stock` | checkout, PDP, admin, analytics | inventory.service commands only | A4 | ✅ Phase 1 |
| Stock history | M | `StockMovement` | InventoryService | — | admin movements, audits | same | append-only | ⚠️ reasons too coarse (M2) |
| Available to sell | D | `InventoryRules.availableToSell` | InventoryService | — | checkout, PDP, cart quote | — | — | ❌ `trackInventory` ignored (D5 approved: untracked = unlimited, Phase 2) |
| Purchasable | D | published ∧ ¬deleted ∧ variant active (`isPurchasable`) | shared predicate | — | checkout, exchanges, wishlist, stock alerts, flash sales, bundles | — | regression tests | ✅ Phase 1 (availability for untracked products: D5, Phase 2) |
| Low stock | D | `InventoryRules.isLowStock` (threshold per product) | InventoryService | `stock.low` event | alerts, dashboard, reports | — | — | ❌ three definitions |
| Back-in-stock subscriptions | M | `StockAlert` | stock-alert.service | `notifiedAt` | email sender | subscribe endpoint | — | ⚠️ triggered only from product form (target: `stock.replenished`) |
| Stock value | D | metrics registry | MetricsService | — | BI | — | — | ⚠️ |

### B4. Orders & fulfilment

| Fact | Class | Authoritative source | Authoritative service | Projection / cache | Consumers | Mutation path | Reconciliation | Status |
|---|---|---|---|---|---|---|---|---|
| Order money (subtotal, discount, bundleDiscount, shippingFee, priceAdjustment, total) | S | `Order` columns | OrderService | — | invoices, courier COD, metrics, customer views | written at creation from the quote; `adjustOrderPrice` rewrites total/adjustment via `computeOrderTotals` over the snapshot | I8 | ✅ Phase 2 (one formula) |
| Order pricing breakdown | S | `Order.pricingVersion, flashDiscount, couponDiscount, shippingWaived, shippingZoneKey` + tax fields (B2) | OrderService (`insertOrderRecord`), ReturnService (exchange) | — | price adjustment, analytics, support | creation only | verification queries (PRICING_INVARIANTS §10); NULL = pre-Phase-2 | ✅ Phase 2 |
| Line snapshot | S | `OrderItem.*Snapshot`, `priceSnapshot`, `quantity`, `listPriceSnapshot` | OrderService | — | everything historical | creation only | — | ✅ |
| Line discount allocation | S | `OrderItem.bundleDiscountAllocated`, `couponDiscountAllocated` (exact largest-remainder split) | OrderService | — | exchange paid value (D6), refunds, analytics | creation only | Σ allocations = order discounts | ✅ Phase 2 |
| Order idempotency key | S | `Order.idempotencyKey` (unique) | OrderService | Redis lock `order-idem-lock:<key>` | retrying clients | `Idempotency-Key` header on order create | unique index | ✅ Phase 2 |
| Returned quantity | S | `OrderItem.returnedQuantity` | inventory.service `releaseOrderLines` | — | units sold, returns metric | RETURNED transition, partial-delivery reconcile, exchange | INV-2 | ✅ Phase 1 |
| Restocked quantity | P (per-line idempotency) | `OrderItem.restockedQuantity` (Phase 1) | inventory.service | — | every release/return/trash/restore | same | INV-2, INV-3; backfilled from ledger | ✅ Phase 1 |
| Order status | M | `Order.status` + `OrderStatusHistory` | order.service `applyOrderTransition` (matrix in `packages/shared/src/order-state.ts`) | — | all | admin, bulk, courier, returns, gateway settlement — all through the matrix | history is append-only | ✅ Phase 1 ([ORDER_STATE_MACHINE.md](ORDER_STATE_MACHINE.md)) |
| Courier status | P (external cache) | Steadfast | CourierService | `Order.courierStatus`, `courierStatusSyncedAt`, `courierSyncError` | admin, filters, auto-status | webhook, 15-min cron, manual | staleness timestamp | ✅ |
| Courier loss | S | `CourierLossEvent` | OrderService | — | dashboard | cancel-after-booking, partial return | — | ✅ (amount is a configured estimate) |
| Return / exchange request | M | `ReturnRequest` | ReturnService | — | admin, customer | review endpoint | one-PENDING partial index | ⚠️ approval not atomic |
| Exchange replacement order | M | `Order` linked by `ReturnRequest.exchangeOrderId` | ReturnService | — | admin, metrics | approval | — | ⚠️ counted as a sale by analytics |
| Order trash | M | `Order.deletedAt`, `deletedByAdminId` | OrderService | — | every order query | OWNER endpoints | — | ❌ ignored by analytics, BI, customer spend detail, customer order list |

### B5. Payments

| Fact | Class | Authoritative source | Authoritative service | Projection / cache | Consumers | Mutation path | Reconciliation | Status |
|---|---|---|---|---|---|---|---|---|
| Payment attempt | M | `PaymentSession` (+ `checkoutPayload` S — carries the full quote pricing snapshot and split line snapshots since Phase 2; + `idempotencyKey` unique) | PaymentService | — | callbacks, retry, reconciliation | initiate / callbacks / cron | expiry sweep | ✅ |
| Settlement (money received) | S | `Payment` status `SUCCEEDED`: gateway (`SSLCOMMERZ`/`EPS_PG`, + `rawResponse`), `COD` (collected at delivery, D1), `MANUAL` (staff-recorded) | PaymentLedger (`domain/payments/payment-ledger.service.ts`) — sole writer | — | position, refunds, overview, (Phase 5) collected cash | gateway settle (atomic claim, amount re-verified); T4 `recordCodCollection`; `POST /orders/:id/payments`; manual order `markPaid` | append-only; backfilled rows flagged `backfilled` | ✅ Phase 4 |
| Payment timeline | S | `PaymentEvent` | PaymentService | — | admin | fire-and-forget writes | — | ⚠️ fire-and-forget (target: outbox) |
| Refund | S | `Refund` (`REQUESTED → COMPLETED`, one-way) | PaymentLedger — sole writer | — | position, order, BI, overview | `POST /orders/:id/refunds` (partial + repeated, ≤ refundable, `Idempotency-Key`); exchange downgrade `requestRefund`; `POST …/refunds/:id/complete` | PL-2 violation report | ✅ Phase 4 (STAFF can still record — Phase 10) |
| Payment position (paid, refunded, pending, balance due, `codToCollect`, refundable, refund due, overpaid) | D | `derivePaymentPosition` (`packages/shared/src/engines/payment-ledger.ts`) over the order's `Payment` + `Refund` rows + `Order.total` | PaymentLedger | none stored; `OrderPaymentSummary` read model (`order.payment`) | courier `cod_amount` (single + bulk), admin order page, shipping labels, refund form, price-adjustment guard | — | derived per read | ✅ Phase 4 |
| Order payment status | P | `derivePaymentPosition(...).status` (PAYMENT_LEDGER §4): UNPAID / PAID / FAILED / PARTIALLY_REFUNDED / REFUNDED | PaymentLedger `refreshPaymentStatus` — sole writer | `Order.paymentStatus` | filters, refund queue (`REFUND_QUEUE_WHERE`), T8 guard, BI | every ledger command, in its transaction | `GET /api/payment-admin/ledger/drift`; `POST …/repair` (OWNER, dry run default); `pnpm --filter api payment-ledger:reconcile [--apply]` | ✅ Phase 4 (I9 implemented) |
| Payment method enablement | M | `StoreSetting.codEnabled/onlinePaymentEnabled/epsPaymentEnabled` → target `ProviderConfig.enabled` | Config / Payment | settings cache 300 s | checkout UI + server guard | settings PATCH | — | ⚠️ `updateSettings` guard ignores EPS |
| Provider credentials | M | env vars → target `ProviderConfig` (encrypted) | Config | — | providers | deploy / setup wizard | — | ❌ env only |

### B6. Customers & loyalty

| Fact | Class | Authoritative source | Authoritative service | Projection / cache | Consumers | Mutation path | Reconciliation | Status |
|---|---|---|---|---|---|---|---|---|
| Customer identity | M | `Customer` (+ guest rows matched by phone/email) | CustomerService | — | orders, auth, CRM | register/login/checkout | merge on login | ✅ |
| Addresses | M | `Address` | CustomerService | — | checkout | account | one-default partial index | ✅ |
| Lifetime spend / orders / AOV / last order | D | metrics registry over `Order` | MetricsService (target `CustomerStats` P) | — | CRM list, drawer, segments, SMS vars, RFM | — | cross-surface test | ❌ list excludes trashed, drawer spend includes them |
| Tags / risk signals | D | `computeCustomerTags`, `computeRiskSignals` | CustomerService | — | CRM, BI | — | — | ✅ (single function) but loads all customers in memory |
| Delivery score | P (external) | courier fraud check | CustomerService + FraudCheckProvider | `Customer.delivery*` | admin | checkout, bulk | A6 | ✅ |
| Reward points balance | P | `RewardPointsEntry` Σ | LoyaltyService | `Customer.rewardPoints` | account, admin, BI | `awardDeliveryPoints` (base = `rewardableMerchandiseValue`: subtotal − bundle − coupon, excl. shipping/shipping VAT/tax/admin adjustment — PRICING_INVARIANTS PI-9.4), `reverseDeliveryPoints` (T7 full, refund proportional), `adjustRewardPoints` | report Σ vs balance | ✅ D8 Phase 2; ⚠️ manual adjust check not atomic |
| Marketing consent | M | `smsMarketingOptIn`, `emailMarketingOptIn`, `NewsletterSubscriber` | CustomerService | — | campaigns | account, unsubscribe link | — | ✅ |
| Blocked / COD risk flags | M | `Customer.isBlocked`, `codRisk` | CustomerService | — | checkout, admin | admin | — | ✅ |
| Server cart mirror | P | browser cart (authoritative) | cart.service | `Cart`, `CartItem` | abandonment analytics | debounced sync | — | ⚠️ `reminderSentAt` unused, recovery job missing |
| Wishlist | M | `WishlistItem` (+ `priceAtAdd` S) | wishlist.service | local store for guests | account, price-drop | wishlist endpoints | merge on login | ⚠️ price-drop compares `basePrice` only |

### B7. Analytics & metrics (target definitions in TARGET_ARCHITECTURE §11)

| Metric | Authority | Service | Current implementations | Status |
|---|---|---|---|---|
| Revenue / gross sales | `Order.total` over `SALE_ORDER` | MetricsService | `getOrderStats.todayRevenue`, `getDashboardSummary`, `getRevenueSeries`, BI `revenue*`, ~50 raw SQL copies | ❌ |
| Net sales | gross − returns − refunds | MetricsService | none | ❌ |
| Orders count / AOV | `SALE_ORDER` | MetricsService | dashboard, BI, customer drawer | ❌ |
| Units sold | `OrderItem.quantity − returnedQuantity` | MetricsService | analytics (`!= CANCELLED`), product sales panel (`NOT_A_SALE`) | ❌ |
| Gross profit / COGS | snapshot cost (target) | MetricsService | BI (current cost) | ⚠️ |
| Conversion rate | sessions with sale ÷ sessions | MetricsService | analytics funnel, BI | ⚠️ |
| Visitors / returning | `PageView` | MetricsService | analytics, BI | ⚠️ |
| Refund / return / cancel rates | `Refund`, `ReturnRequest(APPROVED)`, status | MetricsService | BI (counts any return request incl. rejected/pending) | ❌ |
| Low-stock count | `InventoryRules.isLowStock` | MetricsService | dashboard (`≤ 5`) | ❌ |
| Stock value | `stock × cost` purchasable | MetricsService | BI | ⚠️ |
| Courier loss | `CourierLossEvent` | MetricsService | dashboard | ✅ |
| Estimated tax | `TaxEngine` / snapshot (`Order.taxAmount` for orders with `pricingVersion`) | MetricsService | analytics estimate (inclusive formula over revenue; PRICING_INVARIANTS §9) | ⚠️ switch to Σ snapshot in Phase 5 |
| Business day / timezone | `CommerceSettings.timezone` | ConfigService | server-local, UTC and Asia/Dhaka in different places | ❌ |

### B8. Settings, content, notifications, audit

| Fact | Class | Authoritative source | Authoritative service | Projection / cache | Consumers | Mutation path | Reconciliation | Status |
|---|---|---|---|---|---|---|---|---|
| Store profile & branding | M | `StoreSetting` → `StoreProfile` | ConfigService | Redis 300 s, Next cache | layout, SEO, emails | OWNER PATCH | — | ⚠️ email template hard-codes brand name |
| Currency / locale / timezone / country | M | target `CommerceSettings` | ConfigService | — | engines, formatting, metrics | setup wizard | — | ❌ hard-coded BDT, Asia/Dhaka, Bangladesh geography |
| Theme tokens | M | target `ThemeSettings` | ThemeService | CSS variables | web | admin | — | ❌ build-time `packages/ui-tokens` |
| Feature flags | M | target `FeatureFlag` | ConfigService | Redis | API guards, web | admin | — | ❌ none |
| SMS notification toggles & templates | M | `SmsNotificationSetting`, `SmsTemplate` | sms-settings/sms-template services | — | order SMS, CRM SMS | OWNER | — | ✅ |
| SKU pattern | M | `CatalogSetting` | catalog.service | — | generator | OWNER | validated on write | ✅ |
| Homepage layout | M | `HomepageSection`, `Banner` | content services | Next cache | homepage | admin | singleton rules in service | ✅ |
| Social links / payment badges | M | `SocialLink`, `PaymentMethodOption` | content services | — | footer, checkout | admin | — | ✅ |
| Trust badges, policy pages | M | target `ContentBlock` | ContentService | — | PDP, footer pages | admin | — | ❌ hard-coded TSX |
| Admin notifications | S | `Notification` | notify() → NotificationService | — | admin bell | fire-and-forget | — | ⚠️ target: event subscriber |
| Admin audit trail | S | `AuditLog` (+ product audit events) | audit | — | admin history | middleware + product service | append-only | ✅ |
| Order timeline | S | `OrderStatusHistory` | OrderService | — | admin, customer | status/details/hold/price changes | append-only | ✅ |

---

## Part C — Invariants to automate (Phase 1)

| # | Invariant | Owner |
|---|---|---|
| I1 | `ProductVariant.stock = Σ StockMovement.change` | Inventory |
| I2 | per (order, variant): Σ restock/release ≤ Σ ORDER movements | Inventory |
| I3 | `Product.isActive = (status = 'PUBLISHED')` and `deletedAt IS NOT NULL ⇒ status <> 'PUBLISHED'` | Catalog |
| I4 | `Product.avgRating/reviewCount` = APPROVED aggregate | Reviews |
| I5 | `Customer.rewardPoints = Σ RewardPointsEntry.points` | Customers |
| I6 | `Coupon.usedCount` = redemption-predicate count | Promotion |
| I7 | `FlashSale.isActive = enabled ∧ startsAt ≤ now ≤ endsAt` | Promotion |
| I8 | `Order.total = subtotal − discount + shippingCharged + priceAdjustment (+ tax if exclusive)` | Orders |
| I9 | `Order.paymentStatus` consistent with Payment/Refund rows | Payments |
| I10 | every `Product.typeId` not null | Catalog |
| I11 | same metric id returns the same value on every surface for the same range | Metrics |
| I12 | every `Order.status` change satisfies the transition matrix; no transition out of `CANCELLED`/`RETURNED`/`REFUNDED` except `→ REFUNDED` | Orders |
| I13 | per order line: `0 ≤ returnedQuantity ≤ quantity`, `0 ≤ restockedQuantity ≤ quantity`; Σ order-linked movements = `−quantity + restockedQuantity` | Inventory |
| I14 | only `inventory.service.ts` writes `ProductVariant.stock` / `StockMovement` | Inventory (architecture test) |
| I15 | `deletedAt IS NOT NULL ⇒` never purchasable | Catalog |
| I16 | COD ∧ status `DELIVERED` ⇒ `paymentStatus ∈ {PAID, REFUNDED}`; status `REFUNDED` ⇒ `paymentStatus = REFUNDED` (for transitions made from Phase 1 on) | Payments |
| I17 | historical `Order` money fields and `OrderItem` snapshots are never recomputed | Orders |

| I18 | an order line priced at a flash price has `flashSaleItemId`; per `FlashSaleItem`: net units sold ≤ `stockLimit` (except paid settlements) | Promotion |
| I19 | `Σ OrderItem.bundleDiscountAllocated = Order.bundleDiscount` and `Σ couponDiscountAllocated = Order.couponDiscount` for orders with `pricingVersion` | Orders |
| I20 | the quote shown, the order charged and the PDP price agree for the same cart and time | Pricing |
| I21 | legacy `StoreSetting` tax/shipping mirrors equal `TaxSetting` / legacy zone rates (`pricingConfigDrift` empty) | Pricing |
| I22 | no client-supplied price or subtotal influences a quote or an order | Pricing |

| I23 | Σ completed refunds ≤ Σ settled payments per order; a new refund ≤ `refundable` | Payments |
| I24 | only `payment-ledger.service.ts` writes `Payment`, `Refund`, `Order.paymentStatus` | Payments (architecture test) |
| I25 | the courier COD amount = `codToCollect` (balance due of a COD order); a prepaid order is booked with 0 | Payments |
| I26 | a paid order's total never changes (price adjustment refused once `paid > 0`) | Orders / Payments |

Phase 1 implements and tests I1 (reconciliation test), I3, I7, I12–I17. Phase 2 implements and tests I8 (via
`computeOrderTotals`), I18–I22 (`pricing.integration.test.ts`, `pricing-engines.test.ts`). Phase 4 implements and tests
I9 (as PAYMENT_LEDGER PL-1, with a drift report) and I23–I26 ([PAYMENT_LEDGER.md](PAYMENT_LEDGER.md) §13).
