# Metrics Registry — Phase 5 (Metrics & Analytics SSOT)

**Status:** Phase 5 contract (2026-09-30), branch `phase-5/metrics-ssot`. Evidence:
[PHASE_5_METRICS_AUDIT.md](PHASE_5_METRICS_AUDIT.md).

The rules here come from approved sources: D1 (revenue recognition), D6 (exchanges) and D8
([BUSINESS_DECISIONS.md](BUSINESS_DECISIONS.md)), the TARGET_ARCHITECTURE §11 metric table, the order state machine,
the Phase 2 snapshots ([PRICING_INVARIANTS.md](PRICING_INVARIANTS.md) §8) and the Phase 4 ledger
([PAYMENT_LEDGER.md](PAYMENT_LEDGER.md)). Where those leave a rule open, the metric is marked **PENDING** and isn't
implemented. **PD-5.1 was resolved by the owner on 2026-09-30** (§6); no metric is pending.

**Headline sales metric: `realised_net_sales`** (§4.1). The dashboard, KPI strip, BI headline, AOV, customer net spend,
VIP tags and RFM all use it. `net_sales` survives only as a secondary metric labelled *"Net sales incl. shipping, less
returns"*. No surface labels either of them "Revenue" (legacy response field names such as `revenue30d` are kept for
compatibility and carry `realised_net_sales`).

```
database truth    Order + OrderItem snapshots (Phase 2) · OrderStatusHistory (Phase 1) · Payment + Refund (Phase 4)
                  StockMovement RETURN rows (Phase 1, return dates) · ReturnRequest(EXCHANGE) · ProductVariant.stock (read-only)
  → fact loader   apps/api/src/domain/metrics/facts.repository.ts — the only SQL that reads sales facts
  → pure engine   packages/shared/src/metrics/  business-time · eligibility & valuation (facts) · registry · aggregate
  → service       apps/api/src/domain/metrics/metrics.service.ts — resolves the range, loads facts, runs the engine, caches
  → API           GET /api/v1/metrics · /definitions · /consistency
  → consumers     dashboard, orders KPI strip, BI (overview, financial, sales, products, customers, inventory, lifetime),
                  CRM (spend, tags, RFM), product sales panel, storefront urgency/trending/FBT
```

---

## 1. Business time (the one time mechanism)

| Concern | Rule |
|---|---|
| Storage | Every timestamp column is `timestamp(3)` holding **UTC wall-clock** (Prisma's semantics). |
| Store timezone | `StoreSetting.timezone`: IANA name, default `Asia/Dhaka` (additive, Phase 5; TARGET §7 `CommerceSettings.timezone` absorbs it later). Validated with `Intl`. It's the only source of a timezone for metrics. |
| Business date | The calendar date of an instant in the store timezone (`businessDate(instant, tz)`). |
| Day boundary | Local 00:00 of the business date, converted to a UTC instant with `Intl`. DST-safe: the offset is computed for that date, not assumed. |
| Range | Half-open `[startUtc, endUtc)`. `from`/`to` are business dates, **both inclusive**: `endUtc` = local 00:00 of the day after `to`. |
| Presets | `today`, `yesterday`, `last_7_days` / `last_30_days` / `last_90_days` / `last_365_days` (N business days ending today, today included), `this_week` (ISO week, Monday first), `this_month`, `last_month`, `this_year`, `lifetime` (from the epoch). Every dashboard resolves its window through `resolveBusinessRange`; none computes its own. |
| Buckets | `day` / `month` / `year` keys are business dates (`YYYY-MM-DD`, `YYYY-MM`, `YYYY`), computed by the engine from exact instants, never by SQL `date_trunc`. |
| SQL | A bound instant is always written through `utcInstant(date)` → `(${date}::timestamptz AT TIME ZONE 'UTC')`, and "now" is a bound instant from the application clock. Raw `NOW()` and bare `>= ${date}` comparisons are forbidden in metrics/analytics code (guard test). Reason: see audit §2. |
| API | Input: `preset`, or `from` + `to` (`YYYY-MM-DD`). Output: `range {from, to, startUtc, endUtc, timezone}`, series keys as business dates. |

## 2. Eligibility (explicit per metric family)

| Predicate | Definition | Source |
|---|---|---|
| **Cancelled** | `status = CANCELLED` **or** the order has a `CANCELLED` status-history entry (the state machine allows `CANCELLED → REFUNDED`, so the current status alone would miss a cancelled-then-refunded order). **Cancellation instant** = the first `CANCELLED` history entry. | order state machine (T6, T8) |
| **Sale order** | `deletedAt IS NULL ∧ not cancelled ∧ not an exchange replacement` (an order referenced by `ReturnRequest.exchangeOrderId`). Used by the **placement-basis** (demand) metrics. | TARGET §11 `SALE_ORDER` |
| **Realised** | not trashed, not an exchange replacement, and a realisation instant exists **before** any cancellation. **COD:** the first `OrderStatusHistory` entry `DELIVERED` or `PARTIALLY_DELIVERED`. **Online / other:** the first `SUCCEEDED` `Payment.settledAt`. A realised order that is cancelled later is **reversed at the cancellation instant** (P5-2, §3). A legacy cancelled order with no `CANCELLED` history entry has no instant to reverse at and is excluded, as before. | D1 (P5-1 approved) |
| Operational order | `deletedAt IS NULL ∧ not an exchange replacement`, any status | status breakdowns, cancellation counts |
| Money movement | every `SUCCEEDED` `Payment` and `COMPLETED` `Refund` row, whatever the order's status or trash state (cash is cash; trash never deletes a money movement) | Phase 4 ledger |

Treatment summary:

| Case | Sales / revenue metrics | Cash metrics | Counts |
|---|---|---|---|
| Pending / confirmed / shipped COD | not realised → excluded | — | `orders_placed` |
| Paid online order | realised at first successful payment | payment counted | placed + realised |
| Delivered COD | realised at first delivery | COD payment counted (Phase 4 T4) | placed + realised |
| Cancelled before realisation | never realised → nothing to reverse | its payments and refunds count in cash metrics | `orders_cancelled` |
| Cancelled after realisation (e.g. paid online, then cancelled) | counted in the realisation period; **every realised contribution is reversed in the cancellation period** (P5-2). Refunds after the cancellation don't reduce sales again. | payments and refunds count in cash metrics | realised +1, reversal −1 |
| Returned (T7) | realised earlier; returned units subtract as `returns` at their return date | refunds count at completion | status breakdown |
| Refunded / partially refunded | `realised_net_sales` falls by the refund's merchandise part (goods first, capped, after any overpayment — §3) | refunds subtract from `collected_cash` | — |
| Exchange replacement order | never a sale (TARGET §11). An **upgrade** difference collected on it is **not** merchandise sales (P5-3, D6) | its payments → `exchange_difference_collected` + `collected_cash` | excluded |
| Exchange-returned original units | **not** a return (the original sale stands: D6, return-request service) | a **downgrade** difference is a Refund on the original order: a merchandise refund that reduces `realised_net_sales` in full (goods first) | — |
| Trashed order | excluded from every sales and count metric | its payments/refunds still count (ledger rows stay facts) | excluded |
| Trashed / deleted product | history unaffected: price, cost, product, category and brand are the line's own snapshots (Phase 6), so even a permanently deleted product keeps its attribution. Lines written before Phase 6 fall back to the variant's product when the variant still exists (else "unattributed"); their category/brand are "Not recorded" | — | — |

## 3. Valuation rules (from snapshots, never live data)

- **Line gross** = `priceSnapshot × quantity` (post-flash, Phase 2 meaning).
- **Line discount** = `bundleDiscountAllocated + couponDiscountAllocated` when recorded. Pre-Phase-2 lines have no
  allocation: the order's `discount` is pro-rated by line gross, exactly (largest remainder, the shared
  `allocateProportionally`). This is D1's "pro-rated discount".
- **Line net** = gross − line discount. **Net unit value** of a variant in an order = Σ line net ÷ Σ quantity over that
  order's lines of that variant (exact unless a D4 split line has two prices; then it's the weighted average,
  documented).
- **Shipping charged** = 0 if `shippingWaived`, else `shippingFee`. When `shippingWaived` is NULL (unproven pre-Phase-2
  row), the order's own arithmetic is used: `total − (subtotal − discount) − priceAdjustment − taxAdded` (floored at 0).
- **Tax** = `Order.taxAmount` (merchandise + shipping VAT). NULL = not recorded (pre-Phase-2). It is *counted as
  coverage*, never estimated from the current rate.
- **As charged vs VAT-exclusive (C2).** Line prices are stored as charged. Under `taxMode = INCLUSIVE` (D3 default) the
  charged price **contains** VAT; under `EXCLUSIVE` it doesn't (VAT is added on top). So `gross_merchandise_sales`,
  `discounts`, `returns`, `net_merchandise_sales` and `net_sales` are **as charged** (VAT-inclusive for inclusive
  orders). The VAT-exclusive merchandise figure is `realised_net_sales`.
- **Merchandise VAT** of an order, from its own snapshot only (never the current tax setting):
  - `EXCLUSIVE` → 0 (the charged merchandise price excludes VAT).
  - `INCLUSIVE` → `taxAmount − shippingTaxAmount` (0 when `taxAmount` is 0).
  - no `taxMode`, `taxAmount` NULL, or a non-zero `taxAmount` without `shippingTaxAmount` → **unknown**. Nothing is
    guessed and no rate is applied. The merchandise stays at its charged value and the order is reported in the
    metric's `coverage.missing` (with `coverage.recorded` for the rest).
  - Per line it is an **allocation**, not stored data: the order's merchandise VAT is split across lines by line net
    (largest remainder, the shared `allocateProportionally`). VAT was never recorded per line.
- **Refund allocation (C3 + C4).** A `Refund` row records only an amount. Each `COMPLETED` refund of an order, in
  completion order, is split in this fixed hierarchy:
  1. **Overpayment first.** Available overage = `max(0, Σ SUCCEEDED payments settled at or before the refund − Order.total)`
     minus the overage earlier refunds already absorbed. That part is an `overpayment_refund` and never touches sales.
     *Example:* total 1000, payments 1200, refund 200 → the whole 200 is overpayment; sales unchanged.
  2. **Goods, capped.** The next part goes to merchandise, up to the order's **remaining eligible merchandise**: its
     realised merchandise as charged (Σ line net) minus the merchandise parts of earlier refunds. Nothing is eligible
     before the order is realised. This part reduces `realised_net_sales` by its VAT-exclusive equivalent, i.e. part ×
     (merchandise ex VAT ÷ merchandise as charged), rounded half-up. The part that exhausts the remainder takes the
     exact remaining ex-VAT value, so a full refund always nets to zero.
  3. **Non-merchandise.** Anything left belongs to the order's other components (shipping charged, shipping VAT,
     exclusive VAT, price adjustment). It isn't merchandise and doesn't reduce `realised_net_sales`; it stays in
     `refunds`.
  No simple pro-rata split is used. An exchange downgrade refund (pure merchandise) therefore reduces sales in full.
- **Cancellation reversal (P5-2).** For an order realised and later cancelled, every realised-basis contribution made
  before the cancellation (the sale, its discounts, shipping, tax, units, merchandise refunds, returns) is emitted again
  with the opposite sign **at the cancellation instant**. Contributions after it are dropped. History stays traceable
  (Day 1 +1000, Day 3 −1000), no earlier period changes, and nothing new is stored: the reversal is derived from
  `OrderStatusHistory`, with no second ledger.
- **Returned units** come from the ledger's `StockMovement` rows with reason `RETURN` (orderId, variantId, units,
  timestamp). They are valued at the net unit value above. Exchange-returned units, i.e. the original line of an
  `APPROVED` `EXCHANGE` request, are removed chronologically from that (order, variant) pair.
- Money is integer minor units in the store currency (`StoreSetting.currency`); DTOs carry major units. The store
  currency is **locked once any order exists** (P6-4): orders record no currency, so it is the recorded currency of all
  order money.
- **Recorded cost (Phase 6).** `OrderItem.unitCostSnapshot` is the per-unit cost in minor units, captured once in the
  transaction that writes the line (`variant.costPrice ?? product.costPrice` at that moment). NULL means **unknown**:
  no cost was configured, or the line predates Phase 6. Historical COGS and margin never read the current cost price.
  Uncosted lines are excluded from both COGS and margin (never counted at 0) and reported as line coverage. A returned
  unit reverses its recorded cost. Its margin reverses at the VAT-exclusive return value.
- **Attribution (Phase 6).** Every line records `productIdSnapshot`, `categoryIdSnapshot` / `categoryNameSnapshot`
  (leaf category and its name at order time) and `brandSnapshot` (free text; NULL = unbranded). Reports group by these,
  never by today's catalog. Lines written before Phase 6 have no category/brand snapshot. They group as
  **"Not recorded (before Phase 6)"** and are never re-attributed (P6-3). `productIdSnapshot` was backfilled from the
  variant's product, because a variant never changes product.

## 4. The registry

Time basis: **placed** = `Order.createdAt` · **realised** = §2 · **returned** = RETURN movement time · **refunded** =
`Refund.completedAt` · **settled** = `Payment.settledAt` · **now** = point-in-time snapshot.

### 4.1 Sales & financial
| Key | Definition | Time | Refunds | Returns | Exchange | Grain |
|---|---|---|---|---|---|---|
| `orders_placed` | count of sale orders | placed | — | — | excluded | order |
| `orders_realised` | count of realised orders (§2); −1 at the cancellation instant for a realised order cancelled later | realised | — | — | excluded | order |
| `orders_cancelled` | count of cancelled operational orders (§2 cancelled) | placed | — | — | excluded | order |
| `cancelled_order_value` | Σ `total` of those | placed | — | — | excluded | money |
| `gross_merchandise_sales` | Σ line gross (`priceSnapshot × quantity`, after flash sales, before bundle/coupon) of realised orders, **as charged**: excludes shipping and price adjustments; **includes VAT on tax-inclusive orders** (see `merchandise_vat`) | realised | not subtracted | not subtracted | excluded | money |
| `discounts` | Σ `Order.discount` (bundle + coupon) of realised sale orders | realised | — | — | excluded | money |
| `bundle_discount` / `coupon_discount` | split of `discounts` (`bundleDiscount`; `couponDiscount` ?? `discount − bundleDiscount`) | realised | — | — | excluded | money |
| `flash_discount` | Σ `Order.flashDiscount` where recorded (coverage reported) | realised | — | — | excluded | money |
| `shipping_charged` | §3 | realised | — | — | excluded | money |
| `price_adjustments` | Σ `priceAdjustment` | realised | — | — | excluded | money |
| `tax_collected` | Σ `taxAmount` where recorded (coverage reported) | realised | — | — | excluded | money |
| `returns` | Σ returned units × net unit value as charged (realised orders; exchange units excluded) | returned | — | this is the return | excluded | money |
| `net_merchandise_sales` | `gross_merchandise_sales − discounts − returns`, as charged (goods-returned basis; product/category rankings) | mixed (each term its own) | not subtracted | subtracted | excluded | money |
| **`realised_net_sales`** | **Headline.** Realised merchandise sales excluding VAT, less the merchandise part of completed refunds: `gross_merchandise_sales − discounts − merchandise_vat − merchandise_refunds`. Shipping, tax and adjustments are separate metrics. Orders with unknown merchandise VAT are reported as `coverage.missing` | realised / refunded | merchandise part subtracted (§3 hierarchy) | not subtracted (the refund is the reduction) | original sale stands; downgrade refund subtracted; upgrade difference not added | money (order-level groupings) |
| `merchandise_vat` | Σ merchandise VAT of realised orders (§3; coverage reported) | realised | — | — | excluded | money |
| `merchandise_refunds` | Σ VAT-exclusive merchandise parts of completed refunds on realised orders (§3 step 2) | refunded | this is the reduction | — | downgrade refunds included | money |
| `overpayment_refunds` | Σ overpayment parts of completed refunds (§3 step 1), any order | refunded | never a sales reduction | — | — | money |
| `net_sales` | **Secondary — "Net sales incl. shipping, less returns".** `gross_merchandise_sales − discounts + shipping_charged + price_adjustments − returns`, as charged (the D1 goods-basis view) | mixed | **not** subtracted | subtracted | excluded | money |
| `refunds` | Σ `Refund.amount` COMPLETED (all orders; ledger) | refunded | this is the refund | — | downgrade refunds included | money |
| `refund_count` | count of those | refunded | — | — | — | count |
| `payments_received` | Σ `Payment.amount` SUCCEEDED (all providers incl. COD/MANUAL) | settled | — | — | included | money |
| `payment_count` | count of those | settled | — | — | — | count |
| `collected_cash` | `payments_received − refunds` (D1 collected cash, from the ledger) | settled / refunded | subtracted | — | included | money |
| `exchange_difference_collected` | Σ successful payments on exchange replacement orders | settled | — | — | only exchanges | money |
| `outstanding_cod` | Σ `codToCollect` over non-deleted orders (`derivePaymentPosition`) | now | — | — | included | money |
| `amount_due` | Σ `amountDue` over non-deleted, non-cancelled, non-closed orders | now | — | — | included | money |
| `refund_due` | Σ `refundDue` over non-deleted orders | now | — | — | included | money |
| `aov` | `realised_net_sales ÷ orders_realised` (P5-5). Both use the same realisation eligibility and the same cancellation reversals; a refunded order stays in the denominator (it was realised), and its refund lowers the numerator | realised | via numerator | — | excluded | money |
| `cod_orders_placed` | sale orders with `paymentMethod = COD` | placed | — | — | excluded | count |
| `courier_loss` | Σ `CourierLossEvent.amount` | event `createdAt` | — | — | — | money |
| `cogs` | Σ (units sold − units returned) × **recorded** cost (`OrderItem.unitCostSnapshot`), costed lines only; coverage = lines with / without a recorded cost | realised / returned | — | net | excluded | money |
| `gross_margin` | over costed lines only: merchandise excluding VAT − recorded cost, net of costed returns (same population on both sides); coverage as `cogs` | mixed | — | net | excluded | money |

### 4.2 Product
| Key | Definition | Time |
|---|---|---|
| `units_ordered` | Σ quantity on sale-order lines (demand signal: urgency, trending, forecasts) | placed |
| `units_sold` | Σ quantity on realised sale-order lines | realised |
| `units_returned` | returned units (same rule as `returns`) | returned |
| `net_units_sold` | `units_sold − units_returned` (TARGET "units sold") | mixed |
| product / category / variant / size / colour groupings | the metrics above plus `gross_merchandise_sales`, `net_merchandise_sales`, grouped by the line's own snapshots (Phase 6): `productIdSnapshot`, `categoryIdSnapshot`/`categoryNameSnapshot`, `brandSnapshot`, SKU/size/colour. A later re-categorisation, rename, brand edit or product deletion changes no historical report. Pre-Phase-6 lines group as "Not recorded". P5-7 is superseded for new orders | as metric |

### 4.3 Customer (a grouping of the canonical facts, never a separate calculation)
| Key | Definition |
|---|---|
| `customer_orders` | `orders_placed` grouped by customer (lifetime) |
| `customer_net_spend` | `realised_net_sales` grouped by customer (lifetime) — CRM spend, VIP / HIGH_SPENDER tags, RFM, SMS `totalSpent` (P5-4) |
| `customer_refunded` | `refunds` grouped by customer |
| `customer_net_paid` | `collected_cash` grouped by customer |
| `customers_with_orders` | customers with ≥ 1 sale order |
| `repeat_customer_rate` | customers with ≥ 2 sale orders ÷ `customers_with_orders` |
| `customer_lifetime_value` | average `realised_net_sales` per customer over customers with ≥ 1 realised order |

### 4.3a Behaviour and rates (Admin V2, 2026-10-08)
| Key | Definition |
|---|---|
| `sessions` | distinct `PageView.sessionId` with a pageview in the range. Admin (`/admin…`) and draft-preview (`/preview…`) pages are never recorded (`isStorefrontPath`); rows recorded before 2026-10-08 may include admin visits |
| `conversion_rate` | **D25:** `orders_placed` whose order carries a storefront `sessionId` ÷ `sessions`, same range (0–1). Phone / admin-entered orders have no session and are excluded from the numerator |
| `return_rate` | `units_returned` ÷ `units_sold`, both in the range (0–1); exchanges excluded as in both inputs |

### 4.4 Inventory (read-only over InventoryService truth, point in time)
| Key | Definition |
|---|---|
| `stock_on_hand` | Σ `stock` over tracked (`trackInventory`), active variants of non-trashed products — drafts included (physical stock held) |
| `low_stock_variants` | count of **sellable** (published, not trashed, active) tracked variants whose `variantStockState` is `LOW_STOCK` (per-variant `lowStockThreshold`; D5 untracked excluded; product-level low stock is not a rule) |
| `out_of_stock_variants` | sellable tracked variants with `variantStockState = OUT_OF_STOCK` |
| `inventory_value` | Σ `max(stock, 0) × current cost` over the `stock_on_hand` set: TARGET §11 "Stock value"; the only valuation policy that exists (current cost), labelled *estimated* |

## 5. API contract

| Method & path | Auth | Query | Response |
|---|---|---|---|
| `GET /api/v1/metrics` | admin | `metrics` (comma list of registry keys), `preset` or `from`+`to`, optional `groupBy` ∈ `day \| month \| year \| payment_method \| product \| category \| brand \| customer`, optional `limit` (1–100, groupings), optional `compare=previous` (the preceding range of equal length + % change, server-computed) | `{ range, timezone, currency, metrics: { [key]: { value, unit, estimated?, coverage? } }, groups?: [{ key, label, metrics }] }` |
| `GET /api/v1/metrics/definitions` | admin | — | the registry (key, label, description, unit, time basis, status) |
| `GET /api/v1/metrics/consistency` | admin | `preset` / `from`+`to` | cross-surface checks (M-3): each `{ check, expected, actual, ok }` |

Unknown keys, `PENDING` keys, unsupported groupings and malformed dates → 400 with `details.code` (`UNKNOWN_METRIC`,
`METRIC_PENDING`, `UNSUPPORTED_GROUPING`, `INVALID_RANGE`). No free-form filters or SQL fragments are accepted.

The existing `/api/analytics/*`, `/api/bi/*`, `/api/orders/stats`, customer and product endpoints keep their response
shapes where the meaning didn't change. They are re-implemented on the metrics service, so dashboards and the API
return one number per metric.

## 6. Resolved decisions (PD-5.1, owner, 2026-09-30)

PD-5.1 is resolved. The full record is in [BUSINESS_DECISIONS.md](BUSINESS_DECISIONS.md) (PD-5.1 and the P5 table):
- **C1:** `realised_net_sales` is the headline. `net_sales` is secondary and relabelled. The pending
  `realised_revenue` key is withdrawn.
- **C2:** merchandise VAT comes from the order's own snapshot, allocated to lines, with coverage for unknowns.
- **C3:** refunds go goods first, capped. **C4:** overpayment is absorbed first (§3).
- **P5-2:** a cancellation after realisation is a reversal in the cancellation period.
- **P5-3:** exchange semantics are unchanged.
- **P5-5:** AOV = `realised_net_sales ÷ orders_realised`.
- **P5-1, P5-4, P5-6, P5-7, P5-8, P5-9:** approved as recorded.

The API code `METRIC_PENDING` remains for any future pending metric.

## 7. Aggregation, caching, reconciliation

- **No projection tables.** Metrics are computed on request from facts. The fact loader selects only orders with an
  event in the window, using indexed columns. The store's volume doesn't justify materialisation. A daily fact table
  (TARGET M13) would add a rebuild, and nothing today needs one. Phase 6 measured the engine at ~0.1 s / 10k orders and
  ~0.6 s / 100k; revisit above ~50k orders or a lifetime p95 > 1 s ([PHASE_6_AUDIT.md](PHASE_6_AUDIT.md) C).
- **Cache:** Redis, 60 s, keyed by metric set + resolved UTC range + timezone + grouping. Stale semantics: at most 60 s
  old; money commands don't invalidate it, since a dashboard number may lag a refund by up to a minute.
- **Reconciliation (M-3), `GET /api/v1/metrics/consistency`:**
  - Σ daily series = range total.
  - Σ daily `realised_net_sales` = total; Σ `customer_net_spend` = store `realised_net_sales`.
  - Bridge: `realised_net_sales` = `gross_merchandise_sales − discounts − merchandise_vat − merchandise_refunds`.
  - Σ product `net_merchandise_sales` (incl. unattributed) = store `net_merchandise_sales`.
  - Σ product `gross_margin` = store `gross_margin`; Σ category `cogs` (incl. "Not recorded") = store `cogs` (Phase 6).
  - `collected_cash` = Σ ledger payments − Σ ledger refunds, recomputed directly from the tables.

## 8. Invariants (tested)

| ID | Invariant |
|---|---|
| M-1 | Business numbers come from the registry engine only: no `SUM(total)` / `status != 'CANCELLED'` revenue SQL outside the fact loader (guard test) |
| M-2 | Financial metrics read snapshots and the ledger only. Changing a product price, tax setting, shipping zone, coupon or flash sale after the fact changes no historical metric |
| M-3 | Cross-surface equality (§7) |
| M-4 | Business-day boundaries follow `StoreSetting.timezone`. Raw `NOW()` and bare instant comparisons are forbidden (guard test) |
| M-5 | Trashed and exchange-replacement orders are never sales. An order cancelled before realisation is never a sale; one cancelled after realisation is reversed in the cancellation period (P5-2), never deleted from earlier periods |
| M-6 | Returned units never count as net sold. Exchange-returned units aren't returns. An exchange never double-counts merchandise |
| M-7 | Metrics code never writes: no stock, ledger or order writes (the existing single-writer guards cover it) |
| M-8 | Refund hierarchy: overpayment first, then merchandise up to the remaining eligible merchandise, then non-merchandise; never pro-rata. `realised_net_sales` falls only by the merchandise part |
| M-9 | Merchandise VAT comes only from the order's tax snapshot; unknown VAT is reported as coverage, never estimated |
| M-10 | Headline sales, AOV and customer spend are all `realised_net_sales`, over the same realisation population |
| M-11 | COGS and gross margin read only the line's recorded cost. A later cost change changes no historical figure. Unknown cost is excluded and reported, never counted as 0 or backfilled |
| M-12 | Category, brand and product attribution read only the line's snapshots. Re-categorisation, rename, brand edits and permanent product deletion change no historical report. Pre-Phase-6 lines are "Not recorded", never re-attributed |
| M-13 | Order-line snapshots have one writer (`domain/orders/line-snapshots.ts`), called in the transaction that writes the line. Recorded cost is omitted from every read except the metrics loader and never reaches a customer response |

## 9. Verification (final Phase 5 run incl. PD-5.1, 2026-09-30)

| Gate | Result |
|---|---|
| PD-5.1 focused tests (`lib/realised-net-sales.test.ts`: realised online / COD, unrealised COD, cancellation reversal incl. CANCELLED → REFUNDED, partial / full / overpayment refunds, goods-first capped, exchange downgrade / upgrade, inclusive VAT, missing snapshot coverage, AOV and its population, customer spend, bridge) | 18 passed |
| Engine unit tests (`lib/metrics-engine.test.ts`) | 22 passed |
| Mutation tests (`lib/metrics.mutation.test.ts`) | 23 passed: canonical engine clean; 22/22 mutants killed — the 15 Phase 5 mutants plus 11b (AOV denominator = payments) and PD-1 old `net_sales` headline, PD-2 refund before overpayment, PD-3 pro-rata refund, PD-4 current tax instead of the snapshot, PD-5 cancellation retroactively deleting the sale, PD-6 exchange upgrade counted as a sale |
| Source mutations (by hand, then reverted) | 11/11 killed: the 8 of the earlier run plus loader drops `cancelledAt`, loader drops `shippingTaxAmount`, SALE_ORDER query form ignores the CANCELLED history |
| SSOT guard | 2 passed |
| Integration + API contract (`domain/metrics/metrics.integration.test.ts`: incl. PD-5.1 over real order / ledger / exchange paths — paid → cancelled → refunded → REFUNDED, goods-first partial refund, completed exchange downgrade refund, inclusive VAT from the snapshot with the tax setting restored, AOV and customer spend through the service) | 20 passed |
| Every analytics / BI endpoint (76 endpoints × 3 windows, BI fields incl. the PD-5.1 bridge, dashboard headline and AOV = metrics API) | 78 passed |
| Full API suite, Redis connected / without Redis | 47 files, 663 passed / 663 passed |
| D8 loyalty tests with Redis connected (test-only cache isolation) | 22/22 whole file and 2/2 in isolation (`-t D8`), with and without Redis |
| Playwright desktop + mobile (API on the test DB, Redis connected) | 194 passed, 2 skipped (viewport-scoped by the specs), 0 failed — 98 desktop / 98 mobile. (A first run failed only the STAFF-permission test ×2: the reset test DB lacked the CI-provisioned staff account; after `scripts/create-e2e-staff.ts` on the test DB, the full rerun is clean.) |
| TypeScript (api, web) · ESLint (api clean; web 0 errors, 2 pre-existing `<img>` warnings) · API build | clean |
| Next.js build | compiled, type-checked, 12/12 pages generated; the standalone copy step fails with the known Windows symlink `EPERM` (14) |
| Test DB (`clothing_brand_test`) | `migrate status`: 79 migrations, up to date; `migrate diff` (datasource → datamodel, read-only, no shadow DB): no drift |
| Reconciliation (`metricsConsistency`, M-3) | all checks ok for lifetime / last 30 days / today on the test DB, and in the integration suite over its own realised, refunded and exchanged orders |
