/**
 * Deliveries, inspection and finished goods (docs/MANUFACTURING.md §8). A production order's quantity is not proof of
 * delivery: each delivery is a receipt that records, per finished variant, what arrived — delivered = accepted + rejected +
 * sent back for rework (database CHECK) — with its reference, inspection notes and evidence.
 *
 * Posting a receipt (one transaction, idempotent):
 *   accepted units → inventory.service.recordDocumentMovements (PRODUCTION_RECEIPT) at the order's PROVISIONAL unit cost →
 *   costing (DOCUMENT value, ESTIMATED) → event manufacturing.goods_received (Dr 1610 / Cr 1630, the order as party) →
 *   receipt POSTED (the database derives the order lines' delivered / accepted / rejected / rework) → the order's status.
 *
 * Provisional unit cost (decision D-M5) = max(actual cost to date, the complete plan) ÷ planned units, half-even — actual =
 * material issued − returned + approved production costs; the plan counts only when every business-supplied material had a
 * known cost. Zero is refused (goods never enter stock at zero cost). The final cost replaces it at close (M5): the units
 * still held are revalued and the share already sold goes to 5150 — no cost of goods sold is rewritten.
 *
 * Rejected units never become stock. Reversal: the accepted units leave again at the receipt's own unit cost and its journal
 * is reversed; units already sold can't be "unreceived".
 */
import type { Prisma } from "@prisma/client";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { installId } from "../../config/installation";
import { notifyReplenished, recordDocumentMovements } from "../../modules/inventory/inventory.service";
import { actorCan, recordFinanceAudit, type FinanceActor } from "../finance/finance-audit";
import { businessToday, getFinanceContext } from "../finance/finance-context";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "../finance/finance-values";
import { financeTransaction } from "../finance/finance-tx";
import { nextFinanceSequence } from "../finance/suppliers.service";
import { recordFinancialEvent } from "../finance/events.service";
import { divRound } from "../finance/costing.service";
import { MANUFACTURING_EVENT_TYPES, type ProductionGoodsReceivedPayload } from "../finance/manufacturing-posting-rules";
import { lockProductionOrder, moNumber, plannedCostMinor } from "./production-orders.service";

export const prNumber = (n: number) => `PR-${String(n).padStart(6, "0")}`;
const RECEIVABLE = ["APPROVED", "IN_PRODUCTION", "PARTIALLY_RECEIVED", "RECEIVED"];
const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);

export interface ReceiptLineInput { orderLineId: string; delivered: number; accepted: number; rejected?: number; rework?: number; rejectReason?: string | null }

const RECEIPT_INCLUDE = { lines: { orderBy: { createdAt: "asc" }, include: { variant: { select: { sku: true, size: true, color: true } } } } } satisfies Prisma.ProductionReceiptInclude;
type ReceiptRow = Prisma.ProductionReceiptGetPayload<{ include: typeof RECEIPT_INCLUDE }>;

export function receiptDto(r: ReceiptRow, cur: string, opts: { canSeeCost: boolean }) {
  return {
    id: r.id,
    number: prNumber(r.number),
    status: r.status,
    receiptDate: businessDateOf(r.receiptDate),
    deliveryRef: r.deliveryRef,
    inspectionNotes: r.inspectionNotes,
    evidence: r.evidence,
    overReceiptReason: r.overReceiptReason,
    provisionalUnitCost: opts.canSeeCost && r.provisionalUnitCost !== null ? Number(r.provisionalUnitCost) : null,
    postedAt: r.postedAt,
    reversedAt: r.reversedAt,
    reversalReason: r.reversalReason,
    total: { delivered: r.lines.reduce((n, l) => n + l.delivered, 0), accepted: r.lines.reduce((n, l) => n + l.accepted, 0), rejected: r.lines.reduce((n, l) => n + l.rejected, 0), rework: r.lines.reduce((n, l) => n + l.rework, 0) },
    value: opts.canSeeCost && r.lines.every((l) => l.value !== null) ? toMajorNumber(r.lines.reduce((s, l) => s + toMinor(l.value!, cur), 0), cur) : null,
    lines: r.lines.map((l) => ({ id: l.id, orderLineId: l.orderLineId, sku: l.variant.sku, size: l.variant.size, color: l.variant.color, delivered: l.delivered, accepted: l.accepted, rejected: l.rejected, rework: l.rework, rejectReason: l.rejectReason, value: opts.canSeeCost && l.value !== null ? toMajorNumber(toMinor(l.value, cur), cur) : null })),
  };
}

async function lockReceipt(tx: AppTransactionClient, businessId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; orderId: string }>>`
    SELECT r.id, r."productionOrderId" AS "orderId" FROM "ProductionReceipt" r JOIN "ProductionOrder" o ON o.id = r."productionOrderId"
    WHERE r.id = ${id} AND o."businessId" = ${businessId} FOR UPDATE OF r`;
  if (!rows.length) throw financeError(404, "PRODUCTION_RECEIPT_NOT_FOUND", "Production receipt not found");
  return tx.productionReceipt.findUniqueOrThrow({ where: { id }, include: RECEIPT_INCLUDE });
}

/** A DRAFT receipt (inspection recorded; nothing moves yet). */
export async function createProductionReceipt(orderId: string, input: { receiptDate?: string; deliveryRef?: string | null; inspectionNotes?: string | null; evidence?: string | null; lines: ReceiptLineInput[] }, actor: FinanceActor, opts: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const receiptDate = input.receiptDate ?? businessToday(business);
  if (receiptDate > businessToday(business)) throw financeError(400, "RECEIPT_IN_FUTURE", "A receipt records goods already delivered");
  if (business.openingDate && receiptDate < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
  return financeTransaction(async (tx) => {
    const o = await lockProductionOrder(tx, business.id, orderId);
    if (!RECEIVABLE.includes(o.status)) throw financeError(409, "MO_NOT_RECEIVABLE", `Deliveries are recorded on an approved, open order (this one is ${o.status.toLowerCase().replace("_", " ")})`);
    if (!input.lines.length) throw financeError(400, "RECEIPT_EMPTY", "Record at least one size / colour");
    const seen = new Set<string>();
    const rows = input.lines.map((l, i) => {
      const ol = o.lines.find((x) => x.id === l.orderLineId);
      if (!ol) throw financeError(400, "RECEIPT_LINE_NOT_ON_ORDER", `Line ${i + 1}: not a variant of ${moNumber(o.number)}`);
      if (seen.has(ol.id)) throw financeError(400, "RECEIPT_LINE_TWICE", `Line ${i + 1}: each variant once per receipt`);
      seen.add(ol.id);
      const rejected = l.rejected ?? 0;
      const rework = l.rework ?? 0;
      if (![l.delivered, l.accepted, rejected, rework].every((n) => Number.isSafeInteger(n) && n >= 0) || l.delivered === 0) throw financeError(400, "RECEIPT_QTY", `Line ${i + 1}: whole numbers; something delivered`);
      if (l.delivered !== l.accepted + rejected + rework) throw financeError(400, "RECEIPT_RECONCILE", `Line ${i + 1}: delivered (${l.delivered}) must equal accepted + rejected + rework (${l.accepted + rejected + rework})`);
      if (rejected > 0 && !l.rejectReason?.trim()) throw financeError(400, "REJECT_REASON", `Line ${i + 1}: say why units were rejected`);
      return { orderLineId: ol.id, variantId: ol.variantId, delivered: l.delivered, accepted: l.accepted, rejected, rework, rejectReason: l.rejectReason?.trim() || null };
    });
    const created = await tx.productionReceipt.create({
      data: {
        productionOrderId: o.id, number: await nextFinanceSequence(tx, business.id, "production_receipt"), receiptDate: dateColumn(receiptDate),
        deliveryRef: input.deliveryRef ?? null, inspectionNotes: input.inspectionNotes ?? null, evidence: input.evidence ?? null, createdByAdminId: adminOf(actor),
        lines: { createMany: { data: rows } },
      },
      include: RECEIPT_INCLUDE,
    });
    const dto = receiptDto(created, cur, { canSeeCost: true });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_receipt.create", entityType: "ProductionReceipt", entityId: created.id, after: dto, sourceRef: moNumber(o.number) });
    return receiptDto(created, cur, opts);
  });
}

export async function deleteDraftProductionReceipt(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const r = await lockReceipt(tx, business.id, id);
    if (r.status !== "DRAFT") throw financeError(409, "RECEIPT_NOT_DRAFT", "A posted receipt is never deleted — reverse it");
    await tx.productionReceiptLine.deleteMany({ where: { receiptId: id } });
    await tx.productionReceipt.delete({ where: { id } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_receipt.delete_draft", entityType: "ProductionReceipt", entityId: id, before: receiptDto(r, business.baseCurrency, { canSeeCost: true }) });
  });
}

/** Actual cost to date of an order (minor): material issued − returned + approved production costs. */
async function actualToDateMinor(tx: AppTransactionClient, orderId: string, cur: string) {
  const [m] = await tx.$queryRaw<Array<{ v: Prisma.Decimal }>>`SELECT COALESCE(SUM(CASE WHEN kind = 'ISSUE' THEN value ELSE -value END), 0) AS v FROM "ProductionMaterialMove" WHERE "productionOrderId" = ${orderId}`;
  const [c] = await tx.$queryRaw<Array<{ v: Prisma.Decimal }>>`SELECT COALESCE(SUM(amount), 0) AS v FROM "ProductionCostEntry" WHERE "productionOrderId" = ${orderId} AND status = 'APPROVED'`;
  return toMinor(m!.v, cur) + toMinor(c!.v, cur);
}

/** The order's status from its lines' accepted quantities (after a receipt posts or reverses). Audited when it changes. */
async function refreshReceiptStatus(tx: AppTransactionClient, businessId: string, orderId: string, actor: FinanceActor, cause: string) {
  const o = await tx.productionOrder.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, lines: { select: { plannedQty: true, acceptedQty: true } } } });
  if (o.status === "CLOSED" || o.status === "CANCELLED") return;
  const accepted = o.lines.reduce((n, l) => n + l.acceptedQty, 0);
  const next = accepted === 0 ? "IN_PRODUCTION" : o.lines.every((l) => l.acceptedQty >= l.plannedQty) ? "RECEIVED" : "PARTIALLY_RECEIVED";
  if (next === o.status) return;
  await tx.productionOrder.update({ where: { id: orderId }, data: { status: next, ...(o.status === "APPROVED" ? { startedAt: new Date() } : {}) } });
  await recordFinanceAudit(tx, { businessId, actor, action: "production_order.receiving_status", entityType: "ProductionOrder", entityId: orderId, before: { status: o.status }, after: { status: next }, sourceRef: cause });
}

/** Posts a draft receipt (see the file header). Idempotent: a posted receipt is returned as it is. */
export async function postProductionReceipt(id: string, input: { overReceiptReason?: string | null }, actor: FinanceActor, opts: { canSeeCost: boolean }) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  const result = await financeTransaction(async (tx) => {
    const r = await lockReceipt(tx, business.id, id);
    if (r.status !== "DRAFT") return { receipt: receiptDto(r, cur, opts), replayed: true, replenished: [] as string[] };
    const o = await lockProductionOrder(tx, business.id, r.productionOrderId);
    if (!RECEIVABLE.includes(o.status)) throw financeError(409, "MO_NOT_RECEIVABLE", `The order is ${o.status.toLowerCase().replace("_", " ")} — it takes no deliveries`);
    const biz = await tx.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { inventoryCostingActivatedAt: true } });
    if (!biz.inventoryCostingActivatedAt) throw financeError(409, "COSTING_NOT_ACTIVE", "Finished goods are received once inventory costing is active — run the valuation cutover first");
    const update: Prisma.ProductionReceiptUpdateInput = { status: "POSTED", postedAt: new Date(), postedByAdminId: adminOf(actor) };
    const over = r.lines.filter((l) => { const ol = o.lines.find((x) => x.id === l.orderLineId)!; return ol.acceptedQty + l.accepted > ol.plannedQty; });
    if (over.length) {
      if (!actorCan(actor, "manufacturing.approve") || !input.overReceiptReason?.trim()) throw financeError(409, "OVER_RECEIPT", `${over.map((l) => l.variant.sku).join(", ")}: more accepted than planned — an approver must confirm it with a reason`);
      update.overReceiptReason = input.overReceiptReason.trim();
    }
    // The provisional unit cost — the order's best cost estimate per planned unit.
    const plannedUnits = o.lines.reduce((n, l) => n + l.plannedQty, 0);
    const plan = plannedCostMinor(o, cur);
    const actual = await actualToDateMinor(tx, o.id, cur);
    const estimate = plan.complete ? Math.max(actual, plan.totalMinor) : actual;
    const unitMinor = plannedUnits ? Number(divRound(BigInt(estimate), BigInt(plannedUnits))) : 0;
    const accepted = r.lines.filter((l) => l.accepted > 0);
    if (accepted.length && unitMinor === 0) {
      throw financeError(409, "PROVISIONAL_COST_UNKNOWN", "No cost is known for this order yet — issue its materials, approve its costs or plan them before receiving finished goods (goods never enter stock at zero cost)");
    }
    const moved = accepted.length
      ? await recordDocumentMovements(tx, accepted.map((l) => ({ variantId: l.variantId, change: l.accepted, reason: "PRODUCTION_RECEIPT" as const, basis: { kind: "DOCUMENT" as const, valueMinor: l.accepted * unitMinor, status: "ESTIMATED" as const } })), { adminId: adminOf(actor), note: `${prNumber(r.number)} from ${moNumber(o.number)}` })
      : { lines: [], replenished: [] };
    for (const l of r.lines) {
      const i = accepted.indexOf(l);
      await tx.productionReceiptLine.update({ where: { id: l.id }, data: { unitCost: toDecimal(unitMinor, cur), value: toDecimal(l.accepted * unitMinor, cur), stockMovementId: i >= 0 ? moved.lines[i]!.movement.id : null } });
    }
    const valueMinor = accepted.reduce((s, l) => s + l.accepted * unitMinor, 0);
    await recordFinancialEvent(tx, {
      contract: "finance.event", contractVersion: 1, businessKey: business.key, brandKey: brand.key,
      source: { installId, system: "manufacturing", entityType: "ProductionReceipt", entityId: r.id },
      event: { type: MANUFACTURING_EVENT_TYPES.goodsReceived, version: 1, key: `mfg-rcpt:${r.id}#r0`, occurredAt: new Date().toISOString() },
      financialDate: businessDateOf(r.receiptDate), currency: cur,
      payload: { receiptId: r.id, productionOrderId: o.id, receiptNumber: prNumber(r.number), orderNumber: moNumber(o.number), valueMinor, void: false, supersedes: null } satisfies ProductionGoodsReceivedPayload,
    });
    await tx.productionReceipt.update({ where: { id: r.id }, data: { ...update, provisionalUnitCost: toMajorNumber(unitMinor, cur).toFixed(6) } });
    await refreshReceiptStatus(tx, business.id, o.id, actor, prNumber(r.number));
    const after = await tx.productionReceipt.findUniqueOrThrow({ where: { id: r.id }, include: RECEIPT_INCLUDE });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_receipt.post", entityType: "ProductionReceipt", entityId: r.id, before: { status: r.status }, after: { status: after.status, valueMinor, unitMinor, overReceiptReason: after.overReceiptReason } });
    return { receipt: receiptDto(after, cur, opts), replayed: false, replenished: moved.replenished };
  });
  if (result.replenished.length) notifyReplenished(result.replenished);
  return { receipt: result.receipt, replayed: result.replayed };
}

/** Reverses a posted receipt: accepted units out at its own unit cost, its journal reversed, the order's status follows. */
export async function reverseProductionReceipt(id: string, reason: string, actor: FinanceActor, opts: { canSeeCost: boolean }) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const r = await lockReceipt(tx, business.id, id);
    if (r.status === "REVERSED") return { receipt: receiptDto(r, cur, opts), replayed: true };
    if (r.status !== "POSTED") throw financeError(409, "RECEIPT_NOT_POSTED", "Only a posted receipt is reversed — delete a draft");
    if (!actorCan(actor, "manufacturing.approve")) throw financeError(403, "FORBIDDEN", "Reversing a production receipt needs manufacturing.approve");
    const o = await lockProductionOrder(tx, business.id, r.productionOrderId);
    if (!RECEIVABLE.includes(o.status)) throw financeError(409, "MO_NOT_OPEN", "The order is closed — corrections are made at close");
    const accepted = r.lines.filter((l) => l.accepted > 0);
    if (accepted.length) {
      const moved = await recordDocumentMovements(tx, accepted.map((l) => ({ variantId: l.variantId, change: -l.accepted, reason: "PRODUCTION_RECEIPT" as const, basis: { kind: "SNAPSHOT" as const, unitCostMinor: toMinor(l.unitCost!, cur) } })), { adminId: adminOf(actor), note: `${prNumber(r.number)} reversed: ${reason}` });
      for (const [i, l] of accepted.entries()) await tx.productionReceiptLine.update({ where: { id: l.id }, data: { reversalMovementId: moved.lines[i]!.movement.id } });
    }
    const original = await tx.financialEvent.findUnique({ where: { sourceInstallId_eventKey: { sourceInstallId: installId, eventKey: `mfg-rcpt:${r.id}#r0` } } });
    await recordFinancialEvent(tx, {
      contract: "finance.event", contractVersion: 1, businessKey: business.key, brandKey: brand.key,
      source: { installId, system: "manufacturing", entityType: "ProductionReceipt", entityId: r.id },
      event: { type: MANUFACTURING_EVENT_TYPES.goodsReceived, version: 1, key: `mfg-rcpt:${r.id}#r1`, occurredAt: new Date().toISOString() },
      financialDate: businessToday(business), currency: cur,
      payload: { receiptId: r.id, productionOrderId: o.id, receiptNumber: prNumber(r.number), orderNumber: moNumber(o.number), valueMinor: 0, void: true, supersedes: original?.id ?? null } satisfies ProductionGoodsReceivedPayload,
    });
    await tx.productionReceipt.update({ where: { id: r.id }, data: { status: "REVERSED", reversedAt: new Date(), reversedByAdminId: adminOf(actor), reversalReason: reason } });
    await refreshReceiptStatus(tx, business.id, o.id, actor, `${prNumber(r.number)} reversed`);
    const after = await tx.productionReceipt.findUniqueOrThrow({ where: { id: r.id }, include: RECEIPT_INCLUDE });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "production_receipt.reverse", entityType: "ProductionReceipt", entityId: r.id, reason, before: { status: r.status }, after: { status: after.status } });
    return { receipt: receiptDto(after, cur, opts), replayed: false };
  });
}

export async function listProductionReceipts(orderId: string, opts: { canSeeCost: boolean }) {
  const { business } = await getFinanceContext();
  const rows = await prisma.productionReceipt.findMany({ where: { productionOrderId: orderId, productionOrder: { businessId: business.id } }, include: RECEIPT_INCLUDE, orderBy: { number: "asc" } });
  return { receipts: rows.map((r) => receiptDto(r, business.baseCurrency, opts)) };
}
