/**
 * Supplier returns (Financial Core Phase 4D, docs/FINANCE_PHASE_4D.md; locked decision 16 — returns go out at the recorded
 * cost). DRAFT → APPROVED (purchasing.approve) → SHIPPED (purchasing.receive): the units leave through inventory.service
 * as PURCHASE_RETURN movements, valued by the costing engine at the running average, and the return posts
 * Dr 2115 (returned, not yet credited) / Cr inventory for exactly the value that left. How the supplier settles it — credit
 * note, replacement or refund — is Phase 4E/4F. A line may name the receipt it returns (never more than that receipt
 * accepted, net of what was returned before).
 */
import type { Prisma, PurchaseReturnStatus } from "@prisma/client";
import type { PurchaseReturnCreateInput } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { installId } from "../../config/installation";
import { recordDocumentMovements } from "../../modules/inventory/inventory.service";
import { actorCan, recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { nextFinanceSequence } from "./suppliers.service";
import { recordFinancialEvent } from "./events.service";
import { PURCHASING_EVENT_TYPES, type ReturnShippedPayload } from "./purchasing-posting-rules";
import { adminOf, docNumber } from "./purchase-orders.service";

const RET_INCLUDE = {
  supplier: { select: { id: true, code: true, displayName: true } },
  lines: { orderBy: { lineNo: "asc" }, include: { variant: { select: { sku: true, size: true, color: true, product: { select: { name: true } } } }, goodsReceiptLine: { select: { id: true, goodsReceipt: { select: { id: true, number: true } } } } } },
} satisfies Prisma.PurchaseReturnInclude;
type RetRow = Prisma.PurchaseReturnGetPayload<{ include: typeof RET_INCLUDE }>;

export function purchaseReturnDto(r: RetRow, cur: string) {
  return {
    id: r.id,
    number: docNumber("RTN", r.number),
    status: r.status,
    supplier: r.supplier,
    returnDate: businessDateOf(r.returnDate),
    reason: r.reason,
    notes: r.notes,
    approvedAt: r.approvedAt,
    shippedAt: r.shippedAt,
    cancelledReason: r.cancelledReason,
    createdAt: r.createdAt,
    total: r.lines.every((l) => l.value !== null) ? toMajorNumber(r.lines.reduce((s, l) => s + toMinor(l.value!, cur), 0), cur) : null,
    lines: r.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      variantId: l.variantId,
      sku: l.variant.sku,
      name: `${l.variant.product.name} — ${l.variant.size} / ${l.variant.color}`,
      quantity: l.quantity,
      goodsReceipt: l.goodsReceiptLine ? { id: l.goodsReceiptLine.goodsReceipt.id, number: docNumber("GRN", l.goodsReceiptLine.goodsReceipt.number) } : null,
      value: l.value === null ? null : toMajorNumber(toMinor(l.value, cur), cur),
    })),
  };
}

async function load(db: AppTransactionClient | typeof prisma, businessId: string, id: string) {
  const r = await db.purchaseReturn.findFirst({ where: { id, businessId }, include: RET_INCLUDE });
  if (!r) throw financeError(404, "PURCHASE_RETURN_NOT_FOUND", "Supplier return not found");
  return r;
}

async function lockReturn(tx: AppTransactionClient, businessId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "PurchaseReturn" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
  if (!rows.length) throw financeError(404, "PURCHASE_RETURN_NOT_FOUND", "Supplier return not found");
  return load(tx, businessId, id);
}

/** Returned units per receipt line must stay within what it accepted (net of other approved / shipped returns). */
async function checkAgainstReceipts(tx: AppTransactionClient, supplierId: string, lines: Array<{ goodsReceiptLineId: string | null; quantity: number }>, excludeReturnId: string | null) {
  const ids = [...new Set(lines.flatMap((l) => (l.goodsReceiptLineId ? [l.goodsReceiptLineId] : [])))];
  if (!ids.length) return;
  const grls = await tx.goodsReceiptLine.findMany({ where: { id: { in: ids } }, include: { goodsReceipt: { select: { status: true, supplierId: true, number: true } } } });
  const used = await tx.purchaseReturnLine.groupBy({ by: ["goodsReceiptLineId"], where: { goodsReceiptLineId: { in: ids }, purchaseReturn: { status: { in: ["APPROVED", "SHIPPED"] }, ...(excludeReturnId ? { id: { not: excludeReturnId } } : {}) } }, _sum: { quantity: true } });
  for (const id of ids) {
    const g = grls.find((x) => x.id === id);
    if (!g) throw financeError(400, "RECEIPT_LINE_NOT_FOUND", "A returned receipt line doesn't exist");
    if (g.goodsReceipt.status !== "POSTED") throw financeError(409, "RECEIPT_NOT_POSTED", `${docNumber("GRN", g.goodsReceipt.number)} isn't posted`);
    if (g.goodsReceipt.supplierId !== supplierId) throw financeError(400, "RETURN_SUPPLIER", `${docNumber("GRN", g.goodsReceipt.number)} is another supplier's receipt`);
    const wanted = lines.filter((l) => l.goodsReceiptLineId === id).reduce((n, l) => n + l.quantity, 0);
    const before = used.find((u) => u.goodsReceiptLineId === id)?._sum.quantity ?? 0;
    if (before + wanted > g.qtyAccepted) throw financeError(409, "RETURN_EXCEEDS_RECEIPT", `${docNumber("GRN", g.goodsReceipt.number)} line ${g.lineNo}: ${g.qtyAccepted} accepted, ${before} already returned`);
  }
}

export async function createPurchaseReturn(input: PurchaseReturnCreateInput, actor: FinanceActor) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  const returnDate = input.returnDate ?? businessToday(business);
  if (business.openingDate && returnDate < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
  return financeTransaction(async (tx) => {
    const s = await tx.supplier.findFirst({ where: { id: input.supplierId, businessId: business.id } });
    if (!s) throw financeError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
    const grls = await tx.goodsReceiptLine.findMany({ where: { id: { in: input.lines.flatMap((l) => (l.goodsReceiptLineId ? [l.goodsReceiptLineId] : [])) } }, select: { id: true, variantId: true } });
    const rows = input.lines.map((l, i) => {
      const g = l.goodsReceiptLineId ? grls.find((x) => x.id === l.goodsReceiptLineId) : null;
      if (l.goodsReceiptLineId && !g) throw financeError(400, "RECEIPT_LINE_NOT_FOUND", `Line ${i + 1}: receipt line not found`);
      if (g && l.variantId && l.variantId !== g.variantId) throw financeError(400, "RETURN_VARIANT", `Line ${i + 1}: the variant is the receipt line's`);
      return { lineNo: i + 1, goodsReceiptLineId: g?.id ?? null, variantId: g?.variantId ?? l.variantId!, quantity: l.quantity };
    });
    const variants = await tx.productVariant.findMany({ where: { id: { in: rows.map((r) => r.variantId) } }, select: { id: true, sku: true, product: { select: { trackInventory: true } } } });
    for (const r of rows) {
      const v = variants.find((x) => x.id === r.variantId);
      if (!v) throw financeError(400, "VARIANT_NOT_FOUND", `Line ${r.lineNo}: variant not found`);
      if (!v.product.trackInventory) throw financeError(400, "PURCHASE_UNTRACKED", `Line ${r.lineNo}: ${v.sku} isn't stock-tracked`);
    }
    await checkAgainstReceipts(tx, s.id, rows, null);
    const created = await tx.purchaseReturn.create({
      data: { businessId: business.id, brandId: brand.id, supplierId: s.id, number: await nextFinanceSequence(tx, business.id, "purchase_return"), returnDate: dateColumn(returnDate), reason: input.reason, notes: input.notes ?? null, createdByAdminId: adminOf(actor), lines: { createMany: { data: rows } } },
      include: RET_INCLUDE,
    });
    const dto = purchaseReturnDto(created, cur);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "purchase_return.create", entityType: "PurchaseReturn", entityId: created.id, after: dto });
    return dto;
  });
}

async function transition(id: string, actor: FinanceActor, action: string, apply: (r: RetRow, tx: AppTransactionClient) => Promise<Prisma.PurchaseReturnUpdateInput> | Prisma.PurchaseReturnUpdateInput, reason?: string | null) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const before = await lockReturn(tx, business.id, id);
    await tx.purchaseReturn.update({ where: { id }, data: await apply(before, tx) });
    const after = await load(tx, business.id, id);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action, entityType: "PurchaseReturn", entityId: id, before: { status: before.status }, after: { status: after.status }, reason: reason ?? null });
    return purchaseReturnDto(after, cur);
  });
}

const need = (r: RetRow, ...allowed: PurchaseReturnStatus[]) => {
  if (!allowed.includes(r.status)) throw financeError(409, "RETURN_STATUS", `The supplier return is ${r.status.toLowerCase()}`);
};

export const approvePurchaseReturn = (id: string, actor: FinanceActor) =>
  transition(id, actor, "purchase_return.approve", async (r, tx) => {
    need(r, "DRAFT");
    if (!actorCan(actor, "purchasing.approve")) throw financeError(403, "FORBIDDEN", "Approving supplier returns needs purchasing.approve");
    await checkAgainstReceipts(tx, r.supplierId, r.lines.map((l) => ({ goodsReceiptLineId: l.goodsReceiptLineId, quantity: l.quantity })), r.id);
    return { status: "APPROVED", approvedAt: new Date(), approvedByAdminId: adminOf(actor) };
  });

export const reopenPurchaseReturn = (id: string, actor: FinanceActor) =>
  transition(id, actor, "purchase_return.reopen", (r) => {
    need(r, "APPROVED");
    return { status: "DRAFT", approvedAt: null, approvedByAdminId: null };
  });

export const cancelPurchaseReturn = (id: string, reason: string, actor: FinanceActor) =>
  transition(id, actor, "purchase_return.cancel", (r) => {
    need(r, "DRAFT", "APPROVED");
    return { status: "CANCELLED", cancelledReason: reason };
  }, reason);

export async function deleteDraftPurchaseReturn(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const r = await lockReturn(tx, business.id, id);
    if (r.status !== "DRAFT") throw financeError(409, "RETURN_NOT_DRAFT", "Only a draft supplier return can be deleted — cancel it");
    await tx.purchaseReturnLine.deleteMany({ where: { purchaseReturnId: id } });
    await tx.purchaseReturn.delete({ where: { id } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "purchase_return.delete_draft", entityType: "PurchaseReturn", entityId: id, before: purchaseReturnDto(r, business.baseCurrency) });
  });
}

/** Ships an approved return: stock out at the average (costing), Dr 2115 / Cr inventory for the value that left. Idempotent. */
export async function shipPurchaseReturn(id: string, actor: FinanceActor) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const r = await lockReturn(tx, business.id, id);
    if (r.status === "SHIPPED") return { purchaseReturn: purchaseReturnDto(r, cur), replayed: true };
    need(r, "APPROVED");
    const biz = await tx.financeBusiness.findUniqueOrThrow({ where: { id: business.id } });
    if (!biz.inventoryCostingActivatedAt) throw financeError(409, "COSTING_NOT_ACTIVE", "Supplier returns ship once inventory costing is active — run the valuation cutover first");
    const moved = await recordDocumentMovements(tx, r.lines.map((l) => ({ variantId: l.variantId, change: -l.quantity, reason: "PURCHASE_RETURN" as const, basis: { kind: "AVERAGE" as const } })), { adminId: adminOf(actor), note: docNumber("RTN", r.number) });
    let valueMinor = 0;
    for (const [i, l] of r.lines.entries()) {
      const v = -Number(moved.lines[i]!.valuation.figures.bookValue); // what the books take out of inventory for these units
      valueMinor += v;
      await tx.purchaseReturnLine.update({ where: { id: l.id }, data: { stockMovementId: moved.lines[i]!.movement.id, value: toDecimal(v, cur) } });
    }
    await recordFinancialEvent(tx, {
      contract: "finance.event", contractVersion: 1, businessKey: business.key, brandKey: brand.key,
      source: { installId, system: "purchasing", entityType: "PurchaseReturn", entityId: r.id },
      event: { type: PURCHASING_EVENT_TYPES.returnShipped, version: 1, key: `preturn:${r.id}#r0`, occurredAt: new Date().toISOString() },
      financialDate: businessToday(business), currency: cur,
      payload: { returnId: r.id, number: docNumber("RTN", r.number), supplierId: r.supplierId, valueMinor } satisfies ReturnShippedPayload,
    });
    await tx.purchaseReturn.update({ where: { id: r.id }, data: { status: "SHIPPED", shippedAt: new Date(), shippedByAdminId: adminOf(actor) } });
    const after = await load(tx, business.id, r.id);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "purchase_return.ship", entityType: "PurchaseReturn", entityId: r.id, before: { status: r.status }, after: { status: after.status, valueMinor } });
    return { purchaseReturn: purchaseReturnDto(after, cur), replayed: false };
  });
}

export async function getPurchaseReturn(id: string) {
  const { business } = await getFinanceContext();
  return purchaseReturnDto(await load(prisma, business.id, id), business.baseCurrency);
}

export async function listPurchaseReturns(q: { status?: PurchaseReturnStatus; supplierId?: string; page: number; pageSize: number }) {
  const { business } = await getFinanceContext();
  const where: Prisma.PurchaseReturnWhereInput = { businessId: business.id, status: q.status, supplierId: q.supplierId };
  const [total, rows] = await Promise.all([
    prisma.purchaseReturn.count({ where }),
    prisma.purchaseReturn.findMany({ where, include: RET_INCLUDE, orderBy: { number: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, purchaseReturns: rows.map((r) => purchaseReturnDto(r, business.baseCurrency)) };
}
