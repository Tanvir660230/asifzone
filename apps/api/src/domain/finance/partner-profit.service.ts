/**
 * The owner and the partners (docs/FINANCE_EQUITY.md §8–§10), on top of the partner register (equity.service):
 *
 *   profit share   a WORKING partner gets a confirmed % of each finished month's net profit (the income statement's own
 *                  figure). Under ZERO_IN_LOSS_MONTHS a loss month shares nothing and the next month shares its whole
 *                  profit. A share is posted once — Dr 3350 profit shared, Cr the partner's current account — and never
 *                  recomputed: if a shared month's profit later changes, the difference is a correction line in the next
 *                  share (a negative total is carried, never taken back from the partner).
 *   paying         a Treasury withdrawal from cash / bKash / bank against the partner's current account, with the method.
 *   the owner      money put in → owner capital (3100); money taken out → drawings (3300). Courier / gateway payouts the
 *                  owner kept become drawings from the account they were paid into, once per payout.
 *   activity       every line on a partner's two accounts, in date order with running totals — what was put in, earned,
 *                  paid and taken, and when.
 */
import { addDays, type PAYMENT_METHODS } from "@clothing-brand/shared";
import type { Prisma } from "@prisma/client";
import { installId } from "../../config/installation";
import { prisma } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { processFinancialEvent, recordFinancialEvent } from "./events.service";
import { incomeStatement } from "./statements.service";
import { resolveMappedAccount } from "./chart.service";
import { requestMovement } from "./treasury.service";
import { PROFIT_SHARE_EVENT } from "./owner-books-posting-rules";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";
import { booksStarted } from "./finance-facts";
import { isBusinessOwner, partnerNumber } from "./equity.service";
import { classifiedLines, partnerBalances, type LineClass } from "./partner-statement.service";

type PaymentMethod = (typeof PAYMENT_METHODS)[number];
const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);
const METHOD_LABEL: Record<PaymentMethod, string> = { CASH: "cash", BKASH: "bKash", NAGAD: "Nagad", BANK: "bank", OTHER: "other" };

// ── the rules (pure) ──────────────────────────────────────────────────────────────────────────────────────────────────

export const monthOf = (date: string) => date.slice(0, 7);
export const monthStart = (ym: string) => `${ym}-01`;
export function monthEnd(ym: string) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`, -1);
}
export function nextMonth(ym: string) {
  return monthOf(addDays(monthEnd(ym), 1));
}
/** Months from `from` to `to`, both included. */
export function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  for (let m = from; m <= to; m = nextMonth(m)) out.push(m);
  return out;
}

/** A month's share in minor units: pct × the profit, nothing in a loss month. */
export const shareOf = (pct: number, profitMinor: number) => (profitMinor > 0 ? Math.round((profitMinor * pct) / 100) : 0);

export interface Correction { kind: "CHANGE" | "CARRIED"; period: string; amount: number; note: string }

/**
 * The next share: this month's share, plus a correction for every earlier month whose profit has changed since it was
 * shared (what it should have been now − what was credited for it so far), plus anything carried. All minor units.
 */
export function nextShare(input: {
  pct: number;
  profitMinor: number;
  earlier: Array<{ period: string; profitNowMinor: number; creditedForPeriodMinor: number }>;
  carriedMinor: number;
  carriedFrom: string | null;
}) {
  const monthShare = shareOf(input.pct, input.profitMinor);
  const corrections: Array<Correction & { amountMinor: number }> = [];
  for (const e of input.earlier) {
    const delta = shareOf(input.pct, e.profitNowMinor) - e.creditedForPeriodMinor;
    if (delta !== 0) corrections.push({ kind: "CHANGE", period: e.period, amount: 0, amountMinor: delta, note: `${e.period}'s profit changed since it was shared` });
  }
  if (input.carriedMinor !== 0) corrections.push({ kind: "CARRIED", period: input.carriedFrom ?? "", amount: 0, amountMinor: input.carriedMinor, note: "Carried from the previous share" });
  const total = monthShare + corrections.reduce((s, c) => s + c.amountMinor, 0);
  return { monthShare, corrections, amount: Math.max(0, total), carried: Math.min(0, total) };
}

// ── reading ───────────────────────────────────────────────────────────────────────────────────────────────────────────

async function monthProfitMinor(ym: string, cur: string) {
  const s = await incomeStatement({ from: monthStart(ym), to: monthEnd(ym) });
  return toMinor(s.current.netProfit, cur);
}

type ShareRow = Prisma.ProfitShareGetPayload<object>;
const correctionsOf = (r: ShareRow) => (r.corrections as unknown as Correction[]) ?? [];

function shareDto(r: ShareRow, cur: string) {
  return {
    id: r.id, period: r.period, periodStart: businessDateOf(r.periodStart), periodEnd: businessDateOf(r.periodEnd),
    netProfit: Number(r.netProfit), sharePct: Number(r.sharePct), monthShare: Number(r.monthShare), corrections: correctionsOf(r),
    amount: toMajorNumber(toMinor(r.amount, cur), cur), carried: Number(r.carried), createdAt: r.createdAt.toISOString(),
  };
}

/** The first month a partner shares in, and the last finished month (nothing in the running month). */
function shareWindow(p: { shareFrom: Date | null; joinedOn: Date; leftOn: Date | null }, openingDate: string | null, today: string) {
  const starts = [p.shareFrom ? businessDateOf(p.shareFrom) : businessDateOf(p.joinedOn), openingDate ?? "9999-12-31"].sort();
  const first = monthOf(starts[1]!);
  const lastFinished = monthOf(addDays(`${monthOf(today)}-01`, -1));
  const left = p.leftOn ? monthOf(businessDateOf(p.leftOn)) : null;
  return { first, last: left && left < lastFinished ? left : lastFinished };
}

// ── profit shares ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Shares every finished month not shared yet, for each partner with a confirmed share — up to `through`. */
export async function runProfitShares(q: { through?: string }, actor: FinanceActor) {
  const ctx = await getFinanceContext();
  const { business } = ctx;
  const cur = business.baseCurrency;
  if (!(await booksStarted(ctx))) throw financeError(409, "BOOKS_NOT_STARTED", "Start the books first — until the opening balances are posted the month's profit isn't known");
  const today = businessToday(business);
  const partners = await prisma.partner.findMany({ where: { businessId: business.id, profitSharePct: { not: null }, shareConfirmedAt: { not: null }, role: { not: "OWNER" } }, orderBy: { number: "asc" } });
  const made: Array<{ partner: string; period: string; amount: number }> = [];
  for (const p of partners) {
    if (p.lossRule !== "ZERO_IN_LOSS_MONTHS") throw financeError(409, "LOSS_RULE_NOT_BUILT", "Carrying losses forward isn't available yet");
    const w = shareWindow(p, business.openingDate, today);
    const last = q.through && q.through < w.last ? q.through : w.last;
    if (w.first > last) continue;
    for (const period of monthsBetween(w.first, last)) {
      const done = await prisma.profitShare.findUnique({ where: { partnerId_period: { partnerId: p.id, period } } });
      if (done) continue;
      const pct = Number(p.profitSharePct);
      const earlierRows = await prisma.profitShare.findMany({ where: { partnerId: p.id, period: { lt: period } }, orderBy: { period: "asc" } });
      const earlier = [];
      for (const r of earlierRows) {
        const credited = toMinor(r.monthShare, cur) + earlierRows.flatMap(correctionsOf).filter((c) => c.kind === "CHANGE" && c.period === r.period).reduce((s, c) => s + toMinor(c.amount, cur), 0);
        earlier.push({ period: r.period, profitNowMinor: await monthProfitMinor(r.period, cur), creditedForPeriodMinor: credited });
      }
      const prev = earlierRows.at(-1);
      const profitMinor = await monthProfitMinor(period, cur);
      const s = nextShare({ pct, profitMinor, earlier, carriedMinor: prev ? toMinor(prev.carried, cur) : 0, carriedFrom: prev?.period ?? null });
      const corrections = s.corrections.map(({ amountMinor, ...c }) => ({ ...c, amount: toMajorNumber(amountMinor, cur) }));
      const result = await financeTransaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`profit-share:${p.id}`}))`;
        if (await tx.profitShare.findUnique({ where: { partnerId_period: { partnerId: p.id, period } } })) return null;
        await ensureOwnerBooksSetupInTx(tx, business, actor);
        let eventId: string | null = null;
        if (s.amount > 0) {
          const { event } = await recordFinancialEvent(tx, {
            contract: "finance.event", contractVersion: 1, businessKey: business.key, brandKey: ctx.brand.key,
            source: { installId, system: "finance", entityType: "Partner", entityId: p.id },
            event: { type: PROFIT_SHARE_EVENT, version: 1, key: `profit-share:${p.id}:${period}#r0`, occurredAt: new Date().toISOString() },
            financialDate: monthEnd(period), currency: cur,
            payload: { partnerId: p.id, partnerName: p.name, period, amount: s.amount, currentAccountId: p.currentAccountId },
          });
          eventId = event.id;
        }
        const row = await tx.profitShare.create({
          data: {
            businessId: business.id, partnerId: p.id, period, periodStart: dateColumn(monthStart(period)), periodEnd: dateColumn(monthEnd(period)),
            netProfit: toDecimal(profitMinor, cur), sharePct: pct.toFixed(4), monthShare: toDecimal(s.monthShare, cur),
            corrections: corrections as unknown as Prisma.InputJsonValue, amount: toDecimal(s.amount, cur), carried: toDecimal(s.carried, cur),
            eventId, createdByAdminId: adminOf(actor),
          },
        });
        await recordFinanceAudit(tx, { businessId: business.id, actor, action: "equity.profit_share", entityType: "ProfitShare", entityId: row.id, after: shareDto(row, cur) });
        return { row, eventId };
      });
      if (!result) continue;
      if (result.eventId) await processFinancialEvent(result.eventId);
      made.push({ partner: p.name, period, amount: toMajorNumber(s.amount, cur) });
    }
  }
  return { shared: made };
}

/**
 * Every partner but the owner — with a share or not, still here or gone — with what they are owed, what is waiting for
 * approval and what can be paid now (from the ledger, partner-statement.service), their shares, and months waiting.
 */
export async function profitShareOverview() {
  const ctx = await getFinanceContext();
  const { business } = ctx;
  const started = await booksStarted(ctx);
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const partners = await prisma.partner.findMany({ where: { businessId: business.id, role: { not: "OWNER" } }, orderBy: { number: "asc" }, include: { profitShares: { orderBy: { period: "desc" } } } });
  const balances = await partnerBalances(partners, today);
  const out = [];
  for (const p of partners) {
    const b = balances.get(p.id)!;
    const sharing = p.profitSharePct !== null;
    const left = Boolean(p.leftOn && businessDateOf(p.leftOn) <= today);
    const w = shareWindow(p, business.openingDate, today);
    const shared = new Set(p.profitShares.map((s) => s.period));
    const waiting = sharing && started && w.first <= w.last ? monthsBetween(w.first, w.last).filter((m) => !shared.has(m)) : [];
    // the running month, as it stands — information only, nothing is posted until it ends; none for someone who has left
    const running = monthOf(today);
    const runningProfit = sharing && !left && started && running >= w.first ? toMajorNumber(await monthProfitMinor(running, cur), cur) : null;
    out.push({
      partnerId: p.id, number: partnerNumber(p.number), name: p.name, role: p.role, sharePct: sharing ? Number(p.profitSharePct) : null, lossRule: p.lossRule,
      confirmed: Boolean(p.shareConfirmedAt), confirmedNote: p.shareConfirmedNote, leftOn: p.leftOn ? businessDateOf(p.leftOn) : null,
      status: left ? ("LEFT" as const) : sharing ? ("ACTIVE" as const) : ("NO_CURRENT_SHARE" as const),
      shares: p.profitShares.map((s) => shareDto(s, cur)),
      balances: b,
      /** Kept for older screens: earned / paid / owed from the ledger (owed = what is posted, before pending payments). */
      totals: { earned: b.finalizedEarnings, paid: b.paymentsCompleted, owed: b.postedPayable },
      waitingMonths: waiting,
      runningMonth: runningProfit === null ? null : { period: running, profitSoFar: runningProfit, shareSoFar: toMajorNumber(shareOf(Number(p.profitSharePct), toMinor(runningProfit, cur)), cur) },
    });
  }
  return { currency: cur, booksStarted: started, partners: out };
}

// ── money: paying a partner, the owner putting in / taking out ─────────────────────────────────────────────────────────

export async function payPartner(partnerId: string, input: { fromFinancialAccountId: string; amount: number; paymentDate?: string; method: PaymentMethod; note?: string | null; advanceReason?: string | null }, actor: FinanceActor, key: string | null) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const p = await prisma.partner.findFirst({ where: { id: partnerId, businessId: business.id } });
  if (!p) throw financeError(404, "PARTNER_NOT_FOUND", "Partner not found");
  if (isBusinessOwner(p.role)) throw financeError(400, "OWNER_NOT_PAID", "The owner takes money out as a withdrawal");
  // The quick answer for more than is owed at all; the real check (owed less payments waiting for approval, under the
  // partner's lock) runs inside the movement (partner-payable.ts). An advance skips both, on the owner's stated reason.
  if (!input.advanceReason) {
    const lines = await prisma.journalLine.aggregate({ where: { accountId: p.currentAccountId, entry: { status: "POSTED" } }, _sum: { debit: true, credit: true } });
    const owed = toMinor(lines._sum.credit ?? 0, cur) - toMinor(lines._sum.debit ?? 0, cur);
    if (toMinor(input.amount, cur) > owed) throw financeError(400, "PAY_MORE_THAN_OWED", `${p.name} is owed ${toMajorNumber(Math.max(0, owed), cur)} — pay at most that, or pay the rest as an advance`, { owed: toMajorNumber(owed, cur) });
  }
  return requestMovement({
    partnerAdvanceReason: input.advanceReason ?? null,
    kind: "WITHDRAWAL", movementDate: input.paymentDate ?? businessToday(business), amount: input.amount, fromFinancialAccountId: input.fromFinancialAccountId, counterAccountId: p.currentAccountId,
    reference: `${partnerNumber(p.number)} ${METHOD_LABEL[input.method]}`, description: `${input.advanceReason ? "Advance paid to" : "Profit share paid to"} ${p.name} (${METHOD_LABEL[input.method]})${input.note ? ` — ${input.note}` : ""}`.slice(0, 300),
  }, actor, key ? `partner-pay:${key}` : null);
}

async function ownerAccounts() {
  const { business } = await getFinanceContext();
  const owner = await prisma.partner.findFirst({ where: { businessId: business.id, role: "OWNER" } });
  const capital = owner ? owner.capitalAccountId : (await resolveMappedAccount(prisma, business.id, "equity.owner_capital")).id;
  const drawings = owner ? owner.currentAccountId : (await resolveMappedAccount(prisma, business.id, "equity.owner_drawings")).id;
  return { business, owner, capital, drawings };
}

export async function ownerMoney(input: { kind: "INVEST" | "WITHDRAW"; financialAccountId: string; amount: number; date?: string; method?: PaymentMethod; note?: string | null }, actor: FinanceActor, key: string | null) {
  const { business, owner, capital, drawings } = await ownerAccounts();
  const who = owner?.name ?? "the owner";
  const how = input.method ? ` (${METHOD_LABEL[input.method]})` : "";
  return requestMovement(
    input.kind === "INVEST"
      ? { kind: "DEPOSIT", movementDate: input.date ?? businessToday(business), amount: input.amount, toFinancialAccountId: input.financialAccountId, counterAccountId: capital, description: `Money put in by ${who}${how}${input.note ? ` — ${input.note}` : ""}`.slice(0, 300) }
      : { kind: "WITHDRAWAL", movementDate: input.date ?? businessToday(business), amount: input.amount, fromFinancialAccountId: input.financialAccountId, counterAccountId: drawings, description: `Taken out by ${who}${how}${input.note ? ` — ${input.note}` : ""}`.slice(0, 300) },
    actor,
    key ? `owner-money:${key}` : null,
  );
}

const tookKey = (settlementId: string) => `owner-took-payout:${settlementId}`;

/** Posted courier / gateway payouts and whether the owner's taking of each is recorded. */
export async function ownerPayouts() {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const rows = await prisma.clearingSettlement.findMany({
    where: { businessId: business.id, status: "POSTED" },
    orderBy: { settlementDate: "desc" },
    select: { id: true, reference: true, settlementDate: true, netAmount: true, clearingAccount: { select: { name: true } }, destinationAccount: { select: { id: true, name: true } } },
  });
  const taken = await prisma.treasuryMovement.findMany({ where: { businessId: business.id, idempotencyKey: { in: rows.map((r) => `request:${tookKey(r.id)}`) } }, select: { idempotencyKey: true, status: true } });
  const takenBy = new Map(taken.map((t) => [t.idempotencyKey, t.status]));
  return {
    payouts: rows.map((r) => ({
      id: r.id, reference: r.reference, date: businessDateOf(r.settlementDate), amount: toMajorNumber(toMinor(r.netAmount, cur), cur), from: r.clearingAccount.name, paidInto: r.destinationAccount,
      taken: takenBy.get(`request:${tookKey(r.id)}`) ?? null,
    })),
  };
}

/** The owner kept these payouts: each becomes a drawing from the account it was paid into, dated the payout's day. Once. */
export async function markPayoutsTaken(settlementIds: string[], actor: FinanceActor) {
  const { business, owner, drawings } = await ownerAccounts();
  const cur = business.baseCurrency;
  const rows = await prisma.clearingSettlement.findMany({ where: { businessId: business.id, id: { in: settlementIds } }, select: { id: true, reference: true, status: true, settlementDate: true, netAmount: true, destinationFinancialAccountId: true } });
  if (rows.length !== settlementIds.length) throw financeError(404, "SETTLEMENT_NOT_FOUND", "A payout wasn't found");
  const notPosted = rows.filter((r) => r.status !== "POSTED");
  if (notPosted.length) throw financeError(409, "SETTLEMENT_NOT_POSTED", `Post these payouts first: ${notPosted.map((r) => r.reference).join(", ")}`);
  const results = [];
  for (const r of rows) {
    const amount = toMajorNumber(toMinor(r.netAmount, cur), cur);
    if (amount <= 0) continue;
    const { movement, replayed } = await requestMovement({
      kind: "WITHDRAWAL", movementDate: businessDateOf(r.settlementDate), amount, fromFinancialAccountId: r.destinationFinancialAccountId, counterAccountId: drawings,
      reference: r.reference.slice(0, 120), description: `Payout ${r.reference} taken by ${owner?.name ?? "the owner"}`.slice(0, 300),
    }, actor, tookKey(r.id));
    results.push({ settlementId: r.id, movementId: movement.id, status: movement.status, replayed });
  }
  return { taken: results };
}

// ── activity ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The history label of a line, from what produced it (its class), never from its sign alone — a reversed share is not
 * "paid", a reversed payment is not "credited". */
function activityKind(cls: LineClass, account: "capital" | "current", net: number, owner: boolean) {
  if (account === "capital") {
    if (cls === "CAPITAL_IN_REVERSAL") return "PUT_IN_REVERSED" as const;
    if (cls === "CAPITAL_OUT_REVERSAL") return "CAPITAL_BACK_REVERSED" as const;
    return net >= 0 ? ("PUT_IN" as const) : ("CAPITAL_BACK" as const);
  }
  switch (cls) {
    case "SHARE": return "PROFIT_SHARE" as const;
    case "SHARE_REVERSAL": return "SHARE_REVERSED" as const;
    case "PAYMENT": return owner ? ("TAKEN_OUT" as const) : ("PAID" as const);
    case "PAYMENT_REVERSAL": return "PAYMENT_REVERSED" as const;
    case "PARTNER_DEPOSIT": return "RECEIVED" as const;
    case "PARTNER_DEPOSIT_REVERSAL": return "RECEIVED_REVERSED" as const;
    default: return net >= 0 ? ("CREDITED" as const) : ("OTHER" as const);
  }
}

/** Every posted line on the partner's capital and current accounts, oldest first, with running totals. */
export async function partnerActivity(partnerId: string, q: { from?: string; to?: string } = {}) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const p = await prisma.partner.findFirst({ where: { id: partnerId, businessId: business.id } });
  if (!p) throw financeError(404, "PARTNER_NOT_FOUND", "Partner not found");
  const lines = await classifiedLines(prisma, business.id, { cur: p.currentAccountId, cap: p.capitalAccountId }, q);
  const owner = isBusinessOwner(p.role);
  let capital = 0;
  let current = 0;
  const items = lines.map(({ line: l, cls, account, advance }) => {
    const net = toMinor(l.credit, cur) - toMinor(l.debit, cur);
    if (account === "capital") capital += net; else current += net;
    return {
      id: l.id, date: businessDateOf(l.entry.entryDate), entryId: l.entry.id, description: l.entry.description, reference: l.entry.reference,
      account, kind: activityKind(cls, account, net, owner), class: cls, advance, amount: toMajorNumber(net, cur),
      capitalAfter: toMajorNumber(capital, cur), currentAfter: toMajorNumber(current, cur),
    };
  });
  const sum = (pred: (i: (typeof items)[number]) => boolean) => toMajorNumber(items.filter(pred).reduce((s, i) => s + Math.round(i.amount * 100), 0), cur);
  return {
    partnerId: p.id, name: p.name, role: p.role,
    totals: {
      putIn: sum((i) => i.account === "capital" && i.amount > 0),
      capitalBack: -sum((i) => i.account === "capital" && i.amount < 0),
      credited: sum((i) => i.account === "current" && i.amount > 0),
      takenOut: -sum((i) => i.account === "current" && i.amount < 0),
      capital: toMajorNumber(capital, cur), current: toMajorNumber(current, cur), net: toMajorNumber(capital + current, cur),
    },
    items: items.reverse(),
  };
}
