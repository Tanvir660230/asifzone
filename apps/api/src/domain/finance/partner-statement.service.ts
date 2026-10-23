/**
 * One source for every partner and owner figure (partner finance plan §5, phase 2). Every posted line on a partner's
 * current (32xx) and capital (31xx) accounts is put in exactly one class by the record that produced it — never by its
 * sign — and every figure the pages show is a sum of classes, so the Owner & partners page, the Finance home and the
 * statement can't disagree:
 *
 *   SHARE / SHARE_REVERSAL                  a month's profit share (its event's journal) / a reversal of one
 *   PAYMENT / PAYMENT_REVERSAL              Treasury withdrawal or adjustment OUT against the account / its reversal
 *   PARTNER_DEPOSIT / _REVERSAL             Treasury deposit or adjustment IN against the current account / its reversal
 *   CAPITAL_IN / CAPITAL_OUT (+ _REVERSAL)  the same on the capital account (incl. owner-paid expenses funded as capital)
 *   OPENING                                 opening balances
 *   UNCLASSIFIED                            anything else (an old hand-written journal) — always shown, never hidden
 *
 *   posted payable P   = Σ credit − Σ debit on the current account, entry date ≤ asOf
 *   pending C          = PENDING_APPROVAL withdrawals / adjustments out against it (any date)
 *   available A        = max(0, P − C)
 *   earned E           = SHARE − SHARE_REVERSAL            paid Pd = PAYMENT − PAYMENT_REVERSAL
 *
 * The owner's accounts are owner capital (3100) and drawings (3300): net capital = 3100's credit balance, drawings =
 * 3300's debit balance — two figures, never added together into "equity".
 */
import type { JournalEntryKind } from "@prisma/client";
import { addDays } from "@clothing-brand/shared";
import type { AppTransactionClient } from "../../config/prisma";
import { prisma } from "../../config/prisma";
import { businessToday, getFinanceContext } from "./finance-context";
import { resolveMappedAccount } from "./chart.service";
import { businessDateOf, dateColumn, financeError, toMajorNumber, toMinor } from "./finance-values";
import { PROFIT_SHARE_EVENT } from "./owner-books-posting-rules";
import { PARTNER_ADVANCE_ACTION } from "./partner-payable";

export const LINE_CLASSES = [
  "SHARE", "SHARE_REVERSAL", "PAYMENT", "PAYMENT_REVERSAL", "PARTNER_DEPOSIT", "PARTNER_DEPOSIT_REVERSAL",
  "CAPITAL_IN", "CAPITAL_IN_REVERSAL", "CAPITAL_OUT", "CAPITAL_OUT_REVERSAL", "OPENING", "UNCLASSIFIED",
] as const;
export type LineClass = (typeof LINE_CLASSES)[number];

type Db = AppTransactionClient | typeof prisma;
interface EntryInfo { id: string; kind: JournalEntryKind; sourceType: string | null; sourceId: string | null; financialEventId: string | null; reversesEntryId: string | null }
const ENTRY_SELECT = { id: true, kind: true, sourceType: true, sourceId: true, financialEventId: true, reversesEntryId: true, entryDate: true, createdAt: true, number: true, description: true, reference: true } as const;

/** Posted lines on the given accounts up to `to` (and from `from`), each with its class; oldest first. */
export async function classifiedLines(db: Db, businessId: string, accounts: { cur: string; cap: string }, range: { from?: string; to?: string } = {}) {
  const lines = await db.journalLine.findMany({
    where: {
      accountId: { in: [accounts.cur, accounts.cap] },
      entry: { businessId, status: "POSTED", ...(range.from || range.to ? { entryDate: { ...(range.from ? { gte: dateColumn(range.from) } : {}), ...(range.to ? { lte: dateColumn(range.to) } : {}) } } : {}) },
    },
    include: { entry: { select: ENTRY_SELECT } },
    orderBy: [{ entry: { entryDate: "asc" } }, { entry: { createdAt: "asc" } }, { id: "asc" }],
  });
  // what produced each entry: the original of a reversal, the movement of a Treasury journal, the event of a share
  const originals = new Map<string, EntryInfo>();
  const reversed = [...new Set(lines.map((l) => l.entry.reversesEntryId).filter((x): x is string => Boolean(x)))];
  if (reversed.length) for (const e of await db.journalEntry.findMany({ where: { id: { in: reversed } }, select: ENTRY_SELECT })) originals.set(e.id, e);
  const entries = [...lines.map((l) => l.entry), ...originals.values()];
  const movementIds = [...new Set(entries.filter((e) => e.kind === "TREASURY" && e.sourceType === "TreasuryMovement" && e.sourceId).map((e) => e.sourceId!))];
  const movements = new Map((movementIds.length ? await db.treasuryMovement.findMany({ where: { id: { in: movementIds } }, select: { id: true, kind: true, direction: true, status: true } }) : []).map((m) => [m.id, m]));
  const advances = new Set(movementIds.length ? (await db.financeAuditEntry.findMany({ where: { businessId, action: PARTNER_ADVANCE_ACTION, entityType: "TreasuryMovement", entityId: { in: movementIds } }, select: { entityId: true } })).map((a) => a.entityId) : []);
  const eventIds = [...new Set(entries.map((e) => e.financialEventId).filter((x): x is string => Boolean(x)))];
  const shareEvents = new Set(eventIds.length ? (await db.financialEvent.findMany({ where: { id: { in: eventIds }, eventType: PROFIT_SHARE_EVENT }, select: { id: true } })).map((e) => e.id) : []);

  const base = (e: EntryInfo, onCapital: boolean): LineClass | null => {
    if (e.kind === "OPENING_BALANCE") return "OPENING";
    if (e.kind === "EVENT" && e.financialEventId && shareEvents.has(e.financialEventId) && !onCapital) return "SHARE";
    if (e.kind === "TREASURY" && e.sourceType === "TreasuryMovement" && e.sourceId) {
      const m = movements.get(e.sourceId);
      if (!m) return null;
      const out = m.kind === "WITHDRAWAL" || (m.kind === "ADJUSTMENT" && m.direction === "OUT");
      const into = m.kind === "DEPOSIT" || (m.kind === "ADJUSTMENT" && m.direction === "IN");
      if (onCapital) return out ? "CAPITAL_OUT" : into ? "CAPITAL_IN" : null;
      return out ? "PAYMENT" : into ? "PARTNER_DEPOSIT" : null;
    }
    return null;
  };
  return lines.map((l) => {
    const onCapital = l.accountId === accounts.cap;
    let cls: LineClass;
    let sourceMovementId: string | null = l.entry.kind === "TREASURY" ? l.entry.sourceId : null;
    if (l.entry.kind === "REVERSAL" && l.entry.reversesEntryId) {
      const o = originals.get(l.entry.reversesEntryId);
      const b = o ? base(o, onCapital) : null;
      cls = b && b !== "OPENING" ? (`${b}_REVERSAL` as LineClass) : "UNCLASSIFIED";
      sourceMovementId = o?.kind === "TREASURY" ? o.sourceId : null;
    } else cls = base(l.entry, onCapital) ?? "UNCLASSIFIED";
    return {
      line: l, cls, account: onCapital ? ("capital" as const) : ("current" as const),
      advance: cls === "PAYMENT" && Boolean(sourceMovementId && advances.has(sourceMovementId)),
      movementStatus: sourceMovementId ? movements.get(sourceMovementId)?.status ?? null : null,
    };
  });
}

/** Sum a class's credits − debits (minor units). */
function netOf(rows: Array<{ line: { debit: unknown; credit: unknown }; cls: LineClass }>, classes: LineClass[], cur: string) {
  return rows.filter((r) => classes.includes(r.cls)).reduce((s, r) => s + toMinor(r.line.credit as never, cur) - toMinor(r.line.debit as never, cur), 0);
}

/** Pending payment-type movements against each account (minor units). */
async function pendingByAccount(db: Db, businessId: string, accountIds: string[], cur: string) {
  if (!accountIds.length) return new Map<string, number>();
  const rows = await db.treasuryMovement.groupBy({
    by: ["counterAccountId"],
    where: { businessId, counterAccountId: { in: accountIds }, status: "PENDING_APPROVAL", OR: [{ kind: "WITHDRAWAL" }, { kind: "ADJUSTMENT", direction: "OUT" }] },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.counterAccountId!, toMinor(r._sum.amount ?? 0, cur)]));
}

export interface PartnerBalances {
  asOf: string;
  postedPayable: number; pendingCommitments: number; availableToPay: number; overCommitted: boolean;
  finalizedEarnings: number; paymentsCompleted: number; paidInAdvance: number; receivedFromPartner: number; unclassified: number;
  capital: { contributed: number; returned: number; net: number };
}

/** Every figure for a set of partners, as of a date, from the ledger (and pending movements for what is reserved). */
export async function partnerBalances(partners: Array<{ id: string; currentAccountId: string; capitalAccountId: string }>, asOf?: string, db: Db = prisma) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const day = asOf ?? businessToday(business);
  const pending = await pendingByAccount(db, business.id, partners.map((p) => p.currentAccountId), cur);
  const out = new Map<string, PartnerBalances>();
  for (const p of partners) {
    const rows = await classifiedLines(db, business.id, { cur: p.currentAccountId, cap: p.capitalAccountId }, { to: day });
    const curRows = rows.filter((r) => r.account === "current");
    const capRows = rows.filter((r) => r.account === "capital");
    const P = curRows.reduce((s, r) => s + toMinor(r.line.credit, cur) - toMinor(r.line.debit, cur), 0);
    const C = pending.get(p.currentAccountId) ?? 0;
    const K = capRows.reduce((s, r) => s + toMinor(r.line.credit, cur) - toMinor(r.line.debit, cur), 0);
    const m = (v: number) => toMajorNumber(v, cur);
    out.set(p.id, {
      asOf: day,
      postedPayable: m(P), pendingCommitments: m(C), availableToPay: m(Math.max(0, P - C)), overCommitted: P - C < 0 && C > 0,
      finalizedEarnings: m(netOf(curRows, ["SHARE", "SHARE_REVERSAL"], cur)),
      paymentsCompleted: m(-netOf(curRows, ["PAYMENT", "PAYMENT_REVERSAL"], cur)),
      paidInAdvance: m(Math.max(0, -P)),
      receivedFromPartner: m(netOf(curRows, ["PARTNER_DEPOSIT", "PARTNER_DEPOSIT_REVERSAL"], cur)),
      unclassified: m(netOf(curRows, ["UNCLASSIFIED"], cur)),
      capital: { contributed: m(netOf(capRows, ["CAPITAL_IN", "CAPITAL_IN_REVERSAL"], cur)), returned: m(-netOf(capRows, ["CAPITAL_OUT", "CAPITAL_OUT_REVERSAL"], cur)), net: m(K) },
    });
  }
  return out;
}

/** The owner: net capital (3100 credit balance) and drawings (3300 debit balance), as of a date — one calculation for
 * Finance home and Owner & partners. */
export async function ownerSummary(asOf?: string, db: Db = prisma) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const day = asOf ?? businessToday(business);
  const owner = await db.partner.findFirst({ where: { businessId: business.id, role: "OWNER" } });
  const capital = owner?.capitalAccountId ?? (await resolveMappedAccount(db as AppTransactionClient, business.id, "equity.owner_capital")).id;
  const drawings = owner?.currentAccountId ?? (await resolveMappedAccount(db as AppTransactionClient, business.id, "equity.owner_drawings")).id;
  const sum = async (accountId: string) => {
    const a = await db.journalLine.aggregate({ where: { accountId, entry: { businessId: business.id, status: "POSTED", entryDate: { lte: dateColumn(day) } } }, _sum: { debit: true, credit: true } });
    return toMinor(a._sum.credit ?? 0, cur) - toMinor(a._sum.debit ?? 0, cur);
  };
  const [k, d] = await Promise.all([sum(capital), sum(drawings)]);
  return { asOf: day, name: owner?.name ?? null, partnerId: owner?.id ?? null, netCapital: toMajorNumber(k, cur), drawings: toMajorNumber(-d, cur) };
}

/** A partner's statement for a date range: opening, every line with its class and running balance, closing, and the
 * check that the lines add up to the ledger's own balance. Current and capital accounts separately. */
export async function partnerStatement(partnerId: string, q: { from?: string; to?: string } = {}) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const p = await prisma.partner.findFirst({ where: { id: partnerId, businessId: business.id } });
  if (!p) throw financeError(404, "PARTNER_NOT_FOUND", "Partner not found");
  const to = q.to ?? businessToday(business);
  const from = q.from ?? businessDateOf(p.joinedOn);
  if (from > to) throw financeError(400, "STATEMENT_DATES", "The statement starts on or before it ends");
  const accounts = { cur: p.currentAccountId, cap: p.capitalAccountId };
  const before = await classifiedLines(prisma, business.id, accounts, { to: addDays(from, -1) });
  const rows = await classifiedLines(prisma, business.id, accounts, { from, to });
  const balanceOf = async (accountId: string) => {
    const a = await prisma.journalLine.aggregate({ where: { accountId, entry: { businessId: business.id, status: "POSTED", entryDate: { lte: dateColumn(to) } } }, _sum: { debit: true, credit: true } });
    return toMinor(a._sum.credit ?? 0, cur) - toMinor(a._sum.debit ?? 0, cur);
  };
  const m = (v: number) => toMajorNumber(v, cur);
  const section = async (account: "current" | "capital", accountId: string) => {
    const opening = before.filter((r) => r.account === account).reduce((s, r) => s + toMinor(r.line.credit, cur) - toMinor(r.line.debit, cur), 0);
    let running = opening;
    const lines = rows.filter((r) => r.account === account).map((r) => {
      const amount = toMinor(r.line.credit, cur) - toMinor(r.line.debit, cur);
      running += amount;
      return {
        id: r.line.id, date: businessDateOf(r.line.entry.entryDate), journalNumber: r.line.entry.number, entryId: r.line.entry.id,
        description: r.line.entry.description, reference: r.line.entry.reference, class: r.cls, advance: r.advance,
        amount: m(amount), balanceAfter: m(running),
      };
    });
    const ledger = await balanceOf(accountId);
    const totals = Object.fromEntries(LINE_CLASSES.map((c) => [c, m(netOf(rows.filter((r) => r.account === account), [c], cur))]).filter(([, v]) => v !== 0));
    return { opening: m(opening), lines, closing: m(running), ledgerBalance: m(ledger), reconciled: running === ledger, difference: m(running - ledger), totals };
  };
  return { partnerId: p.id, name: p.name, role: p.role, from, to, current: await section("current", p.currentAccountId), capital: await section("capital", p.capitalAccountId) };
}
