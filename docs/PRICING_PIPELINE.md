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

**Order note (tax vs shipping).** The approved target lists `… Coupon → Tax → Shipping → Final Total`. Merchandise
tax is computed on merchandise after bundle and coupon, exactly as listed; it doesn't depend on shipping. Shipping VAT
(D10) has to be computed on the fee actually charged, so the engine resolves shipping first and then runs one
`computeTax` over both parts. The merchandise VAT is the same either way. The only effect of the ordering is that
shipping VAT exists at all.

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

## 4. Known remaining duplicate

Storefront price **filter/sort/facets** and similar-price recommendations still use `Product.basePrice`. Replacing
them needs a maintained `minSellingPrice` projection (TARGET_ARCHITECTURE §5.1) — deferred, recorded in
PRICING_INVARIANTS §12. They affect ordering/filtering only, never an amount shown or charged.
