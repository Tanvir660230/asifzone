/**
 * One item's story on the stock page (inventory recovery phase 3): for an attar size — filled bottles on the shelf, bottles
 * owed, which waiting orders are filled, its recipe (or that it has none: unconfigured, can't be filled), the materials it
 * takes and what is in stock of each, every fill (what went in, what was wasted, what came out, its cost, who and when),
 * sales, cancellations and returns, its valuation and any cost still unresolved. For a cap or a garment the same page
 * without the attar parts.
 *
 * Costing is a moving average (docs/STOCK_HUB.md §2), so a bottle is not traced to one purchase: each fill's materials
 * leave at their average, and the trace lists each material's recent purchases that make that average. Read only.
 */
import { prisma } from "../../config/prisma";
import { getFinanceContext } from "../finance/finance-context";
import { financeError, toMajorNumber, toMinor } from "../finance/finance-values";
import { getProductionOrder } from "../manufacturing/production-orders.service";
import { fillCapacity } from "./fill-capacity.service";
import { reservedNotDispatched } from "./count.service";
import { waitingLines } from "./fill-status.service";
import { materialRole, unitOf, variantLabel } from "./hub-entry";

const HISTORY_DAYS = 90;
const FILLS_SHOWN = 20;
const PURCHASES_PER_MATERIAL = 3;

/** How a reason shows in the movement summary. */
const SUMMARY: Record<string, "sold" | "cancelled" | "returned" | "filled" | "bought" | "counted" | "materialUse"> = {
  ORDER: "sold", CANCELLATION: "cancelled", RETURN: "returned", PRODUCTION_RECEIPT: "filled", PURCHASE_RECEIPT: "bought", PURCHASE_RETURN: "bought",
  ADJUSTMENT: "counted", DAMAGED: "counted", LOST: "counted", RESTOCK: "counted", IMPORT: "counted",
  PRODUCTION_ISSUE: "materialUse", PRODUCTION_RETURN: "materialUse", PACKAGING_USE: "materialUse",
};

/** A material's name without repeating its spec ("Empty attar bottle 12 ml", not "… 12 ml — 12 ml"). */
const materialLabel = (m: Parameters<typeof variantLabel>[0]) => {
  const spec = m.size?.trim().toLowerCase();
  return spec && m.product.name.toLowerCase().includes(spec) ? m.product.name : variantLabel(m);
};

export async function stockTrace(variantId: string, viewer: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const money = (v: unknown) => (viewer.canSeeCost && v !== null && v !== undefined ? toMajorNumber(toMinor(v as never, cur), cur) : null);
  const v = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true, sku: true, size: true, color: true, stock: true, stockPolicy: true,
      product: { select: { id: true, name: true, kind: true, stockUnit: true, fillToOrder: true, trackInventory: true, deletedAt: true, stockPolicy: true, backorderLimit: true } },
      costState: { select: { valuedQty: true, value: true, avgUnitCost: true, unvaluedQty: true, deficitQty: true } },
    },
  });
  if (!v || v.product.deletedAt || !v.product.trackInventory) throw financeError(404, "VARIANT_NOT_FOUND", "That item isn't stock-tracked");
  const fill = v.product.fillToOrder;
  const unit = unitOf(v.product);
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000);

  const [waiting, movements, bom] = await Promise.all([
    reservedNotDispatched(prisma, [v.id]).then((m) => m.get(v.id) ?? 0),
    prisma.stockMovement.groupBy({ by: ["reason"], where: { variantId: v.id, createdAt: { gte: since } }, _sum: { change: true } }),
    fill
      ? prisma.billOfMaterials.findFirst({
          where: { productId: v.product.id, status: "APPROVED" },
          orderBy: { version: "desc" },
          select: { version: true, lines: { select: { materialVariantId: true, finishedVariantId: true, qtyPerUnit: true, wastagePct: true, suppliedBy: true } } },
        })
      : Promise.resolve(null),
  ]);

  // recipe lines for this size, with what is in stock of each material
  const lines = (bom?.lines ?? []).filter((l) => l.finishedVariantId === null || l.finishedVariantId === v.id);
  const mats = lines.length
    ? await prisma.productVariant.findMany({
        where: { id: { in: lines.map((l) => l.materialVariantId) } },
        select: { id: true, sku: true, size: true, color: true, stock: true, product: { select: { name: true, kind: true, stockUnit: true } }, costState: { select: { avgUnitCost: true } } },
      })
    : [];
  const matById = new Map(mats.map((m) => [m.id, m]));
  const purchases = mats.length
    ? await prisma.stockMovement.findMany({
        where: { variantId: { in: mats.map((m) => m.id) }, reason: "PURCHASE_RECEIPT", change: { gt: 0 } },
        select: { variantId: true, change: true, createdAt: true, note: true, valuationEntry: { select: { valueChange: true, valuationStatus: true } } },
        orderBy: { createdAt: "desc" },
        take: 200,
      })
    : [];
  const recipe = bom && lines.length
    ? {
        version: bom.version,
        lines: lines.map((l) => {
          const m = matById.get(l.materialVariantId)!;
          const mUnit = unitOf(m.product);
          return {
            materialVariantId: m.id, sku: m.sku, name: materialLabel(m), unit: mUnit, materialKind: materialRole(mUnit),
            perBottle: Number(l.qtyPerUnit), wastagePct: Number(l.wastagePct), suppliedBy: l.suppliedBy, inStock: m.stock,
            avgCost: viewer.canSeeCost && m.costState?.avgUnitCost != null ? Number(m.costState.avgUnitCost) : null,
            recentPurchases: purchases.filter((p) => p.variantId === m.id).slice(0, PURCHASES_PER_MATERIAL).map((p) => ({
              date: p.createdAt, quantity: p.change, note: p.note,
              unitCost: viewer.canSeeCost && p.valuationEntry && p.valuationEntry.valuationStatus !== "MISSING" ? Math.round((Number(p.valuationEntry.valueChange) / p.change) * 1e6) / 1e6 : null,
            })),
          };
        }),
      }
    : null;

  // fills of this size: the production orders that made it, newest first
  const orders = fill
    ? await prisma.productionOrder.findMany({
        where: { businessId: business.id, lines: { some: { variantId: v.id } }, status: { not: "CANCELLED" } },
        select: { id: true, createdByAdminId: true, notes: true },
        orderBy: { createdAt: "desc" },
        take: FILLS_SHOWN,
      })
    : [];
  const admins = new Map((await prisma.adminUser.findMany({ where: { id: { in: orders.map((o) => o.createdByAdminId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
  const fills = [];
  for (const o of orders) {
    const mo = await getProductionOrder(o.id, viewer);
    fills.push({
      productionOrderId: mo.id, number: mo.number, status: mo.status, date: mo.orderDate, by: o.createdByAdminId ? admins.get(o.createdByAdminId) ?? null : null,
      bottles: mo.lines.filter((l) => l.variantId === v.id).reduce((s, l) => s + l.acceptedQty, 0),
      wasteReason: /— wasted: (.*)$/.exec(o.notes ?? "")?.[1] ?? null,
      materials: mo.materials.filter((m) => m.suppliedBy === "BUSINESS").map((m) => ({ sku: m.sku, name: m.name, unit: m.stockUnit, used: m.consumedQty, wasted: m.scrappedQty, value: m.issuedValue })),
      cost: mo.finalCost?.goods ?? null,
      perBottle: mo.finalCost?.perAcceptedUnit ?? null,
    });
  }

  const summary = { sold: 0, cancelled: 0, returned: 0, filled: 0, bought: 0, counted: 0, materialUse: 0 };
  for (const m of movements) summary[SUMMARY[m.reason] ?? "counted"] += m._sum.change ?? 0;

  // costs still unresolved: open "stock without a cost" exceptions on this item's movements
  const recentIds = (await prisma.stockMovement.findMany({ where: { variantId: v.id }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 500 })).map((m) => m.id);
  const exceptions = recentIds.length
    ? await prisma.financeException.findMany({ where: { businessId: business.id, status: "OPEN", key: { in: recentIds.map((id) => `stock:${id}`) } }, select: { id: true, title: true, amount: true, createdAt: true } })
    : [];

  const made = fill ? (await fillCapacity(prisma, { variantIds: [v.id], materialsOnly: true })).get(v.id) ?? 0 : null;
  const policy = v.stockPolicy ?? v.product.stockPolicy;
  return {
    variantId: v.id, sku: v.sku, name: variantLabel(v), productId: v.product.id, productName: v.product.name, unit,
    kind: v.product.kind === "MATERIAL" ? "MATERIAL" : fill ? "FILL_TO_ORDER" : "FINISHED",
    stock: v.stock,
    waiting,
    onShelf: Math.max(0, v.stock + waiting),
    owed: fill ? Math.max(0, -v.stock) : 0,
    makeable: made,
    policy: fill ? { policy, backorderLimit: v.product.backorderLimit } : null,
    recipe,
    /** An attar size without an approved recipe can't be filled: the owner adds the real recipe first. */
    recipeMissing: fill && !recipe,
    waitingOrders: fill ? (await waitingLines(prisma, [v.id])).map(({ orderId, orderNumber, placedAt, units, filled, toFill, status }) => ({ orderId, orderNumber, placedAt, units, filled, toFill, status })) : [],
    fills,
    last90Days: summary,
    valuation: v.costState
      ? { valuedQty: v.costState.valuedQty, unvaluedQty: v.costState.unvaluedQty, deficitQty: v.costState.deficitQty, value: money(v.costState.value), avgCost: viewer.canSeeCost && v.costState.avgUnitCost != null ? Number(v.costState.avgUnitCost) : null }
      : null,
    unresolvedCosts: exceptions.map((e) => ({ id: e.id, title: e.title, amount: money(e.amount), at: e.createdAt })),
  };
}
export type StockTrace = Awaited<ReturnType<typeof stockTrace>>;
