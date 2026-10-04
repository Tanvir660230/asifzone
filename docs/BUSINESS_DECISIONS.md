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
| D1 | Revenue recognition (COD, returns, refunds) | APPROVED · IMPLEMENTED (refund term resolved by PD-5.1) | Phase 1 (facts) · Phase 5 (metrics — [METRICS_REGISTRY.md](METRICS_REGISTRY.md)) |
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


## PD-5.1 — RESOLVED: realised net sales (Phase 5; raised and resolved 2026-09-30)

- **Question (as raised).** The last term of D1's realised revenue, *"refunds not already counted as returns"*, had no
  rule: a `Refund` isn't linked to what it pays back.
- **Owner decision (2026-09-30).**
  - **Realised net sales** = merchandise sales that have become financially realised, less applicable merchandise
    refunds.
  - Realisation is D1 unchanged (P5-1):
    - online: when the payment settles;
    - COD: when it is delivered, i.e. collected;
    - unpaid or pending COD is not realised;
    - an order cancelled before realisation is not realised.
  - Historical facts only; never current product, tax, shipping, coupon or flash configuration; never "subtract the
    order total".
  - Shipping and tax stay separate metrics.
  - An exchange replacement never double-counts merchandise.
  - The Phase 4 ledger is the payment/refund truth.
- **C1 — headline.**
  - `realised_net_sales` is the canonical headline sales metric: dashboard, KPI strip, BI headline, AOV, customer net
    spend, VIP/RFM.
  - `net_sales` remains a **secondary** metric, labelled *"Net sales incl. shipping, less returns"*.
  - No surface shows two concepts under "Revenue".
- **C2 — merchandise VAT.** Merchandise is measured without VAT, using the order's own tax snapshot:
  - `INCLUSIVE`: merchandise VAT = `taxAmount − shippingTaxAmount`.
  - `EXCLUSIVE`: 0, because the charged price excludes it.
  - Where the snapshot is insufficient: nothing is guessed, today's rate is never used, and the gap is reported as
    coverage.
  - Per-line VAT is a documented value-based **allocation** (largest remainder over line net). It was never stored per
    line.
  - `gross_merchandise_sales` is relabelled "as charged": it includes VAT on inclusive orders.
- **C3 + C4 — refund allocation hierarchy.** Each completed refund of an order, in completion order:
  1. **Payment overage first:** up to `max(0, payments settled by then − order total)`, minus overage already absorbed
     by earlier refunds. It never reduces sales. *Example:* total 1000, payments 1200, refund 200 → overpayment refund;
     merchandise sales unchanged.
  2. **Goods first, capped:** the rest goes to merchandise, up to the order's remaining eligible merchandise (realised
     merchandise as charged, less earlier merchandise refund parts; nothing before realisation). Sales fall by its
     VAT-exclusive equivalent.
  3. **Non-merchandise:** the remainder belongs to the order's other components (shipping, shipping VAT, exclusive
     VAT, price adjustment). It doesn't reduce merchandise sales.

  No pro-rata split is used. An exchange downgrade refund, which is pure merchandise, reduces sales in full.
- **Implemented:** [METRICS_REGISTRY.md](METRICS_REGISTRY.md) §3, §4.1, §6. The pending key `realised_revenue` is
  withdrawn.

## Phase 5 implementation notes (interpretations, recorded 2026-09-30)

Phase 5 ([METRICS_REGISTRY.md](METRICS_REGISTRY.md)) adds no business rule. It implements D1 and TARGET §11 and
records these readings. **The owner reviewed all nine on 2026-09-30**; the decision column is authoritative and
overrides the interpretation where they differ.

| ID | Interpretation | Why | Owner decision (2026-09-30) |
|---|---|---|---|
| P5-1 | An online (non-COD) order is realised at its **first successful payment** (`Payment.settledAt`); a COD order at its first `DELIVERED`/`PARTIALLY_DELIVERED`, even if it was prepaid. | D1: "COD: `DELIVERED`… online: `paymentStatus` reached `PAID`". | APPROVED unchanged. |
| P5-2 | A paid order that is later **cancelled** is not a sale. Its payment and refund count in cash metrics (`collected_cash`, `refunds`), not in sales. | TARGET §11 `SALE_ORDER` excludes cancelled orders; the goods never left. | **CHANGED → reversal at cancellation.** A sale realised before its cancellation stays in its realisation period and is reversed (every realised contribution, opposite sign) at the first `CANCELLED` status entry. No earlier period changes, and nothing extra is stored: it is derived from `OrderStatusHistory`, with no second ledger. Cancellation is read from history, not the current status (`CANCELLED → REFUNDED` is allowed). Cash metrics are unchanged. |
| P5-3 | In an exchange, the original line's units coming back are **not a return**, and the replacement order is **not a sale**. A downgrade refund is a refund. An upgrade difference collected on the replacement is reported as `exchange_difference_collected` and isn't added to sales. | TARGET §11 excludes replacement orders from `SALE_ORDER`; the exchange keeps the original sale (return-request service: "the sale stands"). Counting either side again would double-count merchandise. | KEPT. Returned exchange units aren't a sale, the replacement isn't a sale, a downgrade difference is a refund (a merchandise refund under PD-5.1), and an upgrade difference is **not** merchandise sales under D6. Counting upgrades as incremental sales would need a new explicit decision. |
| P5-4 | Customer spend (CRM list, VIP / HIGH_SPENDER tags, minimum-spend filter, SMS `totalSpent`, RFM) becomes `customer_net_spend`: realised, net of returns, trashed orders excluded. Unrealised COD orders no longer count toward VIP. | D1: placing an order isn't revenue; one definition for revenue and customer spend. | APPROVED. Spend, VIP/RFM and CLV use `realised_net_sales` (PD-5.1 C1). |
| P5-5 | `aov` = `net_sales ÷ orders_realised` until PD-5.1 approves realised revenue. | TARGET §11 denominator; the pending numerator is replaced by its approved components. | **REPLACED.** `aov = realised_net_sales ÷ orders_realised`, both over the same realisation population, with the same cancellation reversals. |
| P5-6 | COGS, gross margin, inventory turnover and dead-stock value use the **current** cost price and are flagged *estimated*. | TARGET §11: historical rows "fall back to current cost, flagged 'estimated'". No cost snapshot exists (`OrderItem.unitCostSnapshot` deferred). | APPROVED. Stays *estimated* until `OrderItem.unitCostSnapshot` exists. |
| P5-7 | Category and brand reports attribute sold lines to the product's **current** category/brand. | No category/brand snapshot exists on `OrderItem`; historical re-attribution can't be reconstructed and isn't faked. | APPROVED limitation. Historical category/brand reports change if the catalog is reclassified; documented until snapshots exist. |
| P5-8 | The store timezone is a store setting (`StoreSetting.timezone`, default `Asia/Dhaka`, today's behaviour). | Configuration over code (TARGET §7). | APPROVED. |
| P5-9 | "Units ordered" (demand on placed sale orders) drives storefront urgency, trending and forecasts; "units sold" (realised, net of returns) drives sales reports. Before Phase 5 both used ad-hoc `NOT IN (CANCELLED, REFUNDED)` or `!= CANCELLED`. | TARGET §5.5: urgency and the sales panel share one predicate; demand and realised sales are different facts. | APPROVED. No product-level low-stock semantics. |

## Phase 6 implementation notes (interpretations, recorded 2026-09-30)

Phase 6 ([PHASE_6_AUDIT.md](PHASE_6_AUDIT.md)) freezes the order-line facts reports need. These readings follow from
the owner's Phase 6 brief ("never fabricate historical values"; "old orders remain explicitly unknown"); the owner may
overrule any of them with a new dated entry.

| ID | Interpretation | Why |
|---|---|---|
| P6-1 | Cost, category, brand and product are snapshotted **once, in the transaction that writes the order line**: order creation (checkout, admin order, gateway settlement) and exchange-replacement creation. They never change afterwards. | The line is financially committed when written (price fixed, stock sold). Realisation or delivery would be a mutable, later moment. |
| P6-2 | A line whose product had no cost price at order time records cost **unknown** (NULL), not 0. COGS and gross margin cover only lines with a recorded cost and report the rest as coverage. | "Missing cost = 0" overstated margin. An unknown isn't a zero. |
| P6-3 | Lines written before Phase 6 are **not** backfilled with today's cost, category or brand. Reports group them as "Not recorded" and count them in cost coverage. The one backfill is `productIdSnapshot`, from the variant's product. | Today's catalog isn't history. A variant never changes product, so its product id is the true historical fact. |
| P6-4 | The store currency is locked once any order exists: settings refuse the change (409 `CURRENCY_LOCKED`). | Orders record no currency. Every money snapshot, including the new minor-unit cost, means "store currency". Changing it would silently reinterpret all history. |
| P6-5 | An exchange (P5-3) keeps the original line's cost and attribution (the original sale stands). The replacement line records its own snapshots for the record, but a replacement is not a sale, so it contributes no COGS or sales. | Consistent with D6/P5-3. Counting the replacement's cost would need a new decision, like upgrades (P5-3). |

## Phase 7 implementation notes (interpretations, recorded 2026-09-30)

Phase 7 ([PHASE_7_AUDIT.md](PHASE_7_AUDIT.md), [PHASE_7_SIGNOFF.md](PHASE_7_SIGNOFF.md)) adds no business rule beyond
these readings; the owner may overrule any with a new dated entry.

| ID | Interpretation | Why |
|---|---|---|
| P7-1 | A store may use only a currency the money engine represents exactly: `BDT USD EUR GBP INR JPY`. Other codes are rejected with 400. Adding one means adding it to the engine's minor-digit table. | The engine silently assumed 2 decimals for unknown codes. A wrong scale would reinterpret every amount, and `Intl` can't display a non-ISO code. |
| P7-2 | Currency and timezone stay stored in `StoreSetting`. No `CommerceSettings` table in Phase 7. `domain/config/commerce-settings` is the single read path. | Storage already had one owner. A new table would have been a second copy during compatibility (Phase 7 boundary). |
| P7-3 | Every business date shown to admins or customers (orders, payments, refunds, returns, reviews, coupons, "today") is the **store-timezone** date, not the viewer's device date. | Reports bucket by the store's business day (Phase 5). A viewer-local date could place an order on a different day than the reports. |
| P7-4 | Currency symbols are derived from the store currency (`Intl` narrow symbol). The number locale stays `en-BD` until a locale setting exists. Transactional SMS copy is unchanged (Bengali content). | No locale concept exists yet (TARGET §7 future). The SMS copy is content, not configuration. |

## Phase 11 decisions (owner, 2026-10-01)

Phase 11 ([PHASE_11_IMPLEMENTATION_CONTRACT.md](PHASE_11_IMPLEMENTATION_CONTRACT.md),
[PHASE_11_SIGNOFF.md](PHASE_11_SIGNOFF.md)).

| ID | Decision |
|---|---|
| BD-11.1 | A phone is a login identifier only after a successful OTP to it. OTP login matches only `phone = P AND phoneVerifiedAt IS NOT NULL`. At most one customer per verified phone (partial unique index). Unverified phones may repeat. A verified phone changes only through OTP of the new number; the old one stays the login until then. Existing phone data is never auto-verified |
| BD-11.2 | No account merges and no record moves: orders, addresses, points, payments and refunds stay put. Existing duplicate or unverified phones remain allowed |
| BD-11.3 | DB-backed customer refresh sessions, at most 7 days from login, rotating. Server-side logout, log out everywhere, and revocation on password change and reset; `tokenVersion` stays compatible. Reuse of a rotated or revoked token revokes that login's chain, with a 10-second grace window for concurrent tabs. `isBlocked` stays a CRM field. No account deletion |
| BD-11.4 | Provider-neutral observability: correlation IDs, structured logs, error-capture interface, readiness, attention signals |
| BD-11.5 | Brief deploy downtime acceptable, no blue/green: backup → verify → migrate → start → readiness (≤ 120 s) → fail if not ready; documented rollback |
| BD-11.6 | **(a)** An existing passwordless customer record is claimed only after proving the matched identity: email (verification/claim link) or phone (OTP). Never by a match alone; never moving history; auditable; safe against concurrency |
| BD-11.7 | **(a)** Guest checkout attaches to an existing customer only through an already **verified** phone or email; otherwise a guest record per existing guest semantics |
| F-26 / F-27 | OTP sign-up never marks the email verified. Google `email_verified` is required for customer and admin Google sign-in |
| R-1 | Existing OTP-only customers are not auto-verified; their first OTP sign-in after the deploy verifies the phone, asking again for their name and email |

**Implementation readings** (recorded; the owner may overrule any with a new dated entry):

| ID | Reading | Why |
|---|---|---|
| P11-1 | A guest record ("placeholder") is reused only for the exact same (phone, email) pair. A guest email already held by another unverified record is not used as a key; the order still keeps the email on the order itself | Grouping guests by phone *or* email let one placeholder collect different people's orders, so whoever later proved either identity could see the others' orders. Exact pairs make a claim expose only orders placed with the proven identity |
| P11-2 | OTP proof of a phone claims the unclaimed guest record holding that phone **and** the email supplied at sign-up, else the one holding that phone with no email | The phone is proven, and the supplied email names which guest record is theirs. An email-only match is never claimed by a phone proof |
| P11-3 | A record whose phone is verified but whose email isn't can't gain a password through that email (no reset email is sent). Its owner sets a password while signed in | The email on such a record was never proven by the phone's owner, so a stranger holding that mailbox must not take the account over |
| P11-4 | Google links to an existing record only when that record is an unclaimed placeholder or its email is already verified; otherwise 409 ("sign in another way and verify your email first") | Google proves the Google user owns the email, not that the existing record's owner does |
| P11-5 | Within the 10-second grace window a replayed refresh token gets a fresh access token but **no** new refresh token, so the session chain never forks. Outside the window the whole chain is revoked | Concurrent tabs keep working through the cookie the winning tab set; there is no unlimited replay window |

**Review closure (2026-10-04).** These record the review of the two contract deviations and the historical-data question
as explicit Phase 11 policy. P11-8 still needs the owner.

| ID | Policy | Why it is safe |
|---|---|---|
| P11-6 | **OTP-only customer, first sign-in after the deploy (R-1).** An OTP to phone P may claim an unclaimed record (no password, no Google, no verified phone) that holds P: the one also holding the email supplied with the sign-in, else the one holding P and no email. The name and email are profile completion and select *which* P-record is meant; they are never proof. The phone becomes verified; the email stays unverified and gets its own link | The record was matched by P, and P is what the OTP proves, which is exactly what BD-11.6 (a) requires for a phone match. F-24 attached to a record because the *email* matched, with no proof of anything. Here an email match without P on the record is refused (409), and knowing P is useless without the code (5 wrong guesses per code and per phone per 30 min, counted atomically). Only credentials are attached; no history moves (BD-11.2). Before the deploy the same person could already sign in with this OTP |
| P11-7 | **Session concurrency (refines P11-5).** The grace window runs from the token's single rotation (`rotatedAt` is written once, by the request that wins the rotation, and never by a replay). Inside it a replay gets only a 15-minute access token: no refresh token, no new row, no change to the family's fixed 7-day expiry. Revocation is checked first, so a revoked family gets nothing even inside the window. After the window, any replay revokes the family | Browser tabs share one cookie, and the web client single-flights refreshes only within a tab. Without the grace path, a tab losing the race gets a 401 and is sent to the login page. A thief replaying an already-rotated token inside the 10 s gains at most a 15-minute access token and no way to continue; a token stolen *before* rotation is no different with or without the grace path |
| P11-8 | **Historical `emailVerifiedAt` (pre-Phase-11 OTP sign-ups, F-26).** Leave the values untouched in Phase 11. Before the deploy, the owner runs the read-only identification query (PHASE_11_SIGNOFF §10). If it returns rows, clearing their `emailVerifiedAt` is a separate, owner-approved, audited and reversible data fix; no schema change is needed | Clearing silently would change customer records without approval. The rows that matter are identifiable exactly: used verification and reset tokens are never deleted, so "verified, but no used token and no Google link" means the email was never proven. The residual risk is limited to records whose email was mistyped or foreign at an OTP sign-up (see the sign-off) |

## Phase 10 implementation notes and open decisions (recorded 2026-10-01)

Phase 10 ([PHASE_10_AUDIT.md](PHASE_10_AUDIT.md), [PHASE_10_SIGNOFF.md](PHASE_10_SIGNOFF.md)) keeps every role capability
exactly as it was (TARGET §15). It records these readings; the owner may overrule any of them with a new dated entry.

| ID | Interpretation | Why |
|---|---|---|
| P10-1 | A customer's order timeline shows the order's **status journey**: one entry per status change, with the note written on that change. Same-status entries are **staff annotations** and stay internal: follow-up holds ("call after 6pm"), address/price edit diffs, payment/refund bookkeeping, admin notes on an unchanged status. The return-request reply (`adminNote`) stays customer-visible as "Note from support". | The timeline was shared by staff and customers with no visibility flag, so internal call notes reached customers. Transition notes and the support reply were already customer-facing by design and stay so. |
| P10-2 | The store always keeps **at least one active OWNER**. Demoting or deactivating the last one is refused (409), including when two owners act at the same moment. | Otherwise no one could manage the team, settings or repairs again without database access. |
| P10-3 | Deactivating an admin or changing their role takes effect on their **next request**, not when their 15-minute session token expires. | TARGET §15 ("isActive and role re-checked"). A removed admin must lose access immediately. |

**Owner decisions (resolved 2026-10-01):**

| ID | Question | Decision | Enforcement |
|---|---|---|---|
| PD-10.1 | Should **permanent delete of coupons and categories** be OWNER-only, like permanent delete of orders and products? | **Yes: OWNER-only.** STAFF gets 403. Normal coupon and category work (create, edit, trash, restore) stays with STAFF | `DELETE /api/coupons/:id/permanent` → `promotions.purge` (new, OWNER-only); `DELETE /api/categories/:id/permanent` → `catalog.purge` (OWNER-only, already used for products) |
| PD-10.2 | Should STAFF keep **refunds, manual payments, price adjustment, loyalty adjustment, ad-hoc/bulk SMS, exports and financial analytics (COGS/margin)**? | **Yes: STAFF keeps all of them.** OWNER remains fully privileged | unchanged STAFF permissions: `refunds.manage`, `payments.record`, `orders.adjust_price`, `loyalty.adjust`, `customers.message`, `orders.export` / `catalog.export` / `analytics.export`, `analytics.read` |

## Phase 9 implementation notes (interpretations, recorded 2026-10-01)

Phase 9 ([PHASE_9_AUDIT.md](PHASE_9_AUDIT.md), [PHASE_9_SIGNOFF.md](PHASE_9_SIGNOFF.md)) adds no business rule beyond
these readings; the owner may overrule any with a new dated entry.

| ID | Interpretation | Why |
|---|---|---|
| P9-1 | When a Steadfast booking **times out or gets a 5xx**, the order is flagged "Booking outcome unknown" and **can't be re-booked for 10 minutes**. The operator should check the Steadfast portal for the invoice (= order number) first. A definite rejection (4xx, validation) can be retried at once. | Steadfast may have created the consignment. Re-booking blind risks two shipments and two charges, and the duplicate-invoice behaviour isn't verified. |
| P9-2 | An exchange is refused (409) when the original line has already been returned or exchanged, and the whole approval rolls back when the original units can't be taken back. | A replacement is only owed against units coming back. Otherwise the customer receives a second item for free. |
| P9-3 | Resubmitting the same checkout, refund or payment form (same content) after a timeout returns the first result. Submitting it again **after a success** is a new operation. | A timeout retry must not double-charge or double-refund, while a deliberate second identical refund stays possible. |

## Phase 8 implementation notes (interpretations, recorded 2026-09-30)

Phase 8 ([PHASE_8_AUDIT.md](PHASE_8_AUDIT.md), [PHASE_8_SIGNOFF.md](PHASE_8_SIGNOFF.md)) adds no business rule beyond
these readings; the owner may overrule either with a new dated entry.

| ID | Interpretation | Why |
|---|---|---|
| P8-1 | D8 loyalty points are awarded and reversed **inside** the transaction of the delivery / return / refund that causes them. If the points write fails, that status change or refund fails too and can be retried. Before Phase 8, the change committed and the points were silently lost. | Points are business truth: they may not be lost after commit, and an outbox worker may not write truth. The award is row-locked, so concurrent deliveries can't double-award. |
| P8-2 | Order SMS / receipt email respect the admin's toggles **at send time**, including after an outage. An intent disabled in the meantime is not sent. | Same behaviour as before, when the send happened immediately. It avoids messages the owner has switched off. |
