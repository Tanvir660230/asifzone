# Pricing Pipeline

**Status:** Phase 1 — documents the pipeline *as implemented* (discovered from the code), the one
Phase 1 change (bundle base, D2), the tax model (D3), and the Phase 2 target. The single place this
pipeline is assembled today is `deriveOrderPricing` in `apps/api/src/modules/orders/order.service.ts`.

## 1. Current pipeline (server, authoritative)

| Step | What happens | Code | Rounding |
|---|---|---|---|
| 1. List price | `ProductVariant.price` if set, else `Product.basePrice` | `effectivePrice` in `orders/cart-lines.ts` | stored 2 dp |
| 2. Flash sale | if the product is in a live flash sale (enabled and `startsAt ≤ now ≤ endsAt`): `PERCENTAGE` → `list × (1 − v/100)`, `FIXED` → `list − v`, floor 0 | `computeFlashPrice` in `flash-sales/flash-sale-pricing.ts` | 2 dp |
| 3. Line total | `unit × quantity`; the unit price is snapshotted to `OrderItem.priceSnapshot` | `resolveCartLines` | — |
| 4. Subtotal | Σ line totals (after flash) | `resolveCartLines` | — |
| 5. Coupon | validity window, usage limit, per-customer / first-order limits, `minOrderAmount` (vs. step-4 subtotal), scope → eligible lines; `PERCENTAGE` on eligible amount, capped by `maxDiscountAmount` and by the eligible amount; `FIXED` capped by eligible amount; `FREE_SHIPPING` → discount 0 + waive flag | `evaluateCoupon` in `coupons/coupon.service.ts` | percentage rounded to whole currency units |
| 6. Bundle | best eligible category bundle; discount on the matched lines (anchor + matched suggestion categories); `PERCENTAGE` or `FIXED`, capped by matched amount | `evaluateBundleForItems` in `bundles/bundle.service.ts` | percentage rounded to whole currency units |
| 7. Stacking | coupon and bundle are computed **independently** from the same step-4 line amounts and **added**: `discount = min(coupon + bundle, subtotal)`; `Order.bundleDiscount` stores the bundle part | `deriveOrderPricing` | — |
| 8. Tax | **not added** — catalogue prices are tax-inclusive (D3) | — | — |
| 9. Shipping | `isInsideDhaka(district) ? shippingFeeDhaka : shippingFeeOutsideDhaka` from `StoreSetting`; a `FREE_SHIPPING` coupon waives it (the fee is still stored in `Order.shippingFee`) | `deriveOrderPricing`, `packages/shared/src/delivery.ts` | stored 2 dp |
| 10. Total | `subtotal − discount + (waived ? 0 : shippingFee)` | `deriveOrderPricing` | — |
| 11. After placement | admin *price adjustment* (signed) replaces `priceAdjustment` and recomputes `total = subtotal − discount + shippingOwed + priceAdjustment` | `adjustOrderPrice` | — |

Gateway payments snapshot steps 1–10 into `PaymentSession.checkoutPayload` at initiation and charge
exactly that at settlement (never recomputed).

### Precedence summary (today, after Phase 1)

```
List price (variant override → product base)
  → Flash sale (per product, replaces the unit price)
    → Subtotal
      → Coupon  ┐ computed side by side on the post-flash line amounts,
      → Bundle  ┘ then added and clamped to the subtotal
        → Tax: included in the price (not added)
          → Shipping (zone fee, or waived by FREE_SHIPPING)
            → Total   (→ optional admin price adjustment after placement)
```

## 2. Phase 1 change — D2: bundles use the effective (post-flash) price

**Before:** `getCandidateBundleMatches` priced cart lines as `variant.price ?? basePrice`, ignoring any
running flash sale, while the subtotal, the coupon and the charged line prices all used the flash price.
A bundle discount could therefore be larger than what the customer was actually paying for the matched
items. **Now:** the bundle's matched amount uses the same `effectivePrice` (list → flash) as the subtotal.
Regression test: `apps/api/src/modules/bundles/bundle.integration.test.ts`.

Nothing else in the stacking order changed in Phase 1.

## 3. Tax model — D3: tax-inclusive prices

- The customer-facing price is the tax-inclusive selling price. Checkout adds **no** tax line, and the
  total is never increased by tax. This was already true; Phase 1 does not change what anyone is charged.
- VAT contained in an amount `A` at rate `r%` is `A × r / (100 + r)`; the taxable (net) amount is `A − VAT`.
  The shared helper `taxIncludedIn(amount, ratePct)` (`packages/shared/src/tax.ts`) is the only
  implementation.
- **Contradictions found and how Phase 1 handles them**

  | Where | Assumption | Phase 1 action |
  |---|---|---|
  | `StoreSetting.taxEnabled`, `defaultTaxRate` | a store-wide rate | unchanged; read by the helper |
  | `Product.taxRate` | per-product rate; stored, exported, audited, never used in any calculation | unchanged (documented as unused) |
  | `analytics.getEstimatedTaxCollected` | computed `revenue × rate/100` — the *tax-exclusive* formula applied to tax-inclusive revenue, overstating VAT by a factor of `(100 + r)/100` | **fixed** to `taxIncludedIn(revenue, rate)`; regression test in `apps/api/src/lib/order-state.test.ts` ("tax-inclusive VAT") |
  | `OrderItem`, `Order` | no tax snapshot | unchanged — historical orders are not recalculated. Phase 2 adds `Order.taxAmount` for new orders only |

## 4. Known duplicates still present (Phase 2 scope, not changed in Phase 1)

The storefront and admin still compute display prices themselves (`product-showcase.tsx`,
`use-add-to-cart.ts`, the admin *New order* page, product cards) and the storefront `activeFlashSale.flashPrice`
is computed from `basePrice`, not the variant price. The checkout page recomputes the total from
localStorage prices. The server remains the authority for what is charged. Phase 2 replaces all of these
with one pure pricing engine in `packages/shared` and a server `quote` endpoint (TARGET_ARCHITECTURE §5.1).

## 5. Phase 2 target (approved 2026-09-28, not yet implemented)

```
List Price → Variant Price → Flash Sale → Bundle Discount → Coupon Discount → Tax → Shipping → Final Total
```

Approved rules that change the pipeline in Phase 2 ([BUSINESS_DECISIONS.md](BUSINESS_DECISIONS.md)):

| ID | Pipeline effect |
|---|---|
| D4 | Flash price applies to at most `FlashSaleItem.stockLimit` units; further units in the same line use the normal effective price (line split). |
| D5 | `trackInventory = false` skips the stock-availability rejection. |
| D6 | Exchange quotes use the current effective selling price; the difference may be collected or refunded. |
| D7 | Coupon usage is released by a cancellation before shipping (order effect, not a price step). |
| D8 | Loyalty base = merchandise after discounts, excluding shipping (order effect, not a price step). |
| D9 | Coupon is computed on the amount **after** the bundle discount — replaces today's side-by-side stacking (step 7 above). This changes coupon amounts on carts that qualify for both. |
| D10 | Shipping is VAT-inclusive by default; its VAT treatment comes from the centralised tax configuration. |

Until Phase 2 ships them, §1 describes what the system actually charges.
