/**
 * Purchase orders (Financial Core Phase 4D, docs/FINANCE_PHASE_4D.md). A purchase order is a commitment: it posts
 * nothing. DRAFT → SUBMITTED → APPROVED, then PARTIALLY_RECEIVED / RECEIVED as goods receipts post (derived from the
 * lines' received quantities, which the database maintains from posted receipts), and CLOSED (no more receipts) or
 * CANCELLED (only before anything is received). Every transition is legal only in the database's list (trigger P-1).
 *
 * Purchased goods are stock-tracked variants (locked decision 6); services and expenses are NON_STOCK lines on an active
 * expense or cost account. Suppliers on hold or inactive take no new orders.
 */
import { Prisma, type PurchaseOrderStatus, type TaxCode } from "@prisma/client";
import type { PurchaseOrderCreateInput, PurchaseOrderUpdateInput } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { actorCan, recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { nextFinanceSequence } from "./suppliers.service";
import { divRound } from "./costing.service";

export const docNumber = (prefix: string, n: number) => `${prefix}-${String(n).padStart(6, "0")}`;
export const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);

/** A purchase line's unit cost for the valuation: the net price plus the non-recoverable part of its tax, per unit (half-even,
 * minor units) — recoverable tax is never cost (it is recovered at the invoice, 4E). */
export function unitCostWithTax(unitPriceMinor: number, tax: Pick<TaxCode, "rate" | "recoverablePct"> | null): number {
  if (!tax) return unitPriceMinor;
  // rate and recoverable share are decimal strings with ≤ 4 places: scale to integers (×10⁴ each) — no floats.
  const scaled = (d: Prisma.Decimal | string) => BigInt(new Prisma.Decimal(d).mul(10_000).toFixed(0));
  const rate = scaled(tax.rate); // percent × 10⁴
  const nonRecoverable = 1_000_000n - scaled(tax.recoverablePct); // percent × 10⁴, of 100% = 10⁶
  const taxMinor = divRound(BigInt(unitPriceMinor) * rate * nonRecoverable, 100n * 10_000n * 1_000_000n);
  return unitPriceMinor + Number(taxMinor);
}

const PO_INCLUDE = {
  supplier: { select: { id: true, code: true, displayName: true, status: true } },
  lines: { orderBy: { lineNo: "asc" }, include: { taxCode: { select: { id: true, code: true, rate: true, recoverablePct: true } }, expenseAccount: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.PurchaseOrderInclude;
type PoRow = Prisma.PurchaseOrderGetPayload<{ include: typeof PO_INCLUDE }>;

export function purchaseOrderDto(po: PoRow, cur: string) {
  const lines = po.lines.map((l) => ({
    id: l.id,
    lineNo: l.lineNo,
    lineType: l.lineType,
    variantId: l.variantId,
    sku: l.sku,
    description: l.description,
    expenseAccount: l.expenseAccount,
    qtyOrdered: l.qtyOrdered,
    unitPrice: toMajorNumber(toMinor(l.unitPrice, cur), cur),
    taxCode: l.taxCode ? { id: l.taxCode.id, code: l.taxCode.code, rate: l.taxCode.rate.toString(), recoverablePct: l.taxCode.recoverablePct.toString() } : null,
    lineTotal: toMajorNumber(toMinor(l.unitPrice, cur) * l.qtyOrdered, cur),
    qtyReceived: l.qtyReceived,
    qtyReturned: l.qtyReturned,
    qtyOpen: l.lineType === "STOCK" ? Math.max(0, l.qtyOrdered - l.qtyReceived) : 0,
  }));
  return {
    id: po.id,
    number: docNumber("PO", po.number),
    status: po.status,
    supplier: po.supplier,
    orderDate: businessDateOf(po.orderDate),
    expectedDate: po.expectedDate ? businessDateOf(po.expectedDate) : null,
    currency: po.currency,
    deliveryTerms: po.deliveryTerms,
    notes: po.notes,
    revision: po.revision,
    createdByAdminId: po.createdByAdminId,
    submittedAt: po.submittedAt,
    approvedByAdminId: po.approvedByAdminId,
    approvedAt: po.approvedAt,
    closedReason: po.closedReason,
    closedAt: po.closedAt,
    createdAt: po.createdAt,
    /** Σ ordered × net price (excluding tax). */
    total: toMajorNumber(po.lines.reduce((s, l) => s + toMinor(l.unitPrice, cur) * l.qtyOrdered, 0), cur),
    lines,
  };
}

async function load(db: AppTransactionClient | typeof prisma, businessId: string, id: string) {
  const po = await db.purchaseOrder.findFirst({ where: { id, businessId }, include: PO_INCLUDE });
  if (!po) throw financeError(404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
  return po;
}

/** Locks the order row and returns it with its lines. */
export async function lockPurchaseOrder(tx: AppTransactionClient, businessId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "PurchaseOrder" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
  if (!rows.length) throw financeError(404, "PURCHASE_ORDER_NOT_FOUND", "Purchase order not found");
  return load(tx, businessId, id);
}

type LineInput = PurchaseOrderCreateInput["lines"][number];

/** Validates lines against the business: tracked variants, postable expense accounts, active tax codes. */
async function lineRows(tx: AppTransactionClient, businessId: string, cur: string, lines: LineInput[]): Promise<Array<Omit<Prisma.PurchaseOrderLineCreateManyInput, "purchaseOrderId">>> {
  const variantIds = [...new Set(lines.flatMap((l) => (l.variantId ? [l.variantId] : [])))];
  const variants = variantIds.length ? await tx.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, sku: true, size: true, color: true, product: { select: { name: true, trackInventory: true, deletedAt: true } } } }) : [];
  const byVariant = new Map(variants.map((v) => [v.id, v]));
  const accountIds = [...new Set(lines.flatMap((l) => (l.expenseAccountId ? [l.expenseAccountId] : [])))];
  const accounts = accountIds.length ? await tx.ledgerAccount.findMany({ where: { id: { in: accountIds }, businessId } }) : [];
  const byAccount = new Map(accounts.map((a) => [a.id, a]));
  const taxIds = [...new Set(lines.flatMap((l) => (l.taxCodeId ? [l.taxCodeId] : [])))];
  const taxes = taxIds.length ? await tx.taxCode.findMany({ where: { id: { in: taxIds }, businessId } }) : [];
  const byTax = new Map(taxes.map((t) => [t.id, t]));
  return lines.map((l, i) => {
    if (l.taxCodeId) {
      const t = byTax.get(l.taxCodeId);
      if (!t) throw financeError(400, "TAX_CODE_NOT_FOUND", `Line ${i + 1}: tax code not found`);
      if (!t.isActive) throw financeError(400, "TAX_CODE_INACTIVE", `Line ${i + 1}: ${t.code} is inactive`);
    }
    if (l.lineType === "STOCK") {
      const v = byVariant.get(l.variantId!);
      if (!v) throw financeError(400, "VARIANT_NOT_FOUND", `Line ${i + 1}: variant not found`);
      if (!v.product.trackInventory) throw financeError(400, "PURCHASE_UNTRACKED", `Line ${i + 1}: ${v.sku} isn't stock-tracked — purchased goods must be (turn stock tracking on, or buy it as a service / expense line)`);
      return { lineNo: i + 1, lineType: "STOCK" as const, variantId: v.id, sku: v.sku, description: l.description ?? `${v.product.name} — ${v.size} / ${v.color}`.slice(0, 300), qtyOrdered: l.qtyOrdered, unitPrice: toDecimal(toMinor(l.unitPrice, cur), cur), taxCodeId: l.taxCodeId ?? null };
    }
    const a = byAccount.get(l.expenseAccountId!);
    if (!a) throw financeError(400, "ACCOUNT_NOT_FOUND", `Line ${i + 1}: account not found`);
    if (!a.isPostable || !a.isActive || (a.type !== "EXPENSE" && a.type !== "COGS")) throw financeError(400, "PURCHASE_EXPENSE_ACCOUNT", `Line ${i + 1}: ${a.code} ${a.name} isn't an active expense or cost account that takes postings`);
    return { lineNo: i + 1, lineType: "NON_STOCK" as const, expenseAccountId: a.id, description: l.description!, qtyOrdered: l.qtyOrdered, unitPrice: toDecimal(toMinor(l.unitPrice, cur), cur), taxCodeId: l.taxCodeId ?? null };
  });
}

async function activeSupplier(tx: AppTransactionClient, businessId: string, supplierId: string) {
  const s = await tx.supplier.findFirst({ where: { id: supplierId, businessId } });
  if (!s) throw financeError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
  if (s.status !== "ACTIVE") throw financeError(409, "SUPPLIER_NOT_ACTIVE", `${s.displayName} is ${s.status === "ON_HOLD" ? "on hold" : "inactive"}${s.statusReason ? ` (${s.statusReason})` : ""} — it takes no new orders`);
  return s;
}

function checkDates(orderDate: string, expectedDate: string | null | undefined, openingDate: string | null) {
  if (openingDate && orderDate < openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${openingDate}`);
  if (expectedDate && expectedDate < orderDate) throw financeError(400, "PO_DATES", "The expected date is before the order date");
}

export async function createPurchaseOrder(input: PurchaseOrderCreateInput, actor: FinanceActor) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  const orderDate = input.orderDate ?? businessToday(business);
  checkDates(orderDate, input.expectedDate, business.openingDate);
  return financeTransaction(async (tx) => {
    const supplier = await activeSupplier(tx, business.id, input.supplierId);
    if (supplier.currency !== cur) throw financeError(400, "SUPPLIER_CURRENCY", `Purchasing is in ${cur} until foreign-currency documents are enabled`);
    const rows = await lineRows(tx, business.id, cur, input.lines);
    const po = await tx.purchaseOrder.create({
      data: {
        businessId: business.id, brandId: brand.id, supplierId: supplier.id, number: await nextFinanceSequence(tx, business.id, "purchase_order"),
        orderDate: dateColumn(orderDate), expectedDate: input.expectedDate ? dateColumn(input.expectedDate) : null, currency: cur,
        deliveryTerms: input.deliveryTerms ?? null, notes: input.notes ?? null, createdByAdminId: adminOf(actor),
        lines: { createMany: { data: rows } },
      },
      include: PO_INCLUDE,
    });
    const dto = purchaseOrderDto(po, cur);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "purchase_order.create", entityType: "PurchaseOrder", entityId: po.id, after: dto });
    return dto;
  });
}

/** A draft only: header fields, and the lines replaced as a whole when sent. */
export async function updatePurchaseOrder(id: string, input: PurchaseOrderUpdateInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const before = await lockPurchaseOrder(tx, business.id, id);
    if (before.status !== "DRAFT") throw financeError(409, "PO_NOT_DRAFT", "Only a draft purchase order can be edited");
    const orderDate = input.orderDate ?? businessDateOf(before.orderDate);
    const expected = input.expectedDate !== undefined ? input.expectedDate : before.expectedDate ? businessDateOf(before.expectedDate) : null;
    checkDates(orderDate, expected, business.openingDate);
    if (input.supplierId && input.supplierId !== before.supplierId) await activeSupplier(tx, business.id, input.supplierId);
    if (input.lines) {
      const rows = await lineRows(tx, business.id, cur, input.lines);
      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
      await tx.purchaseOrderLine.createMany({ data: rows.map((r) => ({ ...r, purchaseOrderId: id })) });
    }
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: input.supplierId ?? undefined, orderDate: dateColumn(orderDate), expectedDate: expected ? dateColumn(expected) : null,
        deliveryTerms: input.deliveryTerms !== undefined ? input.deliveryTerms : undefined, notes: input.notes !== undefined ? input.notes : undefined,
      },
    });
    const after = purchaseOrderDto(await load(tx, business.id, id), cur);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "purchase_order.update", entityType: "PurchaseOrder", entityId: id, before: purchaseOrderDto(before, cur), after });
    return after;
  });
}

async function transition(id: string, actor: FinanceActor, action: string, apply: (po: PoRow, tx: AppTransactionClient, ctx: { threshold: number | null; cur: string }) => Promise<Prisma.PurchaseOrderUpdateInput> | Prisma.PurchaseOrderUpdateInput, reason?: string | null) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const before = await lockPurchaseOrder(tx, business.id, id);
    const biz = await tx.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { purchaseApprovalThreshold: true } });
    const data = await apply(before, tx, { threshold: biz.purchaseApprovalThreshold === null ? null : toMinor(biz.purchaseApprovalThreshold, cur), cur });
    await tx.purchaseOrder.update({ where: { id }, data });
    const after = await load(tx, business.id, id);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action, entityType: "PurchaseOrder", entityId: id, before: { status: before.status }, after: { status: after.status }, reason: reason ?? null });
    return purchaseOrderDto(after, cur);
  });
}

const need = (po: PoRow, ...allowed: PurchaseOrderStatus[]) => {
  if (!allowed.includes(po.status)) throw financeError(409, "PO_STATUS", `The purchase order is ${po.status.toLowerCase().replace("_", " ")}`);
};

export const submitPurchaseOrder = (id: string, actor: FinanceActor) =>
  transition(id, actor, "purchase_order.submit", (po) => {
    need(po, "DRAFT");
    if (!po.lines.length) throw financeError(409, "PO_EMPTY", "Add at least one line");
    if (po.supplier.status !== "ACTIVE") throw financeError(409, "SUPPLIER_NOT_ACTIVE", `${po.supplier.displayName} takes no new orders`);
    return { status: "SUBMITTED", submittedAt: new Date() };
  });

export const returnPurchaseOrderToDraft = (id: string, actor: FinanceActor) =>
  transition(id, actor, "purchase_order.return_to_draft", (po) => {
    need(po, "SUBMITTED");
    return { status: "DRAFT", submittedAt: null };
  });

/** At or above the business's approval threshold, the approver must not be the order's creator (separation of duties). */
export const approvePurchaseOrder = (id: string, actor: FinanceActor) =>
  transition(id, actor, "purchase_order.approve", (po, _tx, { threshold, cur }) => {
    need(po, "SUBMITTED");
    if (!actorCan(actor, "purchasing.approve")) throw financeError(403, "FORBIDDEN", "Approving purchase orders needs purchasing.approve");
    const total = po.lines.reduce((s, l) => s + toMinor(l.unitPrice, cur) * l.qtyOrdered, 0);
    if (threshold !== null && total >= threshold && adminOf(actor) && adminOf(actor) === po.createdByAdminId) {
      throw financeError(409, "PO_SELF_APPROVAL", `Orders of ${toMajorNumber(threshold, cur)} or more need an approver other than their creator`);
    }
    return { status: "APPROVED", approvedAt: new Date(), approvedByAdminId: adminOf(actor) };
  });

export const cancelPurchaseOrder = (id: string, reason: string, actor: FinanceActor) =>
  transition(id, actor, "purchase_order.cancel", (po) => {
    need(po, "DRAFT", "SUBMITTED", "APPROVED");
    if (po.lines.some((l) => l.qtyReceived > 0)) throw financeError(409, "PO_HAS_RECEIPTS", "Goods were received on this order — close it instead");
    return { status: "CANCELLED", closedReason: reason, closedAt: new Date() };
  }, reason);

/** Stops further receipts (e.g. the supplier can't deliver the rest). */
export const closePurchaseOrder = (id: string, reason: string, actor: FinanceActor) =>
  transition(id, actor, "purchase_order.close", (po) => {
    need(po, "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED");
    return { status: "CLOSED", closedReason: reason, closedAt: new Date() };
  }, reason);

export async function deleteDraftPurchaseOrder(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const before = await lockPurchaseOrder(tx, business.id, id);
    if (before.status !== "DRAFT") throw financeError(409, "PO_NOT_DRAFT", "Only a draft purchase order can be deleted — cancel it instead");
    await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
    await tx.purchaseOrder.delete({ where: { id } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "purchase_order.delete_draft", entityType: "PurchaseOrder", entityId: id, before: purchaseOrderDto(before, business.baseCurrency) });
  });
}

/** After a receipt posts or reverses: the receiving status from the stock lines' received quantities (CLOSED stays). */
export async function refreshReceivingStatus(tx: AppTransactionClient, businessId: string, purchaseOrderId: string, actor: FinanceActor, cause: string) {
  const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrderId }, select: { id: true, status: true } });
  if (po.status === "CLOSED" || po.status === "CANCELLED") return po.status;
  const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id, lineType: "STOCK" }, select: { qtyOrdered: true, qtyReceived: true } });
  const received = lines.reduce((n, l) => n + l.qtyReceived, 0);
  const status: PurchaseOrderStatus = received === 0 ? "APPROVED" : lines.every((l) => l.qtyReceived >= l.qtyOrdered) ? "RECEIVED" : "PARTIALLY_RECEIVED";
  if (status !== po.status) {
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status } });
    await recordFinanceAudit(tx, { businessId, actor, action: "purchase_order.receiving_status", entityType: "PurchaseOrder", entityId: po.id, before: { status: po.status }, after: { status }, sourceRef: cause });
  }
  return status;
}

export async function getPurchaseOrder(id: string) {
  const { business } = await getFinanceContext();
  const po = await load(prisma, business.id, id);
  const receipts = await prisma.goodsReceipt.findMany({ where: { purchaseOrderId: id }, orderBy: { number: "asc" }, select: { id: true, number: true, status: true, receiptDate: true } });
  return { ...purchaseOrderDto(po, business.baseCurrency), receipts: receipts.map((r) => ({ id: r.id, number: docNumber("GRN", r.number), status: r.status, receiptDate: businessDateOf(r.receiptDate) })) };
}

export async function listPurchaseOrders(q: { status?: PurchaseOrderStatus; supplierId?: string; q?: string; page: number; pageSize: number }) {
  const { business } = await getFinanceContext();
  const num = q.q ? Number(q.q.replace(/^PO-?/i, "")) : NaN;
  const where: Prisma.PurchaseOrderWhereInput = {
    businessId: business.id,
    status: q.status,
    supplierId: q.supplierId,
    ...(q.q ? { OR: [...(Number.isSafeInteger(num) ? [{ number: num }] : []), { supplier: { displayName: { contains: q.q, mode: "insensitive" as const } } }, { lines: { some: { sku: { contains: q.q, mode: "insensitive" as const } } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({ where, include: PO_INCLUDE, orderBy: { number: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, purchaseOrders: rows.map((p) => purchaseOrderDto(p, business.baseCurrency)) };
}


/** Variants that can be bought (stock-tracked, product not in Trash), by SKU or product name — the purchasing pickers'
 * lookup. Read-only; carries no cost (that is costing.read's). */
export async function searchPurchasableVariants(q: { q?: string; take: number }) {
  const term = q.q?.trim();
  const rows = await prisma.productVariant.findMany({
    where: {
      product: { trackInventory: true, deletedAt: null },
      ...(term ? { OR: [{ sku: { contains: term, mode: "insensitive" } }, { product: { name: { contains: term, mode: "insensitive" } } }] } : {}),
    },
    select: { id: true, sku: true, size: true, color: true, stock: true, product: { select: { name: true } } },
    orderBy: { sku: "asc" },
    take: q.take,
  });
  return { variants: rows.map((v) => ({ id: v.id, sku: v.sku, name: `${v.product.name} — ${v.size} / ${v.color}`, stock: v.stock })) };
}
