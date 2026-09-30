# Metrics Registry — Phase 5 (Metrics & Analytics SSOT)

**Status:** Phase 5 contract (2026-09-30), branch `phase-5/metrics-ssot`. Evidence:
[PHASE_5_METRICS_AUDIT.md](PHASE_5_METRICS_AUDIT.md).

The rules here come from approved sources: D1 (revenue recognition), D6 (exchanges) and D8
([BUSINESS_DECISIONS.md](BUSINESS_DECISIONS.md)), the TARGET_ARCHITECTURE §11 metric table, the order state machine,
the Phase 2 snapshots ([PRICING_INVARIANTS.md](PRICING_INVARIANTS.md) §8) and the Phase 4 ledger
([PAYMENT_LEDGER.md](PAYMENT_LEDGER.md)). Where those leave a rule open, the metric is marked **PENDING** and isn't
implemented (§6).

```
database truth    Order + OrderItem snapshots (Phase 2) · OrderStatusHistory (Phase 1) · Payment + Refund (Phase 4)
                  StockMovement RETURN rows (Phase 1, return dates) · ReturnRequest(EXCHANGE) · ProductVariant.stock (read-only)
  → fact loader   apps/api/src/domain/metrics/facts.repository.ts — the only SQL that reads sales facts
  → pure engine   packages/shared/src/metrics/  business-time · eligibility & valuation (facts) · registry · aggregate
  → service       apps/api/src/domain/metrics/metrics.service.ts — resolves the range, loads facts, runs the engine, caches
  → API           GET /api/v1/metrics · /definitions · /consistency
  → consumers     dashboard, orders KPI strip, BI (overview, financial, sales, products, customers, inventory, lifetime),
                  CRM (spend, tags, RFM),`groupBy` ∈ `day | month | year | payment_method | product | category | brand | customer`sales panel, storefront urgency/trending/FBT
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
| **Sale order** | `deletedAt IS NULL ∧ status ≠ CANCELLED ∧ not an exchange replacement` (an order referenced by `ReturnRequest.exchangeOrderId`) | TARGET §11 `SALE_ORDER` |
| **Realised** | a sale order whose realisation instant exists. **COD:** the first `OrderStatusHistory` entry `DELIVERED` or `PARTIALLY_DELIVERED`. **Online / other:** the first `SUCCEEDED` `Payment.settledAt`. | D1 ("COD: DELIVERED; online: paymentStatus reached PAID") |
| Operational order | `deletedAt IS NULL ∧ not an exchange replacement`, any status | status breakdowns, cancellation counts |
| Money movement | every `SUCCEEDED` `Payment` and `COMPLETED` `Refund` row, whatever the order's status or trash state (cash is cash; trash never deletes a money movement) | Phase 4 ledger |

Treatment summary:

| Case | Sales / revenue metrics | Cash metrics | Counts |
|---|---|---|---|
| Pending / confirmed / shipped COD | not realised → excluded | — | `orders_placed` |
| Paid online order | realised at first successful payment | payment counted | placed + realised |
| Delivered COD | realised at first delivery | COD payment counted (Phase 4 T4) | placed + realised |
| Cancelled | never a sale | its payments and refunds count in cash metrics | `orders_cancelled` |
| Returned (T7) | realised earlier; returned units subtract as `returns` at their return date | refunds count at completion | status breakdown |
| Refunded / partially refunded | unaffected by status; refunds are their own metric | refunds subtract from `collected_cash` | — |
| Exchange replacement order | never a sale (TARGET §11) | its payments → `exchange_difference_collected` + `collected_cash` | excluded |
| Exchange-returned original units | **not** a return (the original sale stands: D6, return-request service) | downgrade refund → `refunds` | — |
| Trashed order | excluded from every sales and count metric | its payments/refunds still count (ledger rows stay facts) | excluded |
| Trashed / deleted`groupBy` ∈ `day | month | year | payment_method | product | category | brand | customer`| history unaffected (line snapshots); attribution to the current product via `variantId` when the variant still exists, else "unattributed" | — | — |

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
- **Returned units** come from the ledger's `StockMovement` rows with reason `RETURN` (orderId, variantId, units,
  timestamp). They are valued at the net unit value above. Exchange-returned units, i.e. the original line of an
  `APPROVED` `EXCHANGE` request, are removed chronologically from that (order, variant) pair.
- Money is integer minor units in the store currency (`StoreSetting.currency`); DTOs carry major units.

## 4. The registry

Time basis: **placed** = `Order.createdAt` · **realised** = §2 · **returned** = RETURN movement time · **refunded** =
`Refund.completedAt` · **settled** = `Payment.settledAt` · **now** = point-in-time snapshot.

### 4.1 Sales & financial
| Key | Definition | Time | Refunds | Returns | Exchange | Grain |
|---|---|---|---|---|---|---|
| `orders_placed` | count of sale orders | placed | — | — | excluded | order |
| `orders_realised` | count of realised sale orders | realised | — | — | excluded | order |
| `orders_cancelled` | count of operational orders with status `CANCELLED` | placed | — | — | excluded | order |
| `cancelled_order_value` | Σ `total` of those | placed | — | — | excluded | money |
| `gross_merchandise_sales` | Σ line gross of realised sale orders (excl. shipping, tax, adjustment) | realised | not subtracted | not subtracted | excluded | money |
| `discounts` | Σ `Order.discount` (bundle + coupon) of realised sale orders | realised | — | — | excluded | money |
| `bundle_discount` / `coupon_discount` | split of `discounts` (`bundleDiscount`; `couponDiscount` ?? `discount − bundleDiscount`) | realised | — | — | excluded | money |
| `flash_discount` | Σ `Order.flashDiscount` where recorded (coverage reported) | realised | — | — | excluded | money |
| `shipping_charged` | §3 | realised | — | — | excluded | money |
| `price_adjustments` | Σ `priceAdjustment` | realised | — | — | excluded | money |
| `tax_collected` | Σ `taxAmount` where recorded (coverage reported) | realised | — | — | excluded | money |
| `returns` | Σ returned units × net unit value (sale orders; exchange units excluded) | returned | — | this is the return | excluded | money |
| `net_merchandise_sales` | `gross_merchandise_sales − discounts − returns` | mixed (each term its own) | not subtracted | subtracted | excluded | money |
| `net_sales` | `gross_merchandise_sales − discounts + shipping_charged + price_adjustments − returns`, i.e. D1 realised revenue **before the refund term** | mixed | **not** subtracted (shown beside) | subtracted | excluded | money |
| `realised_revenue` | D1: `net_sales − refunds not already counted as returns` | — | **PENDING PD-5.1** | — | — | — |
| `refunds` | Σ `Refund.amount` COMPLETED (all orders; ledger) | refunded | this is the refund | — | downgrade refunds included | money |
| `refund_count` | count of those | refunded | — | — | — | count |
| `payments_received` | Σ `Payment.amount` SUCCEEDED (all providers incl. COD/MANUAL) | settled | — | — | included | money |
| `payment_count` | count of those | settled | — | — | — | count |
| `collected_cash` | `payments_received − refunds` (D1 collected cash, from the ledger) | settled / refunded | subtracted | — | included | money |
| `exchange_difference_collected` | Σ successful payments on exchange replacement orders | settled | — | — | only exchanges | money |
| `outstanding_cod` | Σ `codToCollect` over non-deleted orders (`derivePaymentPosition`) | now | — | — | included | money |
| `amount_due` | Σ `amountDue` over non-deleted, non-cancelled, non-closed orders | now | — | — | included | money |
| `refund_due` | Σ `refundDue` over non-deleted orders | now | — | — | included | money |
| `aov` | `net_sales ÷ orders_realised` (interim basis until PD-5.1 approves realised revenue; TARGET's denominator) | realised | — | — | excluded | money |
| `cod_orders_placed` | sale orders with `paymentMethod = COD` | placed | — | — | excluded | count |
| `courier_loss` | Σ `CourierLossEvent.amount` | event `createdAt` | — | — | — | money |
| `cogs_estimated` | Σ (units sold − units returned) × **current** cost (`variant.costPrice ?? product.costPrice ?? 0`) | realised / returned | — | net | excluded | money, flagged *estimated* |
| `gross_margin_estimated` | `net_merchandise_sales − cogs_estimated` | mixed | — | — | excluded | money, flagged *estimated* |

### 4.2 Product
| Key | Definition | Time |
|---|---|---|
| `units_ordered` | Σ quantity on sale-order lines (demand signal: urgency, trending, forecasts) | placed |
| `units_sold` | Σ quantity on realised sale-order lines | realised |
| `units_returned` | returned units (same rule as `returns`) | returned |
| `net_units_sold` | `units_sold − units_returned` (TARGET "units sold") | mixed |
|`groupBy` ∈ `day | month | year | payment_method | product | category | brand | customer`/ category / variant / size / colour groupings | the metrics above plus `gross_merchandise_sales`, `net_merchandise_sales`, grouped by the line's current product (via `variantId`), its **current** category (no category snapshot exists — audit §1.4), or the line's own SKU/size/colour snapshot | as metric |

### 4.3 Customer (a grouping of the canonical facts, never a separate calculation)
| Key | Definition |
|---|---|
| `customer_orders` | `orders_placed` grouped by customer (lifetime) |
| `customer_net_spend` | `net_sales` grouped by customer (lifetime) |
| `customer_refunded` | `refunds` grouped by customer |
| `customer_net_paid` | `collected_cash` grouped by customer |
| `customers_with_orders` | customers with ≥ 1 sale order |
| `repeat_customer_rate` | customers with ≥ 2 sale orders ÷ `customers_with_orders` |
| `customer_lifetime_value` | average `customer_net_spend` over customers with ≥ 1 realised order |

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
| `GET /api/v1/metrics` | admin | `metrics` (comma list of registry keys), `preset` or `from`+`to`, optional `groupBy` ∈ `day | month | year | payment_method | product | category | brand | customer`\| month \| year \| payment_method \| product \| category \| customer`, optional `limit` (1–100, groupings), optional `compare=previous` (the preceding range of equal length + % change, server-computed) | `{ range, timezone, currency, metrics: { [key]: { value, unit, estimated?, coverage? } }, groups?: [{ key, label, metrics }] }` |
| `GET /api/v1/metrics/definitions` | admin | — | the registry (key, label, description, unit, time basis, status) |
| `GET /api/v1/metrics/consistency` | admin | `preset` / `from`+`to` | cross-surface checks (M-3): each `{ check, expected, actual, ok }` |

Unknown keys, `PENDING` keys, unsupported groupings and malformed dates → 400 with `details.code` (`UNKNOWN_METRIC`,
`METRIC_PENDING`, `UNSUPPORTED_GROUPING`, `INVALID_RANGE`). No free-form filters or SQL fragments are accepted.

The existing `/api/analytics/*`, `/api/bi/*`, `/api/orders/stats`, customer and`groupBy` ∈ `day | month | year | payment_method | product | category | brand | customer`endpoints keep their response
shapes where the meaning didn't change. They are re-implemented on the metrics service, so dashboards and the API
return one number per metric.

## 6. Pending decision

- **PD-5.1:** "Refunds not already counted as returns" (the last term of D1 realised revenue). Refunds aren't linked to
  returns. The term needs a rule for when a refund duplicates a return that was already subtracted, how a refund of a
  duplicate payment (overpayment, never revenue) is treated, and which period absorbs the netting. Until approved:
  `realised_revenue` isn't served (400 `METRIC_PENDING`); `net_sales` and `refunds` are shown side by side; `aov` uses
  `net_sales`. The proposal is recorded in BUSINESS_DECISIONS (PD-5.1).

## 7. Aggregation, caching, reconciliation

- **No projection tables.** Metrics are computed on request from facts. The fact loader selects only orders with an
  event in the window, using indexed columns. The store's volume doesn't justify materialisation. A daily fact table
  (TARGET M13) would add a rebuild, and nothing today needs one.
- **Cache:** Redis, 60 s, keyed by metric set + resolved UTC range + timezone + grouping. Stale semantics: at most 60 s
  old; money commands don't invalidate it, since a dashboard number may lag a refund by up to a minute.
- **Reconciliation (M-3), `GET /api/v1/metrics/consistency`:**
  - Σ daily series = range total.
  - Σ `customer_net_spend` = store `net_sales` over the lifetime.
  - Σ`groupBy` ∈ `day | month | year | payment_method | product | category | brand | customer``net_merchandise_sales` (incl. unattributed) = store `net_merchandise_sales`.
  - `collected_cash` = Σ ledger payments − Σ ledger refunds, recomputed directly from the tables.

## 8. Invariants (tested)

| ID | Invariant |
|---|---|
| M-1 | Business numbers come from the registry engine only: no `SUM(total)` / `status != 'CANCELLED'` revenue SQL outside the fact loader (guard test) |
| M-2 | Financial metrics read snapshots and the ledger only. Changing a`groupBy` ∈ `day | month | year | payment_method | product | category | brand | customer`price, tax setting, shipping zone, coupon or flash sale after the fact changes no historical metric |
| M-3 | Cross-surface equality (§7) |
| M-4 | Business-day boundaries follow `StoreSetting.timezone`. Raw `NOW()` and bare instant comparisons are forbidden (guard test) |
| M-5 | Cancelled, trashed and exchange-replacement orders are never sales |
| M-6 | Returned units never count as net sold. Exchange-returned units aren't returns. An exchange never double-counts merchandise |
| M-7 | Metrics code never writes: no stock, ledger or order writes (the existing single-writer guards cover it) |

## 9. Verification (Phase 5 sign-off run, 2026-09-30)

| Gate | Result |
|---|---|
| Engine unit tests (`lib/metrics-engine.test.ts`: business time incl. Dhaka boundaries and a DST zone, eligibility, valuation, aggregation, M-3) | 22 passed |
| Mutation tests (`lib/metrics.mutation.test.ts`) | 16 passed: canonical engine clean, 15/15 mutants killed (cancelled / exchange / trashed included, refunds ignored, current tax, current price, UTC or `NOW()` day boundaries, returned units sold, exchange double count ×2, independent customer spend, wrong AOV denominator, deleted-product lines dropped, placed COD realised) |
| Source mutations (by hand against the integration suites, then reverted) | 8/8 killed: SALE_ORDER query form, replacement flag, exchange approvals, `utcInstant`, store timezone, dashboard figure, COD realisation, returns valuation |
| SSOT guard (`domain/metrics/metrics-ssot.guard.test.ts`) | 2 passed |
| Integration + API contract (`domain/metrics/metrics.integration.test.ts`: real orders through order/ledger/exchange paths, M-2, M-4, `utcInstant` probe, reconciliation, groupings, `/api/v1/metrics` success and error contract) | 15 passed |
| Every analytics / BI endpoint (`modules/analytics/analytics-endpoints.integration.test.ts`: 76 endpoints × default / 7 days / custom range, BI overview, dashboard = metrics API) | 78 passed |
| Full API suite | 46 files, 633 tests passed |
| Playwright desktop + mobile (API connected to Redis) | 194 passed, 2 skipped (viewport-scoped by the specs), 0 failed |
| TypeScript (api, web) · ESLint (api, web: 0 errors; 2 pre-existing `<img>` warnings) · API build | clean |
| Next.js build | compiled, type-checked, 12/12 pages generated; the standalone copy step fails with the known Windows symlink `EPERM` |
| Test DB (`clothing_brand_test`) | reset + all 79 migrations from zero, seeded; `migrate status` up to date; `migrate diff` (datasource → datamodel, read-only) no drift |
