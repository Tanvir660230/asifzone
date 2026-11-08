# Phase 6 Audit: Historical Facts

**Status:** Phase 6 audit and design, 2026-09-30, branch `phase-6/historical-snapshots` (from Phase 5 `185d003`).

**Goal (owner):** Historical business facts must stay reproducible when the current catalog, pricing, tax, shipping,
cost, category, brand, timezone or configuration changes.

This audit covers the six areas deferred from Phase 5 (TARGET §16e):
- **A.** Historical cost
- **B.** Historical category and brand
- **C.** Daily facts
- **D.** CommerceSettings
- **E.** Metrics permissions
- **F.** Outbox

Each is judged against that goal. The approved Phase 1–5 contracts are the baseline:
- TARGET_ARCHITECTURE
- SSOT_REGISTRY
- BUSINESS_DECISIONS
- ORDER_STATE_MACHINE
- PRICING_PIPELINE / PRICING_INVARIANTS
- INVENTORY_INVARIANTS
- STOREFRONT_READ_MODEL
- PHASE_4_AUDIT
- PHASE_5_METRICS_AUDIT
- METRICS_REGISTRY

Phase 2 already snapshots price, discounts, tax, shipping and flash-sale data on the order. Phase 5 made every
report read those snapshots. What an order line still does **not** record is the subject of this audit.

---

## A. Historical cost

**What exists:**
- `Product.costPrice` and `ProductVariant.costPrice` hold **current** cost (Decimal, nullable). STAFF and OWNER edit
  them in the product builder, CSV import and duplicate.
- `OrderItem` records no cost.

**Where current cost reconstructs historical margin.** There is one reader: the metrics fact loader,
`facts.repository.ts` `loadVariantAttribution`. It resolves `variant.costPrice ?? product.costPrice ?? 0` **today**
and puts it on every historical line as `LineFact.currentUnitCost`. From there it reaches:

| Consumer | Path | Surface |
|---|---|---|
| `cogs_estimated`, `gross_margin_estimated` | engine `P.cogsSold`, `P.cogsReturned` | `/api/v1/metrics` |
| BI overview "Gross profit (lifetime)", `profitGrowthPct` | `bi.service` → `gross_margin_estimated` | BI overview, BI financial |
| Profit trend (daily) | `getProfitTrend` → `cogs_estimated`, `gross_margin_estimated` | BI financial table |
| Highest-profit products | `getHighestProfitProducts` → grouped by product | BI products |
| Inventory turnover + CSV export | `getInventoryTurnover` → `cogs_estimated` ÷ current inventory value | BI products, `inventory-turnover.csv` |

**Defects:**
1. **Margin is rewritten.** Changing a cost price today silently changes the COGS and margin of every past order in
   every report. P5-6 accepted this only "until `OrderItem.unitCostSnapshot` exists".
2. **Missing cost is treated as zero.** A product without a cost price counts as 0 cost, i.e. 100 % margin. It is not
   reported as unknown.
3. **Legitimate current-cost uses stay:** `inventory_value`, and the inventory side of turnover and dead stock. These
   value stock held now, not history.

## B. Historical category and brand

**What exists:**
- `OrderItem` holds `variantId` (no FK) plus name, SKU, size, colour and price snapshots. It stores **no** product,
  category or brand.
- The loader attributes each line through the **current** `ProductVariant → Product → Category`, reading
  `Product.brand`. Brand is free text: there is no Brand model and no brand ID.

**What this does to history:**

| Change after the order | Effect today |
|---|---|
| Product moved to another category | every past sale moves to the new category |
| Category renamed | every past sale shows the new name |
| `Product.brand` edited or cleared | every past sale moves brand, or becomes "Unbranded" |
| Product **permanently deleted** (`DELETE /products/:id/permanent`, OWNER) | variants cascade-delete, so the lines lose product, category, brand **and** cost and fall into "Unattributed" |
| Category permanently deleted | only possible with no live products, but trashed products' history then loses its category |

**Consumers:**
- `groupBy=category|brand|product` on `/api/v1/metrics`
- Top categories and top brands
- Top products, highest-profit products, trending, FBT and product sales/risk panels (product key)
- Variant and size/colour performance (these already use line snapshots)
- The inventory turnover CSV

Customer reports don't use attribution.

**Verdict:** historical attribution is reconstructed from today's catalog. P5-7 accepted this only "until snapshots
exist".

## C. Daily facts and aggregation (TARGET M13)

**Architecture:**
- No projection.
- Per request, the loader selects the orders with an event in the range. Placement, delivery, cancellation, payment,
  refund and RETURN rows are indexed columns.
- It loads their lines and money rows and runs the pure contribution engine.
- Results are cached in Redis for 60 s.

**Expensive queries:**
- Lifetime ranges load every order: BI overview lifetime tiles, `customerMetricsIndex` (CRM list and VIP), RFM and
  cohorts.
- Everything else is bounded by the range.

**Measured engine cost** (in memory, 5 metrics + customer stats; Node 20 on the dev machine):

| Orders | Time | Heap |
|---|---|---|
| 10 000 | 96 ms | 49 MB |
| 50 000 | 321 ms | 183 MB |
| 100 000 | 568 ms | 312 MB |

**Repeated work:**
- The same lifetime facts are reloaded by several lifetime surfaces, each within its own 60 s cache window.
- The dimensions (day, product, category, customer) are cuts of the same contributions.

**Would a projection add a second truth?** Yes, unless it is a pure, rebuildable projection of the engine's
contributions. It would also need:
- reversal-aware re-projection for late events: cancellations after realisation (P5-2), late refunds, late returns;
- re-bucketing when the store timezone changes;
- a reconciliation job.

That is real complexity with no correctness gain.

**Verdict: not currently needed.** The engine is linear and fast. The real ceiling is lifetime-load memory
(about 3 KB per order). Revisit when orders exceed about 50 000, or when lifetime `computeMetrics` p95 exceeds 1 s.

The contribution design means a future fact table is just persisted contributions grouped by
`(business day, metric, dimension)`: deterministic to rebuild, no second definition. Order-line snapshots (A, B) are a
**prerequisite** for any fact table, because a projection of reconstructed attribution would freeze wrong data.

## D. Configuration (CommerceSettings)

**Ownership today** (concept → owner → writer → cache → consumers):

| Concept | Canonical owner | Writer | Cache | Consumers | Duplicated? |
|---|---|---|---|---|---|
| Currency | `StoreSetting.currency` | `settings.service.updateSettings` | `settings:singleton` 300 s | pricing, ledger, read model, orders, metrics (6 call sites repeat `currency \|\| "BDT"`) | one owner; the fallback is repeated |
| Timezone | `StoreSetting.timezone` (Phase 5) | `updateSettings` | same | metrics business time, analytics windows | one owner; 2 display formatters hard-code `Asia/Dhaka` (order note formatter, admin order-detail panel) |
| Tax | `TaxSetting` (Phase 2) | pricing-config via `updateSettings` | none (read per quote) | quote pipeline | `StoreSetting.taxEnabled/defaultTaxRate` are Phase 2 **mirrors**, dual-written, drift-checked (`pricingConfigDrift`) |
| Shipping | `ShippingZone`/`ShippingRate` (Phase 2) | pricing-config | none | quote pipeline | `StoreSetting.shippingFee*` are Phase 2 mirrors, drift-checked |
| Courier return fee | `StoreSetting.courierReturnFee*` | `updateSettings` | settings cache | courier-loss | no |
| Reward rate | `StoreSetting.rewardPointsPerCurrency` | `updateSettings` | settings cache | loyalty (D8) | no |
| Checkout / payment switches | `StoreSetting.codEnabled/onlinePaymentEnabled/epsPaymentEnabled` | `updateSettings` | settings cache | checkout | no |
| SMS / notification switches | `SmsNotificationSetting` | sms-settings service | `sms-settings:singleton` | notifications | no |
| Catalog (SKU pattern, …) | `CatalogSetting` | catalog service | — | product builder | no |

There is **no** partial `CommerceSettings` table. Every duplicated concept (tax, shipping) already has one owner and
governed mirrors from Phase 2.

**Historical-reproducibility defect: currency.**
- `StoreSetting.currency` is free text (`z.string().max(8)`), editable at any time in admin settings.
- Orders store **no currency**. Every money snapshot (Decimal major units) and every major↔minor conversion
  (`fromMajor`) implicitly uses the *current* store currency.
- Changing it after the first order silently reinterprets all history. The minor-unit scale changes too: `JPY` has 0
  decimals, `KWD` 3.
- The integer cost snapshot (A) depends on it.

**Timezone is not a defect.**
- Facts are UTC instants.
- A timezone change deterministically re-buckets reports into the new business days (METRICS_REGISTRY §1).
- It never changes a stored fact.

**Verdict:**
- **Phase 6:** lock the store currency once any order exists. It is the implied currency of every money snapshot.
- **Phase 7+:** moving currency and timezone storage into `CommerceSettings` is an installer/configuration concern
  (TARGET §7, §9, M10). It fixes no duplicate truth, so it stays out of Phase 6. So do the repeated `|| "BDT"`
  fallbacks and the two `Asia/Dhaka` display formatters, which are small configuration-consumer cleanups.

## E. Metrics permissions

**Today:**
- `/api/v1/metrics`, `/definitions`, `/consistency`, `/api/analytics/*`, `/api/bi/*`, the CSV exports and the
  customer admin metrics are all `requireAdmin`: OWNER **and** STAFF.
- No business decision restricts STAFF from financial figures.
- STAFF already edits `costPrice` in the product builder, so recorded cost reveals nothing new to STAFF.

**The real exposure is customers.**
- Customer-facing order reads return raw order lines via `include: { items: true }`: public order tracking and retry,
  the checkout response, and the customer-account order list (`customer.service.listCustomerOrders`).
- A cost column on `OrderItem` would leak to customers.

**Verdict:**
- No RBAC change in Phase 6. Permission scoping stays in Phase 10.
- Phase 6 must make recorded cost **default-deny**: omitted from every Prisma read unless explicitly selected (the
  metrics loader). Tests must prove the customer paths don't expose it.

## F. Outbox

**Today:** side effects (notifications, SMS, audit, cache invalidation, loyalty) are called inline or after commit.
There is no `DomainEvent` table (TARGET M9, Phase 8).

**Phase 6 needs none.** Snapshots are captured synchronously in the same transaction that writes the order line, and
metrics read facts directly.

**Verdict:** not needed. Phase 8 keeps ownership of the outbox and subscribers.

---

## Gap matrix

| Gap | Current source | Problem | Historical impact | Runtime impact | Dependency | Priority | Phase |
|---|---|---|---|---|---|---|---|
| G1 Line cost | `variant/product.costPrice` today (loader) | historical COGS/margin rewritten by any cost edit; missing cost = 0 | **High**: margin not reproducible | none | — | P1 | **Phase 6** |
| G2 Line category | current `Product → Category` | re-categorisation / rename rewrites history | **High**: category reports not reproducible | none | — | P1 | **Phase 6** |
| G3 Line brand | current `Product.brand` (free text) | brand edits rewrite history | **High** | none | — | P1 | **Phase 6** |
| G4 Line product identity | current `variant.productId` | permanent product delete erases attribution and cost | **High**: data loss | none | — | P1 | **Phase 6** |
| G5 Store currency mutable | `StoreSetting.currency`, no per-order currency | editing it reinterprets every money snapshot | **High**: all financial history | none | protects G1 | P1 | **Phase 6** |
| G6 Cost confidentiality | `include: { items: true }` on customer paths | a cost column would leak to customers | — | security | required by G1 | P1 | **Phase 6** |
| G7 Daily facts (M13) | per-request loader + 60 s cache | lifetime loads scale linearly (about 3 KB/order) | none | low at current scale | G1–G4 first | P4 | **Not currently needed** (revisit > 50k orders or p95 > 1 s) |
| G8 CommerceSettings | `StoreSetting` (+ Phase 2 mirrors) | storage relocation for installer; repeated `\|\| "BDT"`; 2 `Asia/Dhaka` formatters | none (timezone re-buckets deterministically; currency covered by G5) | none | installer (TARGET §9) | P3 | **Phase 7+** |
| G9 Metrics RBAC | `requireAdmin` | no finer permission | none | none | RBAC tables (M12) | P3 | **Blocked by Phase 10 RBAC** |
| G10 Outbox subscribers | inline side effects | not needed by metrics or snapshots | none | none | M9 | P4 | **Phase 8** |
| G11 Category hierarchy history | `Category.parentId` today | parent-level rollups would use today's tree | low (no parent rollup report exists) | none | G2 | P4 | **Not currently needed** |

## Selected Phase 6 boundary: historical order-line facts

**Scope:** make every order line carry the facts that reports need, frozen when the line is written.
- **G1** `unitCostSnapshot`
- **G2–G4** product, category and brand attribution snapshots
- **G5** the store currency lock, which gives every money snapshot, including the new integer cost, a stable meaning
- **G6** cost default-deny

Metrics then read these snapshots and never today's catalog.

**Why this boundary:**
1. **Correctness.** It is the only open area where history changes when current data changes (the goal statement).
2. **Reports reproduce.**
3. **Data integrity:** deletion no longer erases history.
4. **Future installs:** a fresh store starts with complete facts from order one.

Daily facts, configuration relocation, RBAC and the outbox improve performance or structure but don't make any
historical number more correct. Daily facts would even freeze today's reconstructed attribution if built first.

**Out of scope (deferred):** G7 (Phase 7+ when scale demands), G8 (Phase 7+ installer/configuration), G9 (Phase 10),
G10 (Phase 8), G11.

## Design

**Snapshot timing.** Every snapshot is captured **once, in the same database transaction that writes the order line**.
That is the moment the line becomes financially committed: its price is fixed and its stock is sold.

| Path | Transaction | Notes |
|---|---|---|
| checkout / admin order | `createOrder` | gateway orders: at settlement, when the order row is created, not from the pre-order session payload |
| exchange replacement | `createExchangeOrder` | the replacement product at approval |

No later write touches these columns. The only `OrderItem` writer after creation is inventory's
`restockedQuantity`/`returnedQuantity`.

**New columns** (additive, nullable, no FK so history outlives the catalog):

| Column | Type | Value | NULL means |
|---|---|---|---|
| `unitCostSnapshot` | `Int` | per-unit cost in **minor units of the store currency** (`variant.costPrice ?? product.costPrice`) | **unknown**: no cost configured at order time, or the line predates Phase 6. Never 0 by default. |
| `productIdSnapshot` | `String` | the variant's product | line predates Phase 6 and its variant is gone |
| `categoryIdSnapshot` | `String` | the product's category at order time | not recorded (predates Phase 6) |
| `categoryNameSnapshot` | `String` | its name at order time | not recorded |
| `brandSnapshot` | `String` | `Product.brand` at order time (free text; no brand ID exists) | unbranded **if** `categoryIdSnapshot` is set, otherwise not recorded |

Products always have a category (`categoryId` is required), so `categoryIdSnapshot IS NOT NULL` means "attribution was
recorded". No extra flag column is needed.

**Backfill:**
- `productIdSnapshot` only, from `ProductVariant.productId`. A variant never changes product (no code updates it), so
  this is the true historical fact, not a reconstruction.
- **Cost, category and brand are not backfilled.** Today's values aren't history. Pre-Phase-6 lines stay explicitly
  unknown: cost appears as coverage, and category/brand appear as "Not recorded".

**Currency lock:**
- `updateSettings` refuses to change `currency` once any order row exists (409 `CURRENCY_LOCKED`).
- The value becomes the recorded currency of all order money.
- A store that must change currency needs an explicit migration decision (per-order currency), not a settings edit.

**Default-deny cost:**
- The Prisma client is created with a global `omit: { orderItem: { unitCostSnapshot: true } }` (Prisma `omitApi`).
- Only the metrics fact loader selects the column explicitly.
- Customer and storefront responses cannot contain it.

**Metrics:**
- `LineFact.currentUnitCost` is removed, so no historical path can read current cost.
- Lines carry `unitCostSnapshot` and snapshot attribution.
- `cogs_estimated` and `gross_margin_estimated` are **replaced** by:
  - **`cogs`**: Σ units × recorded cost over costed lines, net of costed returns;
  - **`gross_margin`**: over costed lines only, VAT-exclusive merchandise − cost, net of costed returns.
- Both report line **coverage** (lines with and without a recorded cost). Uncosted lines are excluded, never
  counted at zero.
- Category and brand groupings use snapshots. Lines without them are grouped as "Not recorded".
- The product grouping uses `productIdSnapshot`, falling back to the variant's product for old lines.
- `inventory_value` stays at current cost (point in time, not history).

**Not changed:** Phase 1–4 truths. The order state machine, pricing pipeline, stock ledger and payment ledger are
untouched. Phase 5 definitions are unchanged apart from the cost metrics and attribution source above.

---

## Verification (2026-09-30)

| Gate | Result |
|---|---|
| Engine tests (`lib/historical-snapshots.test.ts`: recorded COGS/margin ex VAT, uncosted lines excluded + coverage, returns reverse recorded cost, cancellation reversal, snapshot attribution, Unbranded / Not recorded) | 6 passed |
| Mutation tests (`lib/metrics.mutation.test.ts`) | 31 passed: canonical engine clean; 30/30 mutants killed — the 22 of Phase 5 plus P6-1 COGS from current cost, P6-2 unknown cost as 0, P6-3 old lines backfilled with today's cost, P6-4 margin as net merchandise − COGS, P6-5 category from today's product, P6-6 brand from today's product, P6-7 pre-Phase-6 lines re-attributed, P6-8 product snapshot ignored after deletion |
| Guard (`domain/orders/historical-snapshots.guard.test.ts`) | 2 passed: one snapshot writer; the order-fact loader reads no current cost/category/brand |
| Integration (`domain/orders/historical-snapshots.integration.test.ts`, real order / exchange / product-deletion / settings paths) | 12 passed: cost captured (variant over product, minor units); later cost change changes neither snapshot nor COGS/margin; no cost → unknown + coverage; pre-Phase-6 line unknown; service coverage; re-categorisation, rename and brand edit change nothing; Unbranded vs Not recorded; permanent product delete keeps attribution and cost; exchange keeps the original's COGS, replacement records its own; reconciliation incl. the Phase 6 checks; checkout response, order tracking (service + HTTP) and the customer's order list never contain cost; currency locked (service + HTTP 409), same currency still saves |
| Source mutations (by hand, then restored) | 7/7 killed: cost `omit` removed, currency lock removed, exchange replacement not snapshotted, missing cost written as 0, loader treats every line as attributed, loader ignores `productIdSnapshot`, order writer skips snapshots |
| Full API suite, Redis connected / without Redis | 50 files, 691 / 691 passed |
| D8 loyalty tests alone (`-t D8`) with Redis | 2/2 |
| Playwright desktop + mobile (API on the test DB, Redis connected) | 194 passed, 2 skipped, 0 failed (98 / 98). A first run failed one desktop step (`POST /api/wishlist` 404): the Next.js fetch cache still held products from before the test-DB reset; after clearing `.next/cache/fetch-cache` the full rerun was clean |
| TypeScript (api, web) · ESLint (api clean; web 0 errors, 2 pre-existing `<img>` warnings) · API build | clean |
| Next.js build | compiled, type-checked, 12/12 pages; standalone copy step fails with the known Windows symlink `EPERM` (14) |
| Database (`clothing_brand_test` only; datasource printed before every Prisma command; no shadow database) | empty DB → full chain of 80 migrations → seed; **backfill proof over existing rows** (lines written by the app, Phase 6 columns rolled back, migration re-applied): `productIdSnapshot` restored from the variant, cost/category/brand left NULL, a line with a missing variant left fully unknown; `migrate status` up to date; `migrate diff` (datasource → datamodel): no drift |
| Reconciliation (`metricsConsistency`) | all checks ok, including Σ product gross margin = total and Σ category COGS (with "Not recorded") = total, in the integration suite over its own costed / uncosted / pre-Phase-6 orders, and on the test DB (lifetime / 30 days / today) |

Also fixed during verification (test-only): a Phase 5 integration test read `customerMetricsIndex()` through the 60 s
metrics cache. With Redis connected, after the fresh reset, it saw an earlier cached grouping. It now clears the
`metrics:` cache first.
