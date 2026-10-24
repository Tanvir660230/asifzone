/**
 * Today on the stock page (docs/STOCK_HUB.md §7): only what needs doing, in the order it matters.
 *
 *   fill       bottles sold and not yet filled (fill-to-order sizes owed), for how many waiting orders, and any material
 *              that can't cover them — null when nothing is owed or the store has no fill-to-order products
 *   reorder    bought items (materials, finished goods) that are low or out, or should be ordered within 3 days to arrive
 *              before they run out, with something to order — soonest first, with the usual (else last) supplier
 *   count      this week's cycle count: items ranked by the value they used in the last 30 days; the top 80% of that value
 *              is counted every 7 days, the next 15% every 30, the rest every 90; due when never counted or counted that
 *              long ago — at most 8, highest value first (fill-to-order sizes aren't counted: their materials are)
 *   approvals  count losses waiting for the owner
 *
 * Nothing here is stored: it is worked out from the stock list (stock-items.service) on each read.
 */
import { addDays } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { ON_SHELF_STATUSES } from "./count.service";
import { openAutoFillFailures } from "./auto-fill.service";
import { listApprovals } from "./count-approval.service";
import { lastPurchasePrice } from "./item-settings.service";
import { allStockItems, type StockListItem } from "./stock-items.service";

export const COUNT_MAX = 8;
export const REORDER_WITHIN_DAYS = 3;

interface Rankable { variantId: string; name: string; group: string; usedValue: number }

/** Count interval (days) per item by its share of the use value (see the file header). */
export function countClasses(items: Rankable[]): Map<string, number> {
  const total = items.reduce((s, i) => s + Math.max(0, i.usedValue), 0);
  const out = new Map<string, number>();
  let before = 0;
  for (const i of [...items].sort((a, b) => b.usedValue - a.usedValue)) {
    const share = total > 0 ? before / total : 1;
    out.set(i.variantId, i.usedValue <= 0 ? 90 : share < 0.8 ? 7 : share < 0.95 ? 30 : 90);
    before += Math.max(0, i.usedValue);
  }
  return out;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function cycleCountDue<T extends Rankable>(items: T[], lastCounted: Map<string, string>, today: string, max = COUNT_MAX): T[] {
  const countable = items.filter((i) => i.group !== "FILL_TO_ORDER");
  const interval = countClasses(countable);
  return countable
    .filter((i) => {
      const last = lastCounted.get(i.variantId);
      return !last || daysBetween(last, today) >= interval.get(i.variantId)!;
    })
    .sort((a, b) => b.usedValue - a.usedValue || a.name.localeCompare(b.name))
    .slice(0, max);
}

export function reorderDue<T extends Pick<StockListItem, "variantId" | "status" | "reorder">>(items: T[], today: string): T[] {
  const soon = addDays(today, REORDER_WITHIN_DAYS);
  return items
    .filter((i) => i.reorder && i.reorder.suggested > 0 && (i.status === "LOW" || i.status === "OUT" || i.reorder.orderBy <= soon))
    .sort((a, b) => a.reorder!.orderBy.localeCompare(b.reorder!.orderBy));
}

export async function stockToday(viewer: { canSeeCost: boolean }) {
  // ranked by value internally; nothing of the cost leaves this function unless the viewer may see it
  const { items, today, claimed } = await allStockItems({ canSeeCost: true });
  const byId = new Map(items.map((i) => [i.variantId, i]));

  const owed = items.filter((i) => i.status === "NEEDS_FILL");
  let fill = null;
  if (owed.length) {
    const orders = await prisma.order.count({
      where: { deletedAt: null, courierConsignmentId: null, status: { in: [...ON_SHELF_STATUSES] }, items: { some: { variantId: { in: owed.map((i) => i.variantId) } } } },
    });
    const short = [...claimed.entries()]
      .map(([materialId, need]) => ({ m: byId.get(materialId), need: Math.ceil(need - 1e-9) }))
      .filter((x) => x.m && x.need > x.m.stock)
      .map((x) => ({ variantId: x.m!.variantId, sku: x.m!.sku, name: x.m!.label, unit: x.m!.unit, need: x.need, have: x.m!.stock }));
    fill = {
      bottles: owed.reduce((s, i) => s + (i.policy?.owed ?? 0), 0),
      orders,
      lines: owed.map((i) => ({ variantId: i.variantId, sku: i.sku, name: i.label, productName: i.productName, owed: i.policy?.owed ?? 0 })),
      short,
    };
  }

  const due = reorderDue(items, today);
  let reorder = null;
  if (due.length) {
    const last = await lastPurchasePrice(due.map((i) => i.variantId));
    const supplierIds = [...new Set(due.map((i) => i.settings.preferredSupplierId ?? last.get(i.variantId)?.supplierId).filter((x): x is string => Boolean(x)))];
    const suppliers = supplierIds.length ? await prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, displayName: true } }) : [];
    const nameOf = new Map(suppliers.map((s) => [s.id, s.displayName]));
    const rows = due.map((i) => {
      const supplierId = i.settings.preferredSupplierId ?? last.get(i.variantId)?.supplierId ?? null;
      const price = last.get(i.variantId);
      return {
        variantId: i.variantId, sku: i.sku, name: i.label, productName: i.productName, unit: i.unit, status: i.status, daysLeft: i.daysLeft,
        suggested: i.reorder!.suggested, orderBy: i.reorder!.orderBy,
        supplier: supplierId ? { id: supplierId, name: nameOf.get(supplierId) ?? "" } : null,
        lastUnitCost: viewer.canSeeCost && price ? price.unitCost : null,
      };
    });
    reorder = { items: rows, suppliers: new Set(rows.map((r) => r.supplier?.id ?? "none")).size };
  }

  const ranked = items.map((i) => ({ ...i, usedValue: (i.usedPerDay ?? 0) * 30 * (i.avgCost ?? 0) }));
  const lastRows = await prisma.stockCount.groupBy({ by: ["variantId"], where: { variantId: { in: ranked.map((i) => i.variantId) } }, _max: { countDate: true } });
  const lastCounted = new Map(lastRows.filter((r) => r._max.countDate).map((r) => [r.variantId, r._max.countDate!.toISOString().slice(0, 10)]));
  const dueCount = cycleCountDue(ranked, lastCounted, today);
  const count = dueCount.length ? { due: dueCount.map((i) => ({ variantId: i.variantId, sku: i.sku, name: i.label, unit: i.unit })), minutes: Math.max(1, Math.ceil(dueCount.length * 0.75)) } : null;

  const approvals = (await listApprovals({ status: "PENDING" }, viewer)).approvals.map((a) => ({ id: a.id, variantId: a.variantId, name: a.name, difference: a.difference, reason: a.reason, value: a.value, requestedBy: a.requestedBy, countedOn: a.countedOn }));

  const fillProblems = await openAutoFillFailures();

  return { today, fill, fillProblems, reorder, count, approvals };
}
export type StockToday = Awaited<ReturnType<typeof stockToday>>;
