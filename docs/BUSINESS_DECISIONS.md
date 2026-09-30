# Business Decision Register

The authoritative record of approved commerce business rules. Engines, services and metrics implement what is
recorded here; when code and this register disagree, the register wins and the code is the defect. A decision
is changed only by recording a new dated entry here (never by editing a rule in place without a trace).

Related: [TARGET_ARCHITECTURE.md §16](TARGET_ARCHITECTURE.md) · [PRICING_PIPELINE.md](PRICING_PIPELINE.md) ·
[ORDER_STATE_MACHINE.md](ORDER_STATE_MACHINE.md) · [INVENTORY_INVARIANTS.md](INVENTORY_INVARIANTS.md) ·
[SSOT_REGISTRY.md](SSOT_REGISTRY.md)

**Approver:** the store owner. **Approved date for every entry below:** 2026-09-28.

## Summary

| ID | Topic | Status | Implemented in |
|---|---|---|---|
| D1 | Revenue recognition (COD, returns, refunds) | APPROVED · IMPLEMENTED (refund term pending PD-5.1) | Phase 1 (facts) · Phase 5 (metrics — [METRICS_REGISTRY.md](METRICS_REGISTRY.md)) |
| D2 | Bundle discount on the post-flash price | APPROVED | Phase 1 |
| D3 | Tax-inclusive pricing | APPROVED · IMPLEMENTED | Phase 1 (helper, analytics fix) · Phase 2 (tax engine, snapshot) |
| D4 | Enforce `FlashSaleItem.stockLimit` | APPROVED · IMPLEMENTED | Phase 2 |
| D5 | `trackInventory = false` means unlimited availability | APPROVED · IMPLEMENTED | Phase 2 |
| D6 | Exchange pricing at the current effective price | APPROVED · IMPLEMENTED | Phase 2 |
| D7 | Release coupon usage on cancellation before shipping | APPROVED · IMPLEMENTED | Phase 2 |
| D8 | Reward points on discounted merchandise, reversed on return/refund | APPROVED · IMPLEMENTED | Phase 2 |
| D9 | Bundle first, then coupon | APPROVED · IMPLEMENTED | Phase 2 |
| D10 | Shipping VAT-inclusive by default, configurable | APPROVED · IMPLEMENTED | Phase 2 |

Phase 2 implemented D3–D10 in the canonical pricing pipeline ([PRICING_PIPELINE.md](PRICING_PIPELINE.md),
[PRICING_INVARIANTS.md](PRICING_INVARIANTS.md)). The interpretations Phase 2 had to make where a decision's wording
left a detail open are listed under *Phase 2 implementation notes* at the end. They are recorded, not silently
decided, and the owner may overrule any of them with a new dated entry.

---

## D1 — Revenue recognition
- **Decision:** For COD, placed / confirmed / shipped are not revenue; `DELIVERED` counts toward realised (gross)
  revenue; `RETURNED` reverses the returned amount; refunds subtract the refunded amount. Gross Sales, Discounts,
  Returns, Refunds, Realised Revenue, Collected Cash and Outstanding COD are separate metrics. COD order creation is
  never cash collection.
- **Approved:** 2026-09-28 · **Status:** APPROVED · **Implementation:** Phase 1 (COD becomes `PAID` on delivery,
  per-line `returnedQuantity`, refunds in `Refund`); Phase 5 (metric definitions in TARGET_ARCHITECTURE §11).

## D2 — Bundle + flash sale
- **Decision:** Bundle discounts operate on the effective selling price after the flash sale, unless an explicit
  promotion rule says otherwise.
- **Approved:** 2026-09-28 · **Status:** APPROVED · **Implementation:** Phase 1 (`bundle.service.ts`).

## D3 — Tax-inclusive pricing
- **Decision:** Customer-facing prices are tax-inclusive. Preserve subtotal, taxable amount, VAT component and total;
  never double-charge tax; never recalculate historical orders.
- **Approved:** 2026-09-28 · **Status:** APPROVED · IMPLEMENTED (Phase 2) · **Implementation:** Phase 1 (`taxIncludedIn()`, analytics VAT
  estimate); Phase 2 (per-order tax snapshot for new orders).

## D4 — Flash sale stock limit
- **Decision:** ENFORCE `FlashSaleItem.stockLimit`. Once the flash-sale quantity limit is exhausted, further units use
  the normal effective selling price.
- **Approved:** 2026-09-28 · **Status:** APPROVED · IMPLEMENTED (Phase 2) · **Implementation:** Phase 2 (PromotionEngine + PricingService).
- **Authority / representation:** the limit is `FlashSaleItem.stockLimit` (existing). The count of units already sold
  at the flash price has **no authoritative source today** — `OrderItem` does not record which flash sale priced it.
  Phase 2 must add an additive order-line snapshot of the applied promotion (one field, written at order creation)
  and count against it; it must not add a separate mutable counter without a registered reconciliation.
  A cart line crossing the limit is split into flash-priced and regular-priced units.
- **Clarification — quota release (approved 2026-09-29, Phase 2 sign-off):**
  - The flash-sale quota represents the **currently consumed** eligible units: order lines attributed to the sale
    item, minus units that have come back into stock.
  - Cancellation before fulfilment releases the consumed quota. This covers cancellation from a pre-shipment
    status, an undelivered parcel cancelled back from `SHIPPED`, and trashing a pre-shipment order.
  - Returned units release the quota only per the return policy, i.e. when they are received back into stock
    (`RETURNED`, partial-delivery reconciliation, an approved exchange). A refund without the goods coming back does
    not release quota.
  - Completed sales are never rewritten. A historical order keeps its original flash-sale attribution and price
    forever, even if the sale is later edited, disabled or deleted.
  - A new customer can receive a flash-sale allocation only after quota has actually been released. Order creation
    re-checks the quota under a row lock.
  - Usage is derived from order-line attribution. It is never inferred from current `FlashSale` rows.
  Invariant: [PRICING_INVARIANTS.md](PRICING_INVARIANTS.md) PI-4.3, PI-4.3a.

## D5 — Inventory not tracked
- **Decision:** `trackInventory = false` means unlimited sellable availability. Checkout must not reject a purchase
  because stock is zero. Stock and its ledger are still kept for reporting and operations.
- **Approved:** 2026-09-28 · **Status:** APPROVED · IMPLEMENTED (Phase 2) · **Implementation:** Phase 2 (availability rule in the inventory /
  pricing path).
- **Authority:** `Product.trackInventory` (existing). Movements are still written by `inventory.service.ts`; for an
  untracked product the stock balance may go below zero (a recorded, expected state, excluded from INV-5).

## D6 — Exchange pricing
- **Decision:** Exchanges are priced at the current effective selling price at the time of the exchange quote. The
  price difference is calculated centrally and collected or refunded according to the exchange policy.
- **Approved:** 2026-09-28 · **Status:** APPROVED · IMPLEMENTED (Phase 2) · **Implementation:** Phase 2 (`PricingService` exchange quote).
- **Note:** today an exchange uses the variant's regular price and never refunds a downgrade
  (`return-request.service.ts`). A refund owed on a downgrade is recorded through the existing `Refund` path — no new
  money table.

## D7 — Coupon usage on cancellation
- **Decision:** If an order is cancelled before shipping, its coupon usage is released. Once shipped, it is not.
- **Approved:** 2026-09-28 · **Status:** APPROVED · IMPLEMENTED (Phase 2) · **Implementation:** Phase 2 (order state machine T6 effect).
- **Authority:** the redemption predicate over `Order.couponId`; `Coupon.usedCount` stays the counter used for atomic
  limit enforcement and is decremented once, idempotently, by the cancellation transition from a pre-shipment status.
  "Before shipping" = the order was in `PENDING`, `CONFIRMED`, `PROCESSING` or `PACKED` when cancelled.

## D8 — Reward points
- **Decision:** Points are based on merchandise value after applicable discounts, excluding shipping. The
  corresponding points are reversed when the underlying merchandise is returned or refunded.
- **Approved:** 2026-09-28 · **Status:** APPROVED · IMPLEMENTED (Phase 2) · **Implementation:** Phase 2 (loyalty effect of the DELIVERED and
  RETURNED/refund transitions).
- **Authority:** the `RewardPointsEntry` ledger (existing; reversals are negative entries linked to the order).
  The earning base is computed from order snapshots, never from `Order.total`.
- **Rewardable merchandise value (explicit rule, confirmed 2026-09-29):**

  ```text
  Merchandise subtotal − bundle discounts − coupon discounts
  ```

  Excluded: shipping, shipping VAT, tax itself, and the admin price adjustment. Points are calculated from this
  canonical value (`rewardableMerchandiseValue`); returns and refunds reverse the corresponding points. Invariant:
  [PRICING_INVARIANTS.md](PRICING_INVARIANTS.md) PI-9.4. This is consistent with the original wording. For a
  pre-Phase-2 order, `Σ priceSnapshot × qty − discount` equals the same value, since `discount` = bundle + coupon.

## D9 — Bundle and coupon stacking
- **Decision:** The bundle discount is calculated first; the coupon discount is then calculated on the resulting
  eligible amount. Canonical sequence:

  ```
  List Price → Variant Price → Flash Sale → Bundle Discount → Coupon Discount → Tax → Shipping → Final Total
  ```

  This order is implemented once, in the canonical pricing pipeline — never separately by a consumer.
- **Approved:** 2026-09-28 · **Status:** APPROVED · IMPLEMENTED (Phase 2) · **Implementation:** Phase 2 (PricingEngine / PromotionEngine).
- **Note:** changes coupon amounts on carts that qualify for both, compared with today's side-by-side stacking.

## D10 — Shipping VAT
- **Decision:** Shipping is VAT-inclusive by default. VAT treatment of shipping remains configurable through the
  centralised tax configuration. No separate, hard-coded shipping VAT calculation.
- **Approved:** 2026-09-28 · **Status:** APPROVED · IMPLEMENTED (Phase 2) · **Implementation:** Phase 2 (TaxEngine).
- **Authority / representation:** the centralised tax configuration today is `StoreSetting.taxEnabled` +
  `defaultTaxRate` (+ unused `Product.taxRate`). It has **no field for shipping VAT treatment**. Phase 2 adds one
  additive setting to that same configuration (default: shipping is VAT-inclusive at the store rate) — not a second
  tax configuration.

---

## Representation gaps (resolved in Phase 2)

| Decision | Gap | Resolution (additive, one authority) |
|---|---|---|
| D4 | No record of which flash sale priced an order line | `OrderItem.flashSaleId` / `flashSaleItemId` written at order creation; units sold = Σ (quantity − restockedQuantity) of attributed lines. No separate mutable counter. |
| D10 | No shipping-VAT setting | `TaxSetting.shippingTaxable` (+ optional `shippingRate`) in the tax authority, which absorbs `StoreSetting.taxEnabled/defaultTaxRate` (kept as dual-written mirrors). |
| D3 | No per-order tax snapshot | `Order.taxMode, taxRate, shippingTaxRate, taxableAmount, taxAmount, shippingTaxAmount` for new orders only; history stays NULL. |
| D7 | No record of a release | `Order.couponReleasedAt` (idempotency guard + redemption predicate). |

All registered in [SSOT_REGISTRY.md](SSOT_REGISTRY.md) (B2, B4).

## Phase 2 implementation notes (interpretations, recorded 2026-09-29)

| Decision | Interpretation | Why |
|---|---|---|
| D4 | Quota release on cancellation/return — **now an approved rule** (see the D4 clarification above). | Approved at Phase 2 sign-off, 2026-09-29. |
| D4 | With overlapping sales on one product, units beyond the chosen sale's limit fall back to the **list** price, not to another sale's price. | One offer per line keeps attribution to one sale per segment. Rare configuration. |
| D4 | A gateway payment that succeeds after the limit ran out is still settled at the price paid (may exceed the limit). | The customer has paid; refusing would need a refund flow. Admin alert as for stock oversell. |
| D5 | Untracked lines are capped at 20 units per line (`MAX_LINE_QUANTITY`, the existing checkout limit). | Existing schema limit, not a stock rule. |
| D6 | "What the customer paid" = the returned line's snapshot price × quantity minus its allocated bundle and coupon discounts. Pre-Phase-2 lines have no allocation, so their plain line value is used. Shipping is not part of an exchange. | Exchange compares merchandise value to merchandise value. |
| D7 | Release happens on the transition out of a pre-shipment status (`PENDING`, `CONFIRMED`, `PROCESSING`, `PACKED`) to `CANCELLED`. Historical cancellations are not retroactively released. | Decision text. No historical rewrite (rule 5). |
| D8 | The formula is now explicit and approved (see D8). Remaining interpretations: (a) an exchange replacement also subtracts its exchange credit, because that value was already rewarded on the original order; (b) a refund counts against merchandise first, reversing `min(1, refund ÷ rewardable)` of the points; (c) a return (T7) reverses all of the order's points. | (a) prevents rewarding the same merchandise twice. (b) and (c) follow from "reversed when returned or refunded". |
| D9 | The coupon's `minOrderAmount` is compared with merchandise **after** the bundle. | Same base as the coupon discount itself. |
| D10 | Shipping is resolved before tax so its VAT can be computed on the fee actually charged. Merchandise VAT is unaffected by the order. | See PRICING_PIPELINE §1a (dependency graph). |
| D3 | `Product.taxRate` remains unused; tax uses the store rate only. | No decision asks for per-product rates. |

## Phase 4 implementation notes (interpretations, recorded 2026-09-29)

Phase 4 (the Payment Ledger, [PAYMENT_LEDGER.md](PAYMENT_LEDGER.md)) adds **no new business rule**. It records money
that D1, D6 and D8 already describe. Where the existing code or decisions left a detail open, this is the
interpretation I implemented. The owner may overrule any of them with a new dated entry.

| ID | Interpretation | Why |
|---|---|---|
| P4-1 | Once any money has been received for an order (`paid > 0`), its total can't be changed by a price adjustment (409). Corrections after payment go through a refund. Before Phase 4 a paid gateway order could be adjusted, leaving `PAID` against a different total. | `PAID` must keep meaning "this total was received". A downward adjustment after payment is money owed back, which only a refund records. |
| P4-2 | Refunds may be partial and repeated, up to what was actually received minus refunds already recorded or requested. A partial refund leaves the payment status `PARTIALLY_REFUNDED` (the M8 value planned since Phase 0). Only the full amount gives `REFUNDED`, and the T8 order-status rule still requires that. | Before Phase 4, any partial refund set `REFUNDED` and blocked the rest of the refund. |
| P4-3 | D1 COD collection at delivery is recorded as a `COD` payment of the order's **balance due** (normally the total; less if part was prepaid and recorded). | D1 says delivery is the collection point. The ledger records the money instead of only flipping the status. |
| P4-4 | "Refund due" for a cancelled or returned order is everything received (net of refunds already recorded or requested). For an active order it's only an overpayment (e.g. a duplicate gateway payment). | T6/T7 already raise "refund may be owed" for these cases; the ledger gives the amount. |
| P4-5 | A manually recorded payment does not change the order status. (A gateway settlement still moves `PENDING → CONFIRMED`, as before.) A manual payment on a COD order is not accepted after courier booking, because the parcel's COD amount is fixed at booking. | Manual payments are recorded by staff who confirm orders themselves. The booking rule mirrors the existing price-adjustment and address-edit guards. |
| P4-6 | A D6 exchange downgrade refund stays `REQUESTED` until staff record that they paid it out ("Complete"). Completing it reverses loyalty points like any refund (D8 interpretation (b)). | D6: "collected or refunded centrally". Before Phase 4 the request could never be completed. |
| P4-7 | Legacy backfill: an order already marked paid (or a delivered COD order) with no payment record gets one settlement of its total, marked `backfilled`. Its status projection is corrected only by the explicit repair command. | D1 (delivered COD = collected) and the order's own recorded status are the only evidence used. Nothing is invented and no order row is rewritten. |


## PD-5.1 — PENDING: refunds in realised revenue (Phase 5, raised 2026-09-30)

- **Question.** D1 (TARGET §11) defines *Realised revenue = Gross sales − Discounts + shipping charged + adjustments −
  Returns − Refunds not already counted as returns*. The last term has no rule in this system: a `Refund` isn't linked
  to the returned units it pays for.
- **What must be decided:**
  - (a) When does a refund duplicate a return that was already subtracted?
  - (b) Is a refund of a duplicate payment (an overpayment that was never revenue) excluded?
  - (c) Which period absorbs the netting when the refund and the return fall in different periods?
- **Proposal (not implemented):** per sale order, the refund term is `max(0, refunds − returns value − overpayment
  refunded)`. It is recognised at the refund's completion time, with returns known at that moment counting first.
  Refunds on cancelled orders aren't a revenue term (the order was never a sale).
- **Until approved:** `realised_revenue` isn't served. Dashboards show `net_sales` (realised revenue before the refund
  term) with `refunds` beside it, and `aov` uses `net_sales`. See [METRICS_REGISTRY.md](METRICS_REGISTRY.md) §6.

## Phase 5 implementation notes (interpretations, recorded 2026-09-30)

Phase 5 ([METRICS_REGISTRY.md](METRICS_REGISTRY.md)) adds no business rule. It implements D1 and TARGET §11 and
records these readings, which the owner may overrule with a new dated entry:

| ID | Interpretation | Why |
|---|---|---|
| P5-1 | An online (non-COD) order is realised at its **first successful payment** (`Payment.settledAt`); a COD order at its first `DELIVERED`/`PARTIALLY_DELIVERED`, even if it was prepaid. | D1: "COD: `DELIVERED`… online: `paymentStatus` reached `PAID`". |
| P5-2 | A paid order that is later **cancelled** is not a sale. Its payment and refund count in cash metrics (`collected_cash`, `refunds`), not in sales. | TARGET §11 `SALE_ORDER` excludes cancelled orders; the goods never left. |
| P5-3 | In an exchange, the original line's units coming back are **not a return**, and the replacement order is **not a sale**. A downgrade refund is a refund. An upgrade difference collected on the replacement is reported as `exchange_difference_collected` and isn't added to sales. | TARGET §11 excludes replacement orders from `SALE_ORDER`; the exchange keeps the original sale (return-request service: "the sale stands"). Counting either side again would double-count merchandise. |
| P5-4 | Customer spend (CRM list, VIP / HIGH_SPENDER tags, minimum-spend filter, SMS `totalSpent`, RFM) becomes `customer_net_spend`: realised, net of returns, trashed orders excluded. Unrealised COD orders no longer count toward VIP. | D1: placing an order isn't revenue; one definition for revenue and customer spend. |
| P5-5 | `aov` = `net_sales ÷ orders_realised` until PD-5.1 approves realised revenue. | TARGET §11 denominator; the pending numerator is replaced by its approved components. |
| P5-6 | COGS, gross margin, inventory turnover and dead-stock value use the **current** cost price and are flagged *estimated*. | TARGET §11: historical rows "fall back to current cost, flagged 'estimated'". No cost snapshot exists (`OrderItem.unitCostSnapshot` deferred). |
| P5-7 | Category and brand reports attribute sold lines to the product's **current** category/brand. | No category/brand snapshot exists on `OrderItem`; historical re-attribution can't be reconstructed and isn't faked. |
| P5-8 | The store timezone is a store setting (`StoreSetting.timezone`, default `Asia/Dhaka`, today's behaviour). | Configuration over code (TARGET §7). |
| P5-9 | "Units ordered" (demand on placed sale orders) drives storefront urgency, trending and forecasts; "units sold" (realised, net of returns) drives sales reports. Before Phase 5 both used ad-hoc `NOT IN (CANCELLED, REFUNDED)` or `!= CANCELLED`. | TARGET §5.5: urgency and the sales panel share one predicate; demand and realised sales are different facts. |
