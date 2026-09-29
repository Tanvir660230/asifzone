# Pricing Pipeline

**Status:** Phase 2 — the pipeline below is **implemented** as one canonical pipeline: pure engines in
`packages/shared/src/engines` orchestrated by `apps/api/src/domain/pricing/pricing.service.ts` (`quoteCart`), exposed
as `POST /api/v1/checkout/quote`. Invariants, snapshot fields and the duplicate-calculation audit:
[PRICING_INVARIANTS.md](PRICING_INVARIANTS.md). Business rules: [BUSINESS_DECISIONS.md](BUSINESS_DECISIONS.md).

## 1. Pipeline (server, authoritative)

```
List Price → Variant Price → Flash Sale (D4 stock limit, line split) → Subtotal
  → Bundle Discount (D2 post-flash) → Coupon Discount (D9 after bundle) → Discount clamp
    → Shipping (zones; waived by FREE_SHIPPING coupon or free-over threshold)
      → Tax (D3 inclusive by default; D10 shipping VAT from the tax configuration)
        → Final Total   (→ optional admin price adjustment after placement, from the snapshot)
```

| Step | Rule | Engine | Rounding |
|---|---|---|---|
| 1. List price | `ProductVariant.price ?? Product.basePrice` | `resolveUnitPrice` (`engines/pricing.ts`) | stored 2 dp |
| 2. Compare-at | flash → list; else `variant.compareAt ?? (variant.price ? null : product.compareAt)` if > list | `resolveUnitPrice` | — |
| 3. Flash sale | live = `enabled ∧ window`; deterministic pick (best price, earliest `endsAt`, smallest item id); `PERCENTAGE` → `list × (1 − v/100)`, `FIXED` → `list − v`, floor 0; at most `stockLimit − unitsSold` units (D4) — the rest of the line at the list price | `selectFlashOffer`, `flashUnitPrice`, `priceLineSegments` | price to paisa |
| 4. Line / subtotal | Σ segments (post-flash) | `buildQuote` | — |
| 5. Bundle | best eligible category bundle on post-flash line amounts (D2); tie: discount, `sortOrder`, id; allocated to matched lines | `evaluateBundles` (`engines/promotion.ts`) | % to whole taka |
| 6. Coupon | validity, usage (D7 redemption predicate), per-customer / first-order; `minOrderAmount` and the discount base are merchandise **after the bundle** (D9); scope → eligible lines; `PERCENTAGE` capped by `maxDiscountAmount` and eligible amount; `FIXED` capped; `FREE_SHIPPING` waives shipping | `evaluateCoupon` | % to whole taka |
| 7. Discount clamp | `discount = min(bundle + coupon, subtotal)`; split recorded (`bundleDiscount`, `couponDiscount`) | `computeOrderTotals` | — |
| 8. Shipping | zone by priority, then specificity (POSTCODE > DISTRICT > DIVISION), else default zone; fee from `ShippingRate`; waived by coupon or `freeOverAmount` on merchandise after discounts | `resolveShipping` (`engines/shipping.ts`) | stored 2 dp |
| 9. Tax | `TaxSetting`: INCLUSIVE (default) → VAT inside merchandise and (if `shippingTaxable`) shipping, total unchanged; EXCLUSIVE → VAT added | `computeTax` (`engines/tax.ts`) | paisa |
| 10. Total | `max(0, subtotal − discount + shippingCharged + taxAdded)` | `computeOrderTotals` | — |
| 11. After placement | `adjustOrderPrice`: the same `computeOrderTotals` over the order's snapshot + signed adjustment | `computeOrderTotals` | — |

All steps run in integer minor units (`Money`). Rounding policy: PRICING_INVARIANTS §2.

### 1a. Dependency graph (tax ⇄ shipping)

The approved business sequence is `List → Variant → Flash → Bundle → Coupon → Tax → Shipping → Total`. What the
engine guarantees is the **business result and the data dependencies** below, not a literal execution order:

```
 list/variant price ─► flash ─► subtotal ─► bundle ─► coupon ─► merchandise after discounts ──┬──► MERCHANDISE TAX
                                                                                               │   (merchandise only)
 address + zones + coupon FREE_SHIPPING + merchandise after discounts (free-over) ──► SHIPPING  │
                                                            RESOLUTION ─► shipping charged ───┼──► SHIPPING TAX (D10)
                                                                                               │   (shipping charge only)
                                                              TAX AGGREGATION (one computeTax) ◄┘
                                                                        │
                    computeOrderTotals (OrderTotalsEngine) — the final total, computed once
```

1. Merchandise pricing and merchandise tax are one concern: merchandise VAT depends only on merchandise after bundle
   and coupon discounts, never on shipping.
2. Shipping resolution (zone, fee, waiver) determines the actual shipping charge.
3. Shipping tax depends only on that resolved charge (0 when waived or unresolved), under the central tax
   configuration (`TaxSetting.shippingTaxable`, `shippingRate`).
4. Tax aggregation (`computeTax`, the only tax calculation) therefore runs after shipping resolution, over the two
   independent parts. There is no second tax calculation anywhere.
5. The final total is computed once, by `computeOrderTotals`, from subtotal, discounts, shipping charged, tax added
   (exclusive mode only) and any price adjustment.

Tests (`apps/api/src/lib/pricing-engines.test.ts`, *tax ⇄ shipping dependency*): merchandise tax is the same for any
shipping fee; shipping VAT is correct on the resolved charge (0 when waived or unresolved); changing the shipping fee
changes only the shipping-tax component (inclusive and exclusive modes); the final total is deterministic and equals
`computeOrderTotals` over the quote's parts.

## 2. Consumers (all on the one pipeline)

| Consumer | How |
|---|---|
| PDP, product cards, listings, search results and suggestions, homepage, flash-sale feed, quick view, compare bar, JSON-LD, reorder | `product.pricing` read model from `priceProductsForDisplay` (same `resolveUnitPrice`) |
| Cart page, cart drawer, sticky cart bar | `useCartQuote()` → `POST /api/v1/checkout/quote` |
| Checkout | quote with coupon + address; coupon apply = requote; best coupon = `/quote/best-coupon`; submits `quoteToken`; 409 `QUOTE_CHANGED` → shows the new quote |
| Storefront order (COD), gateway initiation | `deriveOrderPricing` → `quoteCart` inside the order path; token check; snapshot written |
| Gateway settlement | charges the quote frozen in `PaymentSession.checkoutPayload` (never recomputed) |
| Admin manual order | same quote (staff may pass `customerId` for coupon limits); page renders the quote |
| Exchange (D6) | `quoteCart` with `promotions: "FLASH_ONLY"`, current prices; difference collected or refunded |
| Coupon validate / best, bundle preview | read the quote; client `subtotal` ignored |
| Price adjustment | `computeOrderTotals` from the snapshot |
| Invoices, order views, analytics | read the snapshot (PRICING_INVARIANTS §8–§9) |

## 3. Behaviour changes vs Phase 1 (approved decisions)

| ID | Change | Customer-visible effect |
|---|---|---|
| D4 | Flash price limited to `stockLimit` units; extra units at list price; lines split | a cart can mix flash and list units of one variant |
| D5 | `trackInventory = false` never blocks on stock | untracked products always purchasable (max 20 per line) |
| D6 | Exchange at the current effective price; cheaper replacement → refund requested | downgrades now owe money back |
| D7 | Pre-shipment cancellation releases coupon usage | a cancelled order no longer burns a limited coupon |
| D8 | Points on merchandise after discounts (excl. shipping); reversed on return / proportionally on refund | fewer points on discounted orders; returns remove points |
| D9 | Coupon after bundle | coupon amount smaller on carts that also get a bundle |
| D10 | Shipping VAT from the tax configuration (inclusive by default) | none in inclusive mode (breakdown only) |
| D3 | Tax snapshot on each new order | invoices/analytics can read VAT exactly |

Phase 1's D2 (bundle on the post-flash price) is preserved. Rounding changed only where the old code had no policy:
`taxIncludedIn` now returns paisa (130.43, not 130.4348). Prices charged are otherwise identical to Phase 1 for carts
without the D4/D9 situations — covered by the PDP = quote = order test in `pricing.integration.test.ts`.

## 4. Sorting, filtering and price neighbours — resolved in Phase 3

Phase 2 left storefront price **filter/sort/facets** and similar-price recommendations on `Product.basePrice`.
Phase 3 replaced them with the `ProductReadModel` projection. Its `minSellingPrice` is the output of this pipeline's
`resolveUnitPrice` (via `priceProductsForDisplay`), kept fresh by a read-time guard. Nothing in the storefront sorts,
filters or picks neighbours by `basePrice` any more. See [STOREFRONT_READ_MODEL.md](STOREFRONT_READ_MODEL.md).
