/**
 * Sales, product, customer and financial analytics — adapters over the metrics SSOT (docs/METRICS_REGISTRY.md).
 * Phase 5 replaced ~40 hand-written SQL aggregations (each with its own "sale" predicate, money field and time window;
 * docs/PHASE_5_METRICS_AUDIT.md) with cuts of the ONE engine: every figure below is a registry metric's contributions,
 * grouped for the chart that needs it. Response shapes are unchanged for the dashboards; meanings follow the registry
 * (e.g. "revenue" is now `realised_net_sales`, the PD-5.1 headline).
 */
import {
  bucketKey,
  contributions,
  customerStats,
  distinctOrdersBy,
  enumerateBuckets,
  fromMajor,
  groupContributions,
  localClock,
  previousRange,
  realisedAt,
  variantStockState,
  type BusinessRange,
  type OrderFact,
} from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { cacheGet, cacheSet } from "../../config/redis";
import { computeMetrics, loadFactsForRange, minorToMajor } from "../../domain/metrics/metrics.service";
import { OPERATIONAL_ORDER_WHERE, SALE_ORDER_WHERE } from "../../domain/metrics/sale-order";
import { resolveLegacyWindow, resolveStoreRange, storeContext, utcInstant } from "../../domain/metrics/store-time";
import { loadInventoryFacts } from "../../domain/metrics/facts.repository";

const CACHE_TTL_SECONDS = 60;

async function cached<T>(key: string, range: BusinessRange | null, fn: () => Promise<T>): Promise<T> {
  const full = `analytics:v5:${key}${range ? `:${range.timezone}:${range.startUtc.toISOString()}:${range.endUtc.toISOString()}` : ""}`;
  const hit = await cacheGet<T>(full);
  if (hit !== null) return hit;
  const value = await fn();
  await cacheSet(full, value, CACHE_TTL_SECONDS);
  return value;
}

/** Facts + a minor→major converter for one range (the same facts the metrics service uses). */
async function facts(range: BusinessRange) {
  const { orders, currency } = await loadFactsForRange(range);
  return { orders, major: (v: number) => minorToMajor(v, currency) };
}

async function productRefs(ids: string[]) {
  const rows = ids.length ? await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true } }) : [];
  return new Map(rows.map((p) => [p.id, p]));
}

const productIdOf = (c: { line?: { productId: string | null } }) => c.line?.productId ?? null;

// ─── Revenue & orders ────────────────────────────────────────────────────────────────────────────────────────────────

/** Daily net sales + orders realised for the last N business days, zero-filled. */
export async function getRevenueSeries(days = 30) {
  const range = await resolveLegacyWindow(days);
  const m = await computeMetrics({ metrics: ["realised_net_sales", "orders_realised"], range, groupBy: "day" });
  return m.groups!.map((g) => ({ date: g.key, revenue: g.metrics.realised_net_sales!, orders: g.metrics.orders_realised! }));
}

/** Current status breakdown of operational orders (not trashed, not exchange replacements). */
export async function getOrderStatusCounts() {
  const grouped = await prisma.order.groupBy({ by: ["status"], where: OPERATIONAL_ORDER_WHERE, _count: { _all: true } });
  return grouped.map((g) => ({ status: g.status, count: g._count._all }));
}

export async function getDashboardSummary() {
  const range = await resolveStoreRange({ preset: "last_30_days" });
  const prev = previousRange(range);
  const [cur, before, pendingOrders, visitorRows, courierLossCount] = await Promise.all([
    computeMetrics({ metrics: ["realised_net_sales", "orders_realised", "aov", "courier_loss", "low_stock_variants"], range }),
    computeMetrics({ metrics: ["realised_net_sales", "orders_realised", "aov"], range: prev }),
    prisma.order.count({ where: { ...OPERATIONAL_ORDER_WHERE, status: "PENDING" } }),
    prisma.$queryRaw<Array<{ current: bigint; previous: bigint }>>`
      SELECT
        COUNT(DISTINCT "sessionId") FILTER (WHERE "createdAt" >= ${utcInstant(range.startUtc)})::bigint AS current,
        COUNT(DISTINCT "sessionId") FILTER (WHERE "createdAt" < ${utcInstant(range.startUtc)})::bigint AS previous
      FROM "PageView"
      WHERE "createdAt" >= ${utcInstant(prev.startUtc)} AND "createdAt" < ${utcInstant(range.endUtc)}
    `,
    prisma.courierLossEvent.count({ where: { createdAt: { gte: range.startUtc, lt: range.endUtc } } }),
  ]);
  return {
    revenue30d: cur.metrics.realised_net_sales!.value,
    orders30d: cur.metrics.orders_realised!.value,
    revenuePrev30d: before.metrics.realised_net_sales!.value,
    ordersPrev30d: before.metrics.orders_realised!.value,
    pendingOrders,
    lowStockCount: cur.metrics.low_stock_variants!.value,
    aov30d: cur.metrics.aov!.value,
    aovPrev30d: before.metrics.aov!.value,
    uniqueVisitors30d: Number(visitorRows[0]?.current ?? 0),
    uniqueVisitorsPrev30d: Number(visitorRows[0]?.previous ?? 0),
    courierLoss30d: cur.metrics.courier_loss!.value,
    courierLossCount30d: courierLossCount,
  };
}

/** Variants that need restocking by the canonical per-variant rule (D5): sellable, tracked, LOW_STOCK or OUT_OF_STOCK at
 * their product's own threshold — never a hard-coded number, never product-level. */
export async function getLowStockVariants(limit = 20) {
  const variants = await prisma.productVariant.findMany({
    where: { isActive: true, product: { status: "PUBLISHED", deletedAt: null, trackInventory: true } },
    include: {
      image: { select: { url: true } },
      product: { select: { id: true, name: true, slug: true, lowStockThreshold: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } } },
    },
    orderBy: { stock: "asc" },
  });
  return variants
    .filter((v) => {
      const state = variantStockState(true, v.stock, v.product.lowStockThreshold);
      return state === "LOW_STOCK" || state === "OUT_OF_STOCK";
    })
    .slice(0, limit);
}

// ─── Products ────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function getTopProducts(days = 30, limit = 5) {
  const range = await resolveLegacyWindow(days);
  const m = await computeMetrics({ metrics: ["net_merchandise_sales", "net_units_sold"], range, groupBy: "product", limit });
  const ids = m.groups!.map((g) => g.key).filter((k) => !k.startsWith("unattributed"));
  const images = ids.length ? await prisma.productImage.findMany({ where: { productId: { in: ids } }, orderBy: { sortOrder: "asc" }, select: { productId: true, url: true } }) : [];
  const imageBy = new Map<string, string>();
  for (const img of images) if (!imageBy.has(img.productId)) imageBy.set(img.productId, img.url);
  return m.groups!.map((g) => {
    const productId = g.key.startsWith("unattributed") ? null : g.key;
    return { name: g.label, quantitySold: g.metrics.net_units_sold!, revenue: g.metrics.net_merchandise_sales!, productId, imageUrl: productId ? (imageBy.get(productId) ?? null) : null };
  });
}

export async function getTopCategories(days = 30, limit = 10) {
  const range = await resolveLegacyWindow(days);
  const m = await computeMetrics({ metrics: ["net_merchandise_sales", "net_units_sold"], range, groupBy: "category", limit });
  return m.groups!.map((g) => ({ name: g.label, quantitySold: g.metrics.net_units_sold!, revenue: g.metrics.net_merchandise_sales! }));
}

export async function getTopBrands(days = 30, limit = 10) {
  const range = await resolveLegacyWindow(days);
  const m = await computeMetrics({ metrics: ["net_merchandise_sales", "net_units_sold"], range, groupBy: "brand", limit });
  return m.groups!.map((g) => ({ name: g.label, quantitySold: g.metrics.net_units_sold!, revenue: g.metrics.net_merchandise_sales! }));
}

/** Products with stock on hand and the least demand (units ordered) in the window. */
export async function getSlowMovingProducts(days = 30, limit = 10) {
  const range = await resolveLegacyWindow(days);
  return cached(`slow-moving:${limit}`, range, async () => {
    const { orders } = await facts(range);
    const units = groupContributions("units_ordered", orders, range, productIdOf);
    const products = await prisma.product.findMany({
      where: { status: "PUBLISHED", deletedAt: null },
      select: { id: true, name: true, slug: true, variants: { where: { isActive: true }, select: { stock: true } } },
    });
    return products
      .map((p) => ({ id: p.id, name: p.name, slug: p.slug, unitsSold: units.get(p.id) ?? 0, totalStock: p.variants.reduce((s, v) => s + Math.max(0, v.stock), 0) }))
      .filter((p) => p.totalStock > 0)
      .sort((a, b) => a.unitsSold - b.unitsSold || b.totalStock - a.totalStock)
      .slice(0, limit);
  });
}

/** Demand acceleration: units ordered in the last 7 business days vs the 7 before. */
export async function getBestSellingPrediction(limit = 10) {
  const recent = await resolveStoreRange({ preset: "last_7_days" });
  const prior = previousRange(recent);
  return cached(`best-selling:${limit}`, recent, async () => {
    const { orders } = await facts({ ...prior, endUtc: recent.endUtc, to: recent.to });
    const name = new Map<string, string>();
    const key = (c: { line?: { productId: string | null; productName: string } }) => {
      if (!c.line) return null;
      const k = c.line.productId ?? `unattributed:${c.line.productName}`;
      name.set(k, c.line.productName);
      return k;
    };
    const r = groupContributions("units_ordered", orders, recent, key);
    const p = groupContributions("units_ordered", orders, prior, key);
    return [...r.entries()]
      .map(([k, recentUnits]) => {
        const priorUnits = p.get(k) ?? 0;
        const growthPct = priorUnits > 0 ? ((recentUnits - priorUnits) / priorUnits) * 100 : recentUnits > 0 ? 100 : 0;
        return { name: name.get(k) ?? k, recentUnits, priorUnits, growthPct };
      })
      .sort((a, b) => b.recentUnits - b.priorUnits - (a.recentUnits - a.priorUnits))
      .slice(0, limit);
  });
}

/** Variants projected to sell out soonest from recent demand (units ordered per business day). */
export async function getDemandForecast(days = 14, limit = 10) {
  const range = await resolveLegacyWindow(days);
  return cached(`demand-forecast:${limit}`, range, async () => {
    const { orders } = await facts(range);
    const units = groupContributions("units_ordered", orders, range, (c) => c.line?.variantId ?? null);
    const variants = units.size
      ? await prisma.productVariant.findMany({
          where: { id: { in: [...units.keys()] }, stock: { gt: 0 }, product: { status: "PUBLISHED", deletedAt: null } },
          select: { id: true, sku: true, stock: true, product: { select: { name: true } } },
        })
      : [];
    return variants
      .map((v) => {
        const dailyVelocity = (units.get(v.id) ?? 0) / days;
        return { variantId: v.id, productName: v.product.name, sku: v.sku, stock: v.stock, dailyVelocity, projected7d: dailyVelocity * 7, daysUntilStockout: dailyVelocity > 0 ? v.stock / dailyVelocity : Infinity };
      })
      .filter((v) => v.dailyVelocity > 0)
      .sort((a, b) => a.daysUntilStockout - b.daysUntilStockout)
      .slice(0, limit);
  });
}

/** Distinct sale orders containing the product ÷ product views, over the window. */
export async function getProductConversionRates(days?: number) {
  const range = await resolveLegacyWindow(days);
  return cached("product-conversion", range, async () => {
    const [{ orders }, views] = await Promise.all([
      facts(range),
      prisma.$queryRaw<Array<{ productId: string; views: bigint }>>`
        SELECT "productId", COUNT(*)::bigint AS views FROM "ProductViewLog"
        WHERE "createdAt" >= ${utcInstant(range.startUtc)} AND "createdAt" < ${utcInstant(range.endUtc)}
        GROUP BY "productId"
      `,
    ]);
    const orderSets = distinctOrdersBy("units_ordered", orders, range, productIdOf);
    const refs = await productRefs(views.map((v) => v.productId));
    return views
      .filter((v) => refs.has(v.productId))
      .map((v) => {
        const p = refs.get(v.productId)!;
        const n = Number(v.views);
        const o = orderSets.get(v.productId)?.size ?? 0;
        return { id: p.id, name: p.name, slug: p.slug, views: n, orders: o, conversionRatePct: n > 0 ? (o / n) * 100 : 0 };
      })
      .sort((a, b) => b.conversionRatePct - a.conversionRatePct)
      .slice(0, 500);
  });
}

/** Estimated gross margin per product (current cost — P5-6). */
export async function getHighestProfitProducts(days?: number, limit = 10) {
  const range = await resolveLegacyWindow(days);
  const m = await computeMetrics({ metrics: ["gross_margin_estimated", "net_merchandise_sales", "cogs_estimated"], range, groupBy: "product", limit });
  const refs = await productRefs(m.groups!.map((g) => g.key));
  return m.groups!
    .filter((g) => refs.has(g.key))
    .map((g) => ({ id: g.key, name: g.label, slug: refs.get(g.key)!.slug, revenue: g.metrics.net_merchandise_sales!, cogs: g.metrics.cogs_estimated!, profit: g.metrics.gross_margin_estimated! }));
}

/** Return rate = units returned ÷ units sold (realised); refund rate = realised orders with a completed refund ÷
 * realised orders containing the product. */
export async function getProductRiskMetrics(days?: number, limit = 10) {
  const range = await resolveLegacyWindow(days);
  return cached(`product-risk:${limit}`, range, async () => {
    const { orders } = await facts(range);
    const sold = groupContributions("units_sold", orders, range, productIdOf);
    const returned = groupContributions("units_returned", orders, range, productIdOf);
    const orderSets = distinctOrdersBy("units_sold", orders, range, productIdOf);
    const refunded = new Set(orders.filter((o) => o.refunds.some((r) => r.status === "COMPLETED")).map((o) => o.id));
    const refs = await productRefs([...sold.keys()]);
    return [...sold.entries()]
      .filter(([id, qty]) => qty > 0 && refs.has(id))
      .map(([id, qty]) => {
        const set = orderSets.get(id) ?? new Set<string>();
        const refundedOrders = [...set].filter((oid) => refunded.has(oid)).length;
        return {
          id,
          name: refs.get(id)!.name,
          slug: refs.get(id)!.slug,
          returnRatePct: ((returned.get(id) ?? 0) / qty) * 100,
          refundRatePct: set.size > 0 ? (refundedOrders / set.size) * 100 : 0,
          totalOrders: set.size,
        };
      })
      .sort((a, b) => b.returnRatePct - a.returnRatePct)
      .slice(0, limit);
  });
}

export async function getFrequentlyBoughtTogetherPairs(days?: number, limit = 10) {
  const range = await resolveLegacyWindow(days);
  return cached(`fbt-pairs:${limit}`, range, async () => {
    const { orders } = await facts(range);
    const productsByOrder = distinctOrdersBy("units_ordered", orders, range, productIdOf);
    const perOrder = new Map<string, Set<string>>();
    for (const [pid, set] of productsByOrder) for (const oid of set) (perOrder.get(oid) ?? perOrder.set(oid, new Set()).get(oid)!).add(pid);
    const pairCounts = new Map<string, number>();
    for (const ids of perOrder.values()) {
      const sorted = [...ids].sort();
      for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) pairCounts.set(`${sorted[i]}|${sorted[j]}`, (pairCounts.get(`${sorted[i]}|${sorted[j]}`) ?? 0) + 1);
    }
    const top = [...pairCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    const refs = await productRefs([...new Set(top.flatMap(([k]) => k.split("|")))]);
    return top
      .filter(([k]) => k.split("|").every((id) => refs.has(id)))
      .map(([k, coCount]) => {
        const [a, b] = k.split("|") as [string, string];
        return { productA: refs.get(a)!.name, productB: refs.get(b)!.name, coCount };
      });
  });
}

export interface ProductSalesHeatmap {
  products: Array<{ id: string; name: string; totalQty: number }>;
  days: string[];
  cells: Record<string, Record<string, number>>;
}

/** Top products × business days, units ordered per day. */
export async function getProductSalesHeatmap(days = 14, limit = 10): Promise<ProductSalesHeatmap> {
  const range = await resolveLegacyWindow(days);
  return cached(`product-sales-heatmap:${limit}`, range, async () => {
    const { orders } = await facts(range);
    const totals = groupContributions("units_ordered", orders, range, productIdOf);
    const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    const refs = await productRefs(top.map(([id]) => id));
    const dayKeys = enumerateBuckets(range, "day");
    const cells: Record<string, Record<string, number>> = {};
    for (const [id] of top) cells[id] = Object.fromEntries(dayKeys.map((k) => [k, 0]));
    for (const c of contributions("units_ordered", orders, range)) {
      const pid = c.line?.productId;
      if (pid && cells[pid]) cells[pid]![bucketKey(c.at!, range.timezone, "day")]! += c.amount;
    }
    return { products: top.filter(([id]) => refs.has(id)).map(([id, totalQty]) => ({ id, name: refs.get(id)!.name, totalQty })), days: dayKeys, cells };
  });
}

/** Net units / net merchandise by SKU snapshot (history survives renames and deletions). */
export async function getVariantPerformance(days?: number, limit = 10) {
  const range = await resolveLegacyWindow(days);
  return cached(`variant-performance:${limit}`, range, async () => {
    const { orders, major } = await facts(range);
    const info = new Map<string, { sku: string; productName: string; size: string; color: string }>();
    const key = (c: { line?: { sku: string; productName: string; size: string; color: string } }) => {
      if (!c.line) return null;
      const k = `${c.line.sku}|${c.line.productName}|${c.line.size}|${c.line.color}`;
      info.set(k, { sku: c.line.sku, productName: c.line.productName, size: c.line.size, color: c.line.color });
      return k;
    };
    const units = groupContributions("net_units_sold", orders, range, key);
    const revenue = groupContributions("net_merchandise_sales", orders, range, key);
    return [...units.entries()]
      .map(([k, unitsSold]) => ({ ...info.get(k)!, unitsSold, revenue: major(revenue.get(k) ?? 0) }))
      .sort((a, b) => b.unitsSold - a.unitsSold)
      .slice(0, limit);
  });
}

export async function getSizeColorPerformance(days?: number) {
  const range = await resolveLegacyWindow(days);
  return cached("size-color-performance", range, async () => {
    const { orders, major } = await facts(range);
    const cut = (field: "size" | "color") => {
      const units = groupContributions("net_units_sold", orders, range, (c) => c.line?.[field] ?? null);
      const revenue = groupContributions("net_merchandise_sales", orders, range, (c) => c.line?.[field] ?? null);
      return [...units.entries()].map(([value, unitsSold]) => ({ value, unitsSold, revenue: major(revenue.get(value) ?? 0) })).sort((a, b) => b.unitsSold - a.unitsSold);
    };
    return { sizes: cut("size"), colors: cut("color") };
  });
}

/** Estimated COGS of net units sold ÷ current inventory value, per product (both at current cost — P5-6). */
export async function getInventoryTurnover(days?: number, limit = 10) {
  const range = await resolveLegacyWindow(days);
  return cached(`inventory-turnover:${limit}`, range, async () => {
    const { currency } = await storeContext();
    const [{ orders, major }, variants] = await Promise.all([facts(range), loadInventoryFacts(currency)]);
    const cogs = groupContributions("cogs_estimated", orders, range, productIdOf);
    const valueBy = new Map<string, number>();
    for (const v of variants) if (v.held && v.trackInventory) valueBy.set(v.productId, (valueBy.get(v.productId) ?? 0) + Math.max(0, v.stock) * v.currentUnitCost);
    const refs = await productRefs([...valueBy.keys()]);
    return [...valueBy.entries()]
      .filter(([id, value]) => value > 0 && refs.has(id))
      .map(([id, value]) => ({ id, name: refs.get(id)!.name, slug: refs.get(id)!.slug, cogsSold: major(cogs.get(id) ?? 0), inventoryValue: major(value), turnoverRatio: (cogs.get(id) ?? 0) / value }))
      .sort((a, b) => b.turnoverRatio - a.turnoverRatio)
      .slice(0, limit);
  });
}

/** Variants with stock and zero demand (units ordered) in the window; value tied up at current cost. */
export async function getDeadStockReport(days = 90, limit = 10) {
  const range = await resolveLegacyWindow(days);
  return cached(`dead-stock:${limit}`, range, async () => {
    const [{ orders, major }, rows] = await Promise.all([
      facts(range),
      prisma.productVariant.findMany({
        where: { stock: { gt: 0 }, product: { status: "PUBLISHED", deletedAt: null } },
        select: { id: true, sku: true, size: true, color: true, stock: true, costPrice: true, product: { select: { id: true, name: true, costPrice: true } } },
      }),
    ]);
    const demanded = groupContributions("units_ordered", orders, range, (c) => c.line?.variantId ?? null);
    const { currency } = await storeContext();
    const toMinor = (v: { toString(): string } | null) => fromMajor(v?.toString() ?? "0", currency).amount;
    return rows
      .filter((v) => !demanded.has(v.id))
      .map((v) => ({ productId: v.product.id, name: v.product.name, variantId: v.id, sku: v.sku, size: v.size, color: v.color, stock: v.stock, tiedUpValue: major(v.stock * toMinor(v.costPrice ?? v.product.costPrice)) }))
      .sort((a, b) => b.tiedUpValue - a.tiedUpValue)
      .slice(0, limit);
  });
}

// ─── Customers ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Lifetime repeat rate and customer lifetime value (a grouping of canonical facts). */
export async function getCustomerInsights() {
  const range = await resolveStoreRange({ preset: "lifetime" });
  return cached("customer-insights", range, async () => {
    const { orders, major } = await facts(range);
    const s = customerStats(orders, range);
    return { totalCustomers: s.customersWithOrders, returningCustomers: s.repeatCustomers, returningRate: s.repeatCustomerRate * 100, avgClv: major(s.customerLifetimeValue) };
  });
}

/** Cohorts by the business month of each customer's first sale order; share active in each later month. */
export async function getCohortRetention() {
  const range = await resolveStoreRange({ preset: "lifetime" });
  return cached("cohort-retention", range, async () => {
    const { orders } = await facts(range);
    const tz = range.timezone;
    const months = new Map<string, Set<string>>();
    for (const c of contributions("orders_placed", orders, range)) {
      if (!c.order.customerId) continue;
      const set = months.get(c.order.customerId) ?? new Set<string>();
      set.add(bucketKey(c.at!, tz, "month"));
      months.set(c.order.customerId, set);
    }
    const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
    const current = monthIndex(range.to.slice(0, 7));
    const cohorts = new Map<string, { size: number; active: Map<number, number> }>();
    for (const set of months.values()) {
      const sorted = [...set].sort();
      const cohort = sorted[0]!;
      if (current - monthIndex(cohort) > 5) continue;
      const entry = cohorts.get(cohort) ?? { size: 0, active: new Map<number, number>() };
      entry.size++;
      for (const m of sorted) {
        const off = monthIndex(m) - monthIndex(cohort);
        entry.active.set(off, (entry.active.get(off) ?? 0) + 1);
      }
      cohorts.set(cohort, entry);
    }
    return [...cohorts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cohort, { size, active }]) => {
        const maxOffset = Math.min(5, current - monthIndex(cohort));
        const retention = Array.from({ length: maxOffset + 1 }, (_, offset) => {
          const activeCustomers = active.get(offset) ?? 0;
          return { monthOffset: offset, activeCustomers, retentionPct: size > 0 ? (activeCustomers / size) * 100 : 0 };
        });
        return { cohortMonth: `${cohort}-01`, cohortSize: size, retention };
      });
  });
}

/** Orders placed + net sales by payment method. */
export async function getFavoritePaymentMethod(days?: number, dateFrom?: Date, dateTo?: Date) {
  const range = await resolveLegacyWindow(days, dateFrom, dateTo);
  const m = await computeMetrics({ metrics: ["orders_placed", "realised_net_sales"], range, groupBy: "payment_method" });
  return m.groups!.map((g) => ({ method: g.key, orders: g.metrics.orders_placed!, revenue: g.metrics.realised_net_sales! })).sort((a, b) => b.orders - a.orders);
}

/** Hour-of-day and day-of-week of sale orders placed, in the store timezone. */
export async function getPurchaseTimeDistribution(days?: number) {
  const range = await resolveLegacyWindow(days);
  return cached("purchase-time", range, async () => {
    const { orders } = await facts(range);
    const byHour = new Array<number>(24).fill(0);
    const byDow = new Array<number>(7).fill(0);
    for (const c of contributions("orders_placed", orders, range)) {
      const { hour, dow } = localClock(c.at!, range.timezone);
      byHour[hour]! += 1;
      byDow[dow]! += 1;
    }
    return { byHour: byHour.map((orders, hour) => ({ hour, orders })), byDayOfWeek: byDow.map((orders, dow) => ({ dow, orders })) };
  });
}

export async function getCustomerLocationBreakdown(days?: number, limit = 10) {
  const range = await resolveLegacyWindow(days);
  return cached(`customer-location:${limit}`, range, async () => {
    const { orders, major } = await facts(range);
    const cut = (field: "shippingDivision" | "shippingDistrict") => {
      const count = groupContributions("orders_placed", orders, range, (c) => c.order[field]);
      const revenue = groupContributions("realised_net_sales", orders, range, (c) => c.order[field]);
      return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, n]) => ({ k, orders: n, revenue: major(revenue.get(k) ?? 0) }));
    };
    return {
      divisions: cut("shippingDivision").map((r) => ({ division: r.k, orders: r.orders, revenue: r.revenue })),
      districts: cut("shippingDistrict").map((r) => ({ district: r.k, orders: r.orders, revenue: r.revenue })),
    };
  });
}

/** Net sales and orders attributed to each utm_campaign via the storefront session that placed the sale order. */
export async function getCampaignPerformance(days = 30, limit = 10) {
  const range = await resolveLegacyWindow(days);
  return cached(`campaigns:${limit}`, range, async () => {
    const [{ orders, major }, touches] = await Promise.all([
      facts(range),
      prisma.$queryRaw<Array<{ sessionId: string; utmCampaign: string }>>`
        SELECT DISTINCT ON ("sessionId") "sessionId", "utmCampaign" FROM "PageView"
        WHERE "utmCampaign" IS NOT NULL AND "createdAt" >= ${utcInstant(range.startUtc)} AND "createdAt" < ${utcInstant(range.endUtc)}
        ORDER BY "sessionId", "createdAt" ASC
      `,
    ]);
    const campaignOf = new Map(touches.map((t) => [t.sessionId, t.utmCampaign]));
    const key = (c: { order: OrderFact }) => (c.order.sessionId ? (campaignOf.get(c.order.sessionId) ?? null) : null);
    const count = groupContributions("orders_placed", orders, range, key);
    const revenue = groupContributions("realised_net_sales", orders, range, key);
    return [...count.entries()].map(([campaign, n]) => ({ campaign, orders: n, revenue: major(revenue.get(campaign) ?? 0) })).sort((a, b) => b.revenue - a.revenue).slice(0, limit);
  });
}

// ─── Promotions ──────────────────────────────────────────────────────────────────────────────────────────────────────

export async function getCouponEffectiveness(days?: number, limit = 10) {
  const range = await resolveLegacyWindow(days);
  return cached(`coupon-effectiveness:${limit}`, range, async () => {
    const { orders, major } = await facts(range);
    const key = (c: { order: OrderFact }) => c.order.couponId;
    const count = groupContributions("orders_realised", orders, range, key);
    const discount = groupContributions("coupon_discount", orders, range, key);
    const revenue = groupContributions("realised_net_sales", orders, range, key);
    const coupons = count.size ? await prisma.coupon.findMany({ where: { id: { in: [...count.keys()] } }, select: { id: true, code: true, type: true } }) : [];
    return coupons
      .map((c) => ({ code: c.code, type: c.type, orders: count.get(c.id) ?? 0, discountGiven: major(discount.get(c.id) ?? 0), revenue: major(revenue.get(c.id) ?? 0) }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, limit);
  });
}

export async function getBundlePerformance(days?: number, limit = 10) {
  const range = await resolveLegacyWindow(days);
  return cached(`bundle-performance:${limit}`, range, async () => {
    const { orders, major } = await facts(range);
    const key = (c: { order: OrderFact }) => c.order.bundleId;
    const count = groupContributions("orders_realised", orders, range, key);
    const discount = groupContributions("bundle_discount", orders, range, key);
    const revenue = groupContributions("realised_net_sales", orders, range, key);
    const bundles = count.size ? await prisma.bundle.findMany({ where: { id: { in: [...count.keys()] } }, select: { id: true, name: true } }) : [];
    return bundles
      .map((b) => ({ name: b.name, orders: count.get(b.id) ?? 0, discountGiven: major(discount.get(b.id) ?? 0), revenue: major(revenue.get(b.id) ?? 0) }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, limit);
  });
}

/** Flash-priced units and their net merchandise value per sale, from the order-line attribution (Phase 2, D4). */
export async function getFlashSalePerformance(limit = 10) {
  const range = await resolveStoreRange({ preset: "lifetime" });
  return cached(`flash-sale-performance:${limit}`, range, async () => {
    const [{ orders, major }, sales] = await Promise.all([facts(range), prisma.flashSale.findMany({ orderBy: { startsAt: "desc" }, take: limit, select: { id: true, name: true, startsAt: true, endsAt: true } })]);
    const key = (c: { line?: { flashSaleId: string | null } }) => c.line?.flashSaleId ?? null;
    const units = groupContributions("units_sold", orders, range, key);
    const revenue = groupContributions("net_merchandise_sales", orders, range, key);
    return sales.map((s) => ({ id: s.id, name: s.name, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), unitsSold: units.get(s.id) ?? 0, revenue: major(revenue.get(s.id) ?? 0) }));
  });
}

/** Coupon and bundle discounts from the snapshot split (Phase 2) — the old query counted bundle discounts twice. */
export async function getDiscountUsageBreakdown(days?: number, dateFrom?: Date, dateTo?: Date) {
  const range = await resolveLegacyWindow(days, dateFrom, dateTo);
  return cached("discount-usage", range, async () => {
    const [m, { orders }] = await Promise.all([computeMetrics({ metrics: ["orders_realised", "coupon_discount", "bundle_discount", "discounts", "gross_merchandise_sales"], range }), facts(range)]);
    const withDiscount = orders.filter((o) => {
      const r = realisedAt(o);
      return r && r >= range.startUtc && r < range.endUtc && (o.couponId !== null || o.bundleId !== null);
    }).length;
    const totalOrders = m.metrics.orders_realised!.value;
    const gross = m.metrics.gross_merchandise_sales!.value;
    return {
      totalOrders,
      ordersWithDiscount: withDiscount,
      discountedOrderRatePct: totalOrders > 0 ? (withDiscount / totalOrders) * 100 : 0,
      couponDiscountTotal: m.metrics.coupon_discount!.value,
      bundleDiscountTotal: m.metrics.bundle_discount!.value,
      subtotalTotal: gross,
      discountRatePct: gross > 0 ? (m.metrics.discounts!.value / gross) * 100 : 0,
    };
  });
}

// ─── Financial ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Daily net merchandise sales vs estimated COGS vs estimated gross margin (P5-6). */
export async function getProfitTrend(days = 30) {
  const range = await resolveLegacyWindow(days);
  const m = await computeMetrics({ metrics: ["net_merchandise_sales", "cogs_estimated", "gross_margin_estimated"], range, groupBy: "day" });
  return m.groups!.map((g) => ({ date: g.key, revenue: g.metrics.net_merchandise_sales!, cogs: g.metrics.cogs_estimated!, profit: g.metrics.gross_margin_estimated! }));
}

/** Refunds (ledger), discounts (snapshot) and courier loss for the window. */
export async function getFinancialCostBreakdown(days?: number) {
  const range = await resolveLegacyWindow(days);
  const [m, count] = await Promise.all([
    computeMetrics({ metrics: ["refunds", "discounts", "courier_loss"], range }),
    prisma.courierLossEvent.count({ where: { createdAt: { gte: range.startUtc, lt: range.endUtc } } }),
  ]);
  return { refundCost: m.metrics.refunds!.value, discountCost: m.metrics.discounts!.value, courierLossCost: m.metrics.courier_loss!.value, courierLossCount: count };
}

/** Tax collected from each order's own tax snapshot (Phase 2) — never the current rate applied to history. Orders placed
 * before tax was snapshotted are counted in `taxUnrecordedOrders`, not estimated. */
export async function getEstimatedTaxCollected(days?: number) {
  const range = await resolveLegacyWindow(days);
  const [m, tax] = await Promise.all([computeMetrics({ metrics: ["tax_collected", "realised_net_sales"], range }), prisma.taxSetting.findFirst()]);
  const coverage = m.metrics.tax_collected!.coverage ?? { recorded: 0, missing: 0 };
  return {
    taxEnabled: tax?.enabled ?? false,
    defaultTaxRatePct: tax ? Number(tax.defaultRate) : 0,
    estimatedTax: m.metrics.tax_collected!.value,
    revenue: m.metrics.realised_net_sales!.value,
    taxRecordedOrders: coverage.recorded,
    taxUnrecordedOrders: coverage.missing,
  };
}

/** Orders and net sales per business year, lifetime. */
export async function getLifetimeYearlyTrend() {
  const m = await computeMetrics({ metrics: ["orders_realised", "realised_net_sales"], range: { preset: "lifetime" }, groupBy: "year" });
  return m.groups!.filter((g) => g.metrics.orders_realised! > 0 || g.metrics.realised_net_sales! !== 0).map((g) => ({ year: Number(g.key), orders: g.metrics.orders_realised!, revenue: g.metrics.realised_net_sales! }));
}

// ─── Operations ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Average hours placed → first shipped → first delivered over sale orders placed in the window. */
export async function getOrderFulfillmentTime(days?: number) {
  const range = await resolveLegacyWindow(days);
  return cached("fulfillment-time", range, async () => {
    const rows = await prisma.order.findMany({
      where: { ...SALE_ORDER_WHERE, createdAt: { gte: range.startUtc, lt: range.endUtc } },
      select: { createdAt: true, statusHistory: { where: { status: { in: ["SHIPPED", "DELIVERED"] } }, select: { status: true, createdAt: true }, orderBy: { createdAt: "asc" } } },
    });
    const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;
    const toShip: number[] = [];
    const shipToDeliver: number[] = [];
    const toDeliver: number[] = [];
    for (const o of rows) {
      const shipped = o.statusHistory.find((h) => h.status === "SHIPPED")?.createdAt;
      const delivered = o.statusHistory.find((h) => h.status === "DELIVERED")?.createdAt;
      if (shipped) toShip.push(hours(o.createdAt, shipped));
      if (shipped && delivered) shipToDeliver.push(hours(shipped, delivered));
      if (delivered) toDeliver.push(hours(o.createdAt, delivered));
    }
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    return { avgHoursToShip: avg(toShip), avgHoursShipToDeliver: avg(shipToDeliver), avgHoursToDeliver: avg(toDeliver), deliveredOrders: toDeliver.length };
  });
}
