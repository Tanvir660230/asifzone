/**
 * Goods receipts (Financial Core Phase 4D, docs/FINANCE_PHASE_4D.md). Physical stock and its value enter together, when
 * the receipt posts, in ONE transaction:
 *   inventory.service.recordDocumentMovements (PURCHASE_RECEIPT movements, quantity) → costing.service (valuation, DOCUMENT
 *   value) → recordFinancialEvent purchasing.goods_received (Dr inventory / Cr GRNI, exactly once) → receipt POSTED (the
 *   database derives the order lines' received quantities) → the order's receiving status.
 *
 * - Only accepted units become stock; rejected units are recorded on the receipt and the order, with no value.
 * - Unit cost = the order line's net price plus the non-recoverable part of its tax; a receipt without an order (locked
 *   decision 2) carries an entered cost, a reason and an approver holding purchasing.approve, and evidence.
 * - Receiving beyond the order (over the business's tolerance) needs purchasing.approve and a reason.
 * - Stock documents need inventory costing (decision D-P1): until the valuation cutover, receipts can be drafted, not posted.
 * - Reversal: the units leave again at the receipt's own unit cost, and the receipt's journal is reversed (a void revision
 *   of its event). Units already sold or returned can't be "unreceived" — that is a supplier return.
 */
import type { GoodsReceiptStatus, Prisma } from "@prisma/client";
import type { GoodsReceiptCreateInput } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { installId } from "../../config/installation";
import { notifyReplenished, notifyStockMoved, recordDocumentMovements } from "../../modules/inventory/inventory.service";
import { actorCan, recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { nextFinanceSequence } from "./suppliers.service";
import { recordFinancialEvent } from "./events.service";
import { PURCHASING_EVENT_TYPES, type GoodsReceivedPayload } from "./purchasing-posting-rules";
import { adminOf, docNumber, lockPurchaseOrder, refreshReceivingStatus, unitCostWithTax } from "./purchase-orders.service";
import { findDuplicateReceipts, type DuplicateWarning } from "../stock/duplicate-purchase";

const GRN_INCLUDE = {
  supplier: { select: { id: true, code: true, displayName: true } },
  purchaseOrder: { select: { id: true, number: true, status: true } },
  lines: { orderBy: { lineNo: "asc" }, include: { variant: { select: { sku: true, size: true, color: true, product: { select: { name: true } } } } } },
} satisfies Prisma.GoodsReceiptInclude;
type GrnRow = Prisma.GoodsReceiptGetPayload<{ include: typeof GRN_INCLUDE }>;

export function goodsReceiptDto(r: GrnRow, cur: string) {
  return {
    id: r.id,
    number: docNumber("GRN", r.number),
    status: r.status,
    supplier: r.supplier,
    purchaseOrder: r.purchaseOrder ? { id: r.purchaseOrder.id, number: docNumber("PO", r.purchaseOrder.number), status: r.purchaseOrder.status } : null,
    receiptDate: businessDateOf(r.receiptDate),
    supplierRef: r.supplierRef,
    notes: r.notes,
    evidence: r.evidence,
    direct: !r.purchaseOrderId,
    directReason: r.directReason,
    overReceiptReason: r.overReceiptReason,
    duplicateWarning: (r.duplicateWarning as DuplicateWarning | null) ?? null,
    duplicateReason: r.duplicateReason,
    postedAt: r.postedAt,
    reversedAt: r.reversedAt,
    reversalReason: r.reversalReason,
    createdAt: r.createdAt,
    total: toMajorNumber(r.lines.reduce((s, l) => s + toMinor(l.value, cur), 0), cur),
    lines: r.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      purchaseOrderLineId: l.purchaseOrderLineId,
      variantId: l.variantId,
      sku: l.variant.sku,
      name: `${l.variant.product.name} — ${l.variant.size} / ${l.variant.color}`,
      qtyAccepted: l.qtyAccepted,
      qtyRejected: l.qtyRejected,
      unitCost: toMajorNumber(toMinor(l.unitCost, cur), cur),
      value: toMajorNumber(toMinor(l.value, cur), cur),
      stockMovementId: l.stockMovementId,
    })),
  };
}

async function load(db: AppTransactionClient | typeof prisma, businessId: string, id: string) {
  const r = await db.goodsReceipt.findFirst({ where: { id, businessId }, include: GRN_INCLUDE });
  if (!r) throw financeError(404, "GOODS_RECEIPT_NOT_FOUND", "Goods receipt not found");
  return r;
}

async function lockReceipt(tx: AppTransactionClient, businessId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "GoodsReceipt" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
  if (!rows.length) throw financeError(404, "GOODS_RECEIPT_NOT_FOUND", "Goods receipt not found");
  return load(tx, businessId, id);
}

/** A DRAFT receipt: against an approved order's open stock lines, or (direct) with entered variants and costs. */
export async function createGoodsReceipt(input: GoodsReceiptCreateInput, actor: FinanceActor) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  const receiptDate = input.receiptDate ?? businessToday(business);
  if (business.openingDate && receiptDate < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
  if (receiptDate > businessToday(business)) throw financeError(400, "RECEIPT_IN_FUTURE", "A receipt records goods already received");
  return financeTransaction(async (tx) => {
    let supplierId: string;
    let rows: Array<Omit<Prisma.GoodsReceiptLineCreateManyInput, "goodsReceiptId">>;
    if (input.purchaseOrderId) {
      const po = await lockPurchaseOrder(tx, business.id, input.purchaseOrderId);
      if (!["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(po.status)) throw financeError(409, "PO_NOT_RECEIVABLE", `Goods are received only on an approved order (this one is ${po.status.toLowerCase().replace("_", " ")})`);
      if (input.supplierId && input.supplierId !== po.supplierId) throw financeError(400, "RECEIPT_SUPPLIER", "The receipt's supplier is the order's supplier");
      supplierId = po.supplierId;
      const byId = new Map(po.lines.map((l) => [l.id, l]));
      const seen = new Set<string>();
      rows = input.lines.map((l, i) => {
        const pol = l.purchaseOrderLineId ? byId.get(l.purchaseOrderLineId) : undefined;
        if (!pol) throw financeError(400, "RECEIPT_LINE_NOT_ON_ORDER", `Line ${i + 1}: not a line of ${docNumber("PO", po.number)}`);
        if (pol.lineType !== "STOCK") throw financeError(400, "RECEIPT_NON_STOCK", `Line ${i + 1}: services and expenses are invoiced, not received`);
        if (seen.has(pol.id)) throw financeError(400, "RECEIPT_LINE_TWICE", `Line ${i + 1}: an order line appears once per receipt`);
        seen.add(pol.id);
        if (l.unitCost != null) throw financeError(400, "RECEIPT_COST_FROM_ORDER", `Line ${i + 1}: the cost of an ordered line comes from the order`);
        const unit = unitCostWithTax(toMinor(pol.unitPrice, cur), pol.taxCode ? { rate: pol.taxCode.rate, recoverablePct: pol.taxCode.recoverablePct } : null);
        return { lineNo: i + 1, purchaseOrderLineId: pol.id, variantId: pol.variantId!, qtyAccepted: l.qtyAccepted, qtyRejected: l.qtyRejected, unitCost: toDecimal(unit, cur), value: toDecimal(unit * l.qtyAccepted, cur) };
      });
    } else {
      const s = await tx.supplier.findFirst({ where: { id: input.supplierId!, businessId: business.id } });
      if (!s) throw financeError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
      if (s.status === "INACTIVE") throw financeError(409, "SUPPLIER_NOT_ACTIVE", `${s.displayName} is inactive`);
      supplierId = s.id;
      const variants = await tx.productVariant.findMany({ where: { id: { in: input.lines.map((l) => l.variantId!) } }, select: { id: true, sku: true, product: { select: { trackInventory: true } } } });
      const byId = new Map(variants.map((v) => [v.id, v]));
      rows = input.lines.map((l, i) => {
        const v = byId.get(l.variantId!);
        if (!v) throw financeError(400, "VARIANT_NOT_FOUND", `Line ${i + 1}: variant not found`);
        if (!v.product.trackInventory) throw financeError(400, "PURCHASE_UNTRACKED", `Line ${i + 1}: ${v.sku} isn't stock-tracked — purchased goods must be`);
        if (l.unitCost == null) throw financeError(400, "RECEIPT_COST_REQUIRED", `Line ${i + 1}: a receipt without an order states the actual unit cost`);
        const unit = toMinor(l.unitCost, cur);
        return { lineNo: i + 1, variantId: v.id, qtyAccepted: l.qtyAccepted, qtyRejected: l.qtyRejected, unitCost: toDecimal(unit, cur), value: toDecimal(unit * l.qtyAccepted, cur) };
      });
    }
    // Blueprint P0.3: does this look like a purchase already entered? Stored as a warning; never refuses.
    const matches = await findDuplicateReceipts(tx, {
      businessId: business.id,
      supplierId,
      currency: cur,
      shape: { date: receiptDate, variantIds: rows.map((r) => r.variantId), totalMinor: rows.reduce((s, r) => s + toMinor(r.value as Prisma.Decimal, cur), 0) },
    });
    const duplicateWarning: DuplicateWarning | null = matches.length ? { matches, checkedAt: new Date().toISOString() } : null;
    const created = await tx.goodsReceipt.create({
      data: {
        businessId: business.id, brandId: brand.id, supplierId, purchaseOrderId: input.purchaseOrderId ?? null,
        number: await nextFinanceSequence(tx, business.id, "goods_receipt"), receiptDate: dateColumn(receiptDate),
        supplierRef: input.supplierRef ?? null, notes: input.notes ?? null, evidence: input.evidence ?? null,
        directReason: input.purchaseOrderId ? null : input.directReason ?? null, createdByAdminId: adminOf(actor),
        duplicateWarning: duplicateWarning ? (duplicateWarning as unknown as Prisma.InputJsonValue) : undefined,
        duplicateReason: duplicateWarning ? input.duplicateReason ?? null : null,
        lines: { createMany: { data: rows } },
      },
      include: GRN_INCLUDE,
    });
    const dto = goodsReceiptDto(created, cur);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "goods_receipt.create", entityType: "GoodsReceipt", entityId: created.id, after: dto });
    return dto;
  });
}

export async function deleteDraftGoodsReceipt(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const r = await lockReceipt(tx, business.id, id);
    if (r.status !== "DRAFT") throw financeError(409, "RECEIPT_NOT_DRAFT", "A posted receipt is never deleted — reverse it");
    await tx.goodsReceiptLine.deleteMany({ where: { goodsReceiptId: id } });
    await tx.goodsReceipt.delete({ where: { id } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "goods_receipt.delete_draft", entityType: "GoodsReceipt", entityId: id, before: goodsReceiptDto(r, business.baseCurrency) });
  });
}

/** Posts a draft receipt (see the file header). Idempotent: a posted receipt is returned as it is (`replayed`). */
export async function postGoodsReceipt(id: string, input: { overReceiptReason?: string | null }, actor: FinanceActor) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  const result = await financeTransaction(async (tx) => {
    const r = await lockReceipt(tx, business.id, id);
    if (r.status !== "DRAFT") return { receipt: goodsReceiptDto(r, cur), replayed: true, replenished: [] as string[] };
    const biz = await tx.financeBusiness.findUniqueOrThrow({ where: { id: business.id } });
    if (!biz.inventoryCostingActivatedAt) throw financeError(409, "COSTING_NOT_ACTIVE", "Goods receipts post once inventory costing is active — run the valuation cutover first (Finance → Valuation cutover)");
    const update: Prisma.GoodsReceiptUpdateInput = { status: "POSTED", postedAt: new Date(), postedByAdminId: adminOf(actor) };

    if (r.purchaseOrderId) {
      const po = await lockPurchaseOrder(tx, business.id, r.purchaseOrderId);
      if (!["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(po.status)) throw financeError(409, "PO_NOT_RECEIVABLE", `The order is ${po.status.toLowerCase().replace("_", " ")} — it takes no receipts`);
      const tolerance = Number(biz.overReceiptTolerancePct);
      const over = r.lines.filter((l) => {
        const pol = po.lines.find((x) => x.id === l.purchaseOrderLineId)!;
        return (pol.qtyReceived + l.qtyAccepted) * 100 > pol.qtyOrdered * (100 + tolerance);
      });
      if (over.length) {
        if (!actorCan(actor, "purchasing.approve") || !input.overReceiptReason?.trim()) {
          throw financeError(409, "OVER_RECEIPT", `${over.length} line(s) receive more than ordered${tolerance ? ` (beyond the ${tolerance}% tolerance)` : ""} — an approver must confirm it with a reason`, { lines: over.map((l) => l.lineNo) });
        }
        update.overReceiptReason = input.overReceiptReason.trim();
      }
    } else {
      if (!actorCan(actor, "purchasing.approve")) throw financeError(403, "DIRECT_RECEIPT_APPROVAL", "A receipt without a purchase order is posted by an approver (purchasing.approve)");
      if (!r.directReason) throw financeError(409, "DIRECT_RECEIPT_REASON", "A receipt without a purchase order needs its reason");
      update.directApprovedByAdminId = adminOf(actor);
    }

    // Stock and value in — one movement per accepted line, valued at the receipt's cost (inventory.service → costing).
    const accepted = r.lines.filter((l) => l.qtyAccepted > 0);
    const moved = accepted.length
      ? await recordDocumentMovements(tx, accepted.map((l) => ({ variantId: l.variantId, change: l.qtyAccepted, reason: "PURCHASE_RECEIPT" as const, basis: { kind: "DOCUMENT" as const, valueMinor: toMinor(l.value, cur) } })), { adminId: adminOf(actor), note: docNumber("GRN", r.number) })
      : { lines: [], replenished: [] };
    for (const [i, l] of accepted.entries()) await tx.goodsReceiptLine.update({ where: { id: l.id }, data: { stockMovementId: moved.lines[i]!.movement.id } });
    const valueMinor = moved.lines.reduce((s, x) => s + Number(x.valuation.figures.bookValue), 0);

    await recordFinancialEvent(tx, {
      contract: "finance.event", contractVersion: 1, businessKey: business.key, brandKey: brand.key,
      source: { installId, system: "purchasing", entityType: "GoodsReceipt", entityId: r.id },
      event: { type: PURCHASING_EVENT_TYPES.received, version: 1, key: `grn:${r.id}#r0`, occurredAt: new Date().toISOString() },
      financialDate: businessDateOf(r.receiptDate), currency: cur,
      payload: { receiptId: r.id, number: docNumber("GRN", r.number), supplierId: r.supplierId, valueMinor, void: false, supersedes: null } satisfies GoodsReceivedPayload,
    });
    await tx.goodsReceipt.update({ where: { id: r.id }, data: update }); // the database adds the received quantities to the order lines
    if (r.purchaseOrderId) await refreshReceivingStatus(tx, business.id, r.purchaseOrderId, actor, docNumber("GRN", r.number));
    const after = await load(tx, business.id, r.id);
    const dto = goodsReceiptDto(after, cur);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "goods_receipt.post", entityType: "GoodsReceipt", entityId: r.id, before: { status: r.status }, after: { status: after.status, total: dto.total, overReceiptReason: after.overReceiptReason, direct: dto.direct } });
    return { receipt: dto, replayed: false, replenished: moved.replenished, moved: accepted.map((l) => l.variantId) };
  });
  if (result.replenished.length) notifyReplenished(result.replenished);
  notifyStockMoved(result.moved ?? []);
  return { receipt: result.receipt, replayed: result.replayed };
}

/** Reverses a posted receipt: units out at the receipt's own cost, its journal reversed. Refused once any of its units were
 * returned to the supplier (use the return) or when the stock is no longer there (sold — use a supplier return). */
export async function reverseGoodsReceipt(id: string, reason: string, actor: FinanceActor) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  let movedIds: string[] = [];
  const result = await financeTransaction(async (tx) => {
    const r = await lockReceipt(tx, business.id, id);
    if (r.status === "REVERSED") return { receipt: goodsReceiptDto(r, cur), replayed: true };
    if (r.status !== "POSTED") throw financeError(409, "RECEIPT_NOT_POSTED", "Only a posted receipt can be reversed — delete a draft");
    const returned = await tx.purchaseReturnLine.count({ where: { goodsReceiptLineId: { in: r.lines.map((l) => l.id) }, purchaseReturn: { status: { in: ["APPROVED", "SHIPPED"] } } } });
    if (returned) throw financeError(409, "RECEIPT_HAS_RETURNS", "Units of this receipt are on a supplier return — it can't be reversed");
    const invoiced = await tx.supplierInvoiceLine.count({ where: { goodsReceiptLineId: { in: r.lines.map((l) => l.id) }, invoice: { status: { in: ["DRAFT", "POSTED"] } } } });
    if (invoiced) throw financeError(409, "RECEIPT_INVOICED", "This receipt is on a supplier invoice — void (or delete the draft of) the invoice first");
    if (r.purchaseOrderId) await lockPurchaseOrder(tx, business.id, r.purchaseOrderId);
    const accepted = r.lines.filter((l) => l.qtyAccepted > 0);
    if (accepted.length) {
      const moved = await recordDocumentMovements(tx, accepted.map((l) => ({ variantId: l.variantId, change: -l.qtyAccepted, reason: "PURCHASE_RETURN" as const, basis: { kind: "SNAPSHOT" as const, unitCostMinor: toMinor(l.unitCost, cur) } })), { adminId: adminOf(actor), note: `${docNumber("GRN", r.number)} reversed: ${reason}` });
      for (const [i, l] of accepted.entries()) await tx.goodsReceiptLine.update({ where: { id: l.id }, data: { reversalMovementId: moved.lines[i]!.movement.id } });
      movedIds = accepted.map((l) => l.variantId);
    }
    const original = await tx.financialEvent.findUnique({ where: { sourceInstallId_eventKey: { sourceInstallId: installId, eventKey: `grn:${r.id}#r0` } } });
    await recordFinancialEvent(tx, {
      contract: "finance.event", contractVersion: 1, businessKey: business.key, brandKey: brand.key,
      source: { installId, system: "purchasing", entityType: "GoodsReceipt", entityId: r.id },
      event: { type: PURCHASING_EVENT_TYPES.received, version: 1, key: `grn:${r.id}#r1`, occurredAt: new Date().toISOString() },
      financialDate: businessToday(business), currency: cur,
      payload: { receiptId: r.id, number: docNumber("GRN", r.number), supplierId: r.supplierId, valueMinor: 0, void: true, supersedes: original?.id ?? null } satisfies GoodsReceivedPayload,
    });
    await tx.goodsReceipt.update({ where: { id: r.id }, data: { status: "REVERSED", reversedAt: new Date(), reversedByAdminId: adminOf(actor), reversalReason: reason } });
    if (r.purchaseOrderId) await refreshReceivingStatus(tx, business.id, r.purchaseOrderId, actor, docNumber("GRN", r.number));
    const after = await load(tx, business.id, r.id);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "goods_receipt.reverse", entityType: "GoodsReceipt", entityId: r.id, reason, before: { status: r.status }, after: { status: after.status } });
    return { receipt: goodsReceiptDto(after, cur), replayed: false };
  });
  notifyStockMoved(movedIds);
  return result;
}

export async function getGoodsReceipt(id: string) {
  const { business } = await getFinanceContext();
  return goodsReceiptDto(await load(prisma, business.id, id), business.baseCurrency);
}

export async function listGoodsReceipts(q: { status?: GoodsReceiptStatus; purchaseOrderId?: string; supplierId?: string; page: number; pageSize: number }) {
  const { business } = await getFinanceContext();
  const where: Prisma.GoodsReceiptWhereInput = { businessId: business.id, status: q.status, purchaseOrderId: q.purchaseOrderId, supplierId: q.supplierId };
  const [total, rows] = await Promise.all([
    prisma.goodsReceipt.count({ where }),
    prisma.goodsReceipt.findMany({ where, include: GRN_INCLUDE, orderBy: { number: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, goodsReceipts: rows.map((r) => goodsReceiptDto(r, business.baseCurrency)) };
}
