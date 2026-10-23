/**
 * Stock hub overview (docs/STOCK_HUB.md, /admin/stock): every stock-tracked item in three groups —
 *
 *   FINISHED       sells as it is (caps, clothes…)
 *   FILL_TO_ORDER  filled when orders come (attar): stock = filled bottles (may be negative), `makeable` = what the approved
 *                  recipe can still make from the materials unfilled orders haven't claimed — read live, not the shop's memo
 *   MATERIAL       oil, bottles, boxes, stickers, poly… in their own stock unit (ml, pcs)
 *
 * For each: what waits unpacked on orders (`reserved`) and so what should be on the shelf, the value at the running average
 * (inventory costing — only with costing.read; otherwise null), the use over the last 30 days (orders net of cancellations
 * and returns, production issues net of returns, packaging; over fewer days for an item that first moved more recently)
 * and the days that lasts. Low: 10 days or less, or a fill-to-order variant that can sell 10 or fewer (filled + makeable).
 * Plus the rolls in use (bubble poly) and whether costing is live.
 */
import { sellable } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { getFinanceContext } from "../finance/finance-context";
import { businessDateOf, toMajorNumber, toMinor } from "../finance/finance-values";
import { listRolls } from "../finance/stock-check.service";
import { fillCapacity } from "./fill-capacity.service";
import { expectedOnShelf, reservedNotDispatched } from "./count.service";
import { unitOf, variantLabel } from "./hub-entry";

export const USE_WINDOW_DAYS = 30;
export const LOW_AT = 10;
/** Movements that are use (or undo use): their net, negated, is what went out. Receipts, counts and edits are not use. */
const USE_REASONS = ["ORDER", "CANCELLATION", "RETURN", "PRODUCTION_ISSUE", "PRODUCTION_RETURN", "PACKAGING_USE"] as const;

/** The days use is averaged over: the last 30, or — for an item that first moved more recently — the days since then
 * (rounded up, at least 1), so a new item's use isn't diluted over days it didn't exist. */
export function useWindowDays(firstMovedAt: Date | null, now: number): number {
  if (!firstMovedAt) return USE_WINDOW_DAYS;
  return Math.min(USE_WINDOW_DAYS, Math.max(1, Math.ceil((now - firstMovedAt.getTime()) / 86_400_000)));
}

export type StockHubGroupKey = "FINISHED" | "FILL_TO_ORDER" | "MATERIAL";

export interface StockHubItem {
  variantId: string;
  productId: string;
  sku: string;
  name: string;
  /** The product's name and the variant's own size and colour (as entered), so the page can group colours × sizes. */
  productName: string;
  size: string | null;
  color: string | null;
  unit: string;
  stock: number;
  reserved: number;
  expectedOnShelf: number;
  makeable: number | null;
  avgCost: number | null;
  value: number | null;
  usedPerDay: number | null;
  daysLeft: number | null;
  low: boolean;
}

export async function stockHub(viewer: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const variants = await prisma.productVariant.findMany({
    where: { product: { deletedAt: null, trackInventory: true }, OR: [{ isActive: true }, { stock: { not: 0 } }] },
    select: {
      id: true, sku: true, size: true, color: true, stock: true,
      product: { select: { id: true, name: true, kind: true, stockUnit: true, fillToOrder: true } },
      costState: { select: { avgUnitCost: true, value: true } },
    },
    orderBy: [{ product: { name: "asc" } }, { sortOrder: "asc" }, { sku: "asc" }],
  });
  const ids = variants.map((v) => v.id);
  const since = new Date(Date.now() - USE_WINDOW_DAYS * 86_400_000);
  const [reserved, made, use, first, biz, last, rolls] = await Promise.all([
    reservedNotDispatched(prisma),
    variants.some((v) => v.product.fillToOrder) ? fillCapacity(prisma) : Promise.resolve(new Map<string, number>()),
    prisma.stockMovement.groupBy({ by: ["variantId"], where: { variantId: { in: ids }, createdAt: { gte: since }, reason: { in: [...USE_REASONS] } }, _sum: { change: true } }),
    // when each variant first moved: an item younger than the window divides its use by the days it has existed
    prisma.stockMovement.groupBy({ by: ["variantId"], where: { variantId: { in: ids } }, _min: { createdAt: true } }),
    prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { inventoryCostingActivatedAt: true } }),
    prisma.stockCount.findFirst({ where: { businessId: business.id }, orderBy: [{ countDate: "desc" }, { createdAt: "desc" }], select: { countDate: true } }),
    listRolls({ openOnly: true }),
  ]);
  const usedOf = new Map(use.map((u) => [u.variantId, Math.max(0, -(u._sum.change ?? 0))]));
  const firstOf = new Map(first.map((m) => [m.variantId, m._min.createdAt]));
  const now = Date.now();

  const groups: Record<StockHubGroupKey, StockHubItem[]> = { FINISHED: [], FILL_TO_ORDER: [], MATERIAL: [] };
  let totalMinor = 0;
  for (const v of variants) {
    const key: StockHubGroupKey = v.product.kind === "MATERIAL" ? "MATERIAL" : v.product.fillToOrder ? "FILL_TO_ORDER" : "FINISHED";
    const waiting = reserved.get(v.id) ?? 0;
    const makeable = key === "FILL_TO_ORDER" ? made.get(v.id) ?? 0 : null;
    const valueMinor = viewer.canSeeCost && v.costState ? toMinor(v.costState.value, cur) : null;
    if (valueMinor !== null) totalMinor += valueMinor;
    const used = usedOf.get(v.id) ?? 0;
    // What lasts: filled bottles plus what can still be made for a fill-to-order variant; the shelf otherwise.
    const left = makeable !== null ? sellable(v.stock, makeable) : Math.max(0, v.stock);
    const window = useWindowDays(firstOf.get(v.id) ?? null, now);
    const daysLeft = used > 0 ? Math.floor((left * window) / used) : null;
    groups[key].push({
      variantId: v.id, productId: v.product.id, sku: v.sku, name: variantLabel(v), productName: v.product.name, size: v.size, color: v.color, unit: unitOf(v.product),
      stock: v.stock, reserved: waiting, expectedOnShelf: expectedOnShelf(v.stock, waiting), makeable,
      avgCost: viewer.canSeeCost && v.costState?.avgUnitCost != null ? Number(v.costState.avgUnitCost) : null,
      value: valueMinor === null ? null : toMajorNumber(valueMinor, cur),
      usedPerDay: used > 0 ? Math.round((used / window) * 100) / 100 : null,
      daysLeft,
      // a fill-to-order variant is low by what it can sell (filled bottles + what can be made)
      low: (daysLeft !== null && daysLeft <= LOW_AT) || (makeable !== null && left <= LOW_AT),
    });
  }

  return {
    totalValue: viewer.canSeeCost ? toMajorNumber(totalMinor, cur) : null,
    costingActive: Boolean(biz.inventoryCostingActivatedAt),
    groups: (["FINISHED", "FILL_TO_ORDER", "MATERIAL"] as const).map((key) => ({ key, items: groups[key] })),
    lastCount: last ? businessDateOf(last.countDate) : null,
    /** Rolls in use (bubble poly): opened, not yet finished — parcels booked since it was opened so far. */
    rolls: rolls.rolls.map((r) => ({ id: r.id, materialVariantId: r.materialVariantId, material: r.material, openedOn: r.openedOn, parcels: r.parcels, rollCost: viewer.canSeeCost ? r.rollCost : null })),
  };
}
export type StockHub = Awaited<ReturnType<typeof stockHub>>;
