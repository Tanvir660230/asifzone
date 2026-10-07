import { PRE_SHIPMENT_STATUSES, variantStockState, type StockLevelRow, type StockLevelsQuery, type StockLevelsResult } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";

/**
 * Stock levels (Blueprint V2 §O) — read-only. The stock writer stays inventory.service.ts; this only reads
 * ProductVariant.stock (available), the pre-shipment order lines that hold units (reserved) and recent demand.
 *
 * The variant set of one store is small (hundreds to low thousands), so state, filtering and ordering run in memory over
 * one lean query — the low-stock rule compares two columns (stock vs the product's threshold), which Prisma can't
 * express as a filter. Reserved units and days of cover are computed only for the page being returned.
 */

const STATE_ORDER: Record<StockLevelRow["state"], number> = { OUT_OF_STOCK: 0, LOW_STOCK: 1, IN_STOCK: 2, UNLIMITED: 3 };
const DEMAND_WINDOW_DAYS = 30;

export async function listStockLevels(query: StockLevelsQuery, now: Date = new Date()): Promise<StockLevelsResult> {
  const search = query.search?.trim();
  const variants = await prisma.productVariant.findMany({
    where: {
      product: { deletedAt: null },
      ...(search
        ? {
            OR: [
              { sku: { contains: search, mode: "insensitive" as const } },
              { product: { name: { contains: search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      sku: true,
      size: true,
      color: true,
      stock: true,
      isActive: true,
      product: {
        select: {
          id: true,
          name: true,
          trackInventory: true,
          lowStockThreshold: true,
          images: { select: { url: true }, orderBy: { sortOrder: "asc" }, take: 1 },
        },
      },
    },
  });

  const rows = variants.map((v) => ({
    v,
    state: variantStockState(v.product.trackInventory, v.stock, v.product.lowStockThreshold),
  }));

  const counts: StockLevelsResult["counts"] = { ALL: rows.length, OUT_OF_STOCK: 0, LOW_STOCK: 0, IN_STOCK: 0, UNLIMITED: 0 };
  for (const r of rows) counts[r.state] += 1;

  const filtered = query.state ? rows.filter((r) => r.state === query.state) : rows;
  const byName = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    a.v.product.name.localeCompare(b.v.product.name) || a.v.sku.localeCompare(b.v.sku);
  filtered.sort((a, b) => {
    if (query.sort === "available") return a.v.stock - b.v.stock || byName(a, b);
    if (query.sort === "-available") return b.v.stock - a.v.stock || byName(a, b);
    if (query.sort === "name") return byName(a, b);
    return STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.v.stock - b.v.stock || byName(a, b);
  });

  const start = (query.page - 1) * query.pageSize;
  const page = filtered.slice(start, start + query.pageSize);
  const ids = page.map((r) => r.v.id);

  const since = new Date(now.getTime() - DEMAND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const [held, demand] = ids.length
    ? await Promise.all([
        prisma.orderItem.groupBy({
          by: ["variantId"],
          where: { variantId: { in: ids }, order: { deletedAt: null, status: { in: [...PRE_SHIPMENT_STATUSES] } } },
          _sum: { quantity: true, restockedQuantity: true },
        }),
        // Demand = units ordered (the registry's `units_ordered` population: not trashed, not cancelled).
        prisma.orderItem.groupBy({
          by: ["variantId"],
          where: { variantId: { in: ids }, order: { deletedAt: null, createdAt: { gte: since }, status: { not: "CANCELLED" } } },
          _sum: { quantity: true },
        }),
      ])
    : [[], []];
  const reservedBy = new Map(held.map((h) => [h.variantId, Math.max(0, (h._sum.quantity ?? 0) - (h._sum.restockedQuantity ?? 0))]));
  const orderedBy = new Map(demand.map((d) => [d.variantId, d._sum.quantity ?? 0]));

  const items: StockLevelRow[] = page.map(({ v, state }) => {
    const reserved = reservedBy.get(v.id) ?? 0;
    const perDay = (orderedBy.get(v.id) ?? 0) / DEMAND_WINDOW_DAYS;
    return {
      variantId: v.id,
      productId: v.product.id,
      productName: v.product.name,
      imageUrl: v.product.images[0]?.url ?? null,
      sku: v.sku,
      size: v.size,
      color: v.color,
      available: v.stock,
      reserved,
      onHand: v.stock + reserved,
      lowStockThreshold: v.product.lowStockThreshold,
      trackInventory: v.product.trackInventory,
      active: v.isActive,
      state,
      daysOfCover: v.product.trackInventory && perDay > 0 ? Math.floor(Math.max(v.stock, 0) / perDay) : null,
    };
  });

  return { items, total: filtered.length, page: query.page, pageSize: query.pageSize, counts };
}
