# Storefront Read Model — Phase 3

**Status:** implemented in Phase 3 (branch `phase-3/storefront-read-model`). It builds on the approved Phase 2 pricing
pipeline ([PRICING_PIPELINE.md](PRICING_PIPELINE.md), [PRICING_INVARIANTS.md](PRICING_INVARIANTS.md)) and the Phase 1
inventory single writer ([INVENTORY_INVARIANTS.md](INVENTORY_INVARIANTS.md)). It adds no business rule and does not
change the pricing pipeline.

```
database truth (Product, ProductVariant, FlashSale/Item; ProductVariant.stock — inventory.service only)
  → canonical engines (priceProductsForDisplay → resolveUnitPrice; productAvailability / variantStockState)
    → Storefront Read Model (apps/api/src/domain/storefront/read-model.service.ts)
        presentStorefrontProducts  — the one storefront product DTO
        ProductReadModel           — projection of the canonical selling price, for SQL sort/filter/neighbours
      → API (/api/products/storefront*, /slug, /:id/similar|budget|upgrade|premium|rail, /api/flash-sales/active, wishlist)
        → Next.js storefront — formats server values, never recomputes them
```

## 1. Audit (Step 1) — every storefront calculation, classified

Legend: **C** canonical · **D** duplicate · **P** presentation-only · **L** compatibility/legacy. "Before" is the state
at the start of Phase 3 (after Phase 2), and "After" is this phase.

| Place | What it decided | Before | After |
|---|---|---|---|
| `product.service` price sort (`SORT_ORDER_BY.price_*`) | order by `basePrice` | **D** (ignores flash + variant price) | **C** — `ProductReadModel.minSellingPrice` |
| `product.service` listing `minPrice/maxPrice` filter | `basePrice` range | **D** | **C** — projection |
| `product.service` facets price range | `basePrice` min/max | **D** | **C** — projection min/max |
| `getSimilarProducts` proximity | `basePrice` distance | **D** | **C** — projection |
| `getBudgetAlternatives` / `getUpgradeOptions` | `basePrice` lt/gt | **D** | **C** — projection |
| `getPremiumAlternatives` ordering | `basePrice desc` | **D** | **C** — projection |
| `getTrendingProducts` budget filter | `basePrice` range | **D** | **C** — live `pricing.from` |
| `withFlashSaleInfo` (all product reads) | pricing + compat flash view | **C** (Phase 2) | **C** — replaced by `presentStorefrontProducts` (adds availability) |
| flash-sale homepage feed | its own copy of `withFlashSaleInfo`; returned **inactive variants** | **D** + bug | **C** — same presenter, active variants only |
| wishlist list | products with no `pricing` → web fell back to `basePrice` (flash ignored) | **D** (Phase 2 gap) | **C** — same presenter |
| search suggestions `price` | `priceProductsForDisplay().from` | **C** (Phase 2) | **C** (unchanged) |
| PDP detail (Redis-cached 120 s) | stock from the cached copy | **L** (stale stock up to 120 s) | **C** — stock overlaid live; availability derived |
| web `pricing-display.ts` | formats `product.pricing` | **P** | **P** |
| web `promo-badge` % off / "Limited Item" | label from server numbers / `sellableUnits` | **P** | **P** (input now server `availability.sellableUnits`) |
| web `product-card` sold-out / quick-add | `isAvailable` per variant (shared) | **C** (shared fn) | **C** — server `availability` |
| web `compare-bar` "In stock" | Σ stock > 0, **ignored D5** (untracked + 0 stock → "Sold out") | **D** + bug | **C** — server `availability` |
| web cart page low-stock alternatives | `stock ≤ lowStockThreshold`, **ignored D5** | **D** + bug | **C** — server `availability.variants[id].state` |
| web account exchange variant picker | `stock > 0`, **ignored D5** | **D** + bug | **C** — server `availability` |
| web `variant-selector` stock label | `stock`/`lowStockThreshold` comparisons | **D** (same rule, re-typed) | **C** — shared `variantStockState` + presentation word thresholds |
| web `structured-data` availability | `isAvailable` (shared) | **C** | **C** — server `availability.inStock` |
| web `use-add-to-cart` / `sticky-add-to-cart` max quantity | `maxSellableQuantity` (shared) | **C** | **C** (unchanged; same shared fn the server uses) |
| web `facet-filters` price inputs | shows server facet bounds | **P** | **P** |
| web `lib/fuzzy-search.ts` sort | relevance of client search results | **P** | **P** |
| `Product.basePrice` in admin list/picker/CSV/audit, wishlist `priceAtAdd`, price-drop email | the stored list price as a catalog attribute | **P/L** | unchanged (not a storefront selling price) |
| `ProductResult.activeFlashSale` | compat view of `pricing.flash` | **L** | **L** (kept; `flashPrice = pricing.from`) |

## 2. The canonical storefront product (Step 2, Step 7 — API contract)

Every storefront endpoint returns products through `presentStorefrontProducts` — one DTO:

| Field | Source | Notes |
|---|---|---|
| id, name, slug, descriptions, brand, brandTier, category, images, variants (active only), SEO fields, rating | `Product` / `ProductVariant` / relations (`PUBLIC_PRODUCT_SELECT`) | cost price and tax rate never exposed |
| `basePrice`, `compareAtPrice` | stored catalog attributes | **not** a selling price; never used by the storefront to price |
| `pricing` `{currency, from, to, listFrom, compareAt, flash, variants[id]{list, selling, compareAt, flash}}` | `priceProductsForDisplay` → `resolveUnitPrice` (live, Phase 2) | what the card/PDP shows; equals what the quote charges per unit |
| `availability` `{state, inStock, sellableUnits, variants[id]{state, sellable, maxQuantity}}` | `productAvailability` over canonical `ProductVariant.stock` + `trackInventory` (D5) + `lowStockThreshold` | derived per read, never stored |
| `activeFlashSale` | compat view of `pricing.flash` | deprecated |

Endpoints using it: `GET /api/products/storefront` (listing/search), `/storefront/by-ids` (compare, quick view,
recently viewed, cart checks, guest wishlist), `/storefront/trending`, `/storefront/recommended`, `/slug/:slug` (PDP),
`/:id/similar|complete-your-look|budget-alternatives|upgrade-options|premium-alternatives|frequently-bought-together|rail/:key`,
`GET /api/flash-sales/active` (homepage feed), `GET /api/wishlist`. Search suggestions return a slim `{id, name, slug,
price, imageUrl}` whose `price` is the same canonical `pricing.from`.

Reconciliation API: `GET /api/v1/storefront/read-model/drift` (admin), `POST /api/v1/storefront/read-model/rebuild`
(OWNER).

## 3. `ProductReadModel` — the minSellingPrice projection (Step 3)

| Aspect | Definition |
|---|---|
| Fact | `minSellingPrice` = the canonical "from" price: lowest current selling price over the product's **active** variants (variant price override, then the best live flash offer — enabled, in window, quota remaining (D4)). Identical to `ProductPricing.from`. Also `maxSellingPrice` (= `to`), `listPriceOfMin` (= `listFrom`), `hasLiveFlashSale`. |
| Source of truth | the Phase 2 pricing engine (`resolveUnitPrice`) over `Product.basePrice/compareAtPrice`, `ProductVariant.price/compareAtPrice/isActive`, `FlashSale.enabled/startsAt/endsAt`, `FlashSaleItem` terms and `stockLimit`, D4 units sold (order-line attribution), store currency. |
| Not included (by design) | stock (a sold-out variant still has a price; availability is separate and live), bundles (cart-level, not a unit price — PRICING_PIPELINE §1), coupons, tax (prices are tax-inclusive), shipping. |
| Writer | `domain/storefront/read-model.service.ts` only (`refreshReadModels`, called by the guard, the eager hooks, the cron and the rebuild). It never writes inventory, orders or prices. |
| Persistence | table `ProductReadModel` (1:1 with `Product`, cascade delete). Additive migration `20260930100000_phase3_storefront_read_model`. |
| Consumers | SQL only: price sort, price filter, facet bounds, similar/budget/upgrade/premium neighbours. **Never displayed** — every displayed price is computed live. |
| Authority | none — it is a cache of the engine's output. If it disagrees with the engine, the engine is right and the row is rebuilt. |

### Freshness and stale-data semantics

A row is **stale** when any of these holds (the guard, `findStaleProductIds`, one SQL query over visible products):

1. **missing** — no row yet (new product, or the table was just migrated);
2. **inputs changed** — `sourceHash` ≠ the md5 fingerprint of the current price inputs (base/compare-at price; each
   variant's id, price, compare-at, active flag; each flash item's id, discount type/value, stock limit, and its
   sale's `enabled`, `startsAt`, `endsAt`). Content-based, so it catches edits, inserts, **hard deletes** and writes
   that bypass the service layer. It does not depend on `updatedAt`: timestamps in this database are written in two
   timezones (Prisma: UTC; raw-SQL `NOW()` in the inventory service: the DB session's Asia/Dhaka).
3. **clock boundary passed** — `validUntil ≤ now`, where `validUntil` = the earliest scheduled start of an enabled sale,
   or 1 ms after the end of a live one;
4. **volatile** — a live flash offer with a `stockLimit` prices the product. Any order, cancellation or return can
   exhaust or release its quota (D4) without touching the product, so the row is recomputed on every guarded read;
5. **currency or `PRICING_VERSION` changed.**

**Read guarantee:** every query that reads the projection first runs `ensureFreshReadModels(now)`. The listing runs
it only when a price sort or price filter is requested. Facets and price-relative recommendations run it always. It
recomputes exactly the stale rows, in the same request, with the same `now`. **A listing therefore never sorts or
filters by a stale row.** If the guard itself fails (DB error), the query is served from the last projection and the
error is logged; the next request retries. That is the only case where a stale read is possible, and it is explicit.

**Residual window:** a price input changed by a transaction that commits after the guard's fingerprint read but
before its pricing read is priced correctly, but stamped with the older fingerprint. It is therefore recomputed on
the next guarded read. The fingerprint is read *before* pricing, so a row can look stale when it isn't, but never
fresh when it isn't.

### Refresh / rebuild triggers (Step 6 — events)

The codebase has no outbox yet (TARGET_ARCHITECTURE §6 is a target). Phase 3 uses the modular-monolith's existing
hooks, and it does not rely on any of them for correctness: the guard alone guarantees freshness.

| Change | Eager path (latency) | Correctness path |
|---|---|---|
| product price / compare-at, variant price / active flag, publish / unpublish, trash / restore, bulk status / category | `product.service.invalidateCache(context)` → `refreshReadModels(ids)` after the write | fingerprint mismatch → guard |
| flash sale create / update (enable, disable, window) / delete; item add / remove | `flash-sale.service.flashSaleChanged(ids)` → refresh + storefront revalidation tags | fingerprint mismatch → guard |
| flash sale starts / ends on the clock | minute cron (`syncFlashSaleActivation` → `ensureFreshReadModels`) | `validUntil` → guard |
| flash quota consumed / released (orders, cancellations, returns) | — | `volatile` → guard (every read) |
| inventory (stock) change | none needed — stock is not a projection input | availability is derived live on every read |
| category change | none needed — category filter reads `Product.categoryId` directly | — |
| store currency / pricing version | — | guard |
| anything missed / corrupted | — | periodic full rebuild every 15 min (`storefront-read-model-rebuild` job); drift report; manual rebuild |

These are the natural subscribers for `product.price_changed`, `flash_sale.started/ended/changed` and
`stock.changed` once the outbox (§6) exists. They can move there without changing the guard.

## 4. Availability (Step 5)

`productAvailability` / `variantStockState` (`packages/shared/src/engines/availability.ts`) — pure functions of the
canonical inventory state (`ProductVariant.stock`, written only by `inventory.service`) and product settings:

| State | Rule |
|---|---|
| `UNLIMITED` | `trackInventory = false` (D5) — always sellable, whatever the stock number says |
| `OUT_OF_STOCK` | tracked and no active variant has stock |
| `LOW_STOCK` | **variant level only**: tracked, sellable, and the variant's stock ≤ the product's `lowStockThreshold` (the existing per-variant rule, as in the admin low-stock alert and the PDP label) |
| `IN_STOCK` | otherwise |

Only **active** variants count. `sellable` = `isAvailable`, `maxQuantity` = `maxSellableQuantity` (Phase 2
functions). This is a **derivation for display**, not a business rule. It is computed on every read and never
persisted, so the read model is never a second inventory writer (tested: a full rebuild changes no stock and writes
no `StockMovement`).

**Product level** (`availability.state`) is only `UNLIMITED`, `IN_STOCK` or `OUT_OF_STOCK`. There is no product-level
`LOW_STOCK`, because no approved rule defines one. A first draft of Phase 3 applied the threshold to the product's total
units; that was removed at sign-off (2026-09-29). Low stock is per variant (`availability.variants[id].state`), exactly
as before Phase 3. The card's "Limited Item" badge keeps its own presentation constant, now fed by the server's
`sellableUnits`.

The PDP's detail row is Redis-cached (120 s) for its heavy content. Variant stock is re-read live on every PDP
request, so `availability` is never the cached copy's. The web tier's own fetch-cache windows (`REVALIDATE_SECONDS`,
listing tag `products:listing`) still apply, as before Phase 3. Flash-sale writes now also bust those tags.

## 5. Reconciliation and rebuild

| Tool | What it does |
|---|---|
| `GET /api/v1/storefront/read-model/drift` (admin) | recomputes every visible product in memory and lists `{productId, issue, stored, expected}` for missing rows and mismatched `minSellingPrice / maxSellingPrice / listPriceOfMin / hasLiveFlashSale`. Read-only. |
| `POST /api/v1/storefront/read-model/rebuild` (OWNER) | recomputes every non-trashed product, deterministically for one `now` |
| `pnpm --filter api read-model:rebuild` | same, from the CLI. Exits non-zero if drift remains. **Run after deploying the migration.** |
| BullMQ `storefront-read-model-rebuild`, every 15 min | full rebuild (closes the residual window) |

Verification after deploy:

```sql
SELECT count(*) FROM "Product" p LEFT JOIN "ProductReadModel" r ON r."productId" = p.id
 WHERE p."isActive" AND p."deletedAt" IS NULL AND r."productId" IS NULL;   -- 0 after the rebuild
```

plus `GET /api/v1/storefront/read-model/drift` → `{ "drift": [] }`.

## 6. Tests

- `apps/api/src/lib/storefront-read-model.test.ts` (unit):
  - stock states per variant and product: D5, active-only, line cap
  - row derivation copies the engine's prices
  - `validUntil` boundaries
  - volatility
  - determinism
- `apps/api/src/domain/storefront/read-model.integration.test.ts`:
  - price sort, filter and facets by the flash- and variant-aware selling price
  - inactive variant excluded
  - freshness after raw price writes that bypass hooks
  - flash sale add / disable / re-enable / delete / scheduled start / expiry
  - D4 quota exhaustion and release re-sorting
  - publish / unpublish / trash / restore
  - similar / budget / upgrade by selling price
  - trending budget filter
  - availability states, live on the cached PDP
  - rebuild writes no inventory
  - missing row re-projected
  - corrupted row detected by drift and fixed by rebuild
  - deterministic refresh
  - one contract across listing / PDP / by-ids / similar / suggestions
- Mutation tests (Phase 3 report): base-price fallback, flash ignored, inactive variant included, trashed product
  included, stock state miscalculated, stale projection not rebuilt, price sort on basePrice.

## 7. Removed or replaced

- `withFlashSaleInfo` (product.service) and the flash feed's private copy → `presentStorefrontProducts`.
- every `basePrice`-based sort, filter, facet and price-neighbour query in `product.service` → projection helpers
  (`sellingPriceOrderBy`, `sellingPriceWhere`, `projectedSellingPrice`).
- the trending budget filter on `basePrice` → live `pricing.from`.
- web stock computations in compare bar, cart page, account exchange, product card and structured data → server
  `availability` (`lib/availability-display.ts`). The variant selector uses the shared `variantStockState`.

## 8. Phase 4 candidates (not done)

- Move the eager hooks to outbox subscribers once §6 lands.
- (Done at Phase 3 sign-off: the raw-SQL `NOW()` timezone mismatch in `inventory.service.ts`, INVENTORY_INVARIANTS INV-8.)
- Analytics raw SQL compares `timestamp` columns with `NOW() - INTERVAL …` (read-side; the DB casts in the session
  timezone). Out of Phase 3 scope — review with the Phase 5 metrics work.
- Materialise availability for "in stock only" filtering, if that filter is ever added.
