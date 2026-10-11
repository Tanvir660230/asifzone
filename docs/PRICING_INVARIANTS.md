# Pricing Invariants — Phase 2 (Central Pricing & Quote SSOT)

**Status:** implemented in Phase 2 (branch `phase-2/pricing-quote`). The rules below are what the code enforces;
tests named in each section fail if a rule is broken. Pipeline order: [PRICING_PIPELINE.md](PRICING_PIPELINE.md).
Business rules: [BUSINESS_DECISIONS.md](BUSINESS_DECISIONS.md) D2–D10. Field registry: [SSOT_REGISTRY.md](SSOT_REGISTRY.md) B2/B4.

**The one pricing pipeline**

```
packages/shared/src/engines/          pure: no Prisma, no fetch, no clock (time is an input), integer minor units
  money.ts  rounding.ts  availability.ts  pricing.ts  promotion.ts  shipping.ts  tax.ts  order-totals.ts  quote.ts
apps/api/src/domain/pricing/
  pricing-config.ts   loads TaxSetting / ShippingZone (+ dual-write from legacy settings, drift check)
  pricing.service.ts  quoteCart() — loads catalog, flash offers + units sold, bundles, coupon, customer context,
                      zones, tax config → buildQuote() → Quote + token.  priceProductsForDisplay() — read models.
POST /api/v1/checkout/quote            the server quote (ids + quantities + coupon code + address in; never prices)
POST /api/v1/checkout/quote/best-coupon
```

There is no second implementation of any step. `grep` checks used in the Phase 2 audit are listed in §12.

---

## §1 Money

- PI-1.1 Every engine computes in `Money = { amount: integer minor units, currency }` (BDT: 2 minor digits).
- PI-1.2 Conversion major ↔ minor happens only at boundaries: `fromMajor` (string-parsed, half-up — no float
  multiplication) when loading Decimal columns, `toMajor` when writing snapshots / DTOs (`quoteMoneyToMajor`).
- PI-1.3 Mixing currencies throws. Totals are floored at zero (`clampNonNegative`), never negative.
- PI-1.4 Proportional allocation (bundle/coupon discount → lines, refunds → points) uses BigInt largest-remainder
  (`allocateProportionally`): the parts always sum exactly to the whole.

## §2 Rounding

`RoundingPolicy` (`DEFAULT_ROUNDING_POLICY`) is the single place a fractional result is rounded:

| Quantity | Unit | Why |
|---|---|---|
| Flash unit price | MINOR (paisa), rounds the **price** | identical to the pre-Phase-2 `computeFlashPrice` output |
| Percentage bundle/coupon discount | MAJOR (whole taka) | identical to the pre-Phase-2 coupon/bundle rounding |
| Tax (VAT) | MINOR | stored at 2 dp |

All rounding is half-up on integers (`divRoundHalfUp`). The shared `taxIncludedIn` helper (D3) now delegates to the
engine (`inclusiveTaxOf`) and returns paisa (e.g. VAT in 1000 at 15 % = 130.43, was 130.4348). Tests:
`apps/api/src/lib/pricing-engines.test.ts` (rounding, allocation), `order-state.test.ts` (tax helper).

## §3 Unit price and display read models

- PI-3.1 `resolveUnitPrice` is the only unit-price function: list = `variant.price ?? product.basePrice`;
  selling = list, or the live flash price (§4); compareAt = list during a flash sale, else
  `variant.compareAtPrice ?? (variant.price ? null : product.compareAtPrice)` when greater than list.
- PI-3.2 Storefront reads (PDP, listings, search results, search suggestions, homepage, flash-sale feed, compare bar,
  JSON-LD, reorder) receive `product.pricing` (`ProductPricingDto`: from/to/listFrom/compareAt/flash/variants[id])
  built by `priceProductsForDisplay` with the same `resolveUnitPrice`. `activeFlashSale.flashPrice` is kept as a
  compatibility field equal to `pricing.from`.
- PI-3.3 The web formats these numbers (`apps/web/lib/pricing-display.ts`); it never derives a price from `basePrice`
  and a discount. The fallback to `basePrice` exists only for an object without `pricing` (admin wizard preview of
  unsaved values).
- PI-3.4 Availability is one rule (`isAvailable`, `maxSellableQuantity` in `engines/availability.ts`): D5 — an
  untracked product (`trackInventory = false`) is always available, capped only by `MAX_LINE_QUANTITY` (20).
- PI-3.5 (Phase 3) Every storefront product DTO is built by `presentStorefrontProducts` (Storefront Read Model):
  `pricing` as PI-3.2, plus `availability` (`productAvailability`, derived per read). Price sort, filter, facet bounds
  and price-relative recommendations read `ProductReadModel.minSellingPrice`, a guarded projection of `pricing.from`,
  never `basePrice`. See [STOREFRONT_READ_MODEL.md](STOREFRONT_READ_MODEL.md).

## §4 Flash sales (D4)

- PI-4.1 An offer is live iff `sale.enabled ∧ startsAt ≤ now ≤ endsAt` (Phase 1 lifecycle; `isActive` is a cache).
- PI-4.2 Deterministic selection among live offers with remaining units: lowest price for the customer, then earliest
  `endsAt`, then smallest `flashSaleItemId`.
- PI-4.3 **Quota = currently consumed eligible units** (approved rule, BUSINESS_DECISIONS D4 clarification
  2026-09-29): consumed units of an offer = Σ (`OrderItem.quantity − restockedQuantity`) over order lines attributed to
  that `flashSaleItemId`. Remaining = `stockLimit − consumed`. It is derived from order-line attribution only — never
  inferred from current `FlashSale`/`FlashSaleItem` rows and never kept in a separate mutable counter.
  - A unit consumes quota from order creation, and keeps consuming it through fulfilment: a completed sale stays
    consumed.
  - **Cancellation before fulfilment** (T6 from a pre-shipment status, or `SHIPPED → CANCELLED` when the parcel comes
    back undelivered; trashing a pre-shipment order) puts the unit back in stock and releases its quota.
  - **Returns** release quota only per the return policy: when the returned unit is received back into stock — the
    `RETURNED` transition (T7), partial-delivery reconciliation, or an approved exchange's return of the original item.
    A refund without the goods coming back releases nothing.
  - Restoring a trashed order from Trash re-consumes its units (the order keeps its historical price; while
    consumption is at or above the limit no new flash units are sold).
  - Released quota is available to a new customer's quote/order only after the release has happened; order creation
    re-checks it under lock (PI-4.5).
- PI-4.3a **History is permanent:** an order line's `flashSaleId`, `flashSaleItemId`, `priceSnapshot` and
  `listPriceSnapshot` are written once and never changed — not by cancellation, return, refund, or by editing,
  disabling or deleting the sale (`OrderItem.flashSaleItemId` has no foreign key, so deleting a sale can't null it).
  Releasing quota changes only future availability; it never reprices an existing order.
- PI-4.4 `stockLimit` is enforced per unit: a line is split into segments (flash units up to the remaining quota,
  then list-price units), and each segment becomes its own `OrderItem` row with `flashSaleId`/`flashSaleItemId`
  attribution. **Interpretation:** when overlapping sales cover a product, exhausted units fall back to the list
  price (not to the next sale) — `priceLineSegments` takes one offer per line.
- PI-4.5 Order creation re-checks the quota under `SELECT … FOR UPDATE` on the `FlashSaleItem` rows; if it no longer
  holds, the order is refused with 409 `QUOTE_CHANGED` (no oversell of the flash price under concurrency).
  Exception: a gateway payment that already succeeded settles at the price paid (`allowOversell`), and the limit may
  be exceeded by that settlement — the customer's money is never refused.
- PI-4.6 Pricing never writes inventory: flash attribution is read from order lines; stock movements remain the
  inventory service's (INVENTORY_INVARIANTS INV-1).

Tests (`pricing.integration.test.ts`, *flash-sale stock limit (D4)* and *flash-sale quota lifecycle*): a sale consumes
quota; exhaustion prices further units at the regular price; cancellation releases quota; a return releases it only
when the goods come back (a refund alone does not); historical orders keep their attribution and price after the sale
is edited, disabled and deleted; a later quote and a later customer's order use the released quota; concurrent orders
cannot exceed the quota. Engine tests: limit not reached / exact / exceeded, shared across lines.

## §5 Tax (D3, D10)

- PI-5.1 Authority: `TaxSetting` (singleton) — `enabled`, `mode` (`INCLUSIVE` default | `EXCLUSIVE`), `defaultRate`,
  `shippingTaxable` (default **true**, D10), `shippingRate` (null = store rate). `StoreSetting.taxEnabled/defaultTaxRate`
  are legacy mirrors dual-written by the settings service (§10). `Product.taxRate` remains unused (documented).
- PI-5.2 `computeTax` is the one tax calculation. Inclusive: VAT = gross × bp / (10000 + bp), total unchanged.
  Exclusive: VAT = net × bp / 10000, added to the total (`addedToTotal`). Shipping is taxed at its own rate when
  `shippingTaxable`, VAT-inclusive in inclusive mode — no shipping-VAT code anywhere else.
- PI-5.3 Taxable merchandise = merchandise after bundle and coupon discounts; shipping = the fee actually charged.
- PI-5.4 Every new order snapshots `taxMode, taxRate, shippingTaxRate, taxableAmount, taxAmount, shippingTaxAmount`.
  Tax is never recomputed for an existing order from current configuration.

## §6 Order totals

`computeOrderTotals` is the only final-total formula:
`discount = min(bundle + coupon, subtotal)`, `merchandiseTotal = subtotal − discount`,
`total = max(0, merchandiseTotal + shippingCharged + taxAdded + priceAdjustment)` (`negative` flag when the unclamped
value is below zero). Used by the quote, and by the post-order price adjustment from the snapshot (§9).

## §7 The quote

- PI-7.1 The client sends only variant ids, quantities, coupon code, address (and, for staff, `customerId`).
  A client price or subtotal is never read (coupon validate/best ignore any `subtotal` field).
- PI-7.2 `Quote` = lines (segments with attribution) · listSubtotal · flashDiscount · subtotal · bundle · coupon ·
  discount · merchandiseTotal · shipping · tax · total · appliedPromotions · rejectedPromotions · warnings · orderable.
- PI-7.3 Quote token = first 40 hex chars of sha256 over the quote's fingerprint (every money figure, line
  segmentation, promotions, shipping, tax, `pricingVersion`). `expiresAt` = now + 15 min (advisory for clients).
- PI-7.4 Order paths (storefront COD, gateway initiation, admin manual order) re-quote on the server inside the order
  path. If a `quoteToken` was sent and the new quote's token differs, the order is refused with **409**
  `{ code: "QUOTE_CHANGED", quote }` and the client shows the new quote; a stale price is never charged. Without a
  token (older clients) the server quote is charged as-is.
- PI-7.5 Web consumers: cart page, cart drawer, sticky cart bar, checkout and the admin *New order* page render only
  quote numbers (`hooks/use-quote.ts`). `CartItem.price` is a **display cache** of the server price at add time,
  used only for the Meta Pixel value and never summed into a displayed total.

## §8 Order pricing snapshot (new orders)

Written once, at order creation, from the quote (gateway orders: from the quote frozen in `PaymentSession.checkoutPayload`
at initiation):

| Field | Meaning |
|---|---|
| `Order.pricingVersion` | engine version (`PRICING_VERSION = 2`); NULL = pre-Phase-2 order |
| `Order.subtotal` / `discount` / `bundleDiscount` / `shippingFee` / `total` | unchanged meaning (post-flash subtotal; bundle+coupon; zone fee) |
| `Order.flashDiscount` | Σ (list − flash) over flash-priced units |
| `Order.couponDiscount` | coupon part of `discount` |
| `Order.shippingWaived` | shipping not charged (FREE_SHIPPING coupon or zone free-over threshold) |
| `Order.shippingZoneKey` | zone that priced shipping |
| tax fields | §5 |
| `Order.couponReleasedAt` | D7 release time (NULL = usage still counted) |
| `Order.idempotencyKey` | §11 |
| `OrderItem.priceSnapshot` | unit price charged (unchanged meaning) |
| `OrderItem.listPriceSnapshot` | unit list price at sale |
| `OrderItem.flashSaleId` / `flashSaleItemId` | D4 attribution (NULL = not flash-priced) |
| `OrderItem.bundleDiscountAllocated` / `couponDiscountAllocated` | the line's share of each discount (sums exactly) |
| `OrderItem.unitCostSnapshot` (Phase 6) | per-unit cost at sale, minor units; NULL = unknown (never 0); internal — omitted from every read except metrics |
| `OrderItem.productIdSnapshot` / `categoryIdSnapshot` / `categoryNameSnapshot` / `brandSnapshot` (Phase 6) | attribution at sale; no FKs; NULL category = not recorded (pre-Phase-6) |

## §9 History is immutable

- PI-9.1 No code path recalculates a placed order from current catalog, promotion, tax or shipping configuration.
- PI-9.2 `adjustOrderPrice` recomputes the total with `computeOrderTotals` from the order's own snapshot only
  (`subtotal, bundleDiscount, couponDiscount, shippingWaived, shippingFee, taxMode/taxAmount`) plus the new signed
  adjustment. An order whose `shippingWaived` could not be proven from its own arithmetic is refused (409), not guessed.
- PI-9.3 D6 exchange: the replacement is quoted at the current effective price (flash only; no bundle/coupon/shipping);
  what the customer paid for the returned units is read from the original line snapshot net of its allocations
  (pre-Phase-2 lines: plain line value). Difference > 0 → the exchange order's COD total; < 0 → a `REQUESTED` Refund.
- PI-9.4 **D8 rewardable merchandise value** (approved rule, BUSINESS_DECISIONS D8):

  ```text
  rewardable = merchandise subtotal − bundle discounts − coupon discounts        (never below zero)
  ```

  Excluded: shipping, shipping VAT, tax itself, the admin price adjustment. The one implementation is
  `rewardableMerchandiseValue` (`packages/shared/src/engines/loyalty.ts`); its only inputs are `Order.subtotal`,
  `bundleDiscount` and `couponDiscount` from the order snapshot, so excluded amounts cannot enter it. `loyaltyBase`
  (customer.service) is its only caller-facing wrapper. Pre-Phase-2 orders use the backfilled coupon split
  (`discount − bundleDiscount`). An exchange replacement order also subtracts its exchange credit: the credit is
  the returned item's value, and that value was already rewarded on the original order.
  Points = ⌊rewardable × `rewardPointsPerCurrency`⌋, awarded once on delivery. Reversal: a return (T7) reverses all
  of the order's points; a refund reverses `min(1, refund ÷ rewardable)` of them (a refund counts against merchandise
  first). Total reversal is capped at what was earned, and the balance never goes below zero.
  Tests: engine *rewardable merchandise value (D8)*; integration *loyalty points (D8)*, which uses exclusive VAT,
  taxable shipping and a +500 admin adjustment. It earns exactly (1000 − 200) × 0.1 = 80, and a refund of half the
  rewardable value reverses 40.
- PI-9.5 D7: a transition flagged `releasesCouponUsage` (cancellation from a pre-shipment state) decrements
  `Coupon.usedCount` once (guarded by `couponReleasedAt`) and stamps `couponReleasedAt`; per-customer redemption counts
  exclude released orders.
- PI-9.6 Analytics read snapshots. Classification of pricing fields for metrics:

  | Field | Class | Use in analytics |
  |---|---|---|
  | `subtotal`, `discount`, `bundleDiscount`, `shippingFee`, `priceAdjustment`, `total`, `priceSnapshot` | HISTORICAL SNAPSHOT | revenue, AOV, discount totals (unchanged) |
  | `couponDiscount`, `flashDiscount`, tax fields, allocations, attribution | HISTORICAL SNAPSHOT (NULL before Phase 2) | new breakdowns; NULL means "not recorded", never 0 |
  | `getEstimatedTaxCollected` | **Phase 5:** HISTORICAL SNAPSHOT — Σ `taxAmount` (registry `tax_collected`); orders without a snapshot are counted as coverage, never estimated from the current rate | METRICS_REGISTRY §3 |
  | abandoned-cart `potentialRevenue` | ESTIMATE at list price (ignores flash) | indicative only |
  | Meta Pixel / funnel `value` | DISPLAY CACHE | marketing signal, not revenue |

## §10 Migration, verification, reconciliation

Migration `20260929100000_phase2_pricing_snapshot_tax_shipping` is additive only (no drop, no rewrite of existing
money columns). Backfills use only each row's own data:

- `TaxSetting` ← `StoreSetting.taxEnabled/defaultTaxRate`, mode INCLUSIVE, shippingTaxable true.
- Zones reproducing the old rule exactly: `dhaka-district` (DISTRICT = Dhaka, priority 10, fee = `shippingFeeDhaka`)
  and `default` (default zone, fee = `shippingFeeOutsideDhaka`).
- `Order.shippingWaived` only where the order's own arithmetic proves it; otherwise NULL.
- `Order.couponDiscount` = 0 without a coupon, else `discount − bundleDiscount`.
- Not backfilled (stay NULL, never invented): `flashDiscount`, tax snapshot, `listPriceSnapshot`, flash attribution,
  allocations, `pricingVersion`, `couponReleasedAt`.

Verification queries (run after deploy; expected results in comments):

```sql
SELECT count(*) FROM "TaxSetting";                                                       -- 1
SELECT z.key, r.fee FROM "ShippingZone" z JOIN "ShippingRate" r ON r."zoneId" = z.id;    -- equal StoreSetting fees
SELECT count(*) FROM "Order" WHERE "shippingWaived" IS NULL;                             -- review list (snapshot doesn't add up)
SELECT count(*) FROM "Order" WHERE "couponId" IS NOT NULL AND "couponDiscount" IS NULL;  -- 0
SELECT count(*) FROM "OrderItem" WHERE "flashSaleItemId" IS NOT NULL AND "flashSaleId" IS NULL; -- 0
SELECT count(*) FROM "Order" WHERE "pricingVersion" IS NOT NULL AND "taxMode" IS NULL;  -- 0
```

Test database result: `shippingWaived IS NULL` = 0, `couponDiscount IS NULL (with coupon)` = 0, no Prisma drift.

**Reconciliation (dual-write).** The settings service writes the legacy `StoreSetting` fields and the authorities
(`TaxSetting`, the two legacy zones' `ShippingRate`) in one transaction. `pricingConfigDrift()` compares them;
admins can read it at `GET /api/settings/pricing-config-drift` (empty `drift` = consistent). Pricing reads only the
authorities.

## §11 Idempotency

- `Idempotency-Key` header (printable ASCII, 8–128 chars) on `POST /api/orders` and `POST /api/orders/admin`.
- Same key → the same order is returned (lock `order-idem-lock:<key>` in Redis, then `Order.idempotencyKey` unique;
  a unique-violation race returns the winner). Gateway initiations store it on `PaymentSession.idempotencyKey`.
- Without the header the pre-existing `sessionId` lock behaves exactly as before.

## §12 Duplicate-calculation audit (repository-wide, end of Phase 2)

| Location | What it does | Class |
|---|---|---|
| `packages/shared/src/engines/*`, `apps/api/src/domain/pricing/*` | the pipeline | CANONICAL |
| `packages/shared/src/tax.ts` `taxIncludedIn` | thin wrapper over `inclusiveTaxOf` | CANONICAL (delegates) |
| order/payment/exchange/adjustment code in `orders/`, `payments/`, `return-requests/` | call the quote / `computeOrderTotals` / `computeTax` | CANONICAL consumers |
| `coupons/coupon.controller` validate/best, `bundles/bundle.service` preview | read the quote | CANONICAL consumers |
| product/search/suggestion/homepage/flash feed/reorder reads | `priceProductsForDisplay` | CANONICAL consumers |
| admin coupon form preview | runs `evaluateCoupon` on a sample line | CANONICAL consumer (illustration) |
| invoices, order views, admin order panel, account orders (`priceSnapshot × quantity`) | line totals of a placed order | HISTORICAL SNAPSHOT (display) |
| `engines/loyalty.ts` `rewardableMerchandiseValue` (via `customer.service.loyaltyBase`) | D8 over snapshot fields | CANONICAL (D8) |
| web `pricing-display.ts`, `formatPrice` everywhere | formats server numbers | DISPLAY/FORMATTING |
| admin product list/picker/CSV/audit/duplicate, wishlist `priceAtAdd`, price-drop notice | the stored list price as a catalog attribute | DISPLAY (list price is the fact shown) |
| storefront price filter/sort/facets, similar/budget/upgrade/premium recommendations, trending budget filter | `ProductReadModel.minSellingPrice` (projection of `pricing.from`) / live `pricing.from` | CANONICAL — **resolved in Phase 3** (was DUPLICATE on `basePrice`; STOREFRONT_READ_MODEL.md §1) |
| JSON-LD `shippingDetails` | legacy `StoreSetting.shippingFee*` mirrors (dual-written, drift-checked) | DISPLAY of a mirror |
| `getEstimatedTaxCollected` (Σ snapshot since Phase 5), abandoned-cart `potentialRevenue` (estimate) | analytics | see §9 PI-9.6, METRICS_REGISTRY |
| admin wizard live preview | typed-in values of an unsaved product | DISPLAY |

Removed in Phase 2: `orders/cart-lines.ts` (`effectivePrice`/`resolveCartLines`), `computeFlashPrice` /
`getActiveFlashInfoByProduct`, the coupon evaluator in `coupon.service.ts`, `getCandidateBundleMatches` /
`evaluateBundleForItems`, the checkout page's subtotal/shipping/total math and `SHIPPING_FEE_*` fallbacks,
`useCartSubtotal`, the admin *New order* page's price math.
