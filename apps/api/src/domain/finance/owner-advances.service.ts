/**
 * Owner-advance subledger (blueprint P1.4; owner decisions Q14 = B and Q-F; clarification report §4). When the owner pays a
 * purchase or an expense from his own pocket and it is owed back to him, his money comes in as a deposit against
 * liability.owner_reimbursable — and one advance line records what it was for. "Repay owner" pays chosen lines with one
 * withdrawal (Dr liability.owner_reimbursable / Cr the paying account) and writes an allocation per line, so every
 * repayment says what it repays. Ledger entries are the ones treasury already makes; only the link is new.
 *
 * State is read from the movements, never copied: a line counts once its funding deposit is POSTED; an allocation counts
 * while its withdrawal is waiting for approval or posted, so a rejected or reversed repayment frees it by itself.
 * Owed-back money from before the subledger existed (or repaid with a plain Treasury withdrawal) shows as the unlinked
 * difference between the ledger balance and the lines' outstanding total — nothing old is reinterpreted.
 */
import { ownerRepaySchema, type OwnerRepayInput } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { businessDateOf, dateColumn, financeError, toMajorNumber, toMinor } from "./finance-values";
import { resolveMappedAccount } from "./chart.service";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";
import { movementDto, requestMovementInTx } from "./treasury.service";

export type OwnerAdvanceSource = "StockPurchase" | "Expense";
const LIVE_REPAYMENT = ["PENDING_APPROVAL", "POSTED"] as const;
const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);

/** One advance line for a deposit owed back to the owner, inside the deposit's transaction; a replay finds the line. */
export async function recordOwnerAdvanceInTx(
  tx: AppTransactionClient,
  business: FinanceBusinessInfo,
  input: { fundingMovementId: string; sourceType: OwnerAdvanceSource; sourceId: string; amount: number; date: string; description: string },
  actor: FinanceActor,
) {
  const existing = await tx.ownerAdvance.findUnique({ where: { fundingMovementId: input.fundingMovementId } });
  if (existing) return existing;
  const row = await tx.ownerAdvance.create({
    data: {
      businessId: business.id, fundingMovementId: input.fundingMovementId, sourceType: input.sourceType, sourceId: input.sourceId,
      amount: input.amount, advanceDate: dateColumn(input.date), description: input.description.slice(0, 300), createdByAdminId: adminOf(actor),
    },
  });
  await recordFinanceAudit(tx, { businessId: business.id, actor, action: "owner_advance.create", entityType: "OwnerAdvance", entityId: row.id, after: { sourceType: row.sourceType, sourceId: row.sourceId, amount: input.amount, fundingMovementId: row.fundingMovementId } });
  return row;
}

/** The owner's money owed back to him for a purchase (Q14 = B): it comes into his own-money cash account against
 * liability.owner_reimbursable — the posting an owner-paid expense with funding REIMBURSE makes (custody.service) — and
 * its advance line is written in the same transaction. Idempotent by \`key\`. */
export async function ownerOwedBack(
  input: { financialAccountId: string; amount: number; date: string; description: string; sourceType: OwnerAdvanceSource; sourceId: string },
  actor: FinanceActor,
  key: string,
) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    await ensureOwnerBooksSetupInTx(tx, business);
    const owed = await resolveMappedAccount(tx, business.id, "liability.owner_reimbursable");
    const { movement } = await requestMovementInTx(tx, business, { kind: "DEPOSIT", movementDate: input.date, amount: input.amount, toFinancialAccountId: input.financialAccountId, counterAccountId: owed.id, description: input.description.slice(0, 300) }, actor, `request:owner-owed:${key}`);
    await recordOwnerAdvanceInTx(tx, business, { fundingMovementId: movement.id, sourceType: input.sourceType, sourceId: input.sourceId, amount: input.amount, date: input.date, description: input.description }, actor);
    return { movement };
  });
}

type AdvanceRow = Awaited<ReturnType<typeof loadAdvances>>[number];
function loadAdvances(db: AppTransactionClient | typeof prisma, businessId: string, ids?: string[]) {
  return db.ownerAdvance.findMany({
    where: { businessId, ...(ids ? { id: { in: ids } } : {}) },
    include: {
      fundingMovement: { select: { status: true } },
      allocations: { include: { repaymentMovement: { select: { id: true, status: true, movementDate: true } } } },
    },
    orderBy: [{ advanceDate: "asc" }, { createdAt: "asc" }],
  });
}

/** Minor units: repaid (withdrawals waiting or posted) and outstanding of one line. */
function balancesOf(a: AdvanceRow, cur: string) {
  const amount = toMinor(a.amount, cur);
  const repaid = a.allocations.filter((x) => (LIVE_REPAYMENT as readonly string[]).includes(x.repaymentMovement.status)).reduce((s, x) => s + toMinor(x.amount, cur), 0);
  return { amount, repaid, outstanding: amount - repaid };
}

/** Lines owed back to the owner, oldest first, with what is still to repay, and the ledger balance they explain. */
export async function listOwnerAdvances() {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const rows = (await loadAdvances(prisma, business.id)).filter((a) => a.fundingMovement.status === "POSTED");
  const lines = rows.map((a) => {
    const b = balancesOf(a, cur);
    return {
      id: a.id,
      date: businessDateOf(a.advanceDate),
      description: a.description,
      sourceType: a.sourceType as OwnerAdvanceSource,
      sourceId: a.sourceId,
      amount: toMajorNumber(b.amount, cur),
      repaid: toMajorNumber(b.repaid, cur),
      outstanding: toMajorNumber(b.outstanding, cur),
      repayments: a.allocations.map((x) => ({ movementId: x.repaymentMovement.id, status: x.repaymentMovement.status, date: businessDateOf(x.repaymentMovement.movementDate), amount: Number(x.amount) })),
    };
  });
  const linkedMinor = rows.reduce((s, a) => s + balancesOf(a, cur).outstanding, 0);
  const owedMinor = await owedToOwnerMinor(business.id, cur);
  return {
    lines,
    /** What the lines still owe him. */
    outstanding: toMajorNumber(linkedMinor, cur),
    /** liability.owner_reimbursable in the books (posted). */
    ledgerBalance: toMajorNumber(owedMinor, cur),
    /** Ledger balance not explained by a line: positive = owed from before the link existed; negative = repaid without
     * saying what for (a plain Treasury withdrawal), or a repayment still waiting for approval. */
    unlinked: toMajorNumber(owedMinor - linkedMinor, cur),
  };
}

async function owedToOwnerMinor(businessId: string, cur: string): Promise<number> {
  const mapping = await prisma.accountMapping.findUnique({ where: { businessId_key: { businessId, key: "liability.owner_reimbursable" } }, select: { accountId: true } });
  if (!mapping) return 0;
  const s = await prisma.journalLine.aggregate({ where: { accountId: mapping.accountId, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
  return toMinor(Number(s._sum.credit ?? 0) - Number(s._sum.debit ?? 0), cur);
}

/**
 * "Repay owner": one withdrawal from a money account for the chosen lines (each at most what it still owes, read under a
 * row lock so two repayments can't spend one line), Dr liability.owner_reimbursable / Cr the account, and one allocation
 * per line in the same transaction. The account's approval rules apply as to any withdrawal; while it waits, the lines
 * count as being repaid. Idempotent by \`key\`: a replay returns the first repayment and writes nothing.
 */
export async function repayOwner(raw: OwnerRepayInput, actor: FinanceActor, key: string | null) {
  if (!key) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every repayment");
  const input = ownerRepaySchema.parse(raw);
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const ids = input.lines.map((l) => l.advanceId);
    await tx.$queryRaw`SELECT id FROM "OwnerAdvance" WHERE id = ANY(${ids}) AND "businessId" = ${business.id} ORDER BY id FOR UPDATE`;
    const rows = await loadAdvances(tx, business.id, ids);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const what: string[] = [];
    let totalMinor = 0;
    const replayKey = `request:owner-repay:${key}`;
    const prior = await tx.treasuryMovement.findFirst({ where: { businessId: business.id, idempotencyKey: replayKey }, select: { id: true } });
    for (const [i, l] of input.lines.entries()) {
      const a = byId.get(l.advanceId);
      if (!a || a.fundingMovement.status !== "POSTED") throw financeError(404, "OWNER_ADVANCE_NOT_FOUND", `Line ${i + 1}: that amount owed to the owner doesn't exist`);
      const amountMinor = toMinor(l.amount, cur);
      // a replay's own allocations are already counted in what is repaid
      const left = balancesOf(a, cur).outstanding + (prior ? a.allocations.filter((x) => x.repaymentMovementId === prior.id).reduce((s, x) => s + toMinor(x.amount, cur), 0) : 0);
      if (amountMinor > left) throw financeError(409, "REPAY_MORE_THAN_OWED", `Line ${i + 1}: ${a.description} has ${toMajorNumber(left, cur)} left to repay`, { advanceId: a.id, outstanding: toMajorNumber(left, cur) });
      totalMinor += amountMinor;
      what.push(a.description);
    }
    await ensureOwnerBooksSetupInTx(tx, business);
    const owed = await resolveMappedAccount(tx, business.id, "liability.owner_reimbursable");
    const date = input.date ?? businessToday(business);
    const { movement, replayed } = await requestMovementInTx(tx, business, {
      kind: "WITHDRAWAL", movementDate: date, amount: toMajorNumber(totalMinor, cur), fromFinancialAccountId: input.fromFinancialAccountId, counterAccountId: owed.id,
      description: `Repaid to the owner: ${what.join("; ")}${input.note ? ` — ${input.note}` : ""}`.slice(0, 300),
    }, actor, replayKey);
    if (!replayed) {
      for (const l of input.lines) {
        const row = await tx.ownerAdvanceAllocation.create({ data: { businessId: business.id, advanceId: l.advanceId, repaymentMovementId: movement.id, amount: l.amount, createdByAdminId: adminOf(actor) } });
        await recordFinanceAudit(tx, { businessId: business.id, actor, action: "owner_advance.repay", entityType: "OwnerAdvanceAllocation", entityId: row.id, after: { advanceId: l.advanceId, repaymentMovementId: movement.id, amount: l.amount } });
      }
    }
    return { movement: movementDto(movement), replayed };
  });
}
