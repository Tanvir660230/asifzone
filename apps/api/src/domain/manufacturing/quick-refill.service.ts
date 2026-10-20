/**
 * Quick refill (docs/FINANCE_OWNER_BOOKS.md §7.2): attar oil bought by the litre, bottles by the hundred, a label and a
 * box — then refilled into 3 / 6 / 12 ml bottles and sold. A refill is a small in-house production order, run start to
 * finish in one action on the existing manufacturing engine, so costing, stock and every check stay one system:
 *
 *   plan from the product's approved recipe (bill of materials, wastage included) → approve → issue the materials (the
 *   planned quantities, or what was really used) → declare them consumed → receive the finished bottles → close at the
 *   final cost (each bottle's cost = the materials it took).
 *
 * Each step is its own transaction. If one fails, the order is left at that step (its number is in the error) and is
 * finished from Manufacturing. Idempotent by the request key (the order's notes carry it).
 */
import { prisma } from "../../config/prisma";
import type { FinanceActor } from "../finance/finance-audit";
import { getFinanceContext } from "../finance/finance-context";
import { financeError } from "../finance/finance-values";
import { approveProductionOrder, createProductionOrder, getProductionOrder } from "./production-orders.service";
import { declareMaterialUsage, issueMaterials } from "./material-custody.service";
import { createProductionReceipt, postProductionReceipt } from "./production-receipts.service";
import { closeProductionOrder } from "./production-close.service";

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
  const marker = `Quick refill ${requestKey}`;
  const prior = await prisma.productionOrder.findFirst({ where: { businessId: business.id, notes: { startsWith: marker } }, select: { id: true } });
  if (prior) return { order: await getProductionOrder(prior.id, SEE), replayed: true };

  const variant = await prisma.productVariant.findUnique({ where: { id: input.variantId }, select: { id: true, sku: true, productId: true, product: { select: { name: true, kind: true } } } });
  if (!variant || variant.product.kind !== "FINISHED") throw financeError(404, "VARIANT_NOT_FOUND", "Choose the bottle size you refilled");
  const bom = await prisma.billOfMaterials.findFirst({ where: { productId: variant.productId, status: "APPROVED" }, orderBy: { version: "desc" }, select: { id: true } });
  if (!bom) throw financeError(409, "NO_RECIPE", `${variant.product.name} has no approved recipe yet — add it under Inventory › Manufacturing › Bills of materials (e.g. 6 ml oil + 1 bottle + 1 label)`);

  const created = await createProductionOrder({ productId: variant.productId, bomId: bom.id, lines: [{ variantId: variant.id, plannedQty: input.quantity }], notes: `${marker}${input.note ? ` — ${input.note}` : ""}` }, actor, SEE);
  const moId = created.id;
  const step = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      const e = err as { message?: string; statusCode?: number; details?: unknown };
      throw financeError((e.statusCode as 400 | 409) ?? 409, "REFILL_STOPPED", `${created.number}: stopped at "${name}" — ${e.message ?? String(err)}. Finish it in Manufacturing.`, { productionOrderId: moId, step: name });
    }
  };
  await step("approve", () => approveProductionOrder(moId, actor, SEE));
  const mo = await getProductionOrder(moId, SEE);
  const own = mo.materials.filter((m) => m.suppliedBy === "BUSINESS");
  const usedBy = new Map((input.used ?? []).map((u) => [u.materialVariantId, u.quantity]));
  const lines = own.map((m) => ({ materialLineId: m.id, quantity: usedBy.get(m.materialVariantId) ?? m.plannedQty })).filter((l) => l.quantity > 0);
  if (!lines.length) throw financeError(409, "RECIPE_EMPTY", "The recipe has no material the business supplies");
  const overPlan = lines.some((l) => l.quantity > (own.find((m) => m.id === l.materialLineId)?.plannedQty ?? 0));
  await step("issue materials", () => issueMaterials(moId, { lines, note: "Quick refill", overIssueReason: overPlan ? "Quick refill: what was really used" : null }, actor, { ...SEE, requestKey: `refill:${requestKey}` }));
  await step("declare usage", () => declareMaterialUsage(moId, { lines: lines.map((l) => ({ materialLineId: l.materialLineId, consumedQty: l.quantity, scrappedQty: 0 })) }, actor, SEE));
  const receipt = await step("receive bottles", () => createProductionReceipt(moId, { lines: [{ orderLineId: mo.lines[0]!.id, delivered: input.quantity, accepted: input.quantity }], inspectionNotes: "Quick refill" }, actor, SEE));
  await step("post receipt", () => postProductionReceipt(receipt.id, {}, actor, SEE));
  await step("close", () => closeProductionOrder(moId, { note: "Quick refill" }, actor, SEE));
  const final = await getProductionOrder(moId, SEE);
  return { order: final, replayed: false };
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
