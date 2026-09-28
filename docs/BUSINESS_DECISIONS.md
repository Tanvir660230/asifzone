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
| D1 | Revenue recognition (COD, returns, refunds) | APPROVED | Phase 1 (facts) · Phase 5 (metrics) |
| D2 | Bundle discount on the post-flash price | APPROVED | Phase 1 |
| D3 | Tax-inclusive pricing | APPROVED | Phase 1 (helper, analytics fix) · Phase 2 (snapshot) |
| D4 | Enforce `FlashSaleItem.stockLimit` | APPROVED | Phase 2 |
| D5 | `trackInventory = false` means unlimited availability | APPROVED | Phase 2 |
| D6 | Exchange pricing at the current effective price | APPROVED | Phase 2 |
| D7 | Release coupon usage on cancellation before shipping | APPROVED | Phase 2 |
| D8 | Reward points on discounted merchandise, reversed on return/refund | APPROVED | Phase 2 |
| D9 | Bundle first, then coupon | APPROVED | Phase 2 |
| D10 | Shipping VAT-inclusive by default, configurable | APPROVED | Phase 2 |

Until a Phase 2 decision is implemented, the code keeps its current (Phase 1) behaviour, documented in
[PRICING_PIPELINE.md §1](PRICING_PIPELINE.md). "APPROVED" means the rule is settled, not that it is live.

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
- **Approved:** 2026-09-28 · **Status:** APPROVED · **Implementation:** Phase 1 (`taxIncludedIn()`, analytics VAT
  estimate); Phase 2 (per-order tax snapshot for new orders).

## D4 — Flash sale stock limit
- **Decision:** ENFORCE `FlashSaleItem.stockLimit`. Once the flash-sale quantity limit is exhausted, further units use
  the normal effective selling price.
- **Approved:** 2026-09-28 · **Status:** APPROVED · **Implementation:** Phase 2 (PromotionEngine + PricingService).
- **Authority / representation:** the limit is `FlashSaleItem.stockLimit` (existing). The count of units already sold
  at the flash price has **no authoritative source today** — `OrderItem` does not record which flash sale priced it.
  Phase 2 must add an additive order-line snapshot of the applied promotion (one field, written at order creation)
  and count against it; it must not add a separate mutable counter without a registered reconciliation.
  A cart line crossing the limit is split into flash-priced and regular-priced units.

## D5 — Inventory not tracked
- **Decision:** `trackInventory = false` means unlimited sellable availability. Checkout must not reject a purchase
  because stock is zero. Stock and its ledger are still kept for reporting and operations.
- **Approved:** 2026-09-28 · **Status:** APPROVED · **Implementation:** Phase 2 (availability rule in the inventory /
  pricing path).
- **Authority:** `Product.trackInventory` (existing). Movements are still written by `inventory.service.ts`; for an
  untracked product the stock balance may go below zero (a recorded, expected state, excluded from INV-5).

## D6 — Exchange pricing
- **Decision:** Exchanges are priced at the current effective selling price at the time of the exchange quote. The
  price difference is calculated centrally and collected or refunded according to the exchange policy.
- **Approved:** 2026-09-28 · **Status:** APPROVED · **Implementation:** Phase 2 (`PricingService` exchange quote).
- **Note:** today an exchange uses the variant's regular price and never refunds a downgrade
  (`return-request.service.ts`). A refund owed on a downgrade is recorded through the existing `Refund` path — no new
  money table.

## D7 — Coupon usage on cancellation
- **Decision:** If an order is cancelled before shipping, its coupon usage is released. Once shipped, it is not.
- **Approved:** 2026-09-28 · **Status:** APPROVED · **Implementation:** Phase 2 (order state machine T6 effect).
- **Authority:** the redemption predicate over `Order.couponId`; `Coupon.usedCount` stays the counter used for atomic
  limit enforcement and is decremented once, idempotently, by the cancellation transition from a pre-shipment status.
  "Before shipping" = the order was in `PENDING`, `CONFIRMED`, `PROCESSING` or `PACKED` when cancelled.

## D8 — Reward points
- **Decision:** Points are based on merchandise value after applicable discounts, excluding shipping. The
  corresponding points are reversed when the underlying merchandise is returned or refunded.
- **Approved:** 2026-09-28 · **Status:** APPROVED · **Implementation:** Phase 2 (loyalty effect of the DELIVERED and
  RETURNED/refund transitions).
- **Authority:** the `RewardPointsEntry` ledger (existing; reversals are negative entries linked to the order).
  The earning base is computed from order snapshots (`Σ priceSnapshot × qty − discount`), never from `Order.total`.

## D9 — Bundle and coupon stacking
- **Decision:** The bundle discount is calculated first; the coupon discount is then calculated on the resulting
  eligible amount. Canonical sequence:

  ```
  List Price → Variant Price → Flash Sale → Bundle Discount → Coupon Discount → Tax → Shipping → Final Total
  ```

  This order is implemented once, in the canonical pricing pipeline — never separately by a consumer.
- **Approved:** 2026-09-28 · **Status:** APPROVED · **Implementation:** Phase 2 (PricingEngine / PromotionEngine).
- **Note:** changes coupon amounts on carts that qualify for both, compared with today's side-by-side stacking.

## D10 — Shipping VAT
- **Decision:** Shipping is VAT-inclusive by default. VAT treatment of shipping remains configurable through the
  centralised tax configuration. No separate, hard-coded shipping VAT calculation.
- **Approved:** 2026-09-28 · **Status:** APPROVED · **Implementation:** Phase 2 (TaxEngine).
- **Authority / representation:** the centralised tax configuration today is `StoreSetting.taxEnabled` +
  `defaultTaxRate` (+ unused `Product.taxRate`). It has **no field for shipping VAT treatment**. Phase 2 adds one
  additive setting to that same configuration (default: shipping is VAT-inclusive at the store rate) — not a second
  tax configuration.

---

## Representation gaps to resolve in Phase 2 (before implementing the decision)

| Decision | Gap | Resolution direction (additive, one authority) |
|---|---|---|
| D4 | No record of which flash sale priced an order line | order-line snapshot of the applied promotion, written at order creation |
| D10 | No shipping-VAT setting | one field in the existing centralised tax configuration |
| D3 | No per-order tax snapshot | order-level tax snapshot for new orders only |

Each gap is resolved by registering the new field in [SSOT_REGISTRY.md](SSOT_REGISTRY.md) in the same change.
