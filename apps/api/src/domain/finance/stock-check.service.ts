/**
 * Stock check (docs/FINANCE_CENTER.md §7): where every unit went, rebuilt from the shop's own records — nothing is forced
 * to balance and nothing here changes stock or the books.
 *
 *   sold & shipped products: units through the site = the units that left on orders (not cancelled, less what was put
 *   back) + the stock now. Of those, the units that came in on a document (goods receipt, production receipt) are
 *   proven; the rest were typed into the product form.
 *
 *   materials: what the products made from them used = Σ (recipe quantity × finished units through the site), recipe
 *   = the latest approved bill of materials. Bought at least = used + stock now (wastage and samples not included).
 *
 * Physical counts are recorded beside the site's stock (StockCount), never into it. Rolls (bubble poly) get their yield
 * from the parcels booked with the courier between opening and finishing a roll.
 */
import { addDays, businessDayStartUtc } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { businessDateOf, dateColumn, financeError } from "./finance-values";

const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);

/** Order statuses → the bucket a unit sits in. Cancelled units count only where they were not put back. */
export const STATUS_BUCKET: Record<string, "delivered" | "partly" | "returned" | "onTheWay" | "waiting" | "cancelled" | "refunded"> = {
  DELIVERED: "delivered",
  PARTIALLY_DELIVERED: "partly",
  RETURNED: "returned",
  SHIPPED: "onTheWay",
  PACKED: "onTheWay",
  PROCESSING: "waiting",
  CONFIRMED: "waiting",
  PENDING: "waiting",
  CANCELLED: "cancelled",
  REFUNDED: "refunded",
};
export type Bucket = (typeof STATUS_BUCKET)[string];
export type Buckets = Record<Bucket, number>;
const emptyBuckets = (): Buckets => ({ delivered: 0, partly: 0, returned: 0, onTheWay: 0, waiting: 0, cancelled: 0, refunded: 0 });

/** Units still out on orders (not put back into stock), per bucket. Pure. */
export function unitsOut(lines: Array<{ status: string; quantity: number; restocked: number }>): Buckets {
  const b = emptyBuckets();
  for (const l of lines) {
    const bucket = STATUS_BUCKET[l.status] ?? "waiting";
    b[bucket] += Math.max(0, l.quantity - l.restocked);
  }
  return b;
}
export const totalOut = (b: Buckets) => Object.values(b).reduce((s, n) => s + n, 0);

/** Material use implied by recipes: Σ qtyPerUnit × finished units through the site, per material variant. Pure. */
export function impliedMaterialUse(
  recipes: Array<{ materialVariantId: string; finishedVariantIds: string[]; qtyPerUnit: number }>,
  throughSite: Map<string, number>,
): Map<string, { used: number; finishedUnits: number }> {
  const out = new Map<string, { used: number; finishedUnits: number }>();
  for (const r of recipes) {
    const units = r.finishedVariantIds.reduce((s, id) => s + (throughSite.get(id) ?? 0), 0);
    const cur = out.get(r.materialVariantId) ?? { used: 0, finishedUnits: 0 };
    cur.used += r.qtyPerUnit * units;
    cur.finishedUnits += units;
    out.set(r.materialVariantId, cur);
  }
  return out;
}

const DOCUMENTED = new Set(["PURCHASE_RECEIPT", "PURCHASE_RETURN", "PRODUCTION_RECEIPT"]);
const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

export async function stockCheck() {
  const { business } = await getFinanceContext();
  const today = businessToday(business);
  const variants = await prisma.productVariant.findMany({
    where: { product: { deletedAt: null } },
    select: {
      id: true, sku: true, size: true, color: true, stock: true, costPrice: true,
      product: { select: { id: true, name: true, kind: true, stockUnit: true, costPrice: true, category: { select: { name: true } } } },
      costState: { select: { avgUnitCost: true } },
    },
    orderBy: [{ product: { name: "asc" } }, { size: "asc" }],
  });
  const ids = variants.map((v) => v.id);

  const lines = await prisma.orderItem.groupBy({
    by: ["variantId", "orderId"],
    where: { variantId: { in: ids }, order: { deletedAt: null } },
    _sum: { quantity: true, restockedQuantity: true },
  });
  const orderStatus = new Map(
    (await prisma.order.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.orderId))] } }, select: { id: true, status: true } })).map((o) => [o.id, o.status as string]),
  );
  const outLines = new Map<string, Array<{ status: string; quantity: number; restocked: number }>>();
  for (const l of lines) {
    const arr = outLines.get(l.variantId) ?? [];
    arr.push({ status: orderStatus.get(l.orderId) ?? "PENDING", quantity: l._sum.quantity ?? 0, restocked: l._sum.restockedQuantity ?? 0 });
    outLines.set(l.variantId, arr);
  }

  const moves = await prisma.stockMovement.groupBy({ by: ["variantId", "reason"], where: { variantId: { in: ids } }, _sum: { change: true }, _count: true });
  const unexplainedEdits = await prisma.stockMovement.groupBy({
    by: ["variantId"],
    where: { variantId: { in: ids }, reason: { in: ["ADJUSTMENT", "RESTOCK"] }, OR: [{ note: null }, { note: "" }, { note: { startsWith: "Manual edit" } }] },
    _count: true,
  });
  const documented = new Map<string, number>();
  const issued = new Map<string, number>();
  for (const m of moves) {
    if (DOCUMENTED.has(m.reason)) documented.set(m.variantId, (documented.get(m.variantId) ?? 0) + (m._sum.change ?? 0));
    if (m.reason === "PRODUCTION_ISSUE" || m.reason === "PRODUCTION_RETURN" || m.reason === "PACKAGING_USE")
      issued.set(m.variantId, (issued.get(m.variantId) ?? 0) - (m._sum.change ?? 0));
  }
  const editsOf = new Map(unexplainedEdits.map((e) => [e.variantId, e._count]));

  const counts = await prisma.stockCount.findMany({ where: { variantId: { in: ids } }, orderBy: [{ countDate: "desc" }, { createdAt: "desc" }] });
  const lastCount = new Map<string, (typeof counts)[number]>();
  for (const c of counts) if (!lastCount.has(c.variantId)) lastCount.set(c.variantId, c);

  // through the site, per finished variant
  const through = new Map<string, number>();
  const finished = variants.filter((v) => v.product.kind !== "MATERIAL").map((v) => {
    const out = unitsOut(outLines.get(v.id) ?? []);
    const t = totalOut(out) + v.stock;
    through.set(v.id, t);
    const proven = documented.get(v.id) ?? 0;
    const count = lastCount.get(v.id);
    return {
      variantId: v.id, productId: v.product.id, product: v.product.name, category: v.product.category?.name ?? null, size: v.size, color: v.color, sku: v.sku,
      stock: v.stock, out, throughSite: t, cameInOnDocument: proven, typedIn: t - proven, editsWithoutReason: editsOf.get(v.id) ?? 0,
      count: count ? { date: businessDateOf(count.countDate), counted: count.counted, siteStockThen: count.siteStock, difference: count.counted - count.siteStock } : null,
    };
  });

  // recipes: latest approved BOM per product
  const boms = await prisma.billOfMaterials.findMany({
    where: { businessId: business.id, status: "APPROVED" },
    orderBy: { version: "desc" },
    select: { productId: true, version: true, lines: { select: { materialVariantId: true, finishedVariantId: true, qtyPerUnit: true } } },
  });
  const latest = new Map<string, (typeof boms)[number]>();
  for (const b of boms) if (!latest.has(b.productId)) latest.set(b.productId, b);
  const variantsOfProduct = new Map<string, string[]>();
  for (const v of variants) variantsOfProduct.set(v.product.id, [...(variantsOfProduct.get(v.product.id) ?? []), v.id]);
  const recipes = [...latest.entries()].flatMap(([productId, b]) =>
    b.lines.map((l) => ({ materialVariantId: l.materialVariantId, finishedVariantIds: l.finishedVariantId ? [l.finishedVariantId] : variantsOfProduct.get(productId) ?? [], qtyPerUnit: Number(l.qtyPerUnit) })),
  );
  const implied = impliedMaterialUse(recipes, through);

  const materials = variants.filter((v) => v.product.kind === "MATERIAL").map((v) => {
    const use = implied.get(v.id) ?? null;
    const count = lastCount.get(v.id);
    return {
      variantId: v.id, productId: v.product.id, product: v.product.name, size: v.size, color: v.color, sku: v.sku, unit: v.product.stockUnit ?? "pcs",
      stock: v.stock, cameInOnDocument: documented.get(v.id) ?? 0, usedOnRecord: issued.get(v.id) ?? 0,
      usedByRecipes: use ? round(use.used) : null, finishedUnits: use?.finishedUnits ?? null,
      // what is physically there: the latest count when there is one (materials are often counted, never typed in)
      boughtAtLeast: use ? round(use.used + (count ? count.counted : v.stock)) : null,
      boughtBasis: count ? ("count" as const) : ("stock" as const),
      unitCost: v.costState?.avgUnitCost != null ? Number(v.costState.avgUnitCost) : v.costPrice != null ? Number(v.costPrice) : v.product.costPrice != null ? Number(v.product.costPrice) : null,
      count: count ? { date: businessDateOf(count.countDate), counted: count.counted, siteStockThen: count.siteStock, difference: count.counted - count.siteStock } : null,
    };
  });

  // parcels booked straight on the courier (no order on the site), from courier payouts
  const outside = await prisma.clearingSettlementLine.findMany({
    where: { orderId: null, settlement: { businessId: business.id, status: { not: "REVERSED" } } },
    select: { amount: true, outsideSale: true, matchStatus: true, settlement: { select: { reference: true, settlementDate: true, status: true } } },
  });
  const direct = new Map<string, { reference: string; date: string; status: string; parcels: number; amount: number; outsideSale: number }>();
  for (const l of outside) {
    const k = l.settlement.reference;
    const d = direct.get(k) ?? { reference: k, date: businessDateOf(l.settlement.settlementDate), status: l.settlement.status, parcels: 0, amount: 0, outsideSale: 0 };
    d.parcels += 1;
    d.amount += Number(l.amount);
    if (l.outsideSale) d.outsideSale += 1;
    direct.set(k, d);
  }
  const shippedWithoutCourier = await prisma.order.count({ where: { deletedAt: null, status: { in: ["SHIPPED", "DELIVERED", "PARTIALLY_DELIVERED"] }, courierConsignmentId: null } });
  const partlyUnsettled = await prisma.order.count({ where: { deletedAt: null, status: "PARTIALLY_DELIVERED", partialDeliveryReconciledAt: null } });
  const returnedNotRestocked = finished.reduce((s, f) => s + f.out.returned, 0);

  return {
    asOf: today,
    finished,
    materials,
    directShipments: [...direct.values()].sort((a, b) => a.date.localeCompare(b.date)),
    checks: { shippedWithoutCourier, partlyUnsettled, returnedNotRestocked, recipes: latest.size },
  };
}

/**
 * Records a physical count beside the site's stock. The stock hub passes `expected` (what should be on the shelf: stock
 * plus units on orders not yet handed to the courier), kept as the count's `siteStock` so the difference shown here is
 * the true one, and `sourceId` (its count line): a count already recorded for that line is returned, not repeated.
 */
export async function recordStockCount(
  input: { variantId: string; counted: number; countDate?: string; note?: string | null; expected?: number; sourceId?: string },
  actor: FinanceActor,
) {
  const { business } = await getFinanceContext();
  const date = input.countDate ?? businessToday(business);
  if (date > businessToday(business)) throw financeError(400, "STOCK_COUNT_FUTURE", "A count can't be dated in the future");
  return financeTransaction(async (tx) => {
    if (input.sourceId) {
      const seen = await tx.stockCount.findUnique({ where: { sourceId: input.sourceId }, select: { id: true, counted: true, siteStock: true } });
      if (seen) return { id: seen.id, siteStock: seen.siteStock, difference: seen.counted - seen.siteStock, existed: true };
    }
    const v = await tx.productVariant.findUnique({ where: { id: input.variantId }, select: { id: true, stock: true, sku: true } });
    if (!v) throw financeError(404, "VARIANT_NOT_FOUND", "That product or material wasn't found");
    const siteStock = input.expected ?? v.stock;
    const c = await tx.stockCount.create({
      data: { businessId: business.id, variantId: v.id, countDate: dateColumn(date), counted: input.counted, siteStock, note: input.note ?? null, countedByAdminId: adminOf(actor), sourceId: input.sourceId ?? null },
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "stock_count.record", entityType: "StockCount", entityId: c.id, before: null, after: { sku: v.sku, date, counted: input.counted, siteStock, stock: v.stock, sourceId: input.sourceId ?? null } });
    return { id: c.id, siteStock, difference: input.counted - siteStock, existed: false };
  });
}

/** Parcels booked with the courier on the days a roll was in use (both ends included). */
async function parcelsBetween(from: string, to: string, tz: string) {
  return prisma.order.count({ where: { deletedAt: null, courierBookedAt: { gte: businessDayStartUtc(from, tz), lt: businessDayStartUtc(addDays(to, 1), tz) } } });
}

/** Rolls with their yield; `openOnly`: just the rolls in use (the stock hub — no parcel counts for finished rolls). */
export async function listRolls(opts: { openOnly?: boolean } = {}) {
  const { business } = await getFinanceContext();
  const today = businessToday(business);
  const rolls = await prisma.materialRoll.findMany({
    where: { businessId: business.id, ...(opts.openOnly ? { finishedOn: null } : {}) },
    orderBy: [{ openedOn: "desc" }, { createdAt: "desc" }],
    include: { materialVariant: { select: { id: true, size: true, costPrice: true, product: { select: { name: true, costPrice: true } }, costState: { select: { avgUnitCost: true } } } } },
  });
  const out = [];
  for (const r of rolls) {
    const opened = businessDateOf(r.openedOn);
    const finished = r.finishedOn ? businessDateOf(r.finishedOn) : null;
    const booked = await parcelsBetween(opened, finished ?? today, business.timezone);
    const parcels = r.parcelsCounted ?? booked;
    const mv = r.materialVariant;
    const rollCost = mv.costState?.avgUnitCost != null ? Number(mv.costState.avgUnitCost) : mv.costPrice != null ? Number(mv.costPrice) : mv.product.costPrice != null ? Number(mv.product.costPrice) : null;
    out.push({
      id: r.id, material: `${mv.product.name}${mv.size ? ` ${mv.size}` : ""}`, materialVariantId: mv.id, openedOn: opened, finishedOn: finished, note: r.note,
      parcelsBooked: booked, parcelsCounted: r.parcelsCounted, parcels,
      rollCost,
      // a cost per parcel only from a finished roll — an open roll's yield isn't known yet
      perParcel: finished && rollCost != null && parcels > 0 ? Math.round((rollCost / parcels) * 100) / 100 : null,
    });
  }
  const done = out.filter((r) => r.perParcel != null);
  return { rolls: out, averagePerParcel: done.length ? Math.round((done.reduce((s, r) => s + (r.perParcel ?? 0), 0) / done.length) * 100) / 100 : null };
}

export async function openRoll(input: { materialVariantId: string; openedOn: string; note?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  if (input.openedOn > businessToday(business)) throw financeError(400, "ROLL_FUTURE", "A roll can't be opened in the future");
  return financeTransaction(async (tx) => {
    const v = await tx.productVariant.findUnique({ where: { id: input.materialVariantId }, select: { id: true, product: { select: { kind: true } } } });
    if (!v || v.product.kind !== "MATERIAL") throw financeError(400, "ROLL_NOT_MATERIAL", "Choose a material");
    const r = await tx.materialRoll.create({ data: { businessId: business.id, materialVariantId: v.id, openedOn: dateColumn(input.openedOn), note: input.note ?? null, createdByAdminId: adminOf(actor) } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "material_roll.open", entityType: "MaterialRoll", entityId: r.id, before: null, after: { openedOn: input.openedOn } });
    return { id: r.id };
  });
}

export async function finishRoll(id: string, input: { finishedOn: string; parcelsCounted?: number | null; note?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  if (input.finishedOn > businessToday(business)) throw financeError(400, "ROLL_FUTURE", "A roll can't be finished in the future");
  return financeTransaction(async (tx) => {
    const r = await tx.materialRoll.findFirst({ where: { id, businessId: business.id } });
    if (!r) throw financeError(404, "ROLL_NOT_FOUND", "Roll not found");
    if (input.finishedOn < businessDateOf(r.openedOn)) throw financeError(400, "ROLL_DATES", "It can't finish before it was opened");
    const updated = await tx.materialRoll.update({ where: { id }, data: { finishedOn: dateColumn(input.finishedOn), parcelsCounted: input.parcelsCounted ?? null, note: input.note ?? r.note } });
    await recordFinanceAudit(tx, {
      businessId: business.id, actor, action: "material_roll.finish", entityType: "MaterialRoll", entityId: id,
      before: { finishedOn: r.finishedOn ? businessDateOf(r.finishedOn) : null, parcelsCounted: r.parcelsCounted }, after: { finishedOn: input.finishedOn, parcelsCounted: updated.parcelsCounted },
    });
    return { id };
  });
}
