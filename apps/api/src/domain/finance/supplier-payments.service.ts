/**
 * Supplier payments and allocations (Financial Core Phase 4F, docs/FINANCE_PHASE_4F.md).
 *
 * A payment is a Treasury movement of kind SUPPLIER_PAYMENT (treasury.service — idempotent, approval thresholds, overdraft
 * rules, reversal and bank reconciliation all as for any money movement): Dr trade payables with the supplier as party /
 * Cr the money account. It may settle bills at once (allocations); what is not allocated is an advance on the supplier's
 * account until it is allocated to a later bill. A posted credit note is allocated to bills the same way.
 *
 * An allocation has no journal — the payment, the credit and the bill already sit on the payables account for the same
 * supplier; it only says which bill they settle. A bill's outstanding = total − ACTIVE allocations from posted payments and
 * posted credit notes; allocations from a payment still waiting for approval are reserved (they block over-allocation) but
 * settle nothing until it posts. Rejecting or reversing a payment releases its allocations. The database refuses any
 * over-allocation of a bill, a payment or a credit note (checked at commit).
 */
import { Prisma } from "@prisma/client";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { businessDateOf, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { MOVEMENT_INCLUDE, movementDto, requestMovementInTx } from "./treasury.service";
import { resolveMappedAccount } from "./chart.service";
import { adminOf } from "./purchase-orders.service";
import { invoiceNumber } from "./supplier-invoices.service";
import { supplierOpeningDues } from "./opening-balances.service";

type Db = AppTransactionClient | typeof prisma;

/** Money accounts a supplier is paid from (gateway and courier clearing accounts hold customers' money in transit). */
const PAYING_KINDS = new Set(["CASH", "BANK", "MOBILE_WALLET"]);

/** Amounts settled on each bill (minor): `settled` from posted sources only; `reserved` also counts payments awaiting approval. */
export async function settlementOf(db: Db, invoiceIds: string[], cur: string) {
  const out = new Map<string, { settled: number; reserved: number }>();
  if (!invoiceIds.length) return out;
  const rows = await db.supplierAllocation.findMany({
    where: { invoiceId: { in: invoiceIds }, status: "ACTIVE" },
    select: { invoiceId: true, amount: true, paymentMovement: { select: { status: true } }, creditNoteId: true },
  });
  for (const r of rows) {
    const x = out.get(r.invoiceId) ?? { settled: 0, reserved: 0 };
    const a = toMinor(r.amount, cur);
    x.reserved += a;
    if (r.creditNoteId || r.paymentMovement?.status === "POSTED") x.settled += a;
    out.set(r.invoiceId, x);
  }
  return out;
}

/** What a payment or credit note has left to allocate (minor). */
/** What is left of a payment or credit note: less its active allocations and its live refunds (awaiting approval or posted). */
async function unallocated(db: Db, source: { paymentMovementId?: string; creditNoteId?: string }, capMinor: number, cur: string) {
  const [used, refunded] = await Promise.all([
    db.supplierAllocation.aggregate({ where: { ...source, status: "ACTIVE" }, _sum: { amount: true } }),
    db.treasuryMovement.aggregate({
      where: { kind: "SUPPLIER_REFUND", status: { in: ["PENDING_APPROVAL", "POSTED"] }, ...(source.paymentMovementId ? { refundOfPaymentId: source.paymentMovementId } : { refundOfCreditNoteId: source.creditNoteId }) },
      _sum: { amount: true },
    }),
  ]);
  return capMinor - (used._sum.amount ? toMinor(used._sum.amount, cur) : 0) - (refunded._sum.amount ? toMinor(refunded._sum.amount, cur) : 0);
}

async function lockBills(tx: AppTransactionClient, businessId: string, supplierId: string, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  if (!sorted.length) return [];
  await tx.$queryRaw`SELECT id FROM "SupplierInvoice" WHERE id IN (${Prisma.join(sorted)}) ORDER BY id FOR UPDATE`;
  const bills = await tx.supplierInvoice.findMany({ where: { id: { in: sorted }, businessId } });
  for (const id of sorted) {
    const b = bills.find((x) => x.id === id);
    if (!b) throw financeError(404, "SUPPLIER_INVOICE_NOT_FOUND", "Bill not found");
    if (b.supplierId !== supplierId) throw financeError(400, "ALLOCATION_SUPPLIER", `${invoiceNumber(b.kind, b.number)} is another supplier's`);
    if (b.kind !== "INVOICE" || b.status !== "POSTED") throw financeError(409, "ALLOCATION_TARGET", `${invoiceNumber(b.kind, b.number)} isn't a posted bill`);
  }
  return bills;
}

/** Checks each requested allocation fits the bill's open amount (reserved allocations included). */
async function assertFits(tx: AppTransactionClient, bills: Awaited<ReturnType<typeof lockBills>>, allocations: Array<{ invoiceId: string; amountMinor: number }>, cur: string) {
  const s = await settlementOf(tx, bills.map((b) => b.id), cur);
  for (const a of allocations) {
    const b = bills.find((x) => x.id === a.invoiceId)!;
    const open = toMinor(b.total!, cur) - (s.get(b.id)?.reserved ?? 0);
    if (a.amountMinor <= 0) throw financeError(400, "ALLOCATION_AMOUNT", "An allocation is more than zero");
    if (a.amountMinor > open) throw financeError(409, "ALLOCATION_EXCEEDS_OPEN", `${invoiceNumber(b.kind, b.number)} has ${toMajorNumber(open, cur)} open`);
  }
}

export interface SupplierPaymentInput {
  supplierId: string;
  fromFinancialAccountId: string;
  movementDate?: string;
  amount: number;
  reference?: string | null;
  description?: string | null;
  allocations?: Array<{ invoiceId: string; amount: number }>;
}

/** Pays a supplier from a money account, settling the named bills; idempotent by the request's key. */
export async function paySupplier(input: SupplierPaymentInput, actor: FinanceActor, idempotencyKey: string | null) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every payment");
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const movementDate = input.movementDate ?? businessToday(business);
  if (business.openingDate && movementDate < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
  return financeTransaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, businessId: business.id } });
    if (!supplier) throw financeError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
    const allocations = (input.allocations ?? []).map((a) => ({ invoiceId: a.invoiceId, amountMinor: toMinor(a.amount, cur) }));
    if (new Set(allocations.map((a) => a.invoiceId)).size !== allocations.length) throw financeError(400, "ALLOCATION_TWICE", "Each bill once per payment");
    const amountMinor = toMinor(input.amount, cur);
    if (allocations.reduce((s, a) => s + a.amountMinor, 0) > amountMinor) throw financeError(400, "ALLOCATION_EXCEEDS_PAYMENT", "The allocations exceed the payment");
    const source = await tx.financialAccount.findFirst({ where: { id: input.fromFinancialAccountId, businessId: business.id }, select: { kind: true, name: true } });
    if (source && !PAYING_KINDS.has(source.kind)) throw financeError(400, "PAYMENT_SOURCE_KIND", `${source.name} is a clearing account — pay suppliers from cash, a bank or a wallet`);
    const bills = await lockBills(tx, business.id, supplier.id, allocations.map((a) => a.invoiceId));
    const { movement, replayed } = await requestMovementInTx(tx, business, {
      kind: "SUPPLIER_PAYMENT", movementDate, amount: input.amount, fromFinancialAccountId: input.fromFinancialAccountId, supplierId: supplier.id,
      reference: input.reference ?? null, description: input.description?.trim() || `Payment to ${supplier.displayName}`,
    }, actor, `supplier-payment:${idempotencyKey}`);
    if (replayed) return { payment: movementDto(movement), replayed: true };
    await assertFits(tx, bills, allocations, cur);
    for (const a of allocations) {
      const row = await tx.supplierAllocation.create({ data: { businessId: business.id, supplierId: supplier.id, invoiceId: a.invoiceId, paymentMovementId: movement.id, amount: toDecimal(a.amountMinor, cur), createdByAdminId: adminOf(actor) } });
      await recordFinanceAudit(tx, { businessId: business.id, actor, action: "supplier_allocation.create", entityType: "SupplierAllocation", entityId: row.id, after: { invoiceId: a.invoiceId, paymentMovementId: movement.id, amountMinor: a.amountMinor } });
    }
    return { payment: movementDto(movement), replayed: false };
  });
}

/** Money a supplier pays back from an advance (an unallocated payment) or an unapplied credit note: a SUPPLIER_REFUND into
 * cash, a bank or a wallet against payables. Never more than is left of the source; idempotent by the request's key. */
export async function refundFromSupplier(input: { supplierId: string; toFinancialAccountId: string; amount: number; movementDate?: string; reference?: string | null; paymentMovementId?: string | null; creditNoteId?: string | null }, actor: FinanceActor, idempotencyKey: string | null) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every refund");
  if (Boolean(input.paymentMovementId) === Boolean(input.creditNoteId)) throw financeError(400, "REFUND_SOURCE", "Refund against a payment or a credit note");
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const movementDate = input.movementDate ?? businessToday(business);
  if (business.openingDate && movementDate < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
  return financeTransaction(async (tx) => {
    const key = `supplier-refund:${idempotencyKey}`;
    const prior = await tx.treasuryMovement.findFirst({ where: { businessId: business.id, idempotencyKey: key }, include: MOVEMENT_INCLUDE });
    if (prior) {
      if (prior.kind !== "SUPPLIER_REFUND") throw financeError(409, "IDEMPOTENCY_KEY_REUSED", "This key was used for another money movement");
      return { refund: movementDto(prior), replayed: true };
    }
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, businessId: business.id } });
    if (!supplier) throw financeError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
    const into = await tx.financialAccount.findFirst({ where: { id: input.toFinancialAccountId, businessId: business.id }, select: { kind: true, name: true } });
    if (into && !PAYING_KINDS.has(into.kind)) throw financeError(400, "REFUND_ACCOUNT_KIND", `${into.name} is a clearing account — a refund comes into cash, a bank or a wallet`);
    let capMinor: number;
    let label: string;
    if (input.paymentMovementId) {
      const [m] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "TreasuryMovement" WHERE id = ${input.paymentMovementId} AND "businessId" = ${business.id} FOR UPDATE`;
      if (!m) throw financeError(404, "MOVEMENT_NOT_FOUND", "Payment not found");
      const pay = await tx.treasuryMovement.findUniqueOrThrow({ where: { id: m.id } });
      if (pay.kind !== "SUPPLIER_PAYMENT" || pay.status !== "POSTED" || pay.supplierId !== supplier.id) throw financeError(409, "PAYMENT_NOT_POSTED", "Only a posted payment to this supplier is refunded");
      capMinor = await unallocated(tx, { paymentMovementId: pay.id }, toMinor(pay.amount, cur), cur);
      label = `advance of ${businessDateOf(pay.movementDate)}`;
    } else {
      const [c] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "SupplierInvoice" WHERE id = ${input.creditNoteId!} AND "businessId" = ${business.id} FOR UPDATE`;
      if (!c) throw financeError(404, "SUPPLIER_INVOICE_NOT_FOUND", "Credit note not found");
      const cn = await tx.supplierInvoice.findUniqueOrThrow({ where: { id: c.id } });
      if (cn.kind !== "CREDIT_NOTE" || cn.status !== "POSTED" || cn.supplierId !== supplier.id) throw financeError(409, "CREDIT_NOT_POSTED", "Only a posted credit note of this supplier is refunded");
      capMinor = await unallocated(tx, { creditNoteId: cn.id }, toMinor(cn.total!, cur), cur);
      label = invoiceNumber(cn.kind, cn.number);
    }
    const amountMinor = toMinor(input.amount, cur);
    if (amountMinor <= 0) throw financeError(400, "REFUND_AMOUNT", "A refund is more than zero");
    if (amountMinor > capMinor) throw financeError(409, "REFUND_EXCEEDS_SOURCE", `Only ${toMajorNumber(capMinor, cur)} is left to refund`);
    const { movement } = await requestMovementInTx(tx, business, {
      kind: "SUPPLIER_REFUND", movementDate, amount: input.amount, toFinancialAccountId: input.toFinancialAccountId, supplierId: supplier.id,
      refundOfPaymentId: input.paymentMovementId ?? null, refundOfCreditNoteId: input.creditNoteId ?? null,
      reference: input.reference ?? null, description: `Refund from ${supplier.displayName} — ${label}`.slice(0, 300),
    }, actor, key);
    return { refund: movementDto(movement), replayed: false };
  });
}

/** Allocates an advance (an unallocated payment) or a posted credit note to a posted bill of the same supplier. */
export async function allocateToBill(input: { invoiceId: string; amount: number; paymentMovementId?: string | null; creditNoteId?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  if (Boolean(input.paymentMovementId) === Boolean(input.creditNoteId)) throw financeError(400, "ALLOCATION_SOURCE", "Allocate from a payment or a credit note");
  return financeTransaction(async (tx) => {
    const amountMinor = toMinor(input.amount, cur);
    let supplierId: string;
    let capMinor: number;
    if (input.paymentMovementId) {
      const [m] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "TreasuryMovement" WHERE id = ${input.paymentMovementId} AND "businessId" = ${business.id} FOR UPDATE`;
      if (!m) throw financeError(404, "MOVEMENT_NOT_FOUND", "Payment not found");
      const p = await tx.treasuryMovement.findUniqueOrThrow({ where: { id: m.id } });
      if (p.kind !== "SUPPLIER_PAYMENT" || p.status !== "POSTED") throw financeError(409, "PAYMENT_NOT_POSTED", "Only a posted supplier payment is allocated");
      supplierId = p.supplierId!;
      capMinor = await unallocated(tx, { paymentMovementId: p.id }, toMinor(p.amount, cur), cur);
    } else {
      const [c] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "SupplierInvoice" WHERE id = ${input.creditNoteId!} AND "businessId" = ${business.id} FOR UPDATE`;
      if (!c) throw financeError(404, "SUPPLIER_INVOICE_NOT_FOUND", "Credit note not found");
      const cn = await tx.supplierInvoice.findUniqueOrThrow({ where: { id: c.id } });
      if (cn.kind !== "CREDIT_NOTE" || cn.status !== "POSTED") throw financeError(409, "CREDIT_NOT_POSTED", "Only a posted credit note is allocated");
      supplierId = cn.supplierId;
      capMinor = await unallocated(tx, { creditNoteId: cn.id }, toMinor(cn.total!, cur), cur);
    }
    if (amountMinor > capMinor) throw financeError(409, "ALLOCATION_EXCEEDS_SOURCE", `Only ${toMajorNumber(capMinor, cur)} is left to allocate`);
    const bills = await lockBills(tx, business.id, supplierId, [input.invoiceId]);
    await assertFits(tx, bills, [{ invoiceId: input.invoiceId, amountMinor }], cur);
    const row = await tx.supplierAllocation.create({ data: { businessId: business.id, supplierId, invoiceId: input.invoiceId, paymentMovementId: input.paymentMovementId ?? null, creditNoteId: input.creditNoteId ?? null, amount: toDecimal(amountMinor, cur), createdByAdminId: adminOf(actor) } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "supplier_allocation.create", entityType: "SupplierAllocation", entityId: row.id, after: { invoiceId: input.invoiceId, paymentMovementId: input.paymentMovementId ?? null, creditNoteId: input.creditNoteId ?? null, amountMinor } });
    return { id: row.id, amount: toMajorNumber(amountMinor, cur) };
  });
}

/** Releases an allocation (the bill is open again by that amount; the payment or credit is free to allocate again). */
export async function releaseAllocation(id: string, reason: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const [r] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "SupplierAllocation" WHERE id = ${id} AND "businessId" = ${business.id} FOR UPDATE`;
    if (!r) throw financeError(404, "ALLOCATION_NOT_FOUND", "Allocation not found");
    const a = await tx.supplierAllocation.findUniqueOrThrow({ where: { id } });
    if (a.status === "RELEASED") return { id, status: a.status };
    await tx.supplierAllocation.update({ where: { id }, data: { status: "RELEASED", releasedAt: new Date(), releasedByAdminId: adminOf(actor), releaseReason: reason } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "supplier_allocation.release", entityType: "SupplierAllocation", entityId: id, before: { status: "ACTIVE" }, after: { status: "RELEASED" }, reason });
    return { id, status: "RELEASED" as const };
  });
}

/**
 * A supplier's account: the statement (every posting on the payables account with the supplier as party — the ledger
 * itself, so it always agrees with the books), what they were owed at the opening date, open bills with what is settled
 * and outstanding, unallocated payments (advances) and credit notes, and the balance.
 */
export async function supplierAccount(supplierId: string, q: { from?: string; to?: string } = {}) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, businessId: business.id }, select: { id: true, code: true, displayName: true, paymentTermsDays: true } });
  if (!supplier) throw financeError(404, "SUPPLIER_NOT_FOUND", "Supplier not found");
  const ap = await resolveMappedAccount(prisma as unknown as AppTransactionClient, business.id, "liability.payable_trade");
  const where: Prisma.JournalLineWhereInput = { accountId: ap.id, partyType: "Supplier", partyId: supplierId, entry: { status: "POSTED", businessId: business.id } };
  const [before] = await prisma.$queryRaw<Array<{ v: Prisma.Decimal | null }>>`
    SELECT SUM(l.credit - l.debit) AS v FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
    WHERE l."accountId" = ${ap.id} AND l."partyType" = 'Supplier' AND l."partyId" = ${supplierId} AND e.status = 'POSTED' AND e."businessId" = ${business.id}
      AND ${q.from ?? "0001-01-01"}::date > e."entryDate"`;
  const lines = await prisma.journalLine.findMany({
    where: { ...where, entry: { status: "POSTED", businessId: business.id, entryDate: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T00:00:00Z`) } : {}) } } },
    select: { id: true, debit: true, credit: true, memo: true, entry: { select: { id: true, entryDate: true, description: true, reference: true, kind: true, createdAt: true } } },
    orderBy: [{ entry: { entryDate: "asc" } }, { entry: { createdAt: "asc" } }],
  });
  let running = before?.v ? toMinor(before.v, cur) : 0;
  const opening = running;
  const statement = lines.map((l) => {
    const amount = toMinor(l.credit, cur) - toMinor(l.debit, cur); // + owed more (bill), − owed less (payment, credit)
    running += amount;
    return { id: l.id, date: businessDateOf(l.entry.entryDate), description: l.entry.description, reference: l.entry.reference, kind: l.entry.kind, owedMore: amount > 0 ? toMajorNumber(amount, cur) : 0, owedLess: amount < 0 ? toMajorNumber(-amount, cur) : 0, balance: toMajorNumber(running, cur) };
  });
  const bills = await prisma.supplierInvoice.findMany({ where: { supplierId, businessId: business.id, kind: "INVOICE", status: "POSTED" }, orderBy: [{ dueDate: "asc" }, { number: "asc" }] });
  const settled = await settlementOf(prisma, bills.map((b) => b.id), cur);
  const today = businessToday(business);
  const openBills = bills
    .map((b) => {
      const total = toMinor(b.total!, cur);
      const s = settled.get(b.id) ?? { settled: 0, reserved: 0 };
      return { id: b.id, number: invoiceNumber(b.kind, b.number), supplierRef: b.supplierRef, invoiceDate: businessDateOf(b.invoiceDate), dueDate: businessDateOf(b.dueDate), overdue: businessDateOf(b.dueDate) < today, total: toMajorNumber(total, cur), settled: toMajorNumber(s.settled, cur), awaitingApproval: toMajorNumber(s.reserved - s.settled, cur), outstanding: toMajorNumber(total - s.settled, cur), allocatable: toMajorNumber(total - s.reserved, cur) };
    })
    .filter((b) => b.outstanding > 0 || b.awaitingApproval > 0);
  const payments = await prisma.treasuryMovement.findMany({ where: { supplierId, kind: "SUPPLIER_PAYMENT", status: "POSTED" }, include: { fromAccount: { select: { name: true } } }, orderBy: { movementDate: "asc" } });
  // What the supplier was owed at the opening date has no bill to allocate to: payments not allocated to a bill settle it
  // first, oldest first; only what is left over is an advance.
  const due = business.openingDate ? ((await supplierOpeningDues(prisma, business.id, ap.id, cur, supplierId)).get(supplierId) ?? 0) : 0;
  let dueLeft = Math.max(0, due);
  const advances = [];
  for (const p of payments) {
    let left = await unallocated(prisma, { paymentMovementId: p.id }, toMinor(p.amount, cur), cur);
    const applied = Math.min(Math.max(left, 0), dueLeft);
    dueLeft -= applied;
    left -= applied;
    if (left > 0) advances.push({ paymentMovementId: p.id, date: businessDateOf(p.movementDate), reference: p.reference, from: p.fromAccount?.name ?? null, amount: toMajorNumber(toMinor(p.amount, cur), cur), unallocated: toMajorNumber(left, cur) });
  }
  const credits = await prisma.supplierInvoice.findMany({ where: { supplierId, businessId: business.id, kind: "CREDIT_NOTE", status: "POSTED" }, orderBy: { invoiceDate: "asc" } });
  const unappliedCredits = [];
  for (const c of credits) {
    const left = await unallocated(prisma, { creditNoteId: c.id }, toMinor(c.total!, cur), cur);
    if (left > 0) unappliedCredits.push({ creditNoteId: c.id, number: invoiceNumber(c.kind, c.number), supplierRef: c.supplierRef, date: businessDateOf(c.invoiceDate), total: toMajorNumber(toMinor(c.total!, cur), cur), unallocated: toMajorNumber(left, cur) });
  }
  // active allocations (what settles which bill) — each can be released, reopening the bill by its amount
  const active = await prisma.supplierAllocation.findMany({
    where: { supplierId, businessId: business.id, status: "ACTIVE" },
    include: { invoice: { select: { kind: true, number: true, supplierRef: true } }, paymentMovement: { select: { movementDate: true, reference: true, status: true } }, creditNote: { select: { kind: true, number: true, supplierRef: true } } },
    orderBy: { createdAt: "desc" },
  });
  const allocations = active
    .filter((a) => !a.paymentMovement || a.paymentMovement.status === "POSTED" || a.paymentMovement.status === "PENDING_APPROVAL")
    .map((a) => ({
      id: a.id, amount: toMajorNumber(toMinor(a.amount, cur), cur), date: businessDateOf(a.createdAt),
      bill: { id: a.invoiceId, number: invoiceNumber(a.invoice.kind, a.invoice.number), supplierRef: a.invoice.supplierRef },
      source: a.paymentMovementId ? ("PAYMENT" as const) : ("CREDIT_NOTE" as const),
      sourceLabel: a.paymentMovement ? `Payment ${businessDateOf(a.paymentMovement.movementDate)}${a.paymentMovement.reference ? ` · ${a.paymentMovement.reference}` : ""}${a.paymentMovement.status === "PENDING_APPROVAL" ? " (awaiting approval)" : ""}` : a.creditNote ? `${invoiceNumber(a.creditNote.kind, a.creditNote.number)} · ${a.creditNote.supplierRef}` : "—",
    }));
  const openingDue = due > 0 ? { date: business.openingDate!, amount: toMajorNumber(due, cur), paid: toMajorNumber(due - dueLeft, cur), outstanding: toMajorNumber(dueLeft, cur) } : null;
  return { supplier, asOf: today, opening: toMajorNumber(opening, cur), balance: toMajorNumber(running, cur), statement, openingDue, openBills, advances, unappliedCredits, allocations };
}
