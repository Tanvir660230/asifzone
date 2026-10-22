/**
 * Finance Center (docs/FINANCE_CENTER.md) — what the owner's-books screens did not yet answer:
 *
 *   - verification: how sure a record is (CONFIRMED / ESTIMATED / NEEDS_CHECK / DISPUTED), kept BESIDE the record (which
 *     never changes), audited — so reported and reconstructed figures are never shown as confirmed;
 *   - expense allocation: an expense paid into 6990 "Expenses awaiting allocation" (a van hired for several errands) is
 *     split later into the accounts (and products) it served; the parts never exceed it, the rest stays visible;
 *   - subscriptions: prepaid costs with an end date are renewals — reminded `remindDaysBefore` the end, renewed once a
 *     later prepaid cost of the same name starts;
 *   - SMS: balance readings (the provider's, else typed in); usage between readings = the drop + recharges in between;
 *     recharges are the expenses booked to 6410 SMS (the cash spent — usage is information, never posted again);
 *   - the summary: what the owner put in and took out, records by verification status, and the missing-data list.
 */
import type { EntryVerification, Prisma } from "@prisma/client";
import { addDays } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { businessDateOf, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { resolveMappedAccount } from "./chart.service";
import { applyFinanceFacts, postRecorded, type FinanceFact } from "./finance-facts";
import { EXPENSE_ALLOCATED_EVENT } from "./owner-books-posting-rules";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";
import { getProviders } from "../../providers/registry";

const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);

// ── verification ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const VERIFIABLE_TYPES = ["Expense", "PrepaidCost", "FixedAsset", "OpeningBalanceLine", "OpeningInventoryItem", "LandedCost", "TreasuryMovement", "AdSpendDay"] as const;
export type VerifiableType = (typeof VERIFIABLE_TYPES)[number];

/** The record's amount (minor units) and a label, or null when it is not this business's record. */
async function verifiable(businessId: string, type: VerifiableType, id: string, cur: string): Promise<{ amount: number; label: string; date: string | null } | null> {
  switch (type) {
    case "Expense": {
      const r = await prisma.expense.findFirst({ where: { id, businessId }, select: { amount: true, description: true, expenseDate: true } });
      return r && { amount: toMinor(r.amount, cur), label: r.description, date: businessDateOf(r.expenseDate) };
    }
    case "PrepaidCost": {
      const r = await prisma.prepaidCost.findFirst({ where: { id, businessId }, select: { amount: true, name: true, serviceStart: true } });
      return r && { amount: toMinor(r.amount, cur), label: r.name, date: businessDateOf(r.serviceStart) };
    }
    case "FixedAsset": {
      const r = await prisma.fixedAsset.findFirst({ where: { id, businessId }, select: { cost: true, name: true, acquisitionDate: true } });
      return r && { amount: toMinor(r.cost, cur), label: r.name, date: businessDateOf(r.acquisitionDate) };
    }
    case "OpeningBalanceLine": {
      const r = await prisma.openingBalanceLine.findFirst({ where: { id, batch: { businessId } }, select: { amount: true, description: true, account: { select: { code: true, name: true } } } });
      return r && { amount: toMinor(r.amount, cur), label: r.description || `${r.account.code} ${r.account.name}`, date: null };
    }
    case "OpeningInventoryItem": {
      const r = await prisma.openingInventoryItem.findFirst({ where: { id, batch: { businessId } }, select: { valuationAmount: true, name: true, sku: true, quantity: true } });
      return r && { amount: toMinor(r.valuationAmount, cur), label: `${r.name} (${r.sku}) × ${r.quantity}`, date: null };
    }
    case "LandedCost": {
      const r = await prisma.landedCost.findFirst({ where: { id, businessId }, select: { amount: true, description: true, costDate: true } });
      return r && { amount: toMinor(r.amount, cur), label: r.description, date: businessDateOf(r.costDate) };
    }
    case "TreasuryMovement": {
      const r = await prisma.treasuryMovement.findFirst({ where: { id, businessId }, select: { amount: true, description: true, movementDate: true } });
      return r && { amount: toMinor(r.amount, cur), label: r.description ?? "Money movement", date: businessDateOf(r.movementDate) };
    }
    case "AdSpendDay": {
      const r = await prisma.adSpendDay.findFirst({ where: { id, campaign: { businessId } }, select: { amount: true, date: true, campaign: { select: { name: true } } } });
      return r && { amount: toMinor(r.amount, cur), label: `${r.campaign.name} — ${businessDateOf(r.date)}`, date: businessDateOf(r.date) };
    }
  }
}

export async function setVerification(input: { entityType: VerifiableType; entityId: string; status: EntryVerification; source?: string | null; note?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const target = await verifiable(business.id, input.entityType, input.entityId, business.baseCurrency);
  if (!target) throw financeError(404, "RECORD_NOT_FOUND", "That record is not in these books");
  if (input.status === "DISPUTED" && !input.note?.trim()) throw financeError(400, "VERIFICATION_NOTE", "Say what is disputed");
  return financeTransaction(async (tx) => {
    const key = { businessId_entityType_entityId: { businessId: business.id, entityType: input.entityType, entityId: input.entityId } };
    const before = await tx.financeVerification.findUnique({ where: key });
    const data = { status: input.status, source: input.source?.trim() || null, note: input.note?.trim() || null, setByAdminId: adminOf(actor) };
    const row = await tx.financeVerification.upsert({ where: key, create: { businessId: business.id, entityType: input.entityType, entityId: input.entityId, ...data }, update: data });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "verification.set", entityType: input.entityType, entityId: input.entityId, before: before ? { status: before.status, source: before.source, note: before.note } : { status: "CONFIRMED" }, after: data });
    return { entityType: row.entityType, entityId: row.entityId, status: row.status, source: row.source, note: row.note, updatedAt: row.updatedAt.toISOString() };
  });
}

/** Status of each listed record (absent = CONFIRMED). */
export async function verificationsOf(businessId: string, entityType: VerifiableType, ids: string[]) {
  const rows = ids.length ? await prisma.financeVerification.findMany({ where: { businessId, entityType, entityId: { in: ids } } }) : [];
  return new Map(rows.map((r) => [r.entityId, { status: r.status, source: r.source, note: r.note }]));
}

/** Every record not CONFIRMED, with its amount — the "check these" list. */
export async function listVerifications(q: { status?: EntryVerification } = {}) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const rows = await prisma.financeVerification.findMany({ where: { businessId: business.id, ...(q.status ? { status: q.status } : { status: { not: "CONFIRMED" } }) }, orderBy: { updatedAt: "desc" } });
  const items = [];
  for (const r of rows) {
    const t = await verifiable(business.id, r.entityType as VerifiableType, r.entityId, cur);
    if (!t) continue;
    items.push({ entityType: r.entityType, entityId: r.entityId, status: r.status, source: r.source, note: r.note, label: t.label, date: t.date, amount: toMajorNumber(t.amount, cur), updatedAt: r.updatedAt.toISOString() });
  }
  const totals: Record<string, { count: number; amount: number }> = {};
  for (const i of items) {
    const t = (totals[i.status] ??= { count: 0, amount: 0 });
    t.count += 1;
    t.amount = toMajorNumber(toMinor(t.amount, cur) + toMinor(i.amount, cur), cur);
  }
  return { items, totals };
}

// ── expense allocation ────────────────────────────────────────────────────────────────────────────────────────────────

export interface AllocationLineInput {
  accountId: string;
  productId?: string | null;
  amount: number;
  note?: string | null;
}

const ALLOCATION_INCLUDE = {
  expenseAccount: { select: { id: true, code: true, name: true } },
  movement: { select: { status: true, fromAccount: { select: { id: true, name: true } } } },
  allocations: { orderBy: { lineNo: "asc" }, include: { account: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.ExpenseInclude;
type AllocRow = Prisma.ExpenseGetPayload<{ include: typeof ALLOCATION_INCLUDE }>;

async function productNames(ids: string[]) {
  const rows = ids.length ? await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  return new Map(rows.map((r) => [r.id, r.name]));
}

function allocationDto(e: AllocRow, cur: string, names: Map<string, string>) {
  const amount = toMinor(e.amount, cur);
  const allocated = e.allocations.reduce((s, a) => s + toMinor(a.amount, cur), 0);
  return {
    id: e.id, number: `EXP-${String(e.number).padStart(6, "0")}`, expenseDate: businessDateOf(e.expenseDate), description: e.description, payee: e.payee, paidFrom: e.movement.fromAccount,
    paymentStatus: e.movement.status, amount: toMajorNumber(amount, cur), allocated: toMajorNumber(allocated, cur), remaining: toMajorNumber(amount - allocated, cur),
    status: allocated === 0 ? "NOT_ALLOCATED" : allocated < amount ? "PARTLY_ALLOCATED" : "ALLOCATED",
    lines: e.allocations.map((a) => ({ lineNo: a.lineNo, account: a.account, productId: a.productId, productName: a.productId ? names.get(a.productId) ?? null : null, amount: toMajorNumber(toMinor(a.amount, cur), cur), note: a.note })),
  };
}

/** Expenses paid into "Expenses awaiting allocation", with what is split and what is left. */
export async function listAwaitingAllocation() {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const map = await prisma.accountMapping.findFirst({ where: { businessId: business.id, key: "expense.unallocated" } });
  if (!map) return { accountId: null, expenses: [], remaining: 0 };
  const rows = await prisma.expense.findMany({ where: { businessId: business.id, expenseAccountId: map.accountId, movement: { status: { in: ["POSTED", "PENDING_APPROVAL"] } } }, include: ALLOCATION_INCLUDE, orderBy: { expenseDate: "desc" } });
  const names = await productNames([...new Set(rows.flatMap((r) => r.allocations.map((a) => a.productId).filter((x): x is string => !!x)))]);
  const expenses = rows.map((r) => allocationDto(r, cur, names));
  return { accountId: map.accountId, expenses, remaining: toMajorNumber(expenses.filter((e) => e.paymentStatus === "POSTED").reduce((s, e) => s + toMinor(e.remaining, cur), 0), cur) };
}

/** Replaces the expense's split. Lines are whole: send the full list each time (an empty list un-allocates it all). */
export async function setExpenseAllocations(expenseId: string, lines: AllocationLineInput[], actor: FinanceActor) {
  const ctx = await getFinanceContext();
  const { business } = ctx;
  const cur = business.baseCurrency;
  const recorded = await financeTransaction(async (tx) => {
    await ensureOwnerBooksSetupInTx(tx, business, actor);
    const unallocated = await resolveMappedAccount(tx, business.id, "expense.unallocated");
    await tx.$queryRaw`SELECT id FROM "Expense" WHERE id = ${expenseId} FOR UPDATE`;
    const e = await tx.expense.findFirst({ where: { id: expenseId, businessId: business.id }, include: ALLOCATION_INCLUDE });
    if (!e) throw financeError(404, "EXPENSE_NOT_FOUND", "Expense not found");
    if (e.expenseAccountId !== unallocated.id) throw financeError(409, "EXPENSE_NOT_AWAITING", `Only an expense paid into ${unallocated.code} ${unallocated.name} is split`);
    if (e.movement.status !== "POSTED") throw financeError(409, "EXPENSE_NOT_POSTED", "Split the expense once its payment is approved");
    const total = toMinor(e.amount, cur);
    let sum = 0;
    const accounts = new Map<string, { id: string; type: string; isPostable: boolean; isActive: boolean }>();
    for (const l of lines) {
      const minor = toMinor(l.amount, cur);
      if (minor <= 0) throw financeError(400, "ALLOCATION_AMOUNT", "Each part is more than zero");
      sum += minor;
      if (l.accountId === unallocated.id) throw financeError(400, "ALLOCATION_ACCOUNT", "Choose where the part belongs, not the awaiting-allocation account");
      const a = accounts.get(l.accountId) ?? (await tx.ledgerAccount.findFirst({ where: { id: l.accountId, businessId: business.id }, select: { id: true, type: true, isPostable: true, isActive: true } }));
      if (!a || !a.isPostable || !a.isActive || (a.type !== "EXPENSE" && a.type !== "ASSET")) throw financeError(400, "ALLOCATION_ACCOUNT", "A part goes to an active expense or asset account");
      accounts.set(a.id, a);
      if (l.productId && !(await tx.product.findUnique({ where: { id: l.productId }, select: { id: true } }))) throw financeError(400, "ALLOCATION_PRODUCT", "Unknown product");
    }
    if (sum > total) throw financeError(400, "ALLOCATION_EXCEEDS", `The parts (${toMajorNumber(sum, cur)}) are more than the expense (${toMajorNumber(total, cur)})`);
    const before = e.allocations.map((a) => ({ accountId: a.accountId, productId: a.productId, amount: a.amount.toString(), note: a.note }));
    await tx.expenseAllocation.deleteMany({ where: { expenseId } });
    if (lines.length) {
      await tx.expenseAllocation.createMany({
        data: lines.map((l, i) => ({ expenseId, lineNo: i + 1, accountId: l.accountId, productId: l.productId ?? null, amount: toDecimal(toMinor(l.amount, cur), cur), note: l.note?.trim() || null, createdByAdminId: adminOf(actor) })),
      });
    }
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "expense.allocate", entityType: "Expense", entityId: expenseId, before: { lines: before }, after: { lines: lines.map((l) => ({ ...l })) } });
    const facts: FinanceFact[] = lines.length
      ? [{
          semanticKey: `expense-alloc:${expenseId}`, type: EXPENSE_ALLOCATED_EVENT, date: businessDateOf(e.expenseDate), entityType: "Expense", entityId: expenseId,
          payload: { expenseId, number: `EXP-${String(e.number).padStart(6, "0")}`, description: e.description, lines: lines.map((l) => ({ accountId: l.accountId, productId: l.productId ?? null, amount: toMinor(l.amount, cur), note: l.note?.trim() || null })) },
        }]
      : [];
    return applyFinanceFacts(tx, ctx, `expense-alloc:${expenseId}`, facts);
  });
  const result = await postRecorded(recorded);
  if (result.failed) throw financeError(409, "ALLOCATION_NOT_POSTED", "The split is saved but could not be posted — see Finance › Activity");
  const row = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId }, include: ALLOCATION_INCLUDE });
  return allocationDto(row, cur, await productNames(row.allocations.map((a) => a.productId).filter((x): x is string => !!x)));
}

// ── subscriptions & renewals ──────────────────────────────────────────────────────────────────────────────────────────

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Each prepaid cost as a subscription: when it ends, when to be reminded, whether it was renewed. Pure. */
export function renewalState(p: { name: string; serviceStart: string; serviceEnd: string; remindDaysBefore: number }, all: Array<{ name: string; serviceStart: string }>, today: string) {
  const renewed = all.some((o) => norm(o.name) === norm(p.name) && o.serviceStart > p.serviceStart);
  const remindOn = addDays(p.serviceEnd, -p.remindDaysBefore);
  const status = renewed ? "RENEWED" : p.serviceEnd < today ? "EXPIRED" : today >= remindOn ? "RENEW_SOON" : "ACTIVE";
  const daysToEnd = Math.round((Date.parse(`${p.serviceEnd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return { renewed, remindOn, status, daysToEnd } as const;
}

export async function listRenewals() {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const rows = await prisma.prepaidCost.findMany({ where: { businessId: business.id, movement: { status: { in: ["POSTED", "PENDING_APPROVAL"] } } }, include: { expenseAccount: { select: { code: true, name: true } } }, orderBy: { serviceEnd: "asc" } });
  const all = rows.map((r) => ({ name: r.name, serviceStart: businessDateOf(r.serviceStart) }));
  const verif = await verificationsOf(business.id, "PrepaidCost", rows.map((r) => r.id));
  return rows.map((r) => {
    const p = { name: r.name, serviceStart: businessDateOf(r.serviceStart), serviceEnd: businessDateOf(r.serviceEnd), remindDaysBefore: r.remindDaysBefore };
    return {
      id: r.id, name: r.name, payee: r.payee, account: r.expenseAccount, amount: toMajorNumber(toMinor(r.amount, cur), cur), serviceStart: p.serviceStart, serviceEnd: p.serviceEnd,
      remindDaysBefore: r.remindDaysBefore, renewalAmount: r.renewalAmount ? toMajorNumber(toMinor(r.renewalAmount, cur), cur) : null,
      verification: verif.get(r.id)?.status ?? "CONFIRMED", ...renewalState(p, all, today),
    };
  });
}

// ── SMS ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function recordSmsBalance(input: { balance: number; takenAt?: string; note?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  if (!(input.balance >= 0)) throw financeError(400, "SMS_BALANCE", "The balance is zero or more");
  const takenAt = input.takenAt ? new Date(input.takenAt) : new Date();
  if (Number.isNaN(takenAt.getTime()) || takenAt.getTime() > Date.now() + 60_000) throw financeError(400, "SMS_BALANCE_TIME", "Give when the balance was read (not in the future)");
  return financeTransaction(async (tx) => {
    const row = await tx.smsBalanceSnapshot.create({ data: { businessId: business.id, takenAt, balance: toDecimal(toMinor(input.balance, cur), cur), source: "MANUAL", note: input.note?.trim() || null, createdByAdminId: adminOf(actor) } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "sms_balance.record", entityType: "SmsBalanceSnapshot", entityId: row.id, after: { balance: input.balance, takenAt: takenAt.toISOString() } });
    return row.id;
  });
}

/** Reads the balance from the SMS provider when it is connected; a reading is stored at most once an hour. */
export async function refreshSmsBalance(): Promise<{ read: boolean; reason?: string }> {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const last = await prisma.smsBalanceSnapshot.findFirst({ where: { businessId: business.id, source: "PROVIDER" }, orderBy: { takenAt: "desc" } });
  if (last && Date.now() - last.takenAt.getTime() < 3_600_000) return { read: true };
  const r = await getProviders().sms.balance();
  if (!r.ok) return { read: false, reason: r.reason };
  await prisma.smsBalanceSnapshot.create({ data: { businessId: business.id, takenAt: new Date(), balance: toDecimal(toMinor(r.balance, cur), cur), source: "PROVIDER" } });
  return { read: true };
}

/** Usage between readings: previous balance + recharges after it (up to this reading) − this balance. Pure (minor units). */
export function smsUsage(readings: Array<{ at: string; balance: number }>, recharges: Array<{ date: string; amount: number }>) {
  const sorted = [...readings].sort((a, b) => a.at.localeCompare(b.at));
  const out: Array<{ from: string; to: string; used: number; recharged: number }> = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    const recharged = recharges.filter((r) => r.date > a.at.slice(0, 10) && r.date <= b.at.slice(0, 10)).reduce((s, r) => s + r.amount, 0);
    out.push({ from: a.at, to: b.at, used: Math.max(0, a.balance + recharged - b.balance), recharged });
  }
  return out;
}

export async function smsStatus() {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const provider = await refreshSmsBalance().catch(() => ({ read: false, reason: "The SMS provider did not answer" }));
  const readings = await prisma.smsBalanceSnapshot.findMany({ where: { businessId: business.id }, orderBy: { takenAt: "desc" }, take: 120 });
  const map = await prisma.accountMapping.findFirst({ where: { businessId: business.id, key: "expense.sms" } });
  const recharges = map
    ? await prisma.expense.findMany({ where: { businessId: business.id, expenseAccountId: map.accountId, movement: { status: "POSTED" } }, orderBy: { expenseDate: "desc" }, select: { id: true, expenseDate: true, amount: true, payee: true, description: true } })
    : [];
  const r = readings.map((x) => ({ at: x.takenAt.toISOString(), balance: toMinor(x.balance, cur) }));
  const rc = recharges.map((x) => ({ date: businessDateOf(x.expenseDate), amount: toMinor(x.amount, cur) }));
  const usage = smsUsage(r, rc);
  const since = addDays(today, -30);
  const recent = usage.filter((u) => u.to.slice(0, 10) > since);
  const spanDays = recent.length ? Math.max(1, (Date.parse(recent[recent.length - 1]!.to) - Date.parse(recent[0]!.from)) / 86_400_000) : 0;
  const perDay = spanDays ? recent.reduce((s, u) => s + u.used, 0) / spanDays : null;
  const latest = readings[0] ?? null;
  const balance = latest ? toMinor(latest.balance, cur) : null;
  const monthly = new Map<string, number>();
  for (const u of usage) monthly.set(u.to.slice(0, 7), (monthly.get(u.to.slice(0, 7)) ?? 0) + u.used);
  const settings = await prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { smsWarnAt: true } });
  const low = settings.smsWarnAt ? toMinor(settings.smsWarnAt, cur) : null;
  return {
    provider,
    balance: balance === null ? null : toMajorNumber(balance, cur),
    readAt: latest?.takenAt.toISOString() ?? null,
    readSource: latest?.source ?? null,
    lowBalance: low === null ? null : toMajorNumber(low, cur),
    isLow: balance !== null && low !== null && balance <= low,
    usedPerDay: perDay === null ? null : toMajorNumber(Math.round(perDay / 100) * 100, cur),
    daysLeft: perDay && balance !== null ? Math.floor(balance / perDay) : null,
    runsOutOn: perDay && balance !== null ? addDays(today, Math.floor(balance / perDay)) : null,
    monthlyUsage: [...monthly.entries()].sort().map(([month, used]) => ({ month, used: toMajorNumber(used, cur) })),
    recharges: recharges.map((x) => ({ id: x.id, date: businessDateOf(x.expenseDate), amount: toMajorNumber(toMinor(x.amount, cur), cur), payee: x.payee, description: x.description })),
    readings: readings.slice(0, 30).map((x) => ({ at: x.takenAt.toISOString(), balance: toMajorNumber(toMinor(x.balance, cur), cur), source: x.source, note: x.note })),
    smsAccountId: map?.accountId ?? null,
  };
}

// ── settings ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const CENTER_SETTINGS_SELECT = { defaultUsdRate: true, smsWarnAt: true, outsideSaleCostPct: true } as const;
export function centerSettingsDto(s: { defaultUsdRate: Prisma.Decimal | null; smsWarnAt: Prisma.Decimal | null; outsideSaleCostPct: Prisma.Decimal | null }) {
  return {
    defaultUsdRate: s.defaultUsdRate ? Number(s.defaultUsdRate) : null,
    smsLowBalance: s.smsWarnAt ? Number(s.smsWarnAt) : null,
    outsideSaleCostPct: s.outsideSaleCostPct === null ? null : Number(s.outsideSaleCostPct),
  };
}

export async function updateFinanceCenterSettings(input: { defaultUsdRate?: number | null; smsLowBalance?: number | null; outsideSaleCostPct?: number | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  if (input.defaultUsdRate !== undefined && input.defaultUsdRate !== null && !(input.defaultUsdRate > 0)) throw financeError(400, "USD_RATE", "The rate is more than zero");
  if (input.smsLowBalance !== undefined && input.smsLowBalance !== null && !(input.smsLowBalance >= 0)) throw financeError(400, "SMS_LOW", "The warning level is zero or more");
  if (input.outsideSaleCostPct !== undefined && input.outsideSaleCostPct !== null && !(input.outsideSaleCostPct >= 0 && input.outsideSaleCostPct <= 100)) {
    throw financeError(400, "OUTSIDE_COST_PCT", "The cost is a percent from 0 to 100");
  }
  return financeTransaction(async (tx) => {
    const before = await tx.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: CENTER_SETTINGS_SELECT });
    const after = await tx.financeBusiness.update({
      where: { id: business.id },
      data: {
        ...(input.defaultUsdRate !== undefined ? { defaultUsdRate: input.defaultUsdRate } : {}),
        ...(input.smsLowBalance !== undefined ? { smsWarnAt: input.smsLowBalance === null ? null : toDecimal(toMinor(input.smsLowBalance, cur), cur) } : {}),
        ...(input.outsideSaleCostPct !== undefined ? { outsideSaleCostPct: input.outsideSaleCostPct === null ? null : input.outsideSaleCostPct.toFixed(2) } : {}),
      },
      select: CENTER_SETTINGS_SELECT,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "finance_center.settings", entityType: "FinanceBusiness", entityId: business.id, before, after });
    return centerSettingsDto(after);
  });
}

// ── summary & missing data ────────────────────────────────────────────────────────────────────────────────────────────

async function netOf(businessId: string, accountIds: string[], cur: string) {
  if (!accountIds.length) return 0;
  const r = await prisma.journalLine.aggregate({ where: { accountId: { in: accountIds }, entry: { businessId, status: "POSTED" } }, _sum: { debit: true, credit: true } });
  return toMinor(r._sum.debit ?? 0, cur) - toMinor(r._sum.credit ?? 0, cur);
}

export async function financeCenterSummary() {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const accounts = await prisma.ledgerAccount.findMany({ where: { businessId: business.id, code: { in: ["3100", "3300", "3900"] } }, select: { id: true, code: true } });
  const id = (code: string) => accounts.filter((a) => a.code === code).map((a) => a.id);
  const reimb = await prisma.accountMapping.findFirst({ where: { businessId: business.id, key: "liability.owner_reimbursable" } });
  const capital = -(await netOf(business.id, id("3100"), cur));
  const openingEquity = -(await netOf(business.id, id("3900"), cur));
  const drawings = await netOf(business.id, id("3300"), cur);
  const ownerPaid = reimb ? -(await netOf(business.id, [reimb.accountId], cur)) : 0;

  const verifications = await listVerifications();
  const missing: Array<{ key: string; title: string; detail: string; count: number; href: string }> = [];
  const add = (m: (typeof missing)[number]) => m.count > 0 && missing.push(m);

  // finished goods sold on the site with no cost the books know
  const noCost = await prisma.productVariant.count({ where: { isActive: true, product: { kind: "FINISHED" }, costPrice: null, costState: null } });
  add({ key: "cost.missing", title: "Product variants with no cost", detail: "Profit on these is incomplete until their cost is known (opening stock, a purchase or a refill).", count: noCost, href: "/admin/finance/profit", });
  const awaiting = await listAwaitingAllocation();
  add({ key: "expenses.unallocated", title: "Expenses awaiting allocation", detail: `${cur} ${awaiting.remaining.toLocaleString("en-US")} not yet split to where it belongs.`, count: awaiting.expenses.filter((e) => e.status !== "ALLOCATED" && e.paymentStatus === "POSTED").length, href: "/admin/finance/center?view=allocate" });
  for (const [status, label] of [["NEEDS_CHECK", "Figures to check"], ["ESTIMATED", "Estimated figures"], ["DISPUTED", "Disputed figures"]] as const) {
    const t = verifications.totals[status];
    if (t) add({ key: `verification.${status.toLowerCase()}`, title: label, detail: `${cur} ${t.amount.toLocaleString("en-US")} across ${t.count} record(s).`, count: t.count, href: `/admin/finance/center?view=check&status=${status}` });
  }
  const unvalued = await prisma.openingInventoryItem.count({ where: { batch: { businessId: business.id }, valuationStatus: { not: "KNOWN" } } });
  add({ key: "opening.unvalued", title: "Opening stock without a known cost", detail: "Counted at opening but valued at zero or an estimate.", count: unvalued, href: "/admin/finance/opening" });
  const plannedCampaigns = await prisma.adCampaign.count({ where: { businessId: business.id, isActive: true, startDate: { lte: new Date(`${today}T00:00:00Z`) }, spendDays: { none: {} } } });
  add({ key: "ads.no_actual", title: "Campaigns with no actual spend", detail: "Booked at their budget until the real spend (Meta, a CSV or typed in) arrives.", count: plannedCampaigns, href: "/admin/finance/ads" });
  const renewals = await listRenewals();
  const due = renewals.filter((r) => r.status === "RENEW_SOON" || r.status === "EXPIRED");
  add({ key: "subscriptions.due", title: "Subscriptions to renew", detail: due.slice(0, 4).map((r) => `${r.name} ${r.serviceEnd}`).join(" · "), count: due.length, href: "/admin/finance/center?view=renewals" });
  const noRecipe = await prisma.product.count({ where: { kind: "FINISHED", productType: "FRAGRANCE", billsOfMaterials: { none: { status: "APPROVED" } } } }).catch(() => 0);
  add({ key: "refill.no_recipe", title: "Attars without a refill recipe", detail: "A refill needs its recipe (ml of oil + bottle + box + sticker) to take stock out and cost the bottle.", count: noRecipe, href: "/admin/manufacturing/boms" });

  return {
    asOf: today,
    owner: {
      capital: toMajorNumber(capital, cur), openingEquity: toMajorNumber(openingEquity, cur), ownerPaidNotRepaid: toMajorNumber(ownerPaid, cur), drawings: toMajorNumber(drawings, cur),
      /** Everything the owner has put in (capital + opening equity + paid from the pocket and not repaid) less what was taken out. */
      netInvested: toMajorNumber(capital + openingEquity + ownerPaid - drawings, cur),
    },
    verification: verifications.totals,
    missing,
  };
}
