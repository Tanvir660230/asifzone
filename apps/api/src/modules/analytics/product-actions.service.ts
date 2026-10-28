/**
 * Product action list loader (docs/METRICS_REGISTRY.md §4.10). Signals per published product: units ordered per variant
 * (§4.2 `units_ordered`, last 30 days → selling speed), current stock of tracked sellable variants, product views and
 * add-to-carts (last 30 days), distinct orders containing it, finished parcels and refusals (§4.7, last 60 days), and the
 * cost value of variants with stock and no order in 60 days.
 */
import { addDays, businessDate, contributions, fromMajor, money, resolveBusinessRange, toMajor } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { resolveVariantCosts } from "../../domain/finance/cost-resolver";
import { cacheGet, cacheSet } from "../../config/redis";
import { loadFactsForRange } from "../../domain/metrics/metrics.service";
import { storeContext, utcInstant } from "../../domain/metrics/store-time";
import { breakdown, outcomeTotals } from "./delivery-outcomes";
import { loadParcels } from "./delivery-outcomes.service";
import { productActions, type ProductAction, type ProductSignals, type StoreBaseline } from "./product-actions";

const CACHE_TTL_SECONDS = 300;

export interface ProductActionsReport {
  actions: ProductAction[];
  baseline: StoreBaseline;
  counts: Record<ProductAction["kind"], number>;
}

export async function getProductActions(now: Date = new Date()): Promise<ProductActionsReport> {
  const { timezone, currency } = await storeContext();
  const today = businessDate(now, timezone);
  const key = `analytics:v1:product-actions:${timezone}:${today}`;
  const hit = await cacheGet<ProductActionsReport>(key);
  if (hit) return hit;

  const r30 = resolveBusinessRange({ from: addDays(today, -29), to: today }, timezone, now);
  const r60 = resolveBusinessRange({ from: addDays(today, -59), to: today }, timezone, now);
  const [{ orders }, views, carts, variants, parcels] = await Promise.all([
    loadFactsForRange(r60),
    prisma.$queryRaw<Array<{ productId: string; n: bigint }>>`
      SELECT "productId", COUNT(*)::bigint AS n FROM "ProductViewLog"
      WHERE "createdAt" >= ${utcInstant(r30.startUtc)} AND "createdAt" < ${utcInstant(r30.endUtc)} GROUP BY "productId"`,
    prisma.$queryRaw<Array<{ productId: string; n: bigint }>>`
      SELECT "productId", COUNT(*)::bigint AS n FROM "FunnelEvent"
      WHERE type = 'ADD_TO_CART' AND "productId" IS NOT NULL AND "createdAt" >= ${utcInstant(r30.startUtc)} AND "createdAt" < ${utcInstant(r30.endUtc)}
      GROUP BY "productId"`,
    prisma.productVariant.findMany({
      where: { product: { status: "PUBLISHED", deletedAt: null, trackInventory: true } },
      select: { id: true, sku: true, size: true, color: true, stock: true, costPrice: true, product: { select: { id: true, name: true, slug: true, costPrice: true } } },
    }),
    loadParcels(r60, currency),
  ]);

  const units30 = new Map<string, number>();
  const units60 = new Map<string, number>();
  const orderSets = new Map<string, Set<string>>();
  for (const c of contributions("units_ordered", orders, r60)) {
    const vid = c.line?.variantId;
    if (!vid) continue;
    units60.set(vid, (units60.get(vid) ?? 0) + c.amount);
    if (c.at && c.at >= r30.startUtc && c.at < r30.endUtc) {
      units30.set(vid, (units30.get(vid) ?? 0) + c.amount);
      const pid = c.line?.productId;
      if (pid) orderSets.set(pid, (orderSets.get(pid) ?? new Set()).add(c.order.id));
    }
  }
  const viewsBy = new Map(views.map((v) => [v.productId, Number(v.n)]));
  const cartsBy = new Map(carts.map((v) => [v.productId, Number(v.n)]));
  const refusalsBy = new Map(breakdown(parcels, (p) => p.products.map((x) => x.id)).map((r) => [r.key, r]));
  const costs = await resolveVariantCosts(variants, currency);

  const products = new Map<string, ProductSignals>();
  for (const v of variants) {
    const p = v.product;
    const sig =
      products.get(p.id) ??
      ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        views: viewsBy.get(p.id) ?? 0,
        addToCarts: cartsBy.get(p.id) ?? 0,
        orders: orderSets.get(p.id)?.size ?? 0,
        variants: [],
        deadStockValue: 0,
        parcels: refusalsBy.get(p.id)?.parcels ?? 0,
        refused: refusalsBy.get(p.id)?.refused ?? 0,
      } satisfies ProductSignals);
    const sold30 = units30.get(v.id) ?? 0;
    const label = [v.color, v.size].filter((x) => x && x.trim()).join(" / ") || v.sku;
    sig.variants.push({ label, stock: v.stock, unitsPerDay: sold30 / 30, unitsSold30: sold30 });
    // tied-up value at the one resolved cost (blueprint P-1); a variant without a cost adds nothing rather than a fake 0
    const unit = costs.get(v.id)!.unitCostMinor;
    if (v.stock > 0 && !units60.has(v.id) && unit !== null) sig.deadStockValue += toMajor(money(v.stock * unit, currency));
    products.set(p.id, sig);
  }

  const all = [...products.values()];
  const sumViews = all.reduce((s, p) => s + p.views, 0);
  const baseline: StoreBaseline = {
    viewToCartRate: sumViews ? all.reduce((s, p) => s + p.addToCarts, 0) / sumViews : 0,
    viewToOrderRate: sumViews ? all.reduce((s, p) => s + p.orders, 0) / sumViews : 0,
    refusalRate: outcomeTotals(parcels).refusalRate,
    currency,
  };
  const actions = productActions(all, baseline);
  const counts = { sold_out: 0, restock: 0, refusals: 0, fix_page: 0, clear_stock: 0, promote: 0 } as ProductActionsReport["counts"];
  for (const a of actions) counts[a.kind] += 1;
  const report = { actions, baseline, counts };
  await cacheSet(key, report, CACHE_TTL_SECONDS);
  return report;
}
