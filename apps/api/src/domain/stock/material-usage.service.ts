/**
 * Material usage (docs/MATERIALS_PURCHASING.md §6): per material and month, where its stock went — read from the stock
 * movements only, nothing written. Opening and closing come from today's stock less the movements since; the rest are the
 * month's movements by reason. "Recipe says" is what the fills closed that month planned from their recipes (wastage %
 * included), so "used in fills" above it is material the recipe doesn't explain. Flags point at what to look into: more
 * used than the recipes say, a count loss or gain, waste.
 */
import { Prisma } from "@prisma/client";
import { monthPeriod } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { storeContext } from "../metrics/store-time";
import { financeError } from "../finance/finance-values";
import { variantLabel } from "./hub-entry";

const BUCKET: Record<string, "received" | "returned" | "fills" | "packaging" | "wasted" | "counted" | "other"> = {
  PURCHASE_RECEIPT: "received", RESTOCK: "received", IMPORT: "received",
  PURCHASE_RETURN: "returned",
  PRODUCTION_ISSUE: "fills", PRODUCTION_RETURN: "fills",
  PACKAGING_USE: "packaging",
  DAMAGED: "wasted", LOST: "wasted",
  ADJUSTMENT: "counted",
};

export type UsageFlag = "OVER_RECIPE" | "COUNT_LOSS" | "COUNT_GAIN" | "WASTE";

export interface MaterialUsageRow {
  variantId: string;
  name: string;
  unit: string;
  materialType: string | null;
  opening: number;
  received: number;
  returned: number;
  usedInFills: number;
  recipeSays: number;
  packaging: number;
  wasted: number;
  counted: number;
  other: number;
  closing: number;
  flags: UsageFlag[];
}

export async function materialUsage(month: string): Promise<{ month: string; from: string; to: string; rows: MaterialUsageRow[] }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw financeError(400, "MONTH", "Use a month like 2026-10");
  const { startDate, endDate } = monthPeriod(`${month}-01`);
  const { timezone } = await storeContext();
  const local = Prisma.sql`(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date`;
  const materials = await prisma.productVariant.findMany({
    where: { product: { kind: "MATERIAL", deletedAt: null } },
    select: { id: true, size: true, color: true, stock: true, product: { select: { name: true, stockUnit: true, materialType: true } } },
  });
  if (!materials.length) return { month, from: startDate, to: endDate, rows: [] };
  const ids = materials.map((m) => m.id);
  const [inMonth, after, planned] = await Promise.all([
    prisma.$queryRaw<Array<{ variantId: string; reason: string; qty: number }>>`
      SELECT "variantId", reason::text AS reason, SUM(change)::int AS qty FROM "StockMovement"
      WHERE "variantId" IN (${Prisma.join(ids)}) AND ${local} BETWEEN ${startDate}::date AND ${endDate}::date
      GROUP BY 1, 2`,
    prisma.$queryRaw<Array<{ variantId: string; qty: number }>>`
      SELECT "variantId", SUM(change)::int AS qty FROM "StockMovement"
      WHERE "variantId" IN (${Prisma.join(ids)}) AND ${local} > ${endDate}::date
      GROUP BY 1`,
    prisma.$queryRaw<Array<{ variantId: string; qty: number }>>`
      SELECT ml."materialVariantId" AS "variantId", SUM(ml."plannedQty")::int AS qty
      FROM "ProductionMaterialLine" ml JOIN "ProductionOrder" po ON po.id = ml."productionOrderId"
      WHERE ml."materialVariantId" IN (${Prisma.join(ids)}) AND ml."suppliedBy" = 'BUSINESS' AND po.status = 'CLOSED'
        AND ((po."closedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date BETWEEN ${startDate}::date AND ${endDate}::date
      GROUP BY 1`,
  ]);
  const afterBy = new Map(after.map((a) => [a.variantId, a.qty]));
  const plannedBy = new Map(planned.map((p) => [p.variantId, p.qty]));
  const rows = materials.map((m): MaterialUsageRow => {
    const b = { received: 0, returned: 0, fills: 0, packaging: 0, wasted: 0, counted: 0, other: 0 };
    for (const r of inMonth) if (r.variantId === m.id) b[BUCKET[r.reason] ?? "other"] += r.qty;
    const net = Object.values(b).reduce((s, x) => s + x, 0);
    const closing = m.stock - (afterBy.get(m.id) ?? 0);
    const usedInFills = -b.fills;
    const recipeSays = plannedBy.get(m.id) ?? 0;
    const flags: UsageFlag[] = [];
    if (usedInFills > recipeSays) flags.push("OVER_RECIPE");
    if (b.counted < 0) flags.push("COUNT_LOSS");
    if (b.counted > 0) flags.push("COUNT_GAIN");
    if (b.wasted < 0) flags.push("WASTE");
    return {
      variantId: m.id, name: variantLabel({ size: m.size, color: m.color, product: m.product }), unit: m.product.stockUnit ?? "pcs", materialType: m.product.materialType,
      opening: closing - net, received: b.received, returned: -b.returned, usedInFills, recipeSays, packaging: -b.packaging, wasted: -b.wasted, counted: b.counted, other: b.other, closing, flags,
    };
  });
  rows.sort((a, z) => z.flags.length - a.flags.length || a.name.localeCompare(z.name));
  return { month, from: startDate, to: endDate, rows };
}
