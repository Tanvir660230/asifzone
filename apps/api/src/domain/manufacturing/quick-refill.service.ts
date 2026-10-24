/**
 * Quick refill (docs/FINANCE_OWNER_BOOKS.md §7.2): attar oil bought by the litre, bottles by the hundred, a label and a
 * box — then refilled into 3 / 6 / 12 ml bottles and sold. A refill is a small in-house production order, run start to
 * finish in one action on the existing manufacturing engine, so costing, stock and every check stay one system
 * (since inventory recovery phase 3 it runs through Stock › Filled — stock/fill.service — the one guarded path):
 *
 *   plan from the product's approved recipe (bill of materials, wastage included) → approve → issue the materials (the
 *   planned quantities, or what was really used) → declare them consumed → receive the finished bottles → close at the
 *   final cost (each bottle's cost = the materials it took).
 *
 * Each step is its own transaction; the fill entry remembers what each made, so sending the refill again resumes where
 * it stopped. Idempotent by the request key (the order's notes carry it).
 */
import { prisma } from "../../config/prisma";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { financeError } from "../finance/finance-values";
import { fillMarker, recordFill } from "../stock/fill.service";
import { findEntry } from "../stock/hub-entry";
import { getProductionOrder } from "./production-orders.service";

export interface QuickRefillInput {
  variantId: string;
  quantity: number;
  /** What was really used, per material (stock units), when it differs from the recipe. */
  used?: Array<{ materialVariantId: string; quantity: number }>;
  note?: string | null;
}

const SEE = { canSeeCost: true };

export async function quickRefill(input: QuickRefillInput, actor: FinanceActor, requestKey: string | null) {
  if (!requestKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every refill");
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) throw financeError(400, "REFILL_QTY", "Refill a whole number of bottles");
  const { business } = await getFinanceContext();
  // a refill made before Stock › Filled ran as a hub entry: its order carries the key in its notes — a replay
  const marker = fillMarker(requestKey);
  const legacy = (await findEntry(business.id, "FILL", requestKey))
    ? null
    : await prisma.productionOrder.findFirst({ where: { businessId: business.id, OR: [{ notes: marker }, { notes: { startsWith: `${marker} — ` } }] }, select: { id: true } });
  if (legacy) return { order: await getProductionOrder(legacy.id, SEE), replayed: true };
  // the one guarded path (stock/fill.service): checked before writing, a double tap waits, a retry resumes
  const r = await recordFill({ variantId: input.variantId, quantity: input.quantity, used: input.used, note: input.note }, actor, requestKey);
  return { order: await getProductionOrder(r.fill.productionOrderId!, SEE), replayed: r.replayed };
}

/** Recent quick refills with what each bottle finally cost. */
export async function listQuickRefills() {
  const { business } = await getFinanceContext();
  const rows = await prisma.productionOrder.findMany({ where: { businessId: business.id, notes: { startsWith: "Quick refill " } }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 30 });
  const refills = [];
  for (const r of rows) {
    const o = await getProductionOrder(r.id, SEE);
    refills.push({
      id: o.id, number: o.number, status: o.status, product: o.product.name, variant: o.lines[0] ? { sku: o.lines[0].sku, size: o.lines[0].size } : null, quantity: o.lines.reduce((s, l) => s + l.acceptedQty, 0),
      cost: o.finalCost?.goods ?? null, unitCost: o.finalCost?.perAcceptedUnit ?? null, materials: o.materials.map((m) => ({ sku: m.sku, name: m.name, unit: m.stockUnit, used: m.consumedQty })), date: o.orderDate,
    });
  }
  return { refills };
}
