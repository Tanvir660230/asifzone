/**
 * Closing a production order, its final cost and late costs (docs/MANUFACTURING.md §9).
 *
 * Close (manufacturing.approve) — checklist: every business-owned material issued is accounted for (returned, consumed or
 * scrapped: nothing left at the producer), no draft cost (approve it or void it — an unapproved cost is excluded only by
 * voiding it), no draft delivery. Then, in one transaction:
 *   final cost = material issued − returned + approved costs; the order's WIP residual = final cost − value transferred
 *   provisionally by its receipts. An approved abnormal loss (with its reason) goes to 5220; the rest is the transfer to the
 *   finished goods, spread over the variants by accepted units (largest remainder, exact) and booked through costing REVALUE
 *   (costing.service.revalueForDocumentInTx): the units still held are revalued, the share already sold goes to 5150 — no
 *   cost of goods sold is rewritten. Event manufacturing.order_settled clears the order's WIP to zero. Status CLOSED (final).
 *
 * Late cost: a cost approved (or an approved cost voided) after close settles at once by the same path, so a closed order's
 * WIP is always zero and the finished goods carry every approved cost.
 */
import type { ProductionSettlementKind } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { installId } from "../../config/installation";
import { actorCan, recordFinanceAudit, type FinanceActor } from "../finance/finance-audit";
import { businessToday, getFinanceContext } from "../finance/finance-context";
import { dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "../finance/finance-values";
import { financeTransaction } from "../finance/finance-tx";
import { recordFinancialEvent } from "../finance/events.service";
import { activeCostingInTx, revalueForDocumentInTx } from "../finance/costing.service";
import { MANUFACTURING_EVENT_TYPES, type OrderSettledPayload } from "../finance/manufacturing-posting-rules";
import { getProductionOrder, lockProductionOrder, moNumber } from "./production-orders.service";

const CLOSABLE = ["IN_PRODUCTION", "PARTIALLY_RECEIVED", "RECEIVED"];
const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);

type Business = { id: string; key: string; baseCurrency: string; timezone: string };

/** The order's work in progress from its documents (minor): material net + approved costs − transfers − settlements. */
export async function orderWipMinor(db: AppTransactionClient | typeof prisma, orderId: string, cur: string) {
  const [r] = await db.$queryRaw<Array<{ v: Prisma.Decimal }>>`
    SELECT COALESCE((SELECT SUM(CASE WHEN kind = 'ISSUE' THEN value ELSE -value END) FROM "ProductionMaterialMove" WHERE "productionOrderId" = ${orderId}), 0)
         + COALESCE((SELECT SUM(amount) FROM "ProductionCostEntry" WHERE "productionOrderId" = ${orderId} AND status = 'APPROVED'), 0)
         - COALESCE((SELECT SUM(rl.value) FROM "ProductionReceiptLine" rl JOIN "ProductionReceipt" r ON r.id = rl."receiptId" WHERE r."productionOrderId" = ${orderId} AND r.status = 'POSTED' AND rl.value IS NOT NULL), 0)
         - COALESCE((SELECT SUM(residual) FROM "ProductionSettlement" WHERE "productionOrderId" = ${orderId}), 0) AS v`;
  return toMinor(r!.v, cur);
}

/** Splits `total` over weights exactly (largest remainder; ties to the earlier entry). */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!sum) return weights.map(() => 0);
  const sign = total < 0 ? -1 : 1;
  const abs = BigInt(Math.abs(total));
  const raw = weights.map((w) => ({ q: (abs * BigInt(w)) / BigInt(sum), r: (abs * BigInt(w)) % BigInt(sum) }));
  let left = abs - raw.reduce((s, x) => s + x.q, 0n);
  const order = raw.map((x, i) => ({ i, r: x.r })).sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  const out = raw.map((x) => x.q);
  for (const { i } of order) {
    if (left === 0n) break;
    out[i] = out[i]! + 1n;
    left -= 1n;
  }
  return out.map((v) => sign * Number(v));
}

/** Sweeps `residual` out of the order's WIP: `loss` to 5220, the rest to its finished goods by accepted share. */
async function settleInTx(
  tx: AppTransactionClient,
  business: Business,
  brandKey: string,
  order: { id: string; number: number; lines: Array<{ variantId: string; acceptedQty: number }> },
  input: { kind: ProductionSettlementKind; residualMinor: number; lossMinor: number; lossReason: string | null; costEntryId: string | null },
  actor: FinanceActor,
) {
  const cur = business.baseCurrency;
  const transferMinor = input.residualMinor - input.lossMinor;
  const accepted = order.lines.filter((l) => l.acceptedQty > 0).sort((a, b) => (a.variantId < b.variantId ? -1 : 1));
  if (transferMinor !== 0 && !accepted.length) {
    throw financeError(409, "CLOSE_NOTHING_ACCEPTED", "No finished goods were accepted on this order — what's left in production can only be written off as an abnormal loss");
  }
  const financialDate = businessToday(business);
  const settlement = await tx.productionSettlement.create({
    data: {
      productionOrderId: order.id, kind: input.kind, costEntryId: input.costEntryId, residual: toDecimal(input.residualMinor, cur), transfer: toDecimal(transferMinor, cur),
      abnormalLoss: toDecimal(input.lossMinor, cur), abnormalLossReason: input.lossReason, financialDate: dateColumn(financialDate), createdByAdminId: adminOf(actor),
    },
  });
  const deltas = allocate(transferMinor, accepted.map((l) => l.acceptedQty));
  const items = accepted.map((l, i) => ({ variantId: l.variantId, deltaMinor: deltas[i]!, qty: l.acceptedQty })).filter((i) => i.deltaMinor !== 0);
  let revalued: Awaited<ReturnType<typeof revalueForDocumentInTx>> = [];
  if (items.length) {
    const scope = await activeCostingInTx(tx);
    if (!scope) throw financeError(409, "COSTING_NOT_ACTIVE", "The final cost reaches the finished goods once inventory costing is active");
    revalued = await revalueForDocumentInTx(tx, { scope, sourceType: "ProductionSettlement", sourceId: settlement.id, financialDate, note: `${input.kind === "CLOSE" ? "Final cost" : "Late cost"} ${moNumber(order.number)}`, items });
  }
  for (const it of items) {
    const r = revalued.find((x) => x.variantId === it.variantId)!;
    await tx.productionSettlementLine.create({
      data: { settlementId: settlement.id, variantId: it.variantId, qty: it.qty, delta: toDecimal(it.deltaMinor, cur), heldShare: toDecimal(r.heldShareMinor, cur), soldShare: toDecimal(r.soldShareMinor, cur), valuationEntryId: r.entryId },
    });
  }
  await recordFinancialEvent(tx, {
    contract: "finance.event", contractVersion: 1, businessKey: business.key, brandKey,
    source: { installId, system: "manufacturing", entityType: "ProductionSettlement", entityId: settlement.id },
    event: { type: MANUFACTURING_EVENT_TYPES.orderSettled, version: 1, key: `mfg-settle:${settlement.id}`, occurredAt: new Date().toISOString() },
    financialDate, currency: cur,
    payload: { settlementId: settlement.id, productionOrderId: order.id, orderNumber: moNumber(order.number), kind: input.kind, transferMinor, lossMinor: input.lossMinor } satisfies OrderSettledPayload,
  });
  const summary = {
    kind: input.kind, residual: toMajorNumber(input.residualMinor, cur), transfer: toMajorNumber(transferMinor, cur), abnormalLoss: toMajorNumber(input.lossMinor, cur), abnormalLossReason: input.lossReason,
    heldShare: toMajorNumber(revalued.reduce((s, r) => s + r.heldShareMinor, 0), cur), soldShare: toMajorNumber(revalued.reduce((s, r) => s + r.soldShareMinor, 0), cur), costEntryId: input.costEntryId,
  };
  await recordFinanceAudit(tx, { businessId: business.id, actor, action: `production_settlement.${input.kind.toLowerCase()}`, entityType: "ProductionSettlement", entityId: settlement.id, after: summary, sourceRef: moNumber(order.number) });
  return summary;
}

export interface CloseChecklist {
  materialsAtProducer: Array<{ sku: string; atProducer: number }>;
  draftCosts: number;
  draftReceipts: number;
}

export function closeChecklist(o: { materials: Array<{ suppliedBy: string; issuedQty: number; returnedQty: number; consumedQty: number; scrappedQty: number; materialVariant: { sku: string } }>; costEntries: Array<{ status: string }>; receipts: Array<{ status: string }> }): CloseChecklist {
  return {
    materialsAtProducer: o.materials
      .filter((m) => m.suppliedBy === "BUSINESS")
      .map((m) => ({ sku: m.materialVariant.sku, atProducer: m.issuedQty - m.returnedQty - m.consumedQty - m.scrappedQty }))
      .filter((m) => m.atProducer !== 0),
    draftCosts: o.costEntries.filter((c) => c.status === "DRAFT").length,
    draftReceipts: o.receipts.filter((r) => r.status === "DRAFT").length,
  };
}

/** Closes the order at its final cost. Idempotent (a closed order is returned as it is). */
export async function closeProductionOrder(id: string, input: { abnormalLoss?: number | null; abnormalLossReason?: string | null; note?: string | null }, actor: FinanceActor, opts: { canSeeCost: boolean }) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  if (!actorCan(actor, "manufacturing.approve")) throw financeError(403, "FORBIDDEN", "Closing a production order needs manufacturing.approve");
  await financeTransaction(async (tx) => {
    const o = await lockProductionOrder(tx, business.id, id);
    if (o.status === "CLOSED") return;
    if (!CLOSABLE.includes(o.status)) throw financeError(409, "MO_NOT_CLOSABLE", `A production order closes once it is in production (this one is ${o.status.toLowerCase().replace("_", " ")})`);
    const check = closeChecklist(o);
    if (check.materialsAtProducer.length) {
      throw financeError(409, "CLOSE_MATERIAL_AT_PRODUCER", `Material still with the producer: ${check.materialsAtProducer.map((m) => `${m.sku} (${m.atProducer})`).join(", ")} — return it or declare it consumed or scrapped`);
    }
    if (check.draftCosts) throw financeError(409, "CLOSE_DRAFT_COSTS", `${check.draftCosts} production cost${check.draftCosts === 1 ? " is" : "s are"} still a draft — approve or void ${check.draftCosts === 1 ? "it" : "them"} first`);
    if (check.draftReceipts) throw financeError(409, "CLOSE_DRAFT_RECEIPTS", `${check.draftReceipts} deliver${check.draftReceipts === 1 ? "y is" : "ies are"} still a draft — post or delete ${check.draftReceipts === 1 ? "it" : "them"} first`);
    const residualMinor = await orderWipMinor(tx, o.id, cur);
    const lossMinor = input.abnormalLoss ? toMinor(input.abnormalLoss, cur) : 0;
    const lossReason = input.abnormalLossReason?.trim() || null;
    if (lossMinor < 0) throw financeError(400, "ABNORMAL_LOSS", "An abnormal loss is zero or more");
    if (lossMinor > 0 && !lossReason) throw financeError(400, "ABNORMAL_LOSS_REASON", "Say why the loss is abnormal");
    if (lossMinor > Math.max(0, residualMinor)) {
      throw financeError(409, "ABNORMAL_LOSS_TOO_LARGE", `The loss can't exceed what is left in production (${toMajorNumber(Math.max(0, residualMinor), cur)})`);
    }
    await tx.productionOrder.update({ where: { id: o.id }, data: { status: "CLOSED", closedAt: new Date(), closedReason: input.note?.trim() || null, closedByAdminId: adminOf(actor) } });
    const summary = await settleInTx(tx, business, brand.key, o, { kind: "CLOSE", residualMinor, lossMinor, lossReason: lossMinor > 0 ? lossReason : null, costEntryId: null }, actor);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_order.close", entityType: "ProductionOrder", entityId: o.id, before: { status: o.status }, after: { status: "CLOSED", ...summary }, reason: input.note?.trim() || undefined });
  });
  return getProductionOrder(id, opts);
}

/** After a cost on a CLOSED order is approved or voided (in that transaction): sweeps the WIP it left. */
export async function settleLateCostInTx(tx: AppTransactionClient, business: Business, brandKey: string, orderId: string, costEntryId: string, actor: FinanceActor) {
  const o = await lockProductionOrder(tx, business.id, orderId);
  if (o.status !== "CLOSED") return null;
  const residualMinor = await orderWipMinor(tx, o.id, business.baseCurrency);
  if (residualMinor === 0) return null;
  const nothingAccepted = !o.lines.some((l) => l.acceptedQty > 0);
  if (nothingAccepted && residualMinor < 0) throw financeError(409, "LATE_CREDIT_NO_GOODS", "This order made no finished goods — a cost reduction after close can't be settled against them");
  return settleInTx(tx, business, brandKey, o, {
    kind: "LATE_COST", residualMinor, costEntryId,
    lossMinor: nothingAccepted ? residualMinor : 0,
    lossReason: nothingAccepted ? "Late cost of an order that made no finished goods" : null,
  }, actor);
}
