# Phase 5 Metrics Audit — every business number, traced

**Status:** Phase 5, Steps 1–2 deliverable (2026-09-30), branch `phase-5/metrics-ssot`. This document was written
before any Phase 5 code changed. Audited revision: `phase-4/payment-ledger` @ `b368c75`. The canonical definitions this
audit leads to are in [METRICS_REGISTRY.md](METRICS_REGISTRY.md).

**Method.** I read every function that reads `Order`, `OrderItem`, `Payment`, `Refund`, `ReturnRequest`,
`StockMovement` or `ProductVariant.stock` to produce a number: 85 functions in `analytics.service.ts`, `bi.service.ts`,
`customer.service.ts`, `product.service.ts`, `order.service.ts` and `payments-overview.service.ts`. For each I traced
three things: which orders it counts, which money field it sums, and which time boundary it uses. Behavioural
analytics over `PageView` / `FunnelEvent` / `SearchLog` / `ProductViewLog` are their own facts (visits, searches), not
business truth. They are audited only for the time-window defect (§2).

---

## 1. Findings

### 1.1 One fact, ~40 ad-hoc definitions of "a sale"
| Definition in use | Where (function) |
|---|---|
| `status != 'CANCELLED'`, **all** orders incl. trashed and exchange replacements, by `createdAt` | analytics: `getRevenueSeries`, `getTopProducts`, `getDashboardSummary`, `getCustomerInsights`, `getCohortRetention`, `getTopCategories`, `getTopBrands`, `getConversionFunnel` (converted), `getSlowMovingProducts`, `getBestSellingPrediction`, `getDemandForecast`, `getProductConversionRates`, `getHighestProfitProducts`, `getProductRiskMetrics`, `getFrequentlyBoughtTogetherPairs`, `getProductSalesHeatmap`, `getVariantPerformance`, `getSizeColorPerformance`, `getInventoryTurnover`, `getFavoritePaymentMethod`, `getPurchaseTimeDistribution`, `getCustomerLocationBreakdown`, `getCouponEffectiveness`, `getBundlePerformance`, `getFlashSalePerformance`, `getDiscountUsageBreakdown`, `getProfitTrend`, `getFinancialCostBreakdown`, `getEstimatedTaxCollected`, `getDeadStockReport`, `getOrderFulfillmentTime`, `getWishlistConversionRate`, `getLifetimeYearlyTrend`; bi: `getExecutiveOverview` (revenue, COGS, conversion, rates) |
| `status NOT IN ('CANCELLED','REFUNDED')`, by `createdAt` | product: `getProductSalesSummary` (admin panel), `getUrgencySignals` (storefront), trending pool, frequently-bought-together |
| no status filter, excludes trashed, **server-local** midnight | order: `getOrderStats.todayRevenue` (orders KPI strip; includes cancelled orders) |
| `status != 'CANCELLED'`, excludes trashed | customer: `loadCustomersWithComputedFields.totalSpent` (CRM list, VIP tags, segments, SMS vars, RFM, purchase frequency) |
| `status != 'CANCELLED'`, **includes** trashed | customer: `getCustomerDetailAdmin.totalSpent` / AOV (same drawer's order counts exclude trashed) |

Consequences:
- Placed COD orders count as revenue the moment they are created. D1 says COD is realised only at `DELIVERED`.
- Returned merchandise is never subtracted, and refunds (the Phase 4 ledger) are never subtracted.
- Trashed orders count in analytics.
- Exchange replacement orders count as sales, so an exchange adds the replacement item's value a second time.

### 1.2 Wrong money field or double counting
| Metric | Implementation | Defect |
|---|---|---|
| "Revenue" | `SUM(Order.total)` | includes shipping, admin adjustment and exclusive-mode tax. It isn't merchandise sales, and it isn't net of returns or refunds |
| Product / category / brand / variant / size / colour revenue | `SUM(qty × priceSnapshot)` | before bundle and coupon discounts (the Phase 2 allocations `bundleDiscountAllocated` / `couponDiscountAllocated` are ignored); returned units still counted |
| Discount usage `couponDiscountTotal` | `SUM(discount)` | `discount` = coupon + bundle, so **bundle discounts are counted twice** (once here, again in `bundleDiscountTotal`) |
| Financial cost "refundCost" | `SUM(total) WHERE paymentStatus IN (REFUNDED, PARTIALLY_REFUNDED)` | counts the whole order total for a partial refund, instead of the ledger's `Σ Refund.amount` |
| Estimated tax | `taxIncludedIn(Σ total, current StoreSetting rate)` | **current tax configuration applied to history**. Phase 2 snapshots `Order.taxAmount` for every new order |
| Flash-sale performance | orders matched by product + "created inside the sale window" | guesswork; Phase 2 records exact `OrderItem.flashSaleId` attribution. Also counts non-flash units bought in the window |
| COGS / profit / inventory turnover / dead stock value | `qty × current costPrice` | current cost applied to history (no cost snapshot exists). Only defensible if labelled *estimated* (TARGET §11 fallback) |
| Pending payments (BI) | `SUM(total) WHERE paymentStatus = 'UNPAID'` | ignores part-payments; the Phase 4 ledger has `amountDue` |
| Refund rate (BI) | `paymentStatus IN (…) OR status = 'REFUNDED'` ÷ non-cancelled | order-count proxy; mixes two representations |
| Return rate (BI) | `COUNT(DISTINCT orderId) FROM ReturnRequest` | counts **pending and rejected** requests and exchanges as returns |
| Units sold (product panel / urgency) | `Σ quantity` | returned units still "sold" |
| Low stock (dashboard, BI insights) | `stock ≤ 5`, product `isActive` | ignores `lowStockThreshold`, `trackInventory` (D5), variant `isActive` and trash |
| Cart "potential revenue" | `qty × (variant.price ?? basePrice)` | current list price, ignores flash. Labelled estimate (PI-9.6); unchanged |

### 1.3 Customer metrics computed independently of revenue
`totalSpent` is recomputed in three places with three predicates (§1.1), in JavaScript, from `Order.total`. VIP /
HIGH_SPENDER tags, the minimum-spend filter, customer SMS variables, RFM and the CRM "lifetime revenue" all read it.
`getCustomerInsights.avgClv` is a fourth implementation, in SQL, with yet another predicate (includes trashed).

### 1.4 No historical attribution for some dimensions
- **Category of a sold item:** `OrderItem` has no category snapshot, so every category report joins the *current*
  product → category. A product moved between categories re-attributes its whole history. This can't be fixed
  retroactively (documented; no fake history).
- **Unit cost at sale:** no snapshot (TARGET M7 planned `OrderItem.unitCostSnapshot`; not built).
- **Per-line return time:** `OrderItem.returnedQuantity` has no timestamp. The return *date* is the ledger's
  `StockMovement` `RETURN` row (per order + variant).

### 1.5 Store timezone is not configuration
`Asia/Dhaka` is hard-coded in 22 places (analytics, BI, order notes, inventory, read model). There is no timezone
setting. TARGET §7 plans `CommerceSettings.timezone`.

## 2. The time-window defect (measured, not assumed)

Probe on `clothing_brand_test` (session `TimeZone` = `Asia/Dhaka`):

| Expression | Row written by the Prisma client one minute ago | Correct? |
|---|---|---|
| stored value | `2026-09-29 17:59:30` (UTC wall clock, naive `timestamp(3)`) | — |
| `"createdAt" >= ${jsDate − 1 min}` (bound `Date` → `timestamptz`) | **false** | ✗ the column is read as Dhaka time, 6 h in the past |
| `"createdAt" >= NOW() − INTERVAL '1 minute'` | **false** | ✗ same 6 h skew |
| `"createdAt" >= (${jsDate}::timestamptz AT TIME ZONE 'UTC')` | true | ✓ |

Effects:
- **Every raw-SQL window in `analytics.service.ts` is shifted by 6 hours.** This covers the ~70 `>= ${since}` /
  `<= ${until}` comparisons and the `NOW() − INTERVAL` windows of `getBestSellingPrediction` and
  `getSearchTrends`/`getTrendingProducts`. The newest 6 hours of each lower boundary are excluded.
- `date_trunc('day', "createdAt" AT TIME ZONE 'UTC')` truncates in the *session* zone and returns a `timestamptz`. JS
  then keys it by its **UTC** date, so revenue, profit and product-heatmap days are keyed one day early.
- "Today" is computed three different ways:
  - `getOrderStats`: Node server-local midnight.
  - `getRevenueSeries`: UTC midnight.
  - BI: `NOW() AT TIME ZONE 'Asia/Dhaka'` (correct, but hard-coded).
- `payments-overview` "this month" uses server-local month start.

Prisma's typed API (`where: { createdAt: { gte } }`) is correct, because the client sends naive UTC. Only raw SQL is
affected.

## 3. Duplicate metrics matrix

"Phase 4 ledger" = `Payment` / `Refund` + `derivePaymentPosition`. "Snapshot" = Phase 2 order/line pricing facts.

| Metric | Current implementations | Current definition | Problem | Canonical source | Proposed definition (METRICS_REGISTRY key) | Consumers |
|---|---|---|---|---|---|---|
| Gross merchandise sales | none (revenue = `Σ total`) | — | not measured | `OrderItem.priceSnapshot × quantity` of realised sale orders | `gross_merchandise_sales` (by realisation time) | BI overview/financial, dashboard, reports |
| Net merchandise sales | none | — | not measured | gross − discounts − returns | `net_merchandise_sales` | BI, product/category rankings |
| Order total / "revenue" | 30+ SQL copies, 3 "today"s | `Σ total`, `status != CANCELLED`, `createdAt` | unrealised COD, no returns/refunds, trashed + exchange included, 6 h skew | snapshot + realisation rule | `net_sales` (realised revenue before refunds) + `refunds` beside it; `realised_revenue` **pending PD-5.1** | dashboard, BI, KPI strip, exports |
| Paid sales | none | — | — | ledger | `payments_received` | BI financial |
| Cancelled sales | `cancelledRatePct` (count only) | count | no value | `Order.total` of cancelled orders | `orders_cancelled`, `cancelled_order_value` (by placement) | BI, operations |
| Returned sales | BI return rate (request count) | pending/rejected requests counted | wrong fact | ledger `RETURN` movements × line net unit value | `returns` (by return date), `units_returned` | BI, product risk |
| Exchange sales | counted as ordinary sales | — | double counting | `ReturnRequest(EXCHANGE, APPROVED)` + replacement order | excluded from sale orders (TARGET §11); exchange-returned units are not returns; difference collected → `exchange_difference_collected`; downgrade refund → `refunds` | BI |
| Discounts | `getDiscountUsageBreakdown`, coupon/bundle effectiveness, cost breakdown | `Σ discount` (+ `Σ bundleDiscount` double count) | bundle counted twice; not realisation-based | `Order.discount`, `bundleDiscount`, `couponDiscount` snapshots | `discounts`, `bundle_discount`, `coupon_discount` | BI marketing/financial |
| Flash discounts | window-matched guess | revenue in window | wrong attribution | `Order.flashDiscount` / `OrderItem.flashSaleId` (NULL before Phase 2) | `flash_discount` (with coverage) | BI marketing |
| Tax | `getEstimatedTaxCollected` | current rate × revenue | current config on history | `Order.taxAmount` snapshot (NULL before Phase 2) | `tax_collected` (+ coverage: orders without a snapshot) | BI financial |
| Shipping | not measured | — | — | `shippingFee` / `shippingWaived` / own arithmetic | `shipping_charged` | BI financial |
| Refunds | cost breakdown, overview Σ this month | `Σ total` of refunded orders / Σ Refund (server month) | whole total; wrong boundary | Phase 4 ledger `Refund` COMPLETED | `refunds` (by completion time) | BI, payments overview |
| Net revenue | none | — | — | D1 formula | `realised_revenue` — **pending PD-5.1**; `net_sales` meanwhile | — |
| Collected cash | none | — | — | ledger: Σ Payment SUCCEEDED − Σ Refund COMPLETED | `collected_cash` | BI financial |
| Outstanding COD | none | — | — | ledger `codToCollect` | `outstanding_cod` (point in time) | BI financial, dashboard |
| Amount due / pending payments | BI `pendingPayments*` | `Σ total WHERE UNPAID` | ignores part-payments | ledger `amountDue` | `amount_due` (point in time) | BI |
| Customer order count | 3 JS copies | orders incl./excl. trashed/cancelled | inconsistent | sale-order predicate | `customer_orders` | CRM list/drawer, tags, RFM |
| Customer spend | 3 JS copies + SQL CLV | `Σ total` non-cancelled | placed ≠ realised; returns/refunds ignored | customer grouping of `net_sales` | `customer_net_spend` (lifetime) | CRM, VIP tags, SMS vars, RFM, BI |
| AOV | dashboard, BI, drawer | `Σ total ÷ count` | inconsistent numerator/denominator | registry | `aov` = `net_sales ÷ orders_realised` (interim until PD-5.1) | dashboard, BI, drawer |
| Repeat customer rate | `getCustomerInsights` | ≥2 non-cancelled orders incl. trashed | predicate | sale orders | `repeat_customer_rate` | BI, journey funnel |
| Lifetime value | `avgClv` | avg `Σ total` | as above | customer net spend | `customer_lifetime_value` (average) | BI |
| Order count (operational) | dashboard, BI, KPI, funnel | varies | predicate | sale orders by placement | `orders_placed`; `orders_realised`; `orders_by_status` | dashboard, KPI, funnel |
| Fulfilled / returned orders | drawer counts, BI | status counts incl. trashed | predicate | status + trash rule | `orders_by_status` (non-trashed) | BI, drawer |
| Refund / payment / COD order counts | none / BI proxy | — | — | ledger rows | `refund_count`, `payment_count`, `cod_orders_placed` | BI financial |
| Units sold | analytics (Σ qty), product panel (NOT_A_SALE), urgency | gross units, 3 predicates | returns counted; predicates differ | realised sale-order lines | `units_sold` (realised), `units_returned`, `net_units_sold` | product BI, heatmap, rankings |
| Units ordered (demand) | urgency, trending, FBT, forecast, slow-moving, best-selling | 2 predicates | differ | sale orders by placement | `units_ordered` | storefront urgency/trending, forecasts |
| Product / category revenue | 6 SQL copies | `qty × priceSnapshot` | pre-discount, returns ignored, current category | line net value | `gross_merchandise_sales` / `net_merchandise_sales` grouped by product / category (current mapping — §1.4) | BI products |
| Top products / categories | 3 copies | as above | as above | registry groupings | groupings of the registry metrics | dashboard, BI |
| COGS / gross margin | BI, profit trend, per-product profit | current cost | history at current cost | line net units × current cost | `cogs_estimated`, `gross_margin_estimated` (flagged *estimated*; cost snapshot deferred) | BI financial/products |
| Stock count | none canonical | — | — | `ProductVariant.stock` (InventoryService, read-only here) | `stock_on_hand` | BI inventory |
| Low stock | dashboard, BI insights, low-stock table | `stock ≤ 5` | wrong rule | `variantStockState` (per-variant threshold, D5) | `low_stock_variants` | dashboard, BI |
| Out of stock | none | — | — | same | `out_of_stock_variants` | BI inventory |
| Inventory value | BI, turnover, dead stock | `stock × current cost`, active products | valuation rule implicit | TARGET §11 "Stock value" | `inventory_value` (current cost — the only policy that exists; labelled) | BI |
| Courier loss | dashboard, BI | `Σ CourierLossEvent.amount` | 6 h window | `CourierLossEvent` | `courier_loss` | dashboard, BI |

## 4. What stays outside the registry (not business truth)
- Visits, sessions, bounce, devices, geo, search, funnel and wishlist events, reviews, feedback, admin activity,
  campaign delivery, cart abandonment. These are behavioural or operational logs with their own sources. They keep their
  queries, but every time window goes through the canonical business-time layer (§2 defect fixed for them too).
- Customer risk signals and tags keep their rules. Only the spend input switches to `customer_net_spend`.
