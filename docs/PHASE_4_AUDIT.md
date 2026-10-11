# Phase 4 Audit — remaining duplicate business truth after Phases 1–3

**Status:** Phase 4, Step 1–3 deliverable (2026-09-29). Audited revision: `release/commerce-os-phase1-3` @ `d6845ca`
(contains Phase 3 `676bf41`, the admin-only storefront follow-up `4ccc5dd` and the `main` merge). The Phase 4 work is
on branch `phase-4/payment-ledger`.

**Method.** I traced each business fact from its database column through every writer, every calculation, the API DTO
and each consumer (admin, storefront, courier, analytics). I did not stop at file names. Line numbers refer to the
audited revision.

**Contracts I treated as fixed:** D1–D10 ([BUSINESS_DECISIONS.md](BUSINESS_DECISIONS.md)), the order state machine
([ORDER_STATE_MACHINE.md](ORDER_STATE_MACHINE.md)), InventoryService as the only stock writer
([INVENTORY_INVARIANTS.md](INVENTORY_INVARIANTS.md)), the Phase 2 pricing pipeline ([PRICING_PIPELINE.md](PRICING_PIPELINE.md))
and the Phase 3 Storefront Read Model ([STOREFRONT_READ_MODEL.md](STOREFRONT_READ_MODEL.md)).

---

## 1. Findings by domain

### 1.1 Payments and refunds — the weakest remaining SSOT

`Order.paymentStatus` is registered as a projection "owned by the Payments context" (TARGET_ARCHITECTURE §5.4, SSOT
registry B5), with invariant **I9** ("paymentStatus consistent with Payment/Refund rows"). In practice nothing derives
it. Several writers set it directly, the money it summarises is not fully recorded, and every consumer re-derives
"what does the customer still owe / get back" in its own way.

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| P1 | **Six writers of `Order.paymentStatus`, none of which derives it from money records.** | `payment.service.ts` `syncOrderPaymentStatus` (L61–83) and `refundOrderPayment` (L570); `order.service.ts` `insertOrderRecord` (L314), `createManualOrder` (L511) and `applyOrderTransition` T4 (L1073); `return-request.service.ts` `createExchangeOrder` (L234). | The status is an unreconciled assertion. I9 has no implementation and no drift report. |
| P2 | **Paid money is not fully recorded.** Only gateway settlements create a `Payment` row. COD cash collected at delivery (D1), the admin "mark paid" on a manual order, and a free exchange all set `PAID` with no money record. | T4 (`order.service.ts` L1067–1073); `createManualOrder` L510–512; `createExchangeOrder` L234. | "Collected cash" (a D1 metric) cannot be computed from records, and "how much was paid" has no source for COD. |
| P3 | **Refunds are capped against the order total, not against what was paid or already refunded.** | `refundOrderPayment` L548: `amount > total` is the only amount check. No row lock, no transaction around the read. | Two concurrent refunds both pass. A refund can exceed the money actually received (e.g. after a price adjustment on a paid order). |
| P4 | **A partial refund is recorded as a full refund, and it blocks every later refund.** | `refundOrderPayment` sets `REFUNDED` for any amount (L570); the next call is refused because the status is no longer `PAID` (L545). TARGET_ARCHITECTURE §5.4 and migration step M8 already planned `PARTIALLY_REFUNDED`; it was never built. | A ৳200 refund on a ৳2,000 order shows the order as fully refunded, in the admin panel, filters, BI and the T8 guard. The remaining refund can't be recorded. |
| P5 | **Exchange downgrade refunds can never be paid out.** `createExchangeOrder` writes a `REQUESTED` Refund (L308). No code path ever moves a Refund to `COMPLETED`. | `grep refund.update` → no match. | D6 ("difference … refunded centrally") is only half implemented. Money owed is recorded but can't be settled, and it's invisible in the admin UI. |
| P6 | **"Cash to collect on delivery" is recomputed in five places as `paymentMethod === "COD" ? total : 0`,** ignoring payments already received. | `courier.service.ts` L131 (single booking) and L207 (bulk booking); `order-detail-panel.tsx` L1029 (booking confirm); `shipping-label.tsx` L101–107; `shipping-label-square.tsx` L120–126. | A COD order the admin marked paid (manual order, customer paid by bKash) is still booked with the courier for the **full** amount: the customer is charged twice. |
| P7 | **Price adjustment is allowed after money was received.** | `adjustOrderPrice` (L1242) checks status and courier booking, not payment. Gateway orders are `CONFIRMED`/`PAID` at creation, so they're adjustable. The update is not transactional (read, then write). | `total` moves away from the amount paid. `PAID` then means "paid some other amount". A downward adjustment silently creates money owed back with no Refund record. |
| P8 | **Refund state labels are duplicated in the UI and wrong.** | `order-detail-panel.tsx` L567–574 and `orders/page.tsx` L1459–1466 and L1548–1555: `PAID → Paid`, `FAILED → Failed`, else `Unpaid`. | A refunded order is shown as **"Unpaid"**. |
| P9 | **The "cancelled but paid" refund queue predicate is copied three times.** | `order.service.ts` `buildOrderWhere` L698, `getOrderStats` L885 and L895, `payments-overview.service.ts` L54. | Any change to refund states has to be made in every copy, or the queue and its counts disagree. |
| P10 | **Non-atomic money flows.** | Gateway settlement of an existing order: the `Payment` row (L359) and the status sync (L379) are separate writes. The manual order is created, then `markPaid` is applied in a separate write (R10 from Phase 0, still open). | A crash between writes leaves a `Payment` row with an unpaid order, or a paid manual order without its flag. |
| P11 | **Loyalty reversal on refund uses float division** (`input.amount / base`). | `payment.service.ts` L581. | Minor. The reversal is capped and floored, so the error is bounded. |

**Sound and kept:** the gateway session model (`PaymentSession`, atomic claim, amount re-verification, pre-order
sessions, reconciliation cron, one-ACTIVE-session index), the `Refund` table, the `PaymentEvent` timeline, and the
order state machine's T8 rule (the `REFUNDED` order status requires a completed full refund). Phase 0 §23 marks these
as "do not rewrite".

### 1.2 Orders

| Fact | Finding | Status |
|---|---|---|
| Order totals | One formula (`computeOrderTotals`), fed by the quote or the snapshot. Phase 2 fixed this. | ✅ |
| Status transitions | One entry point (`applyOrderTransition`) and one matrix. Phase 1 fixed this. | ✅ |
| Cancellation / returns | Stock idempotent per line. Coupon release (D7) and point reversal (D8) implemented. | ✅ |
| Exchanges | Priced by the quote (D6). The replacement `Order` is written directly in `createExchangeOrder`, not through `insertOrderRecord` (a second order-row writer). The refund side is broken (P5). | ⚠️ writer duplication; money side → Phase 4 |
| Admin manual orders | Same quote and the same insert path. `markPaid` is a separate, non-atomic write with no money record (P2, P10). | ⚠️ → Phase 4 |
| Reorder | Uses read-model pricing (Phase 2). | ✅ |
| Order snapshots | Immutable. `adjustOrderPrice` rewrites only `total`/`priceAdjustment`, through the canonical formula. | ✅ (P7 guard → Phase 4) |
| Order history | `OrderStatusHistory` is append-only. Payments and refunds leave no entry in the order timeline. | ⚠️ → Phase 4 (audit notes) |
| Order analytics | See §1.6. | ❌ → Phase 5 |

### 1.3 Inventory

Every stock writer goes through `inventory.service.ts`, and the architecture guard enforces it. Every reader I checked
(checkout, read model, PDP, cart, exchange picker) uses `availability`, `isAvailable` or `maxSellableQuantity`. The
remaining duplicates:

- **Low stock.** The dashboard uses `stock ≤ 5` (`analytics.service.ts` L204), ignoring the threshold,
  `trackInventory`, the variant's active flag and trash. Checkout alerts use `remaining ≤ lowStockThreshold`. This
  belongs to the metrics registry (Phase 5).
- **Category stock rollup** reads raw stock (registry B1 ⚠️, admin-facing).

Nothing here risks money or stock correctness.

### 1.4 Promotions

Coupons, bundles and flash sales all run through the Phase 2 engines. Usage release (D7) and flash quota (D4) are
derived from order lines. Still open: the **`Coupon.usedCount` vs redemption-predicate drift report** (registry A8 ⚠️).
The counter is only +1 at creation and −1 once on a D7 release, both inside transactions, so drift needs a crash
between transactions that don't exist. Low risk. It stays a reconciliation to-do.

### 1.5 Customers

- **Lifetime spend / order count / AOV** has at least two definitions: the CRM list (`customer.service.ts` L608, `!=
  CANCELLED`, excludes trashed orders) and the drawer (L738 area). Neither nets refunds. These are metrics, so they
  belong to Phase 5, but they depend on refunds being recorded correctly (§1.1).
- **Reward points** are one engine (`rewardableMerchandiseValue`) and one ledger. Refund reversal depends on refund
  amounts being right (P3/P4).
- **Account state** (blocked, COD risk) has a single writer. ✅

### 1.6 Analytics / BI

Unchanged since Phase 0 (registry B7 ❌), and explicitly Phase 5 scope:

- About 50 raw-SQL copies of "is a sale" (`status != 'CANCELLED'`, most not excluding trashed orders).
- "Today" is computed three ways (server-local `getOrderStats`, Asia/Dhaka BI, UTC series).
- **Raw `NOW()` windows:** `analytics.service.ts` L415, L421, L496, L502, L1011 and L1018 compare
  `"createdAt" >= NOW() - INTERVAL …`. The DB session runs in Asia/Dhaka, and `createdAt` is `timestamp without time
  zone` written in UTC, so these windows are shifted by 6 h. BI uses `NOW() AT TIME ZONE 'Asia/Dhaka'` with its own
  conversions.
- Refund cost is `SUM(total) WHERE paymentStatus = 'REFUNDED'` (`analytics.service.ts` L2680), which counts the whole
  order total for a partial refund, instead of `Σ Refund.amount`.
- BI's refund count reads either refund representation (`bi.service.ts` L149).

**Does Phase 4 need any of this for correctness?** No. The payment ledger is written by domain services in
transactions and read per order. It uses no time windows and no raw `NOW()`. The analytics numbers are wrong today,
but fixing them needs the metrics registry, and the D1 cash metrics need Phase 4's ledger first. The only analytics
change Phase 4 makes is compatibility: where SQL tests `paymentStatus = 'REFUNDED'`, it also accepts the new
`PARTIALLY_REFUNDED` value, so no existing number silently changes meaning (§4, "Compatibility").

### 1.7 Admin

Admin pages consume canonical services for prices (quote), stock (read model and inventory endpoints) and order
totals (snapshot). The admin order page still **calculates money** in two places: the booking confirmation's COD amount
(P6) and the payment label (P8). The refund form pre-fills `order.total` as the refundable amount, which is wrong after
any earlier refund.

### 1.8 Web (storefront)

No price, discount, total, stock or payment calculation remains in `apps/web` outside formatting (Phase 2/3 grep gates
hold). The only money logic left is the shipping labels' and admin panel's COD amount (P6) and the payment-status
labels (P8).

---

## 2. Duplicate-truth matrix

Risk: **S1** money or stock can be wrong in production · **S2** a business number is ambiguous or drifts · **S3**
maintainability.

| Business fact | Current sources (DB · writer · calculation) | Canonical source | Duplicate locations | Disagree today? | Risk | Proposed SSOT (phase) |
|---|---|---|---|---|---|---|
| **Order payment status** | `Order.paymentStatus` · 6 direct writers (P1) · none (asserted) | *none* | payment.service ×2, order.service ×3, return-request ×1 | yes: partial refund → `REFUNDED` (P4); UI shows REFUNDED as "Unpaid" (P8) | **S1** | **Payment ledger: projection of Payment + Refund rows, one writer (Phase 4)** |
| **Amount paid** | `Payment` rows for gateways only · payment.service · — | *none* for COD, manual or exchange | T4 COD flag, manual `markPaid`, exchange `PAID` | yes: COD-collected and manual-paid orders have no amount | **S1** | **`Payment` rows for every settlement (gateway, COD collection, manual), Phase 4** |
| **Amount refunded / refundable** | `Refund` rows · `refundOrderPayment` · cap = `order.total` | `Refund` (COMPLETED) | refund form default `order.total`; BI `SUM(total)` for REFUNDED | yes (P3, P4) | **S1** | **Ledger engine: refundable = paid − refunded − requested (Phase 4)**; BI refund cost → Phase 5 |
| **Refund owed** (exchange downgrade, cancelled-but-paid, overpayment) | `Refund` REQUESTED (never completable) · status predicate ×3 | *none* | `buildOrderWhere`, `getOrderStats`, payments overview | yes (P5, P9) | **S1** | **Ledger position `refundDue` + completable REQUESTED refunds; one shared queue predicate (Phase 4)** |
| **Cash to collect on delivery** | derived `paymentMethod==COD ? total : 0` | *none* | courier ×2, admin panel, labels ×2 (P6) | yes: prepaid COD collected twice | **S1** | **Ledger position `codToCollect` = balance due (Phase 4)** |
| **Order total after money received** | `Order.total` · `adjustOrderPrice` | snapshot + `computeOrderTotals` | — | can diverge from the amount paid (P7) | S2 | **Guard: a paid order's total is frozen; corrections go through refunds (Phase 4, note P4-1)** |
| Order totals (at placement) | `Order` snapshot · quote | `computeOrderTotals` | — | no | ✅ | Phase 2 (done) |
| Order status | `Order.status` · `applyOrderTransition` | order-state matrix | — | no | ✅ | Phase 1 (done) |
| Exchange replacement order row | `Order` · `createExchangeOrder` (direct `order.create`) | — | second order-row writer beside `insertOrderRecord` | no money disagreement once the ledger owns payment state | S3 | Unify order creation with a `kind`/exchange marker (Phase 5, together with the "exchange is not a sale" metric predicate) |
| Stock on hand / movements | `ProductVariant.stock` + ledger · inventory.service | InventoryService | — | no | ✅ | Phase 1 (done) |
| Storefront availability | derived per read | read model | — | no | ✅ | Phase 3 (done) |
| Low stock | derived | `variantStockState` (per variant) | dashboard `stock ≤ 5` | yes | S2 | Metrics registry (Phase 5) |
| Selling price / sort / filter | engine + `ProductReadModel` | pricing engine | — | no | ✅ | Phases 2–3 (done) |
| Coupon usage count | `Coupon.usedCount` · in-txn ± | redemption predicate | — | no known drift path | S3 | Drift report (Phase 5 reconciliation pack) |
| Flash quota | derived from order lines | `flashUnitsSold` | — | no | ✅ | Phase 2 (done) |
| Reward points | ledger + `Customer.rewardPoints` | `RewardPointsEntry` | — | refund reversal inherits P3/P4 errors | S2 | Fixed indirectly by Phase 4 (correct refund amounts) |
| Customer lifetime spend / AOV | recomputed per surface | *none* | CRM list, drawer, segments, SMS vars | yes (trashed, refunds) | S2 | Metrics registry (Phase 5), on top of the Phase 4 refund ledger |
| Revenue / gross / net / discounts / tax / shipping / refunds / AOV / order count | ~50 raw SQL copies, 3 "today" definitions, raw `NOW()` windows | *none* (D1 definitions approved, not built) | analytics, BI, orders KPI, customer drawer, product panel, exports | yes | S2 | Metrics registry + fact tables (Phase 5); D1 "collected cash" / "refunds" read the Phase 4 ledger |
| Order trash in metrics | `Order.deletedAt` | OrderService | ignored by analytics/BI | yes | S2 | Phase 5 predicate `SALE_ORDER` |
| Payment method enablement / provider credentials | `StoreSetting` flags, env | — | — | — | S3 | Phase 7 (providers) |

### 2.1 Ten-point trace for the Phase 4 facts

| Fact | 1 DB source | 2 Writer | 3 Calculation | 4 API | 5 Admin | 6 Storefront | 7 Analytics | 8 Disagree? | 9 Risk | 10 Owner |
|---|---|---|---|---|---|---|---|---|---|---|
| Payment status | `Order.paymentStatus` | 6 direct writers | none | `order.paymentStatus` | 3 inline label ternaries | order confirmation (retry/cancelled checks) | BI/analytics `= 'REFUNDED'`, `= 'UNPAID'` | yes | S1 | PaymentLedger (projection) |
| Paid amount | `Payment` (gateway only) | payment.service | none | not exposed | not shown | — | payments overview counts only | yes | S1 | PaymentLedger |
| Refunded amount | `Refund` | payment.service; return-request (REQUESTED) | cap vs `total` | `GET /orders/:id/refunds` | list, form default = total | — | overview Σ; analytics `SUM(total)` | yes | S1 | PaymentLedger |
| COD to collect | — | — | `COD ? total : 0` ×5 | Steadfast `cod_amount` | booking confirm, labels | — | — | yes | S1 | PaymentLedger position |
| Refund due | — | — | status predicate ×3 | list filter, stats | refund queue, KPI | — | overview count | yes | S1 | PaymentLedger position |

---

## 3. Phase 4 scope — selected: **Order Payment & Refund Ledger**

### Why this scope

| Criterion | Payment ledger | Next best (analytics / metrics registry) |
|---|---|---|
| 1 Business correctness risk | **S1**: a customer can be charged twice by the courier (P6); refunds can exceed receipts (P3); partial refunds are unrecordable (P4); owed exchange refunds can't be paid (P5) | S2: numbers are ambiguous, but no money moves wrongly |
| 2 Duplicate implementations | 6 writers + 5 COD-amount copies + 3 queue predicates + 3 label copies | ~50 SQL copies |
| 3 Cross-module impact | orders, payments, returns/exchanges, courier, loyalty, admin UI, labels | analytics, BI, customers, products |
| 4 Clean SSOT possible? | yes: `Payment` + `Refund` rows are the facts, and the status is a pure projection | yes, but its D1 cash and refund metrics need this ledger first |
| 5 Migration safety | additive: enum values, nullable columns, and ledger rows backfilled from each order's own recorded status | additive, but a large read-side rewrite |
| 6 Testability | pure engine + transactional service + guard test | shadow comparisons over historical data |
| 7 Dependency on Phase 1–3 | uses the state machine (T4, T8), D1, D6, D8 and `computeOrderTotals`, and changes none of them | depends on Phase 4 |

It is the **smallest coherent boundary** that removes every S1 finding the audit found: one table pair (`Payment`,
`Refund`), one projection (`Order.paymentStatus`), one engine, one service.

### Deliberately deferred (see [PAYMENT_LEDGER.md §12](PAYMENT_LEDGER.md) for the full list)

- **Phase 5 (metrics):** the metrics registry; revenue, net sales, refunds, returns, collected cash, outstanding COD
  and AOV on one definition each; raw `NOW()` windows and store-timezone days; trashed and exchange orders excluded
  from sales; customer lifetime metrics; low-stock count; coupon `usedCount` drift report; making exchange orders go
  through the single order writer.
- **Phase 7 (providers):** gateway refund APIs and provider string keys; the `PaymentProvider` enum stays.
- **Phase 8 (events):** payment/refund outbox events. Phase 4 keeps post-commit side effects, as Phases 1–3 do.
- **Phase 10 (RBAC):** who may record refunds and payments (STAFF can today, unchanged).
