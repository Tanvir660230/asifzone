/**
 * Treasury movements (Financial Core Phase 2, docs/FINANCE_PHASE_2.md §3): deposits, withdrawals, transfers, explicit
 * adjustments and opening funding of financial accounts. A movement is a REQUEST with an idempotency key; its ledger
 * effect is one TREASURY journal posted by journal.service (never a balance written anywhere — an account's balance is its
 * ledger account's balance). A reversal is a second journal.
 *
 *   DEPOSIT / OPENING_FUNDING / ADJUSTMENT IN   Dr the account        Cr the counter account
 *   WITHDRAWAL / ADJUSTMENT OUT                 Dr the counter        Cr the account
 *   TRANSFER                                    Dr the destination    Cr the source        (no revenue, no expense)
 *   SUPPLIER_PAYMENT (Phase 4F)                 Dr trade payables (the supplier as party)  Cr the account
 *   SUPPLIER_REFUND                             Dr the account        Cr trade payables (the supplier as party)
 *
 * Rules: counter accounts are never revenue or COGS (sales and their cost arrive as commerce events, Phase 3) and never a
 * money account (that is a transfer); transfers never cross brands; cash and mobile-wallet balances never go negative
 * (checked under a per-account lock, so concurrent withdrawals can't both pass); a movement of at least an account's
 * approval threshold — or requested by someone without finance.post — waits for approval by a finance.post holder, who
 * for a threshold approval must be a different person.
 */
import type { FinancialAccount, LedgerAccount, Prisma, TreasuryMovement, TreasuryMovementKind } from "@prisma/client";
import type { AppTransactionClient } from "../../config/prisma";
import { prisma } from "../../config/prisma";
import { actorCan, recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { resolveMappedAccount } from "./chart.service";
import { postJournalInTx, reverseJournalInTx, type JournalLineSpec } from "./journal.service";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { moneyBalanceAt } from "./ledger.service";

export interface MovementRequest {
  kind: TreasuryMovementKind;
  direction?: "IN" | "OUT" | null;
  movementDate: string;
  /** Major units. */
  amount: number;
  reference?: string | null;
  description: string;
  reason?: string | null;
  fromFinancialAccountId?: string | null;
  toFinancialAccountId?: string | null;
  counterAccountId?: string | null;
  bankTransactionId?: string | null;
  reconciliationId?: string | null;
  /** SUPPLIER_PAYMENT / SUPPLIER_REFUND only (supplier-payments.service): the supplier, party of the payables line. */
  supplierId?: string | null;
  /** SUPPLIER_REFUND only — exactly one: the advance payment or the credit note refunded. */
  refundOfPaymentId?: string | null;
  refundOfCreditNoteId?: string | null;
}

/** Kinds of money account whose balance can't go below zero (an overdraft exists only at a bank or a gateway). */
const NO_OVERDRAFT = new Set(["CASH", "MOBILE_WALLET"]);
const FORBIDDEN_COUNTER_TYPES = new Set(["REVENUE", "COGS"]);

export const MOVEMENT_INCLUDE = {
  fromAccount: { select: { id: true, name: true, kind: true, brandId: true } },
  toAccount: { select: { id: true, name: true, kind: true, brandId: true } },
  counterAccount: { select: { id: true, code: true, name: true } },
} satisfies Prisma.TreasuryMovementInclude;
type MovementRow = Prisma.TreasuryMovementGetPayload<{ include: typeof MOVEMENT_INCLUDE }>;

export function movementDto(m: MovementRow) {
  const cur = m.currency;
  return {
    id: m.id,
    kind: m.kind,
    status: m.status,
    direction: m.direction,
    movementDate: businessDateOf(m.movementDate),
    amount: toMajorNumber(toMinor(m.amount, cur), cur),
    currency: cur,
    brandId: m.brandId,
    fromAccount: m.fromAccount,
    toAccount: m.toAccount,
    counterAccount: m.counterAccount,
    reference: m.reference,
    description: m.description,
    reason: m.reason,
    journalEntryId: m.journalEntryId,
    reversalJournalEntryId: m.reversalJournalEntryId,
    bankTransactionId: m.bankTransactionId,
    reconciliationId: m.reconciliationId,
    supplierId: m.supplierId,
    requestedByAdminId: m.requestedByAdminId,
    approvedByAdminId: m.approvedByAdminId,
    approvedAt: m.approvedAt,
    rejectedByAdminId: m.rejectedByAdminId,
    rejectedAt: m.rejectedAt,
    rejectionReason: m.rejectionReason,
    reversedByAdminId: m.reversedByAdminId,
    reversedAt: m.reversedAt,
    reversalReason: m.reversalReason,
    createdAt: m.createdAt,
  };
}
export type MovementDto = ReturnType<typeof movementDto>;

const adminId = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);

function fingerprintOf(r: MovementRequest, currency: string): string {
  return JSON.stringify([
    r.kind, r.direction ?? null, r.movementDate, toMinor(r.amount, currency), r.fromFinancialAccountId ?? null, r.toFinancialAccountId ?? null,
    r.counterAccountId ?? null, r.reference ?? null, r.description, r.bankTransactionId ?? null, ...(r.supplierId ? [r.supplierId] : []),
    ...(r.kind === "SUPPLIER_REFUND" ? [r.refundOfPaymentId ?? null, r.refundOfCreditNoteId ?? null] : []),
  ]);
}

/** Per-account advisory locks in a fixed order: money leaving an account is checked and posted while holding its lock. */
async function lockMoneyAccounts(tx: AppTransactionClient, ids: Array<string | null | undefined>) {
  for (const id of [...new Set(ids.filter((x): x is string => Boolean(x)))].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-money:${id}`}))`;
  }
}

type MoneyAccount = FinancialAccount & { ledgerAccount: LedgerAccount };

async function loadMoneyAccount(tx: AppTransactionClient, business: FinanceBusinessInfo, id: string, role: string): Promise<MoneyAccount> {
  const fa = await tx.financialAccount.findFirst({ where: { id, businessId: business.id }, include: { ledgerAccount: true } });
  if (!fa) throw financeError(404, "FINANCIAL_ACCOUNT_NOT_FOUND", `The ${role} account doesn't exist`);
  if (!fa.isActive) throw financeError(409, "FINANCIAL_ACCOUNT_INACTIVE", `${fa.name} is inactive`);
  if (fa.currency !== business.baseCurrency) throw financeError(409, "CURRENCY_MISMATCH", `${fa.name} is in ${fa.currency}; the books are in ${business.baseCurrency}`);
  return fa;
}

async function loadCounterAccount(tx: AppTransactionClient, business: FinanceBusinessInfo, id: string): Promise<LedgerAccount> {
  const a = await tx.ledgerAccount.findFirst({ where: { id, businessId: business.id } });
  if (!a) throw financeError(404, "ACCOUNT_NOT_FOUND", "The counter account doesn't exist");
  if (!a.isPostable || !a.isActive) throw financeError(400, "ACCOUNT_NOT_POSTABLE", `${a.code} ${a.name} can't take postings`);
  if (FORBIDDEN_COUNTER_TYPES.has(a.type)) {
    throw financeError(400, "COUNTER_ACCOUNT_TYPE", `${a.code} ${a.name} is ${a.type.toLowerCase()} — sales and their cost reach the books from orders, not from a cash movement`);
  }
  if (await tx.financialAccount.count({ where: { ledgerAccountId: a.id } })) {
    throw financeError(400, "COUNTER_IS_MONEY_ACCOUNT", `${a.code} ${a.name} is a money account — move money between accounts with a transfer`);
  }
  return a;
}

interface Resolved {
  from: MoneyAccount | null;
  to: MoneyAccount | null;
  counter: LedgerAccount | null;
  brandId: string | null;
}

async function resolve(tx: AppTransactionClient, business: FinanceBusinessInfo, r: MovementRequest): Promise<Resolved> {
  const from = r.fromFinancialAccountId ? await loadMoneyAccount(tx, business, r.fromFinancialAccountId, "source") : null;
  const to = r.toFinancialAccountId ? await loadMoneyAccount(tx, business, r.toFinancialAccountId, "destination") : null;
  if (r.kind === "TRANSFER") {
    if (!from || !to) throw financeError(400, "TRANSFER_ACCOUNTS", "A transfer needs a source and a destination account");
    if (from.id === to.id) throw financeError(400, "TRANSFER_SAME_ACCOUNT", "Choose two different accounts");
    if (from.brandId !== to.brandId) {
      throw financeError(409, "CROSS_BRAND_TRANSFER", "These accounts belong to different brands; moving money between brands needs inter-brand accounts, which are not set up yet");
    }
  }
  let counter: LedgerAccount | null = null;
  if (r.kind === "OPENING_FUNDING") {
    const batch = await tx.openingBalanceBatch.findUnique({ where: { businessId: business.id }, select: { status: true } });
    if (batch?.status !== "POSTED") {
      throw financeError(409, "OPENING_BALANCES_PENDING", "The books' opening balances aren't posted yet — enter this account's balance there");
    }
    counter = await resolveMappedAccount(tx, business.id, "equity.opening_balance");
  } else if (r.kind === "SUPPLIER_PAYMENT") {
    if (!from || !r.supplierId) throw financeError(400, "SUPPLIER_PAYMENT_SHAPE", "A supplier payment leaves a money account for a supplier");
    counter = await resolveMappedAccount(tx, business.id, "liability.payable_trade");
  } else if (r.kind === "SUPPLIER_REFUND") {
    if (!to || !r.supplierId || (!r.refundOfPaymentId === !r.refundOfCreditNoteId)) throw financeError(400, "SUPPLIER_REFUND_SHAPE", "A supplier refund comes into a money account from a supplier, against one payment or credit note");
    counter = await resolveMappedAccount(tx, business.id, "liability.payable_trade");
  } else if (r.kind !== "TRANSFER") {
    if (!r.counterAccountId) throw financeError(400, "COUNTER_ACCOUNT_REQUIRED", "Choose the account on the other side");
    counter = await loadCounterAccount(tx, business, r.counterAccountId);
  }
  return { from, to, counter, brandId: (to ?? from)!.brandId };
}

function journalLines(m: TreasuryMovement, x: Resolved, currency: string): JournalLineSpec[] {
  const amount = toMinor(m.amount, currency);
  const memo = m.reference ?? null;
  const party = m.supplierId ? { partyType: "Supplier", partyId: m.supplierId } : {};
  const into = (fa: MoneyAccount, counterId: string): JournalLineSpec[] => [
    { accountId: fa.ledgerAccountId, debit: amount, credit: 0, brandId: fa.brandId, memo },
    { accountId: counterId, debit: 0, credit: amount, brandId: fa.brandId, memo, ...party },
  ];
  const outOf = (fa: MoneyAccount, counterId: string): JournalLineSpec[] => [
    { accountId: counterId, debit: amount, credit: 0, brandId: fa.brandId, memo, ...party },
    { accountId: fa.ledgerAccountId, debit: 0, credit: amount, brandId: fa.brandId, memo },
  ];
  switch (m.kind) {
    case "DEPOSIT":
    case "OPENING_FUNDING":
    case "SUPPLIER_REFUND":
      return into(x.to!, x.counter!.id);
    case "WITHDRAWAL":
    case "SUPPLIER_PAYMENT":
      return outOf(x.from!, x.counter!.id);
    case "ADJUSTMENT":
      return m.direction === "IN" ? into(x.to!, x.counter!.id) : outOf(x.from!, x.counter!.id);
    case "TRANSFER":
      return [
        { accountId: x.to!.ledgerAccountId, debit: amount, credit: 0, brandId: x.to!.brandId, memo },
        { accountId: x.from!.ledgerAccountId, debit: 0, credit: amount, brandId: x.from!.brandId, memo },
      ];
  }
}

/** The account money LEAVES with this movement's journal (or, reversing it, the account money leaves on reversal). */
function outgoing(m: TreasuryMovement, x: Resolved, reversing: boolean): MoneyAccount | null {
  const leaves = m.kind === "WITHDRAWAL" || m.kind === "SUPPLIER_PAYMENT" || m.kind === "TRANSFER" || (m.kind === "ADJUSTMENT" && m.direction === "OUT");
  if (!reversing) return leaves ? x.from : null;
  return m.kind === "WITHDRAWAL" || m.kind === "SUPPLIER_PAYMENT" || (m.kind === "ADJUSTMENT" && m.direction === "OUT") ? null : x.to;
}

async function assertNoOverdraft(tx: AppTransactionClient, business: FinanceBusinessInfo, fa: MoneyAccount | null, amountMinor: number) {
  if (!fa || !NO_OVERDRAFT.has(fa.kind)) return;
  const balance = await moneyBalanceAt(tx, business.id, fa.ledgerAccountId, business.baseCurrency, null);
  if (balance - amountMinor < 0) {
    throw financeError(409, "INSUFFICIENT_FUNDS", `${fa.name} holds ${toMajorNumber(balance, business.baseCurrency)}; a ${fa.kind === "CASH" ? "cash box" : "wallet"} can't go below zero`, {
      balance: toMajorNumber(balance, business.baseCurrency),
    });
  }
}

const DESCRIPTION: Record<TreasuryMovementKind, string> = {
  DEPOSIT: "Deposit",
  WITHDRAWAL: "Withdrawal",
  TRANSFER: "Transfer",
  ADJUSTMENT: "Adjustment",
  OPENING_FUNDING: "Opening balance",
  SUPPLIER_PAYMENT: "Supplier payment",
  SUPPLIER_REFUND: "Supplier refund",
};

async function postMovement(tx: AppTransactionClient, business: FinanceBusinessInfo, m: TreasuryMovement, x: Resolved, actor: FinanceActor, approval: boolean) {
  await lockMoneyAccounts(tx, [m.fromFinancialAccountId, m.toFinancialAccountId]);
  await assertNoOverdraft(tx, business, outgoing(m, x, false), toMinor(m.amount, business.baseCurrency));
  const { entry } = await postJournalInTx(tx, business, {
    entryDate: businessDateOf(m.movementDate),
    description: `${DESCRIPTION[m.kind]}: ${m.description}`.slice(0, 300),
    reference: m.reference,
    brandId: x.brandId,
    kind: "TREASURY",
    lines: journalLines(m, x, business.baseCurrency),
    sourceType: "TreasuryMovement",
    sourceId: m.id,
    idempotencyKey: `treasury:${m.id}`,
    reason: m.reason,
  }, actor);
  const after = await tx.treasuryMovement.update({
    where: { id: m.id },
    data: { status: "POSTED", journalEntryId: entry.id, ...(approval ? { approvedByAdminId: adminId(actor), approvedAt: new Date() } : {}) },
    include: MOVEMENT_INCLUDE,
  });
  await recordFinanceAudit(tx, { businessId: business.id, actor, action: approval ? "movement.approve" : "movement.post", entityType: "TreasuryMovement", entityId: m.id, before: { status: m.status }, after: { status: after.status, journalEntryId: entry.id }, sourceRef: entry.id });
  return after;
}

/** A rejected or reversed supplier payment settles nothing: its allocations are released (audited, with the reason). */
async function releasePaymentAllocations(tx: AppTransactionClient, businessId: string, m: TreasuryMovement, reason: string, actor: FinanceActor) {
  if (m.kind !== "SUPPLIER_PAYMENT") return;
  const live = await tx.supplierAllocation.findMany({ where: { paymentMovementId: m.id, status: "ACTIVE" } });
  for (const a of live) {
    await tx.supplierAllocation.update({ where: { id: a.id }, data: { status: "RELEASED", releasedAt: new Date(), releasedByAdminId: adminId(actor), releaseReason: `Payment ${m.status === "PENDING_APPROVAL" ? "rejected" : "reversed"}: ${reason}` } });
    await recordFinanceAudit(tx, { businessId, actor, action: "supplier_allocation.release", entityType: "SupplierAllocation", entityId: a.id, before: { status: "ACTIVE" }, after: { status: "RELEASED" }, reason });
  }
}

async function lockKey(tx: AppTransactionClient, businessId: string, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-treasury:${businessId}:${key}`}))`;
}

/**
 * Records a movement in the caller's transaction and posts it unless it needs approval. Idempotent by `key`: the same
 * request again returns the movement it made (`replayed`), a different request under the key is a 409.
 */
export async function requestMovementInTx(tx: AppTransactionClient, business: FinanceBusinessInfo, r: MovementRequest, actor: FinanceActor, key: string): Promise<{ movement: MovementRow; replayed: boolean }> {
  const fingerprint = fingerprintOf(r, business.baseCurrency);
  await lockKey(tx, business.id, key);
  const existing = await tx.treasuryMovement.findUnique({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: key } }, include: MOVEMENT_INCLUDE });
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw financeError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different movement", { movementId: existing.id });
    return { movement: existing, replayed: true };
  }
  const x = await resolve(tx, business, r);
  if (r.kind === "OPENING_FUNDING") {
    const live = await tx.treasuryMovement.count({ where: { toFinancialAccountId: r.toFinancialAccountId!, kind: "OPENING_FUNDING", status: { in: ["PENDING_APPROVAL", "POSTED"] } } });
    if (live) throw financeError(409, "OPENING_FUNDING_EXISTS", "This account already has an opening balance; correct it with an adjustment");
  }
  const amountMinor = toMinor(r.amount, business.baseCurrency);
  const thresholds = [x.from, x.to].map((a) => (a?.approvalThreshold != null ? toMinor(a.approvalThreshold, business.baseCurrency) : null)).filter((t): t is number => t !== null);
  const overThreshold = thresholds.some((t) => amountMinor >= t);
  const needsApproval = overThreshold || !actorCan(actor, "finance.post");

  const created = await tx.treasuryMovement.create({
    data: {
      businessId: business.id,
      brandId: x.brandId,
      kind: r.kind,
      status: "PENDING_APPROVAL",
      direction: r.kind === "ADJUSTMENT" ? r.direction : null,
      movementDate: dateColumn(r.movementDate),
      amount: toDecimal(amountMinor, business.baseCurrency),
      currency: business.baseCurrency,
      fromFinancialAccountId: x.from?.id ?? null,
      toFinancialAccountId: x.to?.id ?? null,
      counterAccountId: x.counter?.id ?? null,
      reference: r.reference ?? null,
      description: r.description,
      reason: r.reason ?? null,
      idempotencyKey: key,
      fingerprint,
      bankTransactionId: r.bankTransactionId ?? null,
      reconciliationId: r.reconciliationId ?? null,
      supplierId: r.kind === "SUPPLIER_PAYMENT" || r.kind === "SUPPLIER_REFUND" ? r.supplierId ?? null : null,
      refundOfPaymentId: r.kind === "SUPPLIER_REFUND" ? r.refundOfPaymentId ?? null : null,
      refundOfCreditNoteId: r.kind === "SUPPLIER_REFUND" ? r.refundOfCreditNoteId ?? null : null,
      requestedByAdminId: adminId(actor),
    },
    include: MOVEMENT_INCLUDE,
  });
  await recordFinanceAudit(tx, {
    businessId: business.id, actor, action: "movement.request", entityType: "TreasuryMovement", entityId: created.id, after: movementDto(created),
    reason: r.reason ?? null, sourceType: "Idempotency-Key", sourceRef: key,
  });
  if (needsApproval) return { movement: created, replayed: false };
  return { movement: await postMovement(tx, business, created, x, actor, false), replayed: false };
}

/** API entry point: one movement per Idempotency-Key (required — a money movement must be safe to retry). */
export async function requestMovement(r: MovementRequest, actor: FinanceActor, idempotencyKey: string | null) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every money movement");
  const { business } = await getFinanceContext();
  const { movement, replayed } = await financeTransaction((tx) => requestMovementInTx(tx, business, r, actor, `request:${idempotencyKey}`));
  return { movement: movementDto(movement), replayed };
}

async function lockMovement(tx: AppTransactionClient, businessId: string, id: string): Promise<MovementRow> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "TreasuryMovement" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
  if (!rows.length) throw financeError(404, "MOVEMENT_NOT_FOUND", "Movement not found");
  return tx.treasuryMovement.findUniqueOrThrow({ where: { id }, include: MOVEMENT_INCLUDE });
}

async function resolvedOf(tx: AppTransactionClient, m: TreasuryMovement): Promise<Resolved> {
  const load = (id: string | null) => (id ? tx.financialAccount.findUniqueOrThrow({ where: { id }, include: { ledgerAccount: true } }) : Promise.resolve(null));
  const [from, to] = await Promise.all([load(m.fromFinancialAccountId), load(m.toFinancialAccountId)]);
  const counter = m.counterAccountId ? await tx.ledgerAccount.findUniqueOrThrow({ where: { id: m.counterAccountId } }) : null;
  return { from, to, counter, brandId: m.brandId };
}

/** Approves (posts) a pending movement. A threshold approval needs a second person. Idempotent: an approved movement is returned as is. */
export async function approveMovement(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const m = await lockMovement(tx, business.id, id);
    if (m.status === "POSTED") return { movement: movementDto(m), alreadyPosted: true };
    if (m.status !== "PENDING_APPROVAL") throw financeError(409, "MOVEMENT_NOT_PENDING", `A ${m.status.toLowerCase()} movement can't be approved`);
    if (!actorCan(actor, "finance.post")) throw financeError(409, "APPROVER_LACKS_PERMISSION", "Approving a movement needs finance.post");
    const x = await resolvedOf(tx, m);
    const thresholds = [x.from, x.to].map((a) => (a?.approvalThreshold != null ? toMinor(a.approvalThreshold, business.baseCurrency) : null)).filter((t): t is number => t !== null);
    const highValue = thresholds.some((t) => toMinor(m.amount, business.baseCurrency) >= t);
    // Phase 3 §11: a movement at or above an account's threshold is a high-value approval — an owner decision.
    if (highValue && !actorCan(actor, "finance.approve_high_value")) {
      throw financeError(403, "HIGH_VALUE_APPROVAL_REQUIRED", "Approving a movement at or above the account's approval amount is reserved for the owner");
    }
    if (highValue && m.requestedByAdminId && m.requestedByAdminId === adminId(actor)) {
      throw financeError(409, "SAME_PERSON_APPROVAL", "A movement above the approval threshold must be approved by someone other than the person who requested it");
    }
    return { movement: movementDto(await postMovement(tx, business, m, x, actor, true)), alreadyPosted: false };
  });
}

export async function rejectMovement(id: string, reason: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const m = await lockMovement(tx, business.id, id);
    if (m.status === "REJECTED") return movementDto(m);
    if (m.status !== "PENDING_APPROVAL") throw financeError(409, "MOVEMENT_NOT_PENDING", `A ${m.status.toLowerCase()} movement can't be rejected`);
    await releasePaymentAllocations(tx, business.id, m, reason, actor);
    const after = await tx.treasuryMovement.update({ where: { id }, data: { status: "REJECTED", rejectedByAdminId: adminId(actor), rejectedAt: new Date(), rejectionReason: reason }, include: MOVEMENT_INCLUDE });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "movement.reject", entityType: "TreasuryMovement", entityId: id, before: { status: m.status }, after: { status: after.status }, reason });
    return movementDto(after);
  });
}

/** Reverses a posted movement with a mirror journal. Refused while a statement line is matched to it (unmatch first). */
export async function reverseMovement(id: string, input: { reason: string; reversalDate?: string }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const m = await lockMovement(tx, business.id, id);
    if (m.status === "REVERSED") return { movement: movementDto(m), replayed: true };
    if (m.status !== "POSTED") throw financeError(409, "MOVEMENT_NOT_POSTED", `A ${m.status.toLowerCase()} movement has nothing to reverse`);
    const matched = await tx.bankTransactionMatch.count({ where: { status: "ACTIVE", journalLine: { entryId: m.journalEntryId! } } });
    if (matched) throw financeError(409, "MOVEMENT_MATCHED", "A statement line is matched to this movement — unmatch it before reversing");
    const x = await resolvedOf(tx, m);
    await lockMoneyAccounts(tx, [m.fromFinancialAccountId, m.toFinancialAccountId]);
    await assertNoOverdraft(tx, business, outgoing(m, x, true), toMinor(m.amount, business.baseCurrency));
    const date = input.reversalDate ?? (businessToday(business) < businessDateOf(m.movementDate) ? businessDateOf(m.movementDate) : businessToday(business));
    const { reversal } = await reverseJournalInTx(tx, business, m.journalEntryId!, input.reason, date, actor);
    await releasePaymentAllocations(tx, business.id, m, input.reason, actor);
    const after = await tx.treasuryMovement.update({
      where: { id },
      data: { status: "REVERSED", reversalJournalEntryId: reversal.id, reversedByAdminId: adminId(actor), reversedAt: new Date(), reversalReason: input.reason },
      include: MOVEMENT_INCLUDE,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "movement.reverse", entityType: "TreasuryMovement", entityId: id, before: { status: m.status }, after: { status: after.status, reversalJournalEntryId: reversal.id }, reason: input.reason, sourceRef: reversal.id });
    return { movement: movementDto(after), replayed: false };
  });
}

export async function getMovement(id: string) {
  const { business } = await getFinanceContext();
  const m = await prisma.treasuryMovement.findFirst({ where: { id, businessId: business.id }, include: MOVEMENT_INCLUDE });
  if (!m) throw financeError(404, "MOVEMENT_NOT_FOUND", "Movement not found");
  return movementDto(m);
}

export async function listMovements(q: { financialAccountId?: string; kind?: TreasuryMovementKind; status?: TreasuryMovement["status"]; from?: string; to?: string; page: number; pageSize: number }) {
  const { business } = await getFinanceContext();
  const where: Prisma.TreasuryMovementWhereInput = {
    businessId: business.id,
    kind: q.kind,
    status: q.status,
    ...(q.financialAccountId ? { OR: [{ fromFinancialAccountId: q.financialAccountId }, { toFinancialAccountId: q.financialAccountId }] } : {}),
    movementDate: q.from || q.to ? { gte: q.from ? dateColumn(q.from) : undefined, lte: q.to ? dateColumn(q.to) : undefined } : undefined,
  };
  const [total, rows] = await Promise.all([
    prisma.treasuryMovement.count({ where }),
    prisma.treasuryMovement.findMany({ where, include: MOVEMENT_INCLUDE, orderBy: [{ movementDate: "desc" }, { createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, movements: rows.map(movementDto) };
}
