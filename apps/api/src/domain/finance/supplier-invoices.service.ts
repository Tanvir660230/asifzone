/**
 * Supplier invoices and credit notes — accounts payable (Financial Core Phase 4E, docs/FINANCE_PHASE_4E.md).
 *
 * A supplier's bill is entered as a DRAFT against what it bills, then POSTED in one transaction:
 *   - STOCK lines (invoice) match a posted goods-receipt line (3-way: order → receipt → invoice; quantity ≤ received −
 *     already invoiced). They clear GRNI at the receipt's value; the difference to the billed cost (net + non-recoverable
 *     tax) is a price difference (locked decisions 11–12): costing REVALUE — the units still held are revalued, the share
 *     already sold goes to 5150 — never a rewritten cost of sales.
 *   - RETURN lines (credit note) match a shipped supplier-return line; they clear the returns liability at the value the
 *     goods left at, the difference to the credited cost going to 5150 (the goods are gone).
 *   - EXPENSE lines (2-way, optionally against an order's service / expense line) debit their expense account.
 *   - PRODUCTION_COST lines (invoice) bill an approved production cost of the same supplier, at exactly its amount, and
 *     clear its accrual (2116) — the cost is never booked twice.
 *   - Recoverable tax → its mapping (asset.vat_input); non-recoverable tax is part of a stock line's cost, otherwise
 *     expense.non_recoverable_tax. The total is payable (liability.payable_trade), the supplier as party.
 *   A unit price beyond the business's tolerance against the order needs purchasing.approve and a reason.
 * VOID (with a reason) reverses the journal (a superseding revision) and the price-difference revaluation — only while
 * nothing is allocated to or from the document. Payments and allocations: supplier-payments.service (Phase 4F).
 */
import { Prisma, type SupplierInvoiceKind, type SupplierInvoiceStatus, type TaxCode } from "@prisma/client";
import { isAccountMappingKey, type SupplierInvoiceCreateInput, type SupplierInvoiceUpdateInput } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { installId } from "../../config/installation";
import { actorCan, recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { nextFinanceSequence } from "./suppliers.service";
import { recordFinancialEvent } from "./events.service";
import { activeCostingInTx, divRound, revalueForDocumentInTx } from "./costing.service";
import { PAYABLES_EVENT_TYPES, PAYABLES_POSTING_KEYS, type InvoicePostedPayload } from "./payables-posting-rules";
import { adminOf, docNumber } from "./purchase-orders.service";
import { supplierOpeningDues } from "./opening-balances.service";

type PayablesKey = (typeof PAYABLES_POSTING_KEYS)[number];
export const invoiceNumber = (kind: SupplierInvoiceKind, n: number) => docNumber(kind === "INVOICE" ? "BILL" : "CN", n);

// ── tax (exact, half-even) ─────────────────────────────────────────────────────────────────────────────────────────
const scaled4 = (d: Prisma.Decimal | string) => BigInt(new Prisma.Decimal(d).mul(10_000).toFixed(0));
/** Tax on `netMinor` at the code's rate, and its recoverable share — both in minor units, half-even. */
export function taxOf(netMinor: number, tax: Pick<TaxCode, "rate" | "recoverablePct"> | null): { tax: number; recoverable: number } {
  if (!tax || netMinor === 0) return { tax: 0, recoverable: 0 };
  const t = divRound(BigInt(netMinor) * scaled4(tax.rate), 1_000_000n); // rate is percent × 10⁴ → ÷ (100 × 10⁴)
  const r = divRound(t * scaled4(tax.recoverablePct), 1_000_000n);
  return { tax: Number(t), recoverable: Number(r) };
}

const INCLUDE = {
  supplier: { select: { id: true, code: true, displayName: true, paymentTermsDays: true } },
  allocations: { where: { status: "ACTIVE" }, select: { amount: true, creditNoteId: true, paymentMovement: { select: { status: true } } } },
  creditAllocations: { where: { status: "ACTIVE" }, select: { amount: true } },
  lines: {
    orderBy: { lineNo: "asc" },
    include: {
      taxCode: { select: { id: true, code: true, rate: true, recoverablePct: true, recoverableMappingKey: true, nonRecoverableMappingKey: true } },
      expenseAccount: { select: { id: true, code: true, name: true } },
      variant: { select: { sku: true, size: true, color: true, product: { select: { name: true } } } },
      goodsReceiptLine: { select: { id: true, qtyAccepted: true, unitCost: true, goodsReceipt: { select: { id: true, number: true } } } },
      purchaseReturnLine: { select: { id: true, quantity: true, value: true, purchaseReturn: { select: { id: true, number: true } } } },
      productionCostEntry: { select: { id: true, amount: true, description: true, productionOrder: { select: { id: true, number: true } } } },
    },
  },
} satisfies Prisma.SupplierInvoiceInclude;
type InvoiceRow = Prisma.SupplierInvoiceGetPayload<{ include: typeof INCLUDE }>;

export function supplierInvoiceDto(i: InvoiceRow, cur: string, today?: string) {
  const m = (d: Prisma.Decimal | null) => (d === null ? null : toMajorNumber(toMinor(d, cur), cur));
  const net = i.lines.reduce((s, l) => s + toMinor(l.netAmount, cur), 0);
  const tax = i.lines.reduce((s, l) => s + toMinor(l.taxAmount, cur), 0);
  const due = businessDateOf(i.dueDate);
  // Phase 4F: what payments and credit notes settle (a payment awaiting approval settles nothing yet)
  const settled = i.allocations.filter((a) => a.creditNoteId || a.paymentMovement?.status === "POSTED").reduce((s, a) => s + toMinor(a.amount, cur), 0);
  const appliedCredit = i.creditAllocations.reduce((s, a) => s + toMinor(a.amount, cur), 0);
  return {
    id: i.id,
    number: invoiceNumber(i.kind, i.number),
    kind: i.kind,
    status: i.status,
    supplier: { id: i.supplier.id, code: i.supplier.code, displayName: i.supplier.displayName },
    supplierRef: i.supplierRef,
    invoiceDate: businessDateOf(i.invoiceDate),
    dueDate: due,
    overdue: Boolean(today && i.kind === "INVOICE" && i.status === "POSTED" && due < today),
    currency: i.currency,
    notes: i.notes,
    evidence: i.evidence,
    varianceReason: i.varianceReason,
    net: toMajorNumber(net, cur),
    tax: toMajorNumber(tax, cur),
    total: toMajorNumber(net + tax, cur),
    /** A bill: settled by payments / credit notes, and what is still owed. A credit note: allocated to bills, and what is left. */
    settled: toMajorNumber(i.kind === "INVOICE" ? settled : appliedCredit, cur),
    outstanding: i.status === "POSTED" ? toMajorNumber(net + tax - (i.kind === "INVOICE" ? settled : appliedCredit), cur) : null,
    postedAt: i.postedAt,
    voidedAt: i.voidedAt,
    voidReason: i.voidReason,
    createdByAdminId: i.createdByAdminId,
    createdAt: i.createdAt,
    lines: i.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      lineType: l.lineType,
      description: l.description,
      quantity: l.quantity,
      unitPrice: m(l.unitPrice)!,
      taxCode: l.taxCode ? { id: l.taxCode.id, code: l.taxCode.code } : null,
      net: m(l.netAmount)!,
      tax: m(l.taxAmount)!,
      recoverableTax: m(l.recoverableTax)!,
      cleared: m(l.clearedAmount),
      priceDifference: m(l.priceDifference),
      expenseAccount: l.expenseAccount,
      sku: l.variant?.sku ?? null,
      goodsReceipt: l.goodsReceiptLine ? { id: l.goodsReceiptLine.goodsReceipt.id, number: docNumber("GRN", l.goodsReceiptLine.goodsReceipt.number) } : null,
      purchaseReturn: l.purchaseReturnLine ? { id: l.purchaseReturnLine.purchaseReturn.id, number: docNumber("RTN", l.purchaseReturnLine.purchaseReturn.number) } : null,
      productionOrder: l.productionCostEntry ? { id: l.productionCostEntry.productionOrder.id, number: docNumber("MO", l.productionCostEntry.productionOrder.number) } : null,
      goodsReceiptLineId: l.goodsReceiptLineId,
      purchaseReturnLineId: l.purchaseReturnLineId,
      purchaseOrderLineId: l.purchaseOrderLineId,
      productionCostEntryId: l.productionCostEntryId,
    })),
  };
}

async function load(db: AppTransactionClient | typeof prisma, businessId: string, id: string) {
  const i = await db.supplierInvoice.findFirst({ where: { id, businessId }, include: INCLUDE });
  if (!i) throw financeError(404, "SUPPLIER_INVOICE_NOT_FOUND", "Supplier invoice not found");
  return i;
}

async function lockInvoice(tx: AppTransactionClient, businessId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "SupplierInvoice" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
  if (!rows.length) throw financeError(404, "SUPPLIER_INVOICE_NOT_FOUND", "Supplier invoice not found");
  return load(tx, businessId, id);
}

/** Quantity of a receipt line / return line / order line already on POSTED documents (excluding one invoice). */
async function billedQty(tx: AppTransactionClient, field: "goodsReceiptLineId" | "purchaseReturnLineId" | "purchaseOrderLineId", id: string, exceptInvoiceId?: string) {
  const r = await tx.supplierInvoiceLine.aggregate({ where: { [field]: id, invoice: { status: "POSTED", ...(exceptInvoiceId ? { id: { not: exceptInvoiceId } } : {}) } }, _sum: { quantity: true } });
  return r._sum.quantity ?? 0;
}

type LineInput = SupplierInvoiceCreateInput["lines"][number];

/** Validates the lines against the supplier and what they bill; returns the rows to store (amounts computed, exact). */
async function buildLines(tx: AppTransactionClient, businessId: string, cur: string, kind: SupplierInvoiceKind, supplierId: string, lines: LineInput[], exceptInvoiceId?: string) {
  const out: Array<Omit<Prisma.SupplierInvoiceLineCreateManyInput, "invoiceId">> = [];
  const seen = new Set<string>();
  for (const [i, l] of lines.entries()) {
    const n = `Line ${i + 1}`;
    const tax = l.taxCodeId ? await tx.taxCode.findFirst({ where: { id: l.taxCodeId, businessId } }) : null;
    if (l.taxCodeId && !tax) throw financeError(400, "TAX_CODE_NOT_FOUND", `${n}: tax code not found`);
    if (tax && !tax.isActive) throw financeError(400, "TAX_CODE_INACTIVE", `${n}: ${tax.code} is inactive`);
    const unit = toMinor(l.unitPrice, cur);
    let description = l.description ?? "";
    let variantId: string | null = null;
    let quantity = l.quantity;
    const ref = l.goodsReceiptLineId ?? l.purchaseReturnLineId ?? l.productionCostEntryId ?? null;
    if (ref) {
      if (seen.has(ref)) throw financeError(400, "INVOICE_LINE_TWICE", `${n}: each receipt line, return line or cost appears once`);
      seen.add(ref);
    }
    if (l.lineType === "STOCK") {
      if (kind !== "INVOICE") throw financeError(400, "INVOICE_LINE_KIND", `${n}: received goods are billed on an invoice`);
      const gl = await tx.goodsReceiptLine.findUnique({ where: { id: l.goodsReceiptLineId! }, include: { goodsReceipt: { select: { businessId: true, supplierId: true, status: true, number: true } }, variant: { select: { sku: true } } } });
      if (!gl || gl.goodsReceipt.businessId !== businessId) throw financeError(400, "RECEIPT_LINE_NOT_FOUND", `${n}: receipt line not found`);
      if (gl.goodsReceipt.supplierId !== supplierId) throw financeError(400, "INVOICE_SUPPLIER", `${n}: ${docNumber("GRN", gl.goodsReceipt.number)} is another supplier's`);
      if (gl.goodsReceipt.status !== "POSTED") throw financeError(409, "RECEIPT_NOT_POSTED", `${n}: ${docNumber("GRN", gl.goodsReceipt.number)} isn't posted`);
      const open = gl.qtyAccepted - (await billedQty(tx, "goodsReceiptLineId", gl.id, exceptInvoiceId));
      if (quantity > open) throw financeError(409, "INVOICE_QTY_EXCEEDS_RECEIVED", `${n}: ${gl.variant.sku} — ${open} received and not yet invoiced`);
      variantId = gl.variantId;
      description ||= `${gl.variant.sku} — ${docNumber("GRN", gl.goodsReceipt.number)}`;
    } else if (l.lineType === "RETURN") {
      if (kind !== "CREDIT_NOTE") throw financeError(400, "INVOICE_LINE_KIND", `${n}: returned goods are credited on a credit note`);
      const rl = await tx.purchaseReturnLine.findUnique({ where: { id: l.purchaseReturnLineId! }, include: { purchaseReturn: { select: { businessId: true, supplierId: true, status: true, number: true } }, variant: { select: { sku: true } } } });
      if (!rl || rl.purchaseReturn.businessId !== businessId) throw financeError(400, "RETURN_LINE_NOT_FOUND", `${n}: return line not found`);
      if (rl.purchaseReturn.supplierId !== supplierId) throw financeError(400, "INVOICE_SUPPLIER", `${n}: ${docNumber("RTN", rl.purchaseReturn.number)} is another supplier's`);
      if (rl.purchaseReturn.status !== "SHIPPED") throw financeError(409, "RETURN_NOT_SHIPPED", `${n}: ${docNumber("RTN", rl.purchaseReturn.number)} hasn't shipped`);
      const open = rl.quantity - (await billedQty(tx, "purchaseReturnLineId", rl.id, exceptInvoiceId));
      if (quantity > open) throw financeError(409, "CREDIT_QTY_EXCEEDS_RETURNED", `${n}: ${rl.variant.sku} — ${open} returned and not yet credited`);
      variantId = rl.variantId;
      description ||= `${rl.variant.sku} — ${docNumber("RTN", rl.purchaseReturn.number)}`;
    } else if (l.lineType === "PRODUCTION_COST") {
      if (kind !== "INVOICE") throw financeError(400, "INVOICE_LINE_KIND", `${n}: production costs are billed on an invoice`);
      const c = await tx.productionCostEntry.findUnique({ where: { id: l.productionCostEntryId! }, include: { productionOrder: { select: { businessId: true, number: true } } } });
      if (!c || c.productionOrder.businessId !== businessId) throw financeError(400, "PRODUCTION_COST_NOT_FOUND", `${n}: production cost not found`);
      if (c.supplierId !== supplierId) throw financeError(400, "INVOICE_SUPPLIER", `${n}: that production cost is another payee's`);
      if (c.status !== "APPROVED") throw financeError(409, "PRODUCTION_COST_NOT_APPROVED", `${n}: only an approved production cost is invoiced`);
      quantity = 1;
      if (unit !== toMinor(c.amount, cur)) throw financeError(409, "PRODUCTION_COST_AMOUNT", `${n}: the bill's net amount must equal the approved cost (${toMajorNumber(toMinor(c.amount, cur), cur)}) — void and re-enter the cost if it changed`);
      const billed = await tx.supplierInvoiceLine.count({ where: { productionCostEntryId: c.id, invoice: { status: "POSTED", ...(exceptInvoiceId ? { id: { not: exceptInvoiceId } } : {}) } } });
      if (billed) throw financeError(409, "PRODUCTION_COST_INVOICED", `${n}: that production cost is already invoiced`);
      description ||= `${c.description} — ${docNumber("MO", c.productionOrder.number)}`;
    } else {
      const acc = await tx.ledgerAccount.findFirst({ where: { id: l.expenseAccountId!, businessId } });
      if (!acc) throw financeError(400, "ACCOUNT_NOT_FOUND", `${n}: expense account not found`);
      if (!acc.isPostable || !acc.isActive) throw financeError(400, "ACCOUNT_NOT_POSTABLE", `${n}: ${acc.code} ${acc.name} can't take postings`);
      if (acc.type !== "EXPENSE" && acc.type !== "ASSET") throw financeError(400, "ACCOUNT_TYPE", `${n}: bill an expense (or asset) account`);
      if (l.purchaseOrderLineId) {
        const pol = await tx.purchaseOrderLine.findUnique({ where: { id: l.purchaseOrderLineId }, include: { purchaseOrder: { select: { businessId: true, supplierId: true, status: true, number: true } } } });
        if (!pol || pol.purchaseOrder.businessId !== businessId || pol.purchaseOrder.supplierId !== supplierId) throw financeError(400, "ORDER_LINE_NOT_FOUND", `${n}: not an order line of this supplier`);
        if (pol.lineType !== "NON_STOCK") throw financeError(400, "ORDER_LINE_STOCK", `${n}: ordered goods are billed against their receipt`);
        if (!["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"].includes(pol.purchaseOrder.status)) throw financeError(409, "PO_NOT_APPROVED", `${n}: ${docNumber("PO", pol.purchaseOrder.number)} isn't approved`);
        if (kind === "INVOICE") {
          const open = pol.qtyOrdered - (await billedQty(tx, "purchaseOrderLineId", pol.id, exceptInvoiceId));
          if (quantity > open) throw financeError(409, "INVOICE_QTY_EXCEEDS_ORDERED", `${n}: ${open} ordered and not yet invoiced`);
        }
      }
    }
    const net = quantity * unit;
    const t = taxOf(net, tax);
    out.push({
      lineNo: i + 1, lineType: l.lineType, description, goodsReceiptLineId: l.goodsReceiptLineId ?? null, purchaseReturnLineId: l.purchaseReturnLineId ?? null,
      purchaseOrderLineId: l.purchaseOrderLineId ?? null, productionCostEntryId: l.productionCostEntryId ?? null, expenseAccountId: l.lineType === "EXPENSE" ? l.expenseAccountId! : null,
      variantId, quantity, unitPrice: toDecimal(unit, cur), taxCodeId: tax?.id ?? null, netAmount: toDecimal(net, cur), taxAmount: toDecimal(t.tax, cur), recoverableTax: toDecimal(t.recoverable, cur),
    });
  }
  return out;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function duplicateRef(err: unknown): never {
  if (err instanceof Error && /SupplierInvoice_live_supplier_ref|Unique constraint/.test(err.message)) {
    throw financeError(409, "SUPPLIER_REF_TAKEN", "This supplier's document number is already entered — the same bill can't be entered twice");
  }
  throw err;
}

export async function createSupplierInvoice(input: SupplierInvoiceCreateInput, actor: FinanceActor) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  const invoiceDate = input.invoiceDate ?? businessToday(business);
  if (business.openingDate && invoiceDate < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
  return financeTransaction(async (tx) => {
    const s = await tx.supplier.findFirst({ where: { id: input.supplierId, businessId: business.id } });
    if (!s) throw financeError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
    const dueDate = input.dueDate ?? addDays(invoiceDate, s.paymentTermsDays);
    if (dueDate < invoiceDate) throw financeError(400, "DUE_BEFORE_INVOICE", "The due date is on or after the invoice date");
    const rows = await buildLines(tx, business.id, cur, input.kind, s.id, input.lines);
    const created = await tx.supplierInvoice
      .create({
        data: {
          businessId: business.id, brandId: brand.id, supplierId: s.id, kind: input.kind, number: await nextFinanceSequence(tx, business.id, "supplier_invoice"),
          supplierRef: input.supplierRef.trim(), invoiceDate: dateColumn(invoiceDate), dueDate: dateColumn(dueDate), currency: cur,
          notes: input.notes ?? null, evidence: input.evidence ?? null, createdByAdminId: adminOf(actor), lines: { createMany: { data: rows } },
        },
        include: INCLUDE,
      })
      .catch(duplicateRef);
    const dto = supplierInvoiceDto(created, cur);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: `supplier_invoice.create`, entityType: "SupplierInvoice", entityId: created.id, after: dto });
    return dto;
  });
}

export async function updateSupplierInvoice(id: string, input: SupplierInvoiceUpdateInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const before = await lockInvoice(tx, business.id, id);
    if (before.status !== "DRAFT") throw financeError(409, "INVOICE_NOT_DRAFT", "Only a draft is edited — void a posted document and enter it again");
    const invoiceDate = input.invoiceDate ?? businessDateOf(before.invoiceDate);
    if (business.openingDate && invoiceDate < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
    const dueDate = input.dueDate ?? (input.invoiceDate ? addDays(invoiceDate, before.supplier.paymentTermsDays) : businessDateOf(before.dueDate));
    if (dueDate < invoiceDate) throw financeError(400, "DUE_BEFORE_INVOICE", "The due date is on or after the invoice date");
    if (input.lines) {
      const rows = await buildLines(tx, business.id, cur, before.kind, before.supplierId, input.lines, id);
      await tx.supplierInvoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.supplierInvoiceLine.createMany({ data: rows.map((r) => ({ ...r, invoiceId: id })) });
    }
    const after = await tx.supplierInvoice
      .update({
        where: { id },
        data: {
          supplierRef: input.supplierRef?.trim() ?? before.supplierRef, invoiceDate: dateColumn(invoiceDate), dueDate: dateColumn(dueDate),
          ...(input.notes !== undefined ? { notes: input.notes } : {}), ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
        },
        include: INCLUDE,
      })
      .catch(duplicateRef);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "supplier_invoice.update", entityType: "SupplierInvoice", entityId: id, before: supplierInvoiceDto(before, cur), after: supplierInvoiceDto(after, cur) });
    return supplierInvoiceDto(after, cur);
  });
}

export async function deleteDraftSupplierInvoice(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  await financeTransaction(async (tx) => {
    const i = await lockInvoice(tx, business.id, id);
    if (i.status !== "DRAFT") throw financeError(409, "INVOICE_NOT_DRAFT", "A posted document is never deleted — void it");
    await tx.supplierInvoiceLine.deleteMany({ where: { invoiceId: id } });
    await tx.supplierInvoice.delete({ where: { id } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "supplier_invoice.delete_draft", entityType: "SupplierInvoice", entityId: id, before: supplierInvoiceDto(i, business.baseCurrency) });
  });
}

/** Resolves a tax code's mapping key to a payables line: a key the rule knows, or the mapped account for any other key. */
async function keyLine(tx: AppTransactionClient, businessId: string, key: string): Promise<{ key: PayablesKey | null; accountId: string | null }> {
  if ((PAYABLES_POSTING_KEYS as readonly string[]).includes(key)) return { key: key as PayablesKey, accountId: null };
  if (!isAccountMappingKey(key)) throw financeError(409, "MAPPING_KEY_UNKNOWN", `Unknown mapping key ${key}`);
  const m = await tx.accountMapping.findUnique({ where: { businessId_key: { businessId, key } } });
  if (!m) throw financeError(409, "MAPPING_MISSING", `Mapping ${key} isn't assigned`);
  return { key: null, accountId: m.accountId };
}

/** Posts a draft: matching re-checked under locks, journal + price-difference revaluation, exactly once. */
export async function postSupplierInvoice(id: string, input: { varianceReason?: string | null }, actor: FinanceActor) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const inv = await lockInvoice(tx, business.id, id);
    if (inv.status === "POSTED") return { invoice: supplierInvoiceDto(inv, cur), replayed: true };
    if (inv.status !== "DRAFT") throw financeError(409, "INVOICE_NOT_DRAFT", "A void document can't be posted");
    const invoiceDate = businessDateOf(inv.invoiceDate);
    if (business.openingDate && invoiceDate < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
    // Lock what the lines bill (receipts and returns by header, then cost entries), in id order, so two bills or a reversal can't race.
    const grnIds = [...new Set(inv.lines.filter((l) => l.goodsReceiptLine).map((l) => l.goodsReceiptLine!.goodsReceipt.id))].sort();
    if (grnIds.length) await tx.$queryRaw`SELECT id FROM "GoodsReceipt" WHERE id IN (${Prisma.join(grnIds)}) ORDER BY id FOR UPDATE`;
    const costIds = inv.lines.filter((l) => l.productionCostEntryId).map((l) => l.productionCostEntryId!).sort();
    if (costIds.length) await tx.$queryRaw`SELECT id FROM "ProductionCostEntry" WHERE id IN (${Prisma.join(costIds)}) ORDER BY id FOR UPDATE`;
    // Re-validate every line now (quantities against what is already POSTED, states, amounts).
    await buildLines(tx, business.id, cur, inv.kind, inv.supplierId, inv.lines.map((l) => ({
      lineType: l.lineType, goodsReceiptLineId: l.goodsReceiptLineId, purchaseReturnLineId: l.purchaseReturnLineId, purchaseOrderLineId: l.purchaseOrderLineId,
      productionCostEntryId: l.productionCostEntryId, expenseAccountId: l.expenseAccountId, description: l.description, quantity: l.quantity,
      unitPrice: toMajorNumber(toMinor(l.unitPrice, cur), cur), taxCodeId: l.taxCodeId,
    })), id);

    // Price tolerance against the order (or, without one, against the receipt's cost).
    const biz = await tx.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { invoicePriceTolerancePct: true } });
    const tolerance = Number(biz.invoicePriceTolerancePct);
    const beyond: string[] = [];
    for (const l of inv.lines) {
      const polId = l.purchaseOrderLineId ?? (l.goodsReceiptLineId ? (await tx.goodsReceiptLine.findUnique({ where: { id: l.goodsReceiptLineId }, select: { purchaseOrderLineId: true } }))?.purchaseOrderLineId : null);
      if (!polId) continue;
      const pol = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: polId }, select: { unitPrice: true } });
      const ordered = toMinor(pol.unitPrice, cur);
      const billed = toMinor(l.unitPrice, cur);
      if (Math.abs(billed - ordered) * 100 > tolerance * ordered) beyond.push(`line ${l.lineNo} (${toMajorNumber(billed, cur)} vs ordered ${toMajorNumber(ordered, cur)})`);
    }
    let varianceReason: string | null = null;
    if (beyond.length) {
      if (!actorCan(actor, "purchasing.approve") || !input.varianceReason?.trim()) {
        throw financeError(409, "INVOICE_PRICE_VARIANCE", `Price beyond the ${tolerance}% tolerance on ${beyond.join(", ")} — an approver confirms it with a reason`);
      }
      varianceReason = input.varianceReason.trim();
    }

    // The journal, and what each line clears.
    const credit = inv.kind === "CREDIT_NOTE";
    type L = { key: PayablesKey | null; accountId: string | null; amount: number; memo: string; valued?: boolean };
    const parts: L[] = []; // amount: positive = the document's natural side (an invoice's debits, a credit note's credits)
    const revalue = new Map<string, { deltaMinor: number; qty: number }>();
    let netTotal = 0;
    let taxTotal = 0;
    const lineUpdates: Array<{ id: string; cleared: number; difference: number }> = [];
    for (const l of inv.lines) {
      const net = toMinor(l.netAmount, cur);
      const tax = toMinor(l.taxAmount, cur);
      const rec = toMinor(l.recoverableTax, cur);
      const nonRec = tax - rec;
      netTotal += net;
      taxTotal += tax;
      if (rec) parts.push({ ...(await keyLine(tx, business.id, l.taxCode!.recoverableMappingKey)), amount: rec, memo: `Recoverable tax ${l.taxCode!.code}` });
      if (l.lineType === "STOCK") {
        const cleared = l.quantity * toMinor(l.goodsReceiptLine!.unitCost, cur);
        const difference = net + nonRec - cleared;
        parts.push({ key: "liability.grni", accountId: null, amount: cleared, memo: `Invoiced ${docNumber("GRN", l.goodsReceiptLine!.goodsReceipt.number)}` });
        if (difference) {
          parts.push({ key: "asset.inventory", accountId: null, amount: difference, memo: `Price difference ${l.variant?.sku ?? ""}`.trim(), valued: true });
          const r = revalue.get(l.variantId!) ?? { deltaMinor: 0, qty: 0 };
          revalue.set(l.variantId!, { deltaMinor: r.deltaMinor + difference, qty: r.qty + l.quantity });
        }
        lineUpdates.push({ id: l.id, cleared, difference });
      } else if (l.lineType === "RETURN") {
        const rl = l.purchaseReturnLine!;
        const cleared = Number(divRound(BigInt(toMinor(rl.value!, cur)) * BigInt(l.quantity), BigInt(rl.quantity)));
        const difference = net + nonRec - cleared;
        parts.push({ key: "liability.supplier_returns", accountId: null, amount: cleared, memo: `Credited ${docNumber("RTN", rl.purchaseReturn.number)}` });
        if (difference) parts.push({ key: "cogs.purchase_price_differences", accountId: null, amount: difference, memo: `Credit vs returned value ${l.variant?.sku ?? ""}`.trim() });
        lineUpdates.push({ id: l.id, cleared, difference });
      } else if (l.lineType === "PRODUCTION_COST") {
        parts.push({ key: "liability.production_accrual", accountId: null, amount: net, memo: `Invoiced production cost — ${l.description}` });
        if (nonRec) parts.push({ ...(await keyLine(tx, business.id, l.taxCode!.nonRecoverableMappingKey)), amount: nonRec, memo: `Non-recoverable tax ${l.taxCode!.code}` });
        lineUpdates.push({ id: l.id, cleared: net, difference: 0 });
      } else {
        parts.push({ key: null, accountId: l.expenseAccountId!, amount: net, memo: l.description });
        if (nonRec) parts.push({ ...(await keyLine(tx, business.id, l.taxCode!.nonRecoverableMappingKey)), amount: nonRec, memo: `Non-recoverable tax ${l.taxCode!.code}` });
        lineUpdates.push({ id: l.id, cleared: 0, difference: 0 });
      }
    }
    const total = netTotal + taxTotal;
    const number = invoiceNumber(inv.kind, inv.number);
    const side = (amount: number, natural: boolean) => {
      // natural side: an invoice debits its parts and credits AP; a credit note the reverse
      const debitSide = credit ? !natural : natural;
      const a = Math.abs(amount);
      const positive = amount >= 0;
      return (debitSide ? positive : !positive) ? { debit: a, credit: 0 } : { debit: 0, credit: a };
    };
    const journal: InvoicePostedPayload["lines"] = [
      ...parts.filter((p) => p.amount !== 0).map((p) => ({ key: p.key, accountId: p.accountId, ...side(p.amount, true), memo: p.memo, valuationStatus: p.valued ? ("KNOWN" as const) : null })),
      { key: "liability.payable_trade", accountId: null, ...side(total, false), memo: `${number} · ${inv.supplierRef}`, valuationStatus: null },
    ];

    // Price differences on received goods: the held share revalues the stock, the sold share goes to 5150 (costing posts it).
    const items = [...revalue.entries()].map(([variantId, r]) => ({ variantId, deltaMinor: r.deltaMinor, qty: r.qty })).filter((r) => r.deltaMinor !== 0);
    if (items.length) {
      const scope = await activeCostingInTx(tx);
      if (!scope) throw financeError(409, "COSTING_NOT_ACTIVE", "A price difference on received goods needs inventory costing");
      await revalueForDocumentInTx(tx, { scope, sourceType: "SupplierInvoice", sourceId: inv.id, financialDate: invoiceDate, note: `Price difference ${number}`, items });
    }
    for (const u of lineUpdates) await tx.supplierInvoiceLine.update({ where: { id: u.id }, data: { clearedAmount: toDecimal(u.cleared, cur), priceDifference: toDecimal(u.difference, cur) } });
    await recordFinancialEvent(tx, {
      contract: "finance.event", contractVersion: 1, businessKey: business.key, brandKey: brand.key,
      source: { installId, system: "payables", entityType: "SupplierInvoice", entityId: inv.id },
      event: { type: PAYABLES_EVENT_TYPES.invoicePosted, version: 1, key: `ap-inv:${inv.id}#r0`, occurredAt: new Date().toISOString() },
      financialDate: invoiceDate, currency: cur,
      payload: { invoiceId: inv.id, number, kind: inv.kind, supplierId: inv.supplierId, totalMinor: total, lines: journal, void: false, supersedes: null } satisfies InvoicePostedPayload,
    });
    const after = await tx.supplierInvoice.update({
      where: { id },
      data: { status: "POSTED", postedAt: new Date(), postedByAdminId: adminOf(actor), varianceReason, netTotal: toDecimal(netTotal, cur), taxTotal: toDecimal(taxTotal, cur), total: toDecimal(total, cur) },
      include: INCLUDE,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "supplier_invoice.post", entityType: "SupplierInvoice", entityId: id, before: { status: inv.status }, after: { status: "POSTED", totalMinor: total, varianceReason, priceDifferences: items } });
    return { invoice: supplierInvoiceDto(after, cur), replayed: false };
  });
}

/** Voids a posted document: its journal reversed (a superseding revision) and any price-difference revaluation undone. */
export async function voidSupplierInvoice(id: string, reason: string, actor: FinanceActor) {
  const { business, brand } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const inv = await lockInvoice(tx, business.id, id);
    if (inv.status === "VOID") return supplierInvoiceDto(inv, cur);
    if (inv.status !== "POSTED") throw financeError(409, "INVOICE_NOT_POSTED", "Only a posted document is voided — delete a draft");
    const allocated = await tx.supplierAllocation.count({ where: { status: "ACTIVE", OR: [{ invoiceId: inv.id }, { creditNoteId: inv.id }] } });
    if (allocated) throw financeError(409, "INVOICE_ALLOCATED", "Payments or credits are allocated to this document — release them first");
    const today = businessToday(business);
    const revalue = new Map<string, { deltaMinor: number; qty: number }>();
    for (const l of inv.lines) {
      const d = l.priceDifference === null ? 0 : toMinor(l.priceDifference, cur);
      if (l.lineType !== "STOCK" || !d) continue;
      const r = revalue.get(l.variantId!) ?? { deltaMinor: 0, qty: 0 };
      revalue.set(l.variantId!, { deltaMinor: r.deltaMinor - d, qty: r.qty + l.quantity });
    }
    const items = [...revalue.entries()].map(([variantId, r]) => ({ variantId, ...r })).filter((r) => r.deltaMinor !== 0);
    if (items.length) {
      const scope = await activeCostingInTx(tx);
      if (!scope) throw financeError(409, "COSTING_NOT_ACTIVE", "Inventory costing is not active");
      await revalueForDocumentInTx(tx, { scope, sourceType: "SupplierInvoice", sourceId: inv.id, financialDate: today, note: `Voided ${invoiceNumber(inv.kind, inv.number)}`, items });
    }
    const original = await tx.financialEvent.findUnique({ where: { sourceInstallId_eventKey: { sourceInstallId: installId, eventKey: `ap-inv:${inv.id}#r0` } } });
    await recordFinancialEvent(tx, {
      contract: "finance.event", contractVersion: 1, businessKey: business.key, brandKey: brand.key,
      source: { installId, system: "payables", entityType: "SupplierInvoice", entityId: inv.id },
      event: { type: PAYABLES_EVENT_TYPES.invoicePosted, version: 1, key: `ap-inv:${inv.id}#r1`, occurredAt: new Date().toISOString() },
      financialDate: today, currency: cur,
      payload: { invoiceId: inv.id, number: invoiceNumber(inv.kind, inv.number), kind: inv.kind, supplierId: inv.supplierId, totalMinor: 0, lines: [], void: true, supersedes: original?.id ?? null } satisfies InvoicePostedPayload,
    });
    const after = await tx.supplierInvoice.update({ where: { id }, data: { status: "VOID", voidedAt: new Date(), voidedByAdminId: adminOf(actor), voidReason: reason }, include: INCLUDE });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "supplier_invoice.void", entityType: "SupplierInvoice", entityId: id, reason, before: { status: inv.status }, after: { status: "VOID", reversedPriceDifferences: items } });
    return supplierInvoiceDto(after, cur);
  });
}

export async function getSupplierInvoice(id: string) {
  const { business } = await getFinanceContext();
  return supplierInvoiceDto(await load(prisma, business.id, id), business.baseCurrency, businessToday(business));
}

export async function listSupplierInvoices(q: { status?: SupplierInvoiceStatus; kind?: SupplierInvoiceKind; supplierId?: string; q?: string; page: number; pageSize: number }) {
  const { business } = await getFinanceContext();
  const num = q.q ? Number(q.q.replace(/^(BILL|CN)-?/i, "")) : NaN;
  const where: Prisma.SupplierInvoiceWhereInput = {
    businessId: business.id, status: q.status, kind: q.kind, supplierId: q.supplierId,
    ...(q.q ? { OR: [...(Number.isSafeInteger(num) ? [{ number: num }] : []), { supplierRef: { contains: q.q, mode: "insensitive" as const } }, { supplier: { displayName: { contains: q.q, mode: "insensitive" as const } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.supplierInvoice.count({ where }),
    prisma.supplierInvoice.findMany({ where, include: INCLUDE, orderBy: [{ invoiceDate: "desc" }, { number: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  const today = businessToday(business);
  return { total, page: q.page, pageSize: q.pageSize, invoices: rows.map((r) => supplierInvoiceDto(r, business.baseCurrency, today)) };
}

/** What a supplier can bill or credit now: received-not-invoiced goods, shipped-not-credited returns, approved production
 * costs not invoiced, and ordered services / expenses not invoiced — the bill-entry picker. */
export async function supplierOpenItems(supplierId: string) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const s = await prisma.supplier.findFirst({ where: { id: supplierId, businessId: business.id }, select: { id: true, displayName: true, paymentTermsDays: true, defaultTaxCodeId: true } });
  if (!s) throw financeError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
  const posted = { invoice: { status: "POSTED" as const } };
  const grnLines = await prisma.goodsReceiptLine.findMany({
    where: { goodsReceipt: { supplierId, status: "POSTED" }, qtyAccepted: { gt: 0 } },
    include: { goodsReceipt: { select: { id: true, number: true, receiptDate: true } }, variant: { select: { sku: true, size: true, color: true, product: { select: { name: true } } } }, purchaseOrderLine: { select: { unitPrice: true, taxCodeId: true } }, invoiceLines: { where: posted, select: { quantity: true } } },
    orderBy: { createdAt: "asc" },
  });
  const returnLines = await prisma.purchaseReturnLine.findMany({
    where: { purchaseReturn: { supplierId, status: "SHIPPED" } },
    include: { purchaseReturn: { select: { id: true, number: true, returnDate: true } }, variant: { select: { sku: true } }, invoiceLines: { where: posted, select: { quantity: true } } },
  });
  const costs = await prisma.productionCostEntry.findMany({
    where: { supplierId, status: "APPROVED", invoiceLines: { none: posted } },
    include: { productionOrder: { select: { id: true, number: true } }, category: { select: { name: true } } },
  });
  const orderLines = await prisma.purchaseOrderLine.findMany({
    where: { lineType: "NON_STOCK", purchaseOrder: { supplierId, status: { in: ["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED"] } } },
    include: { purchaseOrder: { select: { id: true, number: true } }, invoiceLines: { where: posted, select: { quantity: true } } },
  });
  const sumQ = (ls: Array<{ quantity: number }>) => ls.reduce((n, l) => n + l.quantity, 0);
  return {
    supplier: s,
    goods: grnLines
      .map((l) => ({
        goodsReceiptLineId: l.id, goodsReceipt: { id: l.goodsReceipt.id, number: docNumber("GRN", l.goodsReceipt.number), date: businessDateOf(l.goodsReceipt.receiptDate) },
        sku: l.variant.sku, name: `${l.variant.product.name} — ${l.variant.size} / ${l.variant.color}`, open: l.qtyAccepted - sumQ(l.invoiceLines),
        receiptUnitCost: toMajorNumber(toMinor(l.unitCost, cur), cur), orderedUnitPrice: l.purchaseOrderLine ? toMajorNumber(toMinor(l.purchaseOrderLine.unitPrice, cur), cur) : null, taxCodeId: l.purchaseOrderLine?.taxCodeId ?? s.defaultTaxCodeId,
      }))
      .filter((l) => l.open > 0),
    returns: returnLines
      .map((l) => ({ purchaseReturnLineId: l.id, purchaseReturn: { id: l.purchaseReturn.id, number: docNumber("RTN", l.purchaseReturn.number) }, sku: l.variant.sku, open: l.quantity - sumQ(l.invoiceLines), returnedUnitValue: l.value === null ? null : toMajorNumber(Math.round(toMinor(l.value, cur) / l.quantity), cur) }))
      .filter((l) => l.open > 0),
    productionCosts: costs.map((c) => ({ productionCostEntryId: c.id, productionOrder: { id: c.productionOrder.id, number: docNumber("MO", c.productionOrder.number) }, category: c.category.name, description: c.description, reference: c.reference, amount: toMajorNumber(toMinor(c.amount, cur), cur) })),
    services: orderLines
      .map((l) => ({ purchaseOrderLineId: l.id, purchaseOrder: { id: l.purchaseOrder.id, number: docNumber("PO", l.purchaseOrder.number) }, description: l.description, expenseAccountId: l.expenseAccountId, open: l.qtyOrdered - sumQ(l.invoiceLines), unitPrice: toMajorNumber(toMinor(l.unitPrice, cur), cur), taxCodeId: l.taxCodeId }))
      .filter((l) => l.open > 0),
  };
}

/** Accounts payable ageing: each supplier's outstanding bills (and what they were owed at the opening date) by days past
 * due, less credit notes and payments not yet allocated to a bill (advances). The balance equals the supplier's payables
 * account. */
export async function payablesAgeing() {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  // posted refunds (money the supplier paid back) reduce the advance or credit they came from
  const postedRefunds = { where: { kind: "SUPPLIER_REFUND" as const, status: "POSTED" as const }, select: { amount: true } };
  const rows = await prisma.supplierInvoice.findMany({ where: { businessId: business.id, status: "POSTED" }, select: { id: true, kind: true, dueDate: true, total: true, supplier: { select: { id: true, code: true, displayName: true } }, allocations: INCLUDE.allocations, creditAllocations: INCLUDE.creditAllocations, refunds: postedRefunds } });
  const payments = await prisma.treasuryMovement.findMany({ where: { businessId: business.id, kind: "SUPPLIER_PAYMENT", status: "POSTED" }, select: { amount: true, supplier: { select: { id: true, code: true, displayName: true } }, supplierAllocations: { where: { status: "ACTIVE" }, select: { amount: true } }, refunds: postedRefunds } });
  const BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
  type Row = { supplier: { id: string; code: string; displayName: string }; buckets: Record<(typeof BUCKETS)[number], number>; credits: number; advances: number; invoices: number };
  const by = new Map<string, Row>();
  const rowOf = (supplier: Row["supplier"]) => by.get(supplier.id) ?? { supplier, buckets: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 }, credits: 0, advances: 0, invoices: 0 };
  const sum = (xs: Array<{ amount: Prisma.Decimal }>) => xs.reduce((s, a) => s + toMinor(a.amount, cur), 0);
  for (const r of rows) {
    const row = rowOf(r.supplier);
    const total = toMinor(r.total!, cur);
    if (r.kind === "CREDIT_NOTE") row.credits += total - sum(r.creditAllocations) - sum(r.refunds);
    else {
      const open = total - sum(r.allocations.filter((a) => a.creditNoteId || a.paymentMovement?.status === "POSTED"));
      if (open > 0) row.invoices += 1;
      const days = Math.round((Date.parse(`${today}T00:00:00Z`) - r.dueDate.getTime()) / 86_400_000);
      const b = days <= 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90_plus";
      row.buckets[b] += open;
    }
    by.set(r.supplier.id, row);
  }
  for (const p of payments) {
    const row = rowOf(p.supplier!);
    row.advances += toMinor(p.amount, cur) - sum(p.supplierAllocations) - sum(p.refunds);
    by.set(p.supplier!.id, row);
  }
  // What a supplier was owed at the opening date ages like a bill due that day; payments not allocated to a bill settle it
  // first (an opening due has no bill to allocate to).
  const ap = await prisma.accountMapping.findUnique({ where: { businessId_key: { businessId: business.id, key: "liability.payable_trade" } }, select: { accountId: true } });
  const dues = ap && business.openingDate ? await supplierOpeningDues(prisma, business.id, ap.accountId, cur) : new Map<string, number>();
  if (dues.size) {
    const owed = await prisma.supplier.findMany({ where: { id: { in: [...dues.keys()] } }, select: { id: true, code: true, displayName: true } });
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${business.openingDate}T00:00:00Z`)) / 86_400_000);
    const b = days <= 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90_plus";
    for (const s of owed) {
      const row = rowOf(s);
      const due = dues.get(s.id)!;
      if (due < 0) row.advances -= due;
      else {
        const applied = Math.max(0, Math.min(due, row.advances));
        row.advances -= applied;
        if (due > applied) row.invoices += 1;
        row.buckets[b] += due - applied;
      }
      by.set(s.id, row);
    }
  }
  const major = (n: number) => toMajorNumber(n, cur);
  const figures = (buckets: Row["buckets"], credits: number, advances: number) => {
    const gross = BUCKETS.reduce((s, b) => s + buckets[b], 0);
    return { ...Object.fromEntries(BUCKETS.map((b) => [b, major(buckets[b])])) as Record<(typeof BUCKETS)[number], number>, credits: major(credits), advances: major(advances), balance: major(gross - credits - advances), overdue: major(gross - buckets.current) };
  };
  const all = [...by.values()].filter((r) => BUCKETS.some((b) => r.buckets[b]) || r.credits || r.advances);
  const suppliers = all.map((r) => ({ supplier: r.supplier, invoices: r.invoices, ...figures(r.buckets, r.credits, r.advances) })).sort((a, b) => b.balance - a.balance);
  const sumBuckets = Object.fromEntries(BUCKETS.map((b) => [b, all.reduce((s, r) => s + r.buckets[b], 0)])) as Row["buckets"];
  const totals = figures(sumBuckets, all.reduce((s, r) => s + r.credits, 0), all.reduce((s, r) => s + r.advances, 0));
  return { asOf: today, suppliers, totals };
}
