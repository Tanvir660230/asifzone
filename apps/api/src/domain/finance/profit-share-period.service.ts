/**
 * A month's profit sharing, and corrections to it (partner finance plan §7–§8, phase 3).
 *
 *   prepare   only when the accounting period is CLOSED: the month-end checklist is read (failed / waiting events, money
 *             waiting for approval and draft bills block it), the month's net profit taken from the income statement
 *   verify    a person — never the system — confirms that profit figure; it must still be the books' figure
 *   post      once: a ProfitShare per partner at the rate in force for that month (PartnerShareRate), no corrections and no
 *             carry; the share journal is dated by the books into the first open day after the closed month. A failed
 *             posting leaves the month POSTING_FAILED — the share isn't earned until it is in the books; retry is safe
 *   Autopilot only posts a month a person has verified, and says why it skipped the others.
 *
 * Corrections (ProfitShareAdjustment) never edit a share:
 *   UP        a shared month's profit later higher → proposed at that month's own rate, credited once approved — only
 *             after the month is closed and verified again
 *   DOWN      a shared month's profit later lower → POLICY_REVIEW: nothing is taken back without an accounting decision
 *   DUPLICATE / INVALID   a posting on the partner's account that shouldn't be there → reversed with its evidence, only
 *             while it fits in what they are owed; otherwise POLICY_REVIEW
 */
import type { Partner, Prisma } from "@prisma/client";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { installId } from "../../config/installation";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { booksStarted } from "./finance-facts";
import { financeTransaction } from "./finance-tx";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { processFinancialEvent, recordFinancialEvent } from "./events.service";
import { incomeStatement } from "./statements.service";
import { monthEndChecklist } from "./finance-alerts.service";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";
import { PROFIT_SHARE_ADJUSTED_EVENT, PROFIT_SHARE_EVENT } from "./owner-books-posting-rules";
import { reversePartnerEntryInTx } from "./journal.service";
import { lockPartner, partnerAccountState } from "./partner-payable";
import { isBusinessOwner } from "./equity.service";
import { monthEnd, monthOf, monthStart, monthsBetween, shareOf, shareWindow } from "./partner-profit.service";

const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);
/** Month-end steps that stop a month being shared until they are done. */
const BLOCKING_STEPS = new Set(["events", "approvals", "bills"]);

// ── rates ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The rate in force for a month: the latest PartnerShareRate starting on or before it (a partner with no rate rows yet —
 * made before rates were kept — uses their profitSharePct). */
export async function rateForMonth(db: AppTransactionClient | typeof prisma, p: Pick<Partner, "id" | "profitSharePct">, period: string): Promise<number | null> {
  const rows = await db.partnerShareRate.findMany({ where: { partnerId: p.id }, orderBy: { effectiveFrom: "desc" } });
  if (!rows.length) return p.profitSharePct === null ? null : Number(p.profitSharePct);
  const r = rows.find((x) => businessDateOf(x.effectiveFrom) <= monthStart(period));
  return r && r.pct !== null ? Number(r.pct) : null;
}

/** The first month a new rate may start: after the partner's last shared month (a shared month is never re-priced). */
export async function firstUnsharedMonth(db: AppTransactionClient | typeof prisma, p: Pick<Partner, "id" | "shareFrom" | "joinedOn">) {
  const last = await db.profitShare.findFirst({ where: { partnerId: p.id }, orderBy: { period: "desc" }, select: { period: true } });
  return last ? addMonth(last.period) : monthOf(businessDateOf(p.shareFrom ?? p.joinedOn));
}
function addMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Writes a rate from a month on (inside the caller's transaction). Refused for a month already shared. */
export async function writeShareRate(tx: AppTransactionClient, business: { id: string }, p: Partner, input: { pct: number | null; from: string; note?: string | null }, actor: FinanceActor) {
  const first = await firstUnsharedMonth(tx, p);
  if (input.from < first) throw financeError(409, "RATE_MONTH_SHARED", `${p.name}'s shares are made up to ${monthOf(addMonthBack(first))} — a new rate starts ${first} or later`, { firstMonth: first });
  const effectiveFrom = dateColumn(monthStart(input.from));
  const pct = input.pct === null || input.pct === 0 ? null : input.pct.toFixed(4);
  const row = await tx.partnerShareRate.upsert({
    where: { partnerId_effectiveFrom: { partnerId: p.id, effectiveFrom } },
    create: { businessId: business.id, partnerId: p.id, pct, effectiveFrom, note: input.note ?? null, createdByAdminId: adminOf(actor) },
    update: { pct, note: input.note ?? null },
  });
  await recordFinanceAudit(tx, { businessId: business.id, actor, action: "equity.share_rate", entityType: "PartnerShareRate", entityId: row.id, after: { partnerId: p.id, pct: input.pct, from: input.from } });
  // Partner.profitSharePct mirrors the latest rate (older screens and the badge read it; the share run reads the rates).
  const latest = await tx.partnerShareRate.findFirst({ where: { partnerId: p.id }, orderBy: { effectiveFrom: "desc" } });
  const mirror = latest?.pct ?? null;
  if (String(mirror ?? "") !== String(p.profitSharePct ?? "")) {
    await tx.partner.update({ where: { id: p.id }, data: { profitSharePct: mirror, ...(mirror ? { shareConfirmedAt: new Date() } : {}) } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "equity.partner_update", entityType: "Partner", entityId: p.id, before: { profitSharePct: p.profitSharePct }, after: { profitSharePct: mirror }, reason: "Latest profit-share rate" });
  }
  return row;
}
function addMonthBack(ym: string) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export async function setShareRate(partnerId: string, input: { pct: number | null; from: string; note?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const p = await tx.partner.findFirst({ where: { id: partnerId, businessId: business.id } });
    if (!p) throw financeError(404, "PARTNER_NOT_FOUND", "Partner not found");
    if (isBusinessOwner(p.role)) throw financeError(400, "OWNER_NO_SHARE", "The owner keeps what is left — a profit share is for partners");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`profit-share:${p.id}`}))`;
    const r = await writeShareRate(tx, business, p, input, actor);
    return { id: r.id, pct: r.pct === null ? null : Number(r.pct), from: monthOf(businessDateOf(r.effectiveFrom)) };
  });
}

export async function listShareRates(partnerId: string) {
  const { business } = await getFinanceContext();
  const p = await prisma.partner.findFirst({ where: { id: partnerId, businessId: business.id } });
  if (!p) throw financeError(404, "PARTNER_NOT_FOUND", "Partner not found");
  const rows = await prisma.partnerShareRate.findMany({ where: { partnerId }, orderBy: { effectiveFrom: "asc" } });
  return { partnerId, firstOpenMonth: await firstUnsharedMonth(prisma, p), rates: rows.map((r) => ({ id: r.id, pct: r.pct === null ? null : Number(r.pct), from: monthOf(businessDateOf(r.effectiveFrom)), note: r.note })) };
}

// ── a month ───────────────────────────────────────────────────────────────────────────────────────────────────────────

async function monthProfitMinor(period: string, cur: string) {
  const s = await incomeStatement({ from: monthStart(period), to: monthEnd(period) });
  return toMinor(s.current.netProfit, cur);
}

async function accountingPeriod(businessId: string, period: string) {
  return prisma.financialPeriod.findUnique({ where: { businessId_startDate: { businessId, startDate: dateColumn(monthStart(period)) } }, select: { id: true, status: true } });
}

/** Partners who share in a month: not the owner, in their share window, a rate above 0 for it, not shared yet. */
async function eligible(period: string, business: { id: string; openingDate: string | null }, today: string) {
  const partners = await prisma.partner.findMany({ where: { businessId: business.id, role: { not: "OWNER" } }, orderBy: { number: "asc" } });
  const out: Array<{ partner: Partner; pct: number }> = [];
  for (const p of partners) {
    const w = shareWindow(p, business.openingDate, today);
    if (period < w.first || period > w.last) continue;
    const pct = await rateForMonth(prisma, p, period);
    if (!pct) continue;
    out.push({ partner: p, pct });
  }
  return out;
}

type PeriodRow = Prisma.ProfitSharePeriodGetPayload<object>;
function periodDto(r: PeriodRow | null, period: string, accounting: string | null, cur: string) {
  return {
    period, accountingStatus: accounting, status: r?.status ?? null, blocked: r?.blocked ?? false,
    netProfit: r?.netProfit == null ? null : toMajorNumber(toMinor(r.netProfit, cur), cur),
    readiness: (r?.readiness ?? {}) as Record<string, unknown>,
    preparedAt: r?.preparedAt?.toISOString() ?? null, verifiedAt: r?.verifiedAt?.toISOString() ?? null, verifiedByAdminId: r?.verifiedByAdminId ?? null,
    postedAt: r?.postedAt?.toISOString() ?? null, lastError: r?.lastError ?? null,
  };
}

/** Every finished month since the books' opening: its accounting period and where its sharing stands. */
export async function listSharePeriods() {
  const ctx = await getFinanceContext();
  const { business } = ctx;
  const cur = business.baseCurrency;
  const today = businessToday(business);
  if (!business.openingDate) return { months: [] };
  const last = monthOf(`${addMonthBack(monthOf(today))}-01`);
  const months = monthOf(business.openingDate) <= last ? monthsBetween(monthOf(business.openingDate), last) : [];
  const [rows, periods] = await Promise.all([
    prisma.profitSharePeriod.findMany({ where: { businessId: business.id } }),
    prisma.financialPeriod.findMany({ where: { businessId: business.id }, select: { startDate: true, status: true } }),
  ]);
  const byPeriod = new Map(rows.map((r) => [r.period, r]));
  const acc = new Map(periods.map((p) => [monthOf(businessDateOf(p.startDate)), p.status]));
  return { months: months.reverse().map((m) => periodDto(byPeriod.get(m) ?? null, m, acc.get(m) ?? null, cur)) };
}

export async function prepareSharePeriod(period: string, actor: FinanceActor) {
  const ctx = await getFinanceContext();
  const { business } = ctx;
  const cur = business.baseCurrency;
  const today = businessToday(business);
  if (!(await booksStarted(ctx))) throw financeError(409, "BOOKS_NOT_STARTED", "Start the books first");
  if (period >= monthOf(today)) throw financeError(409, "PERIOD_NOT_FINISHED", `${period} hasn't ended yet`);
  const acc = await accountingPeriod(business.id, period);
  if (acc?.status !== "CLOSED") throw financeError(409, "PERIOD_NOT_CLOSED", `Close ${period} in the books first — a month is shared only once it is closed and checked`, { accountingStatus: acc?.status ?? "OPEN" });
  const existing = await prisma.profitSharePeriod.findUnique({ where: { businessId_period: { businessId: business.id, period } } });
  if (existing?.status === "POSTED") throw financeError(409, "PERIOD_ALREADY_SHARED", `${period} is already shared`);
  if (existing?.status === "POSTING_FAILED") throw financeError(409, "PERIOD_POSTING_FAILED", `${period}'s shares are made but not all in the books — retry them`);
  const checklist = await monthEndChecklist({ month: period });
  const blockers = checklist.steps.filter((s) => BLOCKING_STEPS.has(s.key) && s.status === "TODO");
  const profit = await monthProfitMinor(period, cur);
  // a month already shared and re-closed after a change is verified again; its shares stand and differences are corrections
  const restatement = existing?.status === "RESTATEMENT_WATCH" || (await prisma.profitShare.count({ where: { businessId: business.id, period } })) > 0;
  const readiness = {
    restatement,
    steps: checklist.steps.map((s) => ({ key: s.key, label: s.label, status: s.status, detail: s.detail, href: s.href, blocking: BLOCKING_STEPS.has(s.key) })),
    shares: restatement ? [] : (await eligible(period, business, today)).map(({ partner, pct }) => ({ partnerId: partner.id, name: partner.name, pct, share: toMajorNumber(shareOf(pct, profit), cur) })),
  };
  const data = {
    status: "PREPARED" as const, netProfit: toDecimal(profit, cur), readiness: readiness as unknown as Prisma.InputJsonValue, blocked: blockers.length > 0,
    preparedAt: new Date(), preparedByAdminId: adminOf(actor), verifiedAt: null, verifiedByAdminId: null, lastError: null,
  };
  const row = await financeTransaction(async (tx) => {
    const r = await tx.profitSharePeriod.upsert({ where: { businessId_period: { businessId: business.id, period } }, create: { businessId: business.id, period, ...data }, update: data });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "profit_share_period.prepare", entityType: "ProfitSharePeriod", entityId: r.id, after: { period, netProfit: toMajorNumber(profit, cur), blocked: r.blocked } });
    return r;
  });
  return periodDto(row, period, acc.status, cur);
}

export async function verifySharePeriod(period: string, input: { confirmProfit: number }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  if (actor.type !== "ADMIN") throw financeError(409, "VERIFY_BY_A_PERSON", "A month's profit is verified by a person, never automatically");
  const row = await prisma.profitSharePeriod.findUnique({ where: { businessId_period: { businessId: business.id, period } } });
  if (row?.status !== "PREPARED") throw financeError(409, "PERIOD_NOT_PREPARED", `Prepare ${period} first`);
  if (row.blocked) throw financeError(409, "PERIOD_BLOCKED", `${period} has month-end steps to finish first`);
  const acc = await accountingPeriod(business.id, period);
  if (acc?.status !== "CLOSED") throw financeError(409, "PERIOD_NOT_CLOSED", `${period} was reopened — close it and prepare it again`);
  const now = await monthProfitMinor(period, cur);
  const prepared = toMinor(row.netProfit ?? 0, cur);
  if (now !== prepared) throw financeError(409, "SNAPSHOT_STALE", `${period}'s profit changed since it was prepared — prepare it again`, { prepared: toMajorNumber(prepared, cur), now: toMajorNumber(now, cur) });
  if (toMinor(input.confirmProfit, cur) !== prepared) throw financeError(400, "PROFIT_NOT_CONFIRMED", `Type the month's profit exactly: ${toMajorNumber(prepared, cur)}`, { netProfit: toMajorNumber(prepared, cur) });
  const restatement = Boolean((row.readiness as { restatement?: boolean })?.restatement);
  const after = await financeTransaction(async (tx) => {
    const r = await tx.profitSharePeriod.update({ where: { id: row.id }, data: { status: restatement ? "POSTED" : "VERIFIED", verifiedAt: new Date(), verifiedByAdminId: adminOf(actor) } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "profit_share_period.verify", entityType: "ProfitSharePeriod", entityId: r.id, after: { period, netProfit: toMajorNumber(prepared, cur), restatement } });
    return r;
  });
  // verified again after a change: the differences are corrections (up proposed, down for an accounting decision)
  if (restatement) await detectRestatements({ period }, actor);
  return periodDto(after, period, acc.status, cur);
}

/** Posts a verified month once: a share per partner at the month's rate. A posting failure is kept, never hidden. */
export async function postSharePeriod(period: string, actor: FinanceActor) {
  const ctx = await getFinanceContext();
  const { business } = ctx;
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const row = await prisma.profitSharePeriod.findUnique({ where: { businessId_period: { businessId: business.id, period } } });
  if (row?.status !== "VERIFIED" || !row.verifiedByAdminId) throw financeError(409, "PERIOD_NOT_VERIFIED", `${period} must be prepared and verified by a person before it is shared`);
  const acc = await accountingPeriod(business.id, period);
  if (acc?.status !== "CLOSED") throw financeError(409, "PERIOD_NOT_CLOSED", `${period} was reopened — close it and prepare it again`);
  const profit = toMinor(row.netProfit ?? 0, cur);
  const made: Array<{ partner: string; period: string; amount: number }> = [];
  const events: string[] = [];
  for (const { partner: p, pct } of await eligible(period, business, today)) {
    const amount = shareOf(pct, profit);
    const result = await financeTransaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`profit-share:${p.id}`}))`;
      if (await tx.profitShare.findUnique({ where: { partnerId_period: { partnerId: p.id, period } } })) return null;
      await ensureOwnerBooksSetupInTx(tx, business, actor);
      let eventId: string | null = null;
      if (amount > 0) {
        const { event } = await recordFinancialEvent(tx, {
          contract: "finance.event", contractVersion: 1, businessKey: business.key, brandKey: ctx.brand.key,
          source: { installId, system: "finance", entityType: "Partner", entityId: p.id },
          event: { type: PROFIT_SHARE_EVENT, version: 1, key: `profit-share:${p.id}:${period}#r0`, occurredAt: new Date().toISOString() },
          financialDate: monthEnd(period), currency: cur,
          payload: { partnerId: p.id, partnerName: p.name, period, amount, currentAccountId: p.currentAccountId },
        });
        eventId = event.id;
      }
      const share = await tx.profitShare.create({
        data: {
          businessId: business.id, partnerId: p.id, period, periodStart: dateColumn(monthStart(period)), periodEnd: dateColumn(monthEnd(period)),
          netProfit: toDecimal(profit, cur), sharePct: pct.toFixed(4), monthShare: toDecimal(amount, cur), corrections: [], amount: toDecimal(amount, cur), carried: toDecimal(0, cur),
          eventId, createdByAdminId: adminOf(actor),
        },
      });
      await recordFinanceAudit(tx, { businessId: business.id, actor, action: "equity.profit_share", entityType: "ProfitShare", entityId: share.id, after: { period, partner: p.name, pct, amount: toMajorNumber(amount, cur) } });
      return { eventId };
    });
    if (!result) continue;
    if (result.eventId) events.push(result.eventId);
    made.push({ partner: p.name, period, amount: toMajorNumber(amount, cur) });
  }
  // into the books — a failure is caught and kept on the month (processFinancialEvent marks the event FAILED and re-throws)
  const errors: string[] = [];
  for (const id of events) {
    try { await processFinancialEvent(id); } catch (err) { errors.push(err instanceof Error ? err.message : String(err)); }
  }
  const after = await prisma.profitSharePeriod.update({
    where: { id: row.id },
    data: errors.length ? { status: "POSTING_FAILED", lastError: errors.join("; ").slice(0, 1000), postedAt: new Date() } : { status: "POSTED", lastError: null, postedAt: new Date() },
  });
  await financeTransaction((tx) => recordFinanceAudit(tx, { businessId: business.id, actor, action: "profit_share_period.post", entityType: "ProfitSharePeriod", entityId: row.id, after: { period, status: after.status, shared: made } }));
  return { ...periodDto(after, period, acc.status, cur), shared: made };
}

/** Puts a month's shares that didn't reach the books into them (each event once — its journal key makes it safe). */
export async function retrySharePeriod(period: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const row = await prisma.profitSharePeriod.findUnique({ where: { businessId_period: { businessId: business.id, period } } });
  if (row?.status !== "POSTING_FAILED") throw financeError(409, "NOTHING_TO_RETRY", `${period} has no failed share postings`);
  const shares = await prisma.profitShare.findMany({ where: { businessId: business.id, period, eventId: { not: null } }, select: { eventId: true } });
  const events = await prisma.financialEvent.findMany({ where: { id: { in: shares.map((s) => s.eventId!) }, status: { not: "POSTED" } }, select: { id: true } });
  const errors: string[] = [];
  for (const e of events) {
    try { await processFinancialEvent(e.id); } catch (err) { errors.push(err instanceof Error ? err.message : String(err)); }
  }
  const after = await prisma.profitSharePeriod.update({ where: { id: row.id }, data: errors.length ? { lastError: errors.join("; ").slice(0, 1000) } : { status: "POSTED", lastError: null } });
  await financeTransaction((tx) => recordFinanceAudit(tx, { businessId: business.id, actor, action: "profit_share_period.retry", entityType: "ProfitSharePeriod", entityId: row.id, after: { period, status: after.status } }));
  return periodDto(after, period, (await accountingPeriod(business.id, period))?.status ?? null, cur);
}

/**
 * Posts every month a person has verified (the Share button and Autopilot), and says why every other finished month
 * wasn't shared. Never prepares or verifies a month itself.
 */
export async function postVerifiedPeriods(q: { through?: string }, actor: FinanceActor) {
  const { months } = await listSharePeriods();
  const shared: Array<{ partner: string; period: string; amount: number }> = [];
  const skipped: Array<{ period: string; reason: string }> = [];
  for (const m of [...months].reverse()) {
    if (q.through && m.period > q.through) continue;
    if (m.status === "VERIFIED" && m.verifiedByAdminId) {
      const r = await postSharePeriod(m.period, actor);
      shared.push(...r.shared);
      if (r.status === "POSTING_FAILED") skipped.push({ period: m.period, reason: "POSTING_FAILED" });
      continue;
    }
    if (m.status === "POSTED" || m.status === "RESTATEMENT_WATCH") continue;
    skipped.push({
      period: m.period,
      reason: m.accountingStatus !== "CLOSED" ? "NOT_CLOSED" : !m.status ? "NOT_PREPARED" : m.status === "POSTING_FAILED" ? "POSTING_FAILED" : m.blocked ? "BLOCKED" : "NOT_VERIFIED",
    });
  }
  return { shared, skipped };
}

// ── corrections ───────────────────────────────────────────────────────────────────────────────────────────────────────

type AdjustmentRow = Prisma.ProfitShareAdjustmentGetPayload<object>;
function adjustmentDto(a: AdjustmentRow, cur: string) {
  const m = (v: Prisma.Decimal | null) => (v === null ? null : toMajorNumber(toMinor(v, cur), cur));
  return {
    id: a.id, partnerId: a.partnerId, period: a.period, kind: a.kind, status: a.status, amount: m(a.amount), sharePct: a.sharePct === null ? null : Number(a.sharePct),
    profitThen: m(a.profitThen), profitNow: m(a.profitNow), reason: a.reason, relatedEntryId: a.relatedEntryId, decidedAt: a.decidedAt?.toISOString() ?? null,
    rejectionReason: a.rejectionReason, journalEntryId: a.journalEntryId, createdAt: a.createdAt.toISOString(),
  };
}

export async function listAdjustments(q: { partnerId?: string } = {}) {
  const { business } = await getFinanceContext();
  const rows = await prisma.profitShareAdjustment.findMany({ where: { businessId: business.id, ...(q.partnerId ? { partnerId: q.partnerId } : {}) }, orderBy: { createdAt: "desc" } });
  return { adjustments: rows.map((a) => adjustmentDto(a, business.baseCurrency)) };
}

/**
 * Compares each shared month (closed and verified) with the books now. Higher → a PROPOSED correction at that month's own
 * rate; lower → a POLICY_REVIEW item that posts nothing. One open item per partner and month; a newer difference replaces
 * an older proposal.
 */
export async function detectRestatements(q: { period?: string }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const periods = await prisma.profitSharePeriod.findMany({ where: { businessId: business.id, status: "POSTED", ...(q.period ? { period: q.period } : {}) } });
  const made: AdjustmentRow[] = [];
  for (const sp of periods) {
    if ((await accountingPeriod(business.id, sp.period))?.status !== "CLOSED") continue;
    const profitNow = await monthProfitMinor(sp.period, cur);
    const shares = await prisma.profitShare.findMany({ where: { businessId: business.id, period: sp.period } });
    for (const s of shares) {
      const pct = Number(s.sharePct);
      const posted = await prisma.profitShareAdjustment.findMany({ where: { partnerId: s.partnerId, period: sp.period, status: "POSTED", kind: "PROFIT_RESTATEMENT_UP" } });
      const credited = toMinor(s.amount, cur) + posted.reduce((t, a) => t + toMinor(a.amount, cur), 0);
      const delta = shareOf(pct, profitNow) - credited;
      const open = await prisma.profitShareAdjustment.findMany({ where: { partnerId: s.partnerId, period: sp.period, status: { in: ["PROPOSED", "POLICY_REVIEW"] }, kind: { in: ["PROFIT_RESTATEMENT_UP", "PROFIT_RESTATEMENT_DOWN"] } } });
      if (delta === 0) continue;
      if (open.some((a) => toMinor(a.amount, cur) === delta)) continue;
      const row = await financeTransaction(async (tx) => {
        for (const a of open) {
          if (a.status === "PROPOSED") await tx.profitShareAdjustment.update({ where: { id: a.id }, data: { status: "REJECTED", decidedAt: new Date(), rejectionReason: "Replaced — the month's profit changed again" } });
        }
        const up = delta > 0;
        const r = await tx.profitShareAdjustment.create({
          data: {
            businessId: business.id, partnerId: s.partnerId, period: sp.period, kind: up ? "PROFIT_RESTATEMENT_UP" : "PROFIT_RESTATEMENT_DOWN", status: up ? "PROPOSED" : "POLICY_REVIEW",
            amount: toDecimal(delta, cur), sharePct: s.sharePct, profitThen: s.netProfit, profitNow: toDecimal(profitNow, cur),
            reason: up ? `${sp.period}'s profit is now higher than when it was shared` : `${sp.period}'s profit is now lower than when it was shared — nothing is taken back without an accounting decision`,
            proposedByAdminId: adminOf(actor),
          },
        });
        await recordFinanceAudit(tx, { businessId: business.id, actor, action: "profit_share_adjustment.detect", entityType: "ProfitShareAdjustment", entityId: r.id, after: adjustmentDto(r, cur) });
        return r;
      });
      made.push(row);
    }
  }
  return { adjustments: made.map((a) => adjustmentDto(a, cur)) };
}

/** A posting on a partner's current account that shouldn't be there (a duplicate, or a wrong one), with its journal as
 * evidence. PROPOSED when reversing it fits in what they are owed; otherwise POLICY_REVIEW. */
export async function proposeReversal(input: { kind: "DUPLICATE_POSTING" | "INVALID_POSTING"; partnerId: string; relatedEntryId: string; reason: string }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const p = await tx.partner.findFirst({ where: { id: input.partnerId, businessId: business.id, role: { not: "OWNER" } } });
    if (!p) throw financeError(404, "PARTNER_NOT_FOUND", "Partner not found");
    const entry = await tx.journalEntry.findFirst({ where: { id: input.relatedEntryId, businessId: business.id }, include: { lines: true, reversedBy: { select: { id: true } } } });
    if (!entry || entry.status !== "POSTED") throw financeError(404, "JOURNAL_NOT_FOUND", "Posted journal not found");
    if (entry.kind === "REVERSAL" || entry.kind === "TREASURY") throw financeError(400, "NOT_A_CREDIT_POSTING", "A payment or a reversal is undone from its own page, not as a correction");
    if (entry.reversedBy) throw financeError(409, "ALREADY_REVERSED", "This journal is already reversed");
    const credit = entry.lines.filter((l) => l.accountId === p.currentAccountId).reduce((t, l) => t + toMinor(l.credit, cur) - toMinor(l.debit, cur), 0);
    if (credit <= 0) throw financeError(400, "NOT_A_CREDIT_POSTING", `This journal doesn't credit ${p.name}'s account`);
    const open = await tx.profitShareAdjustment.findFirst({ where: { relatedEntryId: entry.id, status: { in: ["PROPOSED", "POLICY_REVIEW", "POSTED"] } } });
    if (open) throw financeError(409, "ADJUSTMENT_EXISTS", "A correction for this journal already exists", { adjustmentId: open.id });
    await lockPartner(tx, p.id);
    const s = await partnerAccountState(tx, business.id, p.currentAccountId, cur);
    const share = await tx.profitShare.findFirst({ where: { eventId: entry.financialEventId ?? "__none__" }, select: { period: true, sharePct: true } });
    const r = await tx.profitShareAdjustment.create({
      data: {
        businessId: business.id, partnerId: p.id, period: share?.period ?? monthOf(businessDateOf(entry.entryDate)), kind: input.kind, status: s.available >= credit ? "PROPOSED" : "POLICY_REVIEW",
        amount: toDecimal(-credit, cur), sharePct: share?.sharePct ?? null, reason: input.reason, relatedEntryId: entry.id, proposedByAdminId: adminOf(actor),
      },
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "profit_share_adjustment.propose", entityType: "ProfitShareAdjustment", entityId: r.id, after: adjustmentDto(r, cur), reason: input.reason });
    return adjustmentDto(r, cur);
  });
}

export async function approveAdjustment(id: string, actor: FinanceActor) {
  const ctx = await getFinanceContext();
  const { business } = ctx;
  const cur = business.baseCurrency;
  const a = await prisma.profitShareAdjustment.findFirst({ where: { id, businessId: business.id }, include: { partner: true } });
  if (!a) throw financeError(404, "ADJUSTMENT_NOT_FOUND", "Correction not found");
  if (a.status === "POLICY_REVIEW") throw financeError(409, "ADJUSTMENT_NEEDS_POLICY", "This would take money back from the partner — it needs an accounting decision, not an approval");
  if (a.status !== "PROPOSED") throw financeError(409, "ADJUSTMENT_NOT_PROPOSED", `This correction is ${a.status.toLowerCase().replace("_", " ")}`);
  const p = a.partner;
  if (a.kind === "PROFIT_RESTATEMENT_UP") {
    const sp = await prisma.profitSharePeriod.findUnique({ where: { businessId_period: { businessId: business.id, period: a.period } } });
    if (sp?.status !== "POSTED" || (await accountingPeriod(business.id, a.period))?.status !== "CLOSED") {
      throw financeError(409, "PERIOD_NOT_VERIFIED", `Close ${a.period} and verify it again before its correction is credited`);
    }
    const eventId = await financeTransaction(async (tx) => {
      const fresh = await tx.profitShareAdjustment.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== "PROPOSED") throw financeError(409, "ADJUSTMENT_NOT_PROPOSED", "This correction was already decided");
      await ensureOwnerBooksSetupInTx(tx, business, actor);
      const { event } = await recordFinancialEvent(tx, {
        contract: "finance.event", contractVersion: 1, businessKey: business.key, brandKey: ctx.brand.key,
        source: { installId, system: "finance", entityType: "Partner", entityId: p.id },
        event: { type: PROFIT_SHARE_ADJUSTED_EVENT, version: 1, key: `profit-share-adj:${id}`, occurredAt: new Date().toISOString() },
        financialDate: monthEnd(a.period), currency: cur,
        payload: { adjustmentId: id, partnerId: p.id, partnerName: p.name, period: a.period, amount: toMinor(a.amount, cur), currentAccountId: p.currentAccountId },
      });
      await tx.profitShareAdjustment.update({ where: { id }, data: { status: "POSTED", eventId: event.id, decidedByAdminId: adminOf(actor), decidedAt: new Date() } });
      await recordFinanceAudit(tx, { businessId: business.id, actor, action: "profit_share_adjustment.approve", entityType: "ProfitShareAdjustment", entityId: id, after: { status: "POSTED", amount: toMajorNumber(toMinor(a.amount, cur), cur) } });
      return event.id;
    });
    await processFinancialEvent(eventId);
    const journal = await prisma.journalEntry.findFirst({ where: { financialEventId: eventId }, select: { id: true } });
    return { ...adjustmentDto(await prisma.profitShareAdjustment.findUniqueOrThrow({ where: { id } }), cur), journalEntryId: journal?.id ?? null };
  }
  if (a.kind === "DUPLICATE_POSTING" || a.kind === "INVALID_POSTING") {
    const after = await financeTransaction(async (tx) => {
      await lockPartner(tx, p.id);
      const fresh = await tx.profitShareAdjustment.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== "PROPOSED") throw financeError(409, "ADJUSTMENT_NOT_PROPOSED", "This correction was already decided");
      const amount = -toMinor(a.amount, cur);
      const s = await partnerAccountState(tx, business.id, p.currentAccountId, cur);
      if (s.available < amount) {
        throw financeError(409, "REVERSAL_EXCEEDS_AVAILABLE", `${p.name} has been paid this already — reversing it now would leave them owing the business; it needs an accounting decision`, { postedPayable: toMajorNumber(s.posted, cur), pending: toMajorNumber(s.pending, cur), available: toMajorNumber(Math.max(0, s.available), cur), amount: toMajorNumber(amount, cur) });
      }
      const { reversal } = await reversePartnerEntryInTx(tx, business, a.relatedEntryId!, `${a.kind === "DUPLICATE_POSTING" ? "Duplicate" : "Wrong"} posting: ${a.reason}`.slice(0, 500), actor);
      const r = await tx.profitShareAdjustment.update({ where: { id }, data: { status: "POSTED", journalEntryId: reversal.id, decidedByAdminId: adminOf(actor), decidedAt: new Date() } });
      await recordFinanceAudit(tx, { businessId: business.id, actor, action: "profit_share_adjustment.approve", entityType: "ProfitShareAdjustment", entityId: id, after: { status: "POSTED", reversal: reversal.id } });
      return r;
    });
    return adjustmentDto(after, cur);
  }
  throw financeError(409, "ADJUSTMENT_NEEDS_POLICY", "This correction needs an accounting decision");
}

export async function rejectAdjustment(id: string, reason: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const a = await prisma.profitShareAdjustment.findFirst({ where: { id, businessId: business.id } });
  if (!a) throw financeError(404, "ADJUSTMENT_NOT_FOUND", "Correction not found");
  if (a.status !== "PROPOSED" && a.status !== "POLICY_REVIEW") throw financeError(409, "ADJUSTMENT_NOT_PROPOSED", "This correction was already decided");
  const r = await financeTransaction(async (tx) => {
    const row = await tx.profitShareAdjustment.update({ where: { id }, data: { status: "REJECTED", decidedByAdminId: adminOf(actor), decidedAt: new Date(), rejectionReason: reason } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "profit_share_adjustment.reject", entityType: "ProfitShareAdjustment", entityId: id, after: { status: "REJECTED" }, reason });
    return row;
  });
  return adjustmentDto(r, business.baseCurrency);
}
