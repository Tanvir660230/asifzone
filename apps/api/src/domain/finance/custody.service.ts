/**
 * Who holds the money (docs/FINANCE_OWNER_BOOKS.md §2). A cash box is somebody's: a CASH financial account names its
 * custodian. Built only on Treasury — no balance or money table of its own:
 *
 *   handover      a TRANSFER; into cash someone else holds it waits (PENDING_APPROVAL, receiverAdminId) until THAT person
 *                 confirms it reached them, or rejects it — the money never shows as arrived before it has.
 *   cash count    the counted amount against what the books held that day; a difference is an ADJUSTMENT against cash
 *                 over/short, waiting for approval when the person counting may not post. The count itself is history.
 *   own expenses  a custodian pays an expense from their own cash (it waits for the owner unless they may post).
 *   owner paid    an expense paid from the owner's pocket: their money comes into a cash account — owed back to them
 *                 (2120) or added as capital — and the expense is paid from it, in one transaction.
 *   money map     every place money and value sit today, grouped by person and by kind, each figure a ledger balance.
 */
import type { FinancialAccount, Prisma } from "@prisma/client";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { actorCan, recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor, type FinanceViewer } from "./finance-values";
import { resolveMappedAccount } from "./chart.service";
import { accountSums, moneyBalanceAt } from "./ledger.service";
import { MOVEMENT_INCLUDE, approveMovement, movementDto, rejectMovement, requestMovementInTx } from "./treasury.service";
import { recordExpenseInTx } from "./expenses.service";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";

const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);

async function loadAccount(db: AppTransactionClient | typeof prisma, businessId: string, id: string): Promise<FinancialAccount> {
  const fa = await db.financialAccount.findFirst({ where: { id, businessId } });
  if (!fa) throw financeError(404, "FINANCIAL_ACCOUNT_NOT_FOUND", "Money account not found");
  return fa;
}

/** A custodian acts on the cash they hold; anyone who may record finance (finance.transact) acts on any account. */
function assertHolds(actor: FinanceActor, fa: FinancialAccount, what: string) {
  if (actorCan(actor, "finance.transact")) return;
  if (fa.custodianAdminId && fa.custodianAdminId === adminOf(actor)) return;
  throw financeError(403, "NOT_YOUR_CASH", `${fa.name} isn't cash you hold — ask the owner to ${what}`);
}

// ── custodian ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function setCustodian(financialAccountId: string, input: { custodianAdminId: string | null; reason?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const fa = await loadAccount(tx, business.id, financialAccountId);
    if (fa.kind !== "CASH") throw financeError(400, "CUSTODIAN_CASH_ONLY", "Only a cash account is held by a person");
    if (input.custodianAdminId) {
      const admin = await tx.adminUser.findUnique({ where: { id: input.custodianAdminId }, select: { id: true, isActive: true } });
      if (!admin?.isActive) throw financeError(404, "ADMIN_NOT_FOUND", "Choose an active team member");
    }
    if (fa.custodianAdminId === input.custodianAdminId) return { id: fa.id, custodianAdminId: fa.custodianAdminId };
    const pending = await tx.treasuryMovement.count({ where: { status: "PENDING_APPROVAL", receiverAdminId: { not: null }, toFinancialAccountId: fa.id } });
    if (pending) throw financeError(409, "HANDOVER_PENDING", "A handover into this cash waits for its receiver — settle it first");
    const after = await tx.financialAccount.update({ where: { id: fa.id }, data: { custodianAdminId: input.custodianAdminId } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "financial_account.custodian", entityType: "FinancialAccount", entityId: fa.id, before: { custodianAdminId: fa.custodianAdminId }, after: { custodianAdminId: after.custodianAdminId }, reason: input.reason ?? null });
    return { id: after.id, custodianAdminId: after.custodianAdminId };
  });
}

// ── handovers ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface HandoverInput {
  fromFinancialAccountId: string;
  toFinancialAccountId: string;
  amount: number;
  movementDate: string;
  description: string;
  reference?: string | null;
}

/** Hands money from one account to another. Into cash another person holds, it waits for them to confirm. */
export async function requestHandover(input: HandoverInput, actor: FinanceActor, idempotencyKey: string | null) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every handover");
  const { business } = await getFinanceContext();
  const { movement, replayed } = await financeTransaction(async (tx) => {
    const [from, to] = await Promise.all([loadAccount(tx, business.id, input.fromFinancialAccountId), loadAccount(tx, business.id, input.toFinancialAccountId)]);
    assertHolds(actor, from, "move it");
    const receiver = to.custodianAdminId && to.custodianAdminId !== adminOf(actor) ? to.custodianAdminId : null;
    return requestMovementInTx(tx, business, {
      kind: "TRANSFER", movementDate: input.movementDate, amount: input.amount, description: input.description, reference: input.reference ?? null,
      fromFinancialAccountId: from.id, toFinancialAccountId: to.id, receiverAdminId: receiver,
    }, actor, `handover:${idempotencyKey}`);
  });
  return { movement: movementDto(movement), replayed };
}

async function pendingHandover(businessId: string, id: string) {
  const m = await prisma.treasuryMovement.findFirst({ where: { id, businessId } });
  if (!m) throw financeError(404, "MOVEMENT_NOT_FOUND", "Handover not found");
  if (!m.receiverAdminId) throw financeError(409, "NOT_A_HANDOVER", "This movement isn't a handover waiting for its receiver");
  return m;
}

/** The receiver confirms the cash reached them: the transfer posts. */
export async function confirmHandover(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const m = await pendingHandover(business.id, id);
  if (m.receiverAdminId !== adminOf(actor)) throw financeError(403, "NOT_THE_RECEIVER", "Only the person receiving the cash can confirm it");
  return approveMovement(id, actor);
}

/** The receiver didn't get it (or the sender takes it back): the handover is rejected and moves nothing. */
export async function rejectHandover(id: string, reason: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const m = await pendingHandover(business.id, id);
  const me = adminOf(actor);
  if (m.receiverAdminId !== me && m.requestedByAdminId !== me && !actorCan(actor, "finance.post")) {
    throw financeError(403, "NOT_YOUR_HANDOVER", "Only the sender, the receiver or the owner can cancel a handover");
  }
  return rejectMovement(id, reason, actor);
}

// ── cash counts ───────────────────────────────────────────────────────────────────────────────────────────────────────

const COUNT_INCLUDE = { financialAccount: { select: { id: true, name: true } }, movement: { include: MOVEMENT_INCLUDE } } satisfies Prisma.CashCountInclude;
type CountRow = Prisma.CashCountGetPayload<{ include: typeof COUNT_INCLUDE }>;

function countDto(c: CountRow, cur: string) {
  const m = (v: Prisma.Decimal) => toMajorNumber((v.isNegative() ? -1 : 1) * toMinor(v.abs(), cur), cur);
  return {
    id: c.id, financialAccount: c.financialAccount, countDate: businessDateOf(c.countDate), counted: m(c.counted), expected: m(c.expected), difference: m(c.difference),
    note: c.note, countedByAdminId: c.countedByAdminId, createdAt: c.createdAt,
    adjustment: c.movement ? { id: c.movement.id, status: c.movement.status } : null,
  };
}

export async function recordCashCount(input: { financialAccountId: string; countDate: string; counted: number; note?: string | null }, actor: FinanceActor, idempotencyKey: string | null) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every cash count");
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  if (input.countDate > businessToday(business)) throw financeError(400, "COUNT_IN_FUTURE", "A count is of cash you hold now or held before");
  if (business.openingDate && input.countDate < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
  return financeTransaction(async (tx) => {
    const fa = await loadAccount(tx, business.id, input.financialAccountId);
    if (fa.kind !== "CASH") throw financeError(400, "COUNT_CASH_ONLY", "Count a cash account — banks and wallets are checked against their statements");
    assertHolds(actor, fa, "count it");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-cash-count:${business.id}:${idempotencyKey}`}))`;
    const prior = await tx.treasuryMovement.findUnique({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey: `cash-count:${idempotencyKey}` } }, select: { id: true } });
    if (prior) {
      const existing = await tx.cashCount.findUnique({ where: { movementId: prior.id }, include: COUNT_INCLUDE });
      if (existing) return { count: countDto(existing, cur), replayed: true };
    }
    await ensureOwnerBooksSetupInTx(tx, business);
    const expected = await moneyBalanceAt(tx, business.id, fa.ledgerAccountId, cur, input.countDate);
    const counted = toMinor(input.counted, cur);
    const difference = counted - expected;
    let movementId: string | null = null;
    if (difference !== 0) {
      const counter = await resolveMappedAccount(tx, business.id, "expense.cash_over_short");
      const { movement } = await requestMovementInTx(tx, business, {
        kind: "ADJUSTMENT", direction: difference > 0 ? "IN" : "OUT", movementDate: input.countDate, amount: toMajorNumber(Math.abs(difference), cur),
        description: `Cash count of ${fa.name}: ${difference > 0 ? "over" : "short"} by ${toMajorNumber(Math.abs(difference), cur)}`,
        reason: input.note ?? null, counterAccountId: counter.id,
        ...(difference > 0 ? { toFinancialAccountId: fa.id } : { fromFinancialAccountId: fa.id }),
      }, actor, `cash-count:${idempotencyKey}`);
      movementId = movement.id;
    }
    const c = await tx.cashCount.create({
      data: {
        businessId: business.id, financialAccountId: fa.id, countDate: dateColumn(input.countDate), counted: toDecimal(counted, cur), expected: toDecimal(expected, cur),
        difference: toDecimal(difference, cur), movementId, note: input.note ?? null, countedByAdminId: adminOf(actor),
      },
      include: COUNT_INCLUDE,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "cash_count.record", entityType: "CashCount", entityId: c.id, after: countDto(c, cur), sourceType: "Idempotency-Key", sourceRef: idempotencyKey });
    return { count: countDto(c, cur), replayed: false };
  });
}

export async function listCashCounts(q: { financialAccountId?: string; page: number; pageSize: number }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const mine = !actorCan(actor, "finance.read");
  const where: Prisma.CashCountWhereInput = { businessId: business.id, financialAccountId: q.financialAccountId, ...(mine ? { financialAccount: { custodianAdminId: adminOf(actor) } } : {}) };
  const [total, rows] = await Promise.all([
    prisma.cashCount.count({ where }),
    prisma.cashCount.findMany({ where, include: COUNT_INCLUDE, orderBy: [{ countDate: "desc" }, { createdAt: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, counts: rows.map((r) => countDto(r, business.baseCurrency)) };
}

// ── what a person holds ───────────────────────────────────────────────────────────────────────────────────────────────

/** The cash the signed-in person holds, handovers waiting for them or sent by them, and their latest counts. */
export async function myCustody(actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const me = adminOf(actor);
  if (!me) throw financeError(403, "ADMIN_ONLY", "Only a person holds cash");
  const accounts = await prisma.financialAccount.findMany({ where: { businessId: business.id, custodianAdminId: me, isActive: true }, orderBy: { name: "asc" } });
  const balances = await Promise.all(accounts.map((a) => moneyBalanceAt(prisma, business.id, a.ledgerAccountId, cur, null)));
  const [incoming, outgoing, counts, others, expenseAccounts] = await Promise.all([
    prisma.treasuryMovement.findMany({ where: { businessId: business.id, status: "PENDING_APPROVAL", receiverAdminId: me }, include: MOVEMENT_INCLUDE, orderBy: { createdAt: "asc" } }),
    prisma.treasuryMovement.findMany({ where: { businessId: business.id, status: "PENDING_APPROVAL", requestedByAdminId: me }, include: MOVEMENT_INCLUDE, orderBy: { createdAt: "asc" } }),
    prisma.cashCount.findMany({ where: { businessId: business.id, financialAccount: { custodianAdminId: me } }, include: COUNT_INCLUDE, orderBy: [{ countDate: "desc" }, { createdAt: "desc" }], take: 10 }),
    // Where a custodian can hand cash to: every other active cash, bank and wallet account (names only, no balances).
    prisma.financialAccount.findMany({
      where: { businessId: business.id, isActive: true, kind: { in: ["CASH", "BANK", "MOBILE_WALLET"] }, OR: [{ custodianAdminId: null }, { custodianAdminId: { not: me } }] },
      select: { id: true, name: true, kind: true, custodian: { select: { id: true, name: true } } }, orderBy: { name: "asc" },
    }),
    // What a custodian may pay from their cash: the operating expense accounts (never a sensitive one, such as salaries).
    prisma.ledgerAccount.findMany({
      where: { businessId: business.id, isPostable: true, isActive: true, isSensitive: false, type: { in: ["EXPENSE", "OTHER_EXPENSE"] } },
      select: { id: true, code: true, name: true }, orderBy: { code: "asc" },
    }),
  ]);
  return {
    accounts: accounts.map((a, i) => ({ id: a.id, name: a.name, balance: toMajorNumber(balances[i]!, cur) })),
    total: toMajorNumber(balances.reduce((s, b) => s + b, 0), cur),
    incoming: incoming.map(movementDto),
    outgoing: outgoing.map(movementDto),
    counts: counts.map((c) => countDto(c, cur)),
    destinations: others,
    expenseAccounts,
  };
}

/** A custodian pays an expense from cash they hold (it waits for the owner unless they may post). */
export async function custodyExpense(input: { fromFinancialAccountId: string; expenseAccountId: string; amount: number; expenseDate?: string; description: string; payee?: string | null; reference?: string | null; evidence?: string | null }, actor: FinanceActor, idempotencyKey: string | null) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every expense");
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const fa = await loadAccount(tx, business.id, input.fromFinancialAccountId);
    if (fa.kind !== "CASH") throw financeError(400, "PAY_FROM_CASH", "Pay from cash you hold");
    assertHolds(actor, fa, "pay from it");
    return recordExpenseInTx(tx, business, { ...input, costBehaviour: "VARIABLE" }, actor, `custody:${idempotencyKey}`);
  });
}

/** An expense the owner paid from their own pocket: the money comes in (owed back to them, or as capital) and the expense
 * is paid from the cash account, in one transaction — the books show both what was spent and where the money came from. */
export async function ownerPaidExpense(
  input: { cashFinancialAccountId: string; expenseAccountId: string; amount: number; expenseDate?: string; description: string; payee?: string | null; reference?: string | null; funding: "REIMBURSE" | "CAPITAL"; partnerId?: string | null },
  actor: FinanceActor,
  idempotencyKey: string | null,
) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every expense");
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const fa = await loadAccount(tx, business.id, input.cashFinancialAccountId);
    if (fa.kind !== "CASH") throw financeError(400, "PAY_FROM_CASH", "Choose the cash account the owner's money goes through");
    await ensureOwnerBooksSetupInTx(tx, business);
    let counterId: string;
    if (input.funding === "REIMBURSE") counterId = (await resolveMappedAccount(tx, business.id, "liability.owner_reimbursable")).id;
    else if (input.partnerId) {
      const p = await tx.partner.findFirst({ where: { id: input.partnerId, businessId: business.id }, select: { capitalAccountId: true } });
      if (!p) throw financeError(404, "PARTNER_NOT_FOUND", "Partner not found");
      counterId = p.capitalAccountId;
    } else counterId = (await resolveMappedAccount(tx, business.id, "equity.owner_capital")).id;
    const date = input.expenseDate ?? businessToday(business);
    const { movement: funding } = await requestMovementInTx(tx, business, {
      kind: "DEPOSIT", movementDate: date, amount: input.amount, toFinancialAccountId: fa.id, counterAccountId: counterId, reference: input.reference ?? null,
      description: `${input.funding === "REIMBURSE" ? "Paid by the owner (to repay)" : "Owner's money put in"}: ${input.description}`.slice(0, 300),
    }, actor, `owner-paid:${idempotencyKey}:funding`);
    if (funding.status !== "POSTED") throw financeError(409, "FUNDING_NEEDS_APPROVAL", "The owner's money must post before the expense can be paid from it — record this as the owner, or lower the account's approval amount");
    const expense = await recordExpenseInTx(tx, business, {
      expenseDate: date, expenseAccountId: input.expenseAccountId, amount: input.amount, fromFinancialAccountId: fa.id, description: input.description,
      payee: input.payee ?? null, reference: input.reference ?? null, costBehaviour: "VARIABLE",
    }, actor, `owner-paid:${idempotencyKey}`);
    return { ...expense, funding: movementDto(funding) };
  });
}

// ── money map ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every place the business's money and value sit on a date, each a ledger balance: cash by person, banks, wallets, what
 * couriers and gateways still owe (net of the charges accrued against them), ad accounts, stock, prepaid costs — and
 * what the business owes. Owner and partner equity only with finance.sensitive.
 */
export async function moneyMap(q: { asOf?: string }, viewer: FinanceViewer) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const asOf = q.asOf ?? businessToday(business);
  const [accounts, sums, mappings, ledger] = await Promise.all([
    prisma.financialAccount.findMany({ where: { businessId: business.id }, include: { custodian: { select: { id: true, name: true } } }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    accountSums(business.id, { to: asOf }),
    prisma.accountMapping.findMany({ where: { businessId: business.id }, select: { key: true, accountId: true } }),
    prisma.ledgerAccount.findMany({ where: { businessId: business.id }, select: { id: true, parentId: true, isSensitive: true, type: true, code: true, name: true } }),
  ]);
  const net = new Map(sums.map((s) => [s.accountId, toMinor(s.periodDebit, cur) - toMinor(s.periodCredit, cur)]));
  const children = new Map<string, string[]>();
  for (const a of ledger) if (a.parentId) children.set(a.parentId, [...(children.get(a.parentId) ?? []), a.id]);
  const total = (id: string): number => (net.get(id) ?? 0) + (children.get(id) ?? []).reduce((s, c) => s + total(c), 0);
  const byKey = new Map(mappings.map((m) => [m.key, m.accountId]));
  const keyBalance = (key: string) => (byKey.has(key) ? total(byKey.get(key)!) : 0);
  const major = (v: number) => toMajorNumber(v, cur);

  // Clearing accounts (COD, gateways, manual receipts) hold money still owed to the business, not money it has.
  const clearingIds = new Set(mappings.filter((m) => m.key.startsWith("clearing.")).map((m) => m.accountId));
  const live = accounts.filter((a) => a.isActive || (net.get(a.ledgerAccountId) ?? 0) !== 0).map((a) => ({ a, minor: net.get(a.ledgerAccountId) ?? 0, clearing: clearingIds.has(a.ledgerAccountId) }));
  const row = (x: (typeof live)[number]) => ({ id: x.a.id, name: x.a.name, kind: x.a.kind, custodian: x.a.custodian, balance: major(x.minor), clearing: x.clearing });
  const money = live.map(row);
  const sumKind = (kinds: string[], clearing = false) => live.filter((x) => kinds.includes(x.a.kind) && x.clearing === clearing).reduce((s, x) => s + x.minor, 0);
  const people = new Map<string, { custodian: { id: string; name: string } | null; total: number; accounts: ReturnType<typeof row>[] }>();
  for (const x of live.filter((y) => y.a.kind === "CASH")) {
    const k = x.a.custodian?.id ?? "unassigned";
    const p = people.get(k) ?? { custodian: x.a.custodian, total: 0, accounts: [] };
    p.total += x.minor;
    p.accounts.push(row(x));
    people.set(k, p);
  }
  // Credit-normal balances (what is owed) are shown positive.
  const owed = (key: string) => -keyBalance(key);
  const courierAccrued = owed("liability.courier_charges_accrued");
  const gatewayAccrued = owed("liability.gateway_fees_accrued");
  const equity = viewer.sensitive
    ? ledger.filter((a) => a.type === "EQUITY" && !a.parentId).map((g) => ({ code: g.code, name: g.name, balance: major(-total(g.id)) }))
    : null;
  return {
    asOf,
    cashByPerson: [...people.values()].map((p) => ({ custodian: p.custodian, total: major(p.total), accounts: p.accounts })),
    totals: {
      cash: major(sumKind(["CASH"])),
      bank: major(sumKind(["BANK"])),
      wallets: major(sumKind(["MOBILE_WALLET"])),
      /** COD the courier collected and hasn't paid out, less the charges accrued against it — what should arrive. */
      courierReceivable: major(sumKind(["COURIER"], true) + sumKind(["COURIER"]) - courierAccrued),
      courierChargesAccrued: major(courierAccrued),
      gatewayReceivable: major(sumKind(["PAYMENT_GATEWAY"], true) + sumKind(["PAYMENT_GATEWAY"]) - gatewayAccrued),
      /** Manual receipts recorded and not banked yet. */
      otherReceivable: major(sumKind(["OTHER"], true)),
      gatewayFeesAccrued: major(gatewayAccrued),
      otherMoney: major(sumKind(["OTHER"])),
      adAccounts: major(sumKind(["AD_PLATFORM"])),
      inventory: major(keyBalance("asset.inventory")),
      workInProgress: major(keyBalance("asset.wip")),
      prepaid: major(keyBalance("asset.prepaid")),
      courierClaims: major(keyBalance("asset.courier_claims")),
      customerReceivables: major(keyBalance("asset.receivable_trade")),
      suppliersOwed: major(owed("liability.payable_trade")),
      goodsNotInvoiced: major(owed("liability.grni")),
      ownerToRepay: major(owed("liability.owner_reimbursable")),
      loans: major(owed("liability.loans")),
      storeCredit: major(owed("liability.store_credit")),
      vatOwed: major(owed("liability.vat_output")),
    },
    accounts: money,
    equity,
  };
}
