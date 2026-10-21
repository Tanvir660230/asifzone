/**
 * Prepaid costs (docs/FINANCE_OWNER_BOOKS.md §6.1): something paid now for a period — a year's hosting, a domain, rent in
 * advance, a photoshoot whose pictures are used for months. The payment is a Treasury WITHDRAWAL into 1720 prepaid
 * expenses; each month that has ended moves its share (by days of service in the month) into the cost's expense account,
 * the last month taking the rounding. So every month carries its own share, and the page shows what is used, what is
 * left and when it ends (renewal reminders).
 */
import type { Prisma } from "@prisma/client";
import { addDays, monthPeriod } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor } from "./finance-audit";
import { businessToday, getFinanceContext } from "./finance-context";
import { financeTransaction } from "./finance-tx";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { resolveMappedAccount } from "./chart.service";
import { movementDto, requestMovementInTx } from "./treasury.service";
import { nextFinanceSequence } from "./suppliers.service";
import { applyFinanceFacts, booksStarted, postRecorded, type FinanceFact } from "./finance-facts";
import { OWNER_BOOKS_EVENT_TYPES } from "./owner-books-posting-rules";
import { ensureOwnerBooksSetupInTx } from "./owner-books-setup.service";

const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);
export const prepaidNumber = (n: number) => `PPD-${String(n).padStart(6, "0")}`;
const PAYING_KINDS = new Set(["CASH", "BANK", "MOBILE_WALLET"]);
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

/** Each month's share of a prepaid amount (minor units), by days of service in the month; the last month takes the
 * rounding. `date` is the month's last day of service (when its share is booked). Pure. */
export function prepaidSchedule(amount: number, start: string, end: string): Array<{ period: string; date: string; days: number; amount: number }> {
  const total = days(start, end);
  const out: Array<{ period: string; date: string; days: number; amount: number }> = [];
  let booked = 0;
  for (let from = start; from <= end; ) {
    const monthEnd = monthPeriod(from).endDate;
    const to = monthEnd < end ? monthEnd : end;
    const d = days(from, to);
    const last = to === end;
    const share = last ? amount - booked : Math.round((amount * d) / total);
    booked += share;
    out.push({ period: from.slice(0, 7), date: to, days: d, amount: share });
    from = addDays(to, 1);
  }
  return out;
}

export interface PrepaidInput {
  name: string;
  expenseAccountId: string;
  amount: number;
  serviceStart: string;
  serviceEnd: string;
  fromFinancialAccountId: string;
  paidOn?: string;
  payee?: string | null;
  reference?: string | null;
  notes?: string | null;
  remindDaysBefore?: number;
  renewalAmount?: number | null;
}

const INCLUDE = {
  expenseAccount: { select: { id: true, code: true, name: true } },
  movement: { select: { id: true, status: true, movementDate: true, fromAccount: { select: { id: true, name: true } } } },
} satisfies Prisma.PrepaidCostInclude;
type Row = Prisma.PrepaidCostGetPayload<{ include: typeof INCLUDE }>;

function dto(p: Row, cur: string, today: string) {
  const amount = toMinor(p.amount, cur);
  const start = businessDateOf(p.serviceStart);
  const end = businessDateOf(p.serviceEnd);
  const schedule = prepaidSchedule(amount, start, end);
  const paid = p.movement.status === "POSTED";
  const used = paid ? schedule.filter((s) => s.date <= today).reduce((s, x) => s + x.amount, 0) : 0;
  const daysLeft = end < today ? 0 : days(today < start ? start : today, end);
  return {
    id: p.id, number: prepaidNumber(p.number), name: p.name, expenseAccount: p.expenseAccount, amount: toMajorNumber(amount, cur), serviceStart: start, serviceEnd: end,
    payee: p.payee, reference: p.reference, notes: p.notes, paidFrom: p.movement.fromAccount, paidOn: businessDateOf(p.movement.movementDate), paymentStatus: p.movement.status, movementId: p.movement.id,
    used: toMajorNumber(used, cur), remaining: toMajorNumber(paid ? amount - used : 0, cur), daysLeft,
    perMonth: toMajorNumber(Math.round((amount * 30) / days(start, end)), cur),
    status: !paid ? (p.movement.status === "PENDING_APPROVAL" ? "AWAITING_PAYMENT" : "NOT_PAID") : end < today ? "FINISHED" : daysLeft <= Math.max(p.remindDaysBefore, 1) ? "ENDING_SOON" : "RUNNING",
    remindDaysBefore: p.remindDaysBefore, renewalAmount: p.renewalAmount ? toMajorNumber(toMinor(p.renewalAmount, cur), cur) : null,
    schedule: schedule.map((s) => ({ ...s, amount: toMajorNumber(s.amount, cur), booked: paid && s.date <= today })),
  };
}

export async function createPrepaid(input: PrepaidInput, actor: FinanceActor, idempotencyKey: string | null) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every prepaid cost");
  if (input.serviceEnd < input.serviceStart) throw financeError(400, "PREPAID_DATES", "The service ends after it starts");
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const paidOn = input.paidOn ?? businessToday(business);
  if (business.openingDate && paidOn < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
  const created = await financeTransaction(async (tx) => {
    await ensureOwnerBooksSetupInTx(tx, business, actor);
    const account = await tx.ledgerAccount.findFirst({ where: { id: input.expenseAccountId, businessId: business.id } });
    if (!account || !account.isPostable || !["EXPENSE", "OTHER_EXPENSE"].includes(account.type)) throw financeError(400, "ACCOUNT_TYPE", "Choose the expense the cost belongs to");
    const from = await tx.financialAccount.findFirst({ where: { id: input.fromFinancialAccountId, businessId: business.id } });
    if (!from || !PAYING_KINDS.has(from.kind)) throw financeError(400, "PAYMENT_SOURCE_KIND", "Pay from cash, a bank or a wallet");
    const prepaid = await resolveMappedAccount(tx, business.id, "asset.prepaid");
    const { movement, replayed } = await requestMovementInTx(tx, business, {
      kind: "WITHDRAWAL", movementDate: paidOn, amount: input.amount, fromFinancialAccountId: from.id, counterAccountId: prepaid.id, reference: input.reference ?? null,
      description: `Prepaid: ${input.name}${input.payee ? ` · ${input.payee}` : ""} (${input.serviceStart} → ${input.serviceEnd})`.slice(0, 300),
    }, actor, `prepaid:${idempotencyKey}`);
    if (replayed) {
      const existing = await tx.prepaidCost.findUnique({ where: { movementId: movement.id }, include: INCLUDE });
      if (!existing) throw financeError(409, "IDEMPOTENCY_KEY_REUSED", "This key was used for another money movement");
      return { row: existing, replayed: true };
    }
    const row = await tx.prepaidCost.create({
      data: {
        businessId: business.id, number: await nextFinanceSequence(tx, business.id, "prepaid"), name: input.name.trim(), expenseAccountId: account.id, amount: toDecimal(toMinor(input.amount, cur), cur),
        serviceStart: dateColumn(input.serviceStart), serviceEnd: dateColumn(input.serviceEnd), movementId: movement.id, payee: input.payee ?? null, reference: input.reference ?? null, notes: input.notes ?? null,
        remindDaysBefore: input.remindDaysBefore ?? 30, renewalAmount: input.renewalAmount ? toDecimal(toMinor(input.renewalAmount, cur), cur) : null,
        createdByAdminId: adminOf(actor),
      },
      include: INCLUDE,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "prepaid.create", entityType: "PrepaidCost", entityId: row.id, after: { ...row, movement: movementDto(movement).status } });
    return { row, replayed: false };
  });
  await syncPrepaid(created.row.id);
  return { prepaid: dto(created.row, cur, businessToday(business)), replayed: created.replayed };
}

/** Changes the name, notes or the end of service (ending early books the rest in the ending month). */
export async function updatePrepaid(id: string, input: { name?: string; notes?: string | null; serviceEnd?: string; remindDaysBefore?: number; renewalAmount?: number | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const before = await prisma.prepaidCost.findFirst({ where: { id, businessId: business.id } });
  if (!before) throw financeError(404, "PREPAID_NOT_FOUND", "Prepaid cost not found");
  if (input.serviceEnd && input.serviceEnd < businessDateOf(before.serviceStart)) throw financeError(400, "PREPAID_DATES", "The service ends after it starts");
  await financeTransaction(async (tx) => {
    const after = await tx.prepaidCost.update({ where: { id }, data: {
      name: input.name?.trim(), notes: input.notes, serviceEnd: input.serviceEnd ? dateColumn(input.serviceEnd) : undefined, remindDaysBefore: input.remindDaysBefore,
      renewalAmount: input.renewalAmount === undefined ? undefined : input.renewalAmount === null ? null : toDecimal(toMinor(input.renewalAmount, cur), cur),
    } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "prepaid.update", entityType: "PrepaidCost", entityId: id, before, after });
  });
  await syncPrepaid(id);
  return (await listPrepaid()).prepaid.find((p) => p.id === id)!;
}

export async function listPrepaid() {
  const { business } = await getFinanceContext();
  const today = businessToday(business);
  const rows = await prisma.prepaidCost.findMany({ where: { businessId: business.id }, include: INCLUDE, orderBy: [{ serviceEnd: "desc" }, { number: "desc" }] });
  const prepaid = rows.map((r) => dto(r, business.baseCurrency, today));
  return {
    asOf: today,
    prepaid,
    totals: { remaining: Math.round(prepaid.reduce((s, p) => s + p.remaining, 0) * 100) / 100, endingSoon: prepaid.filter((p) => p.status === "ENDING_SOON").length },
  };
}

// ── into the books ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function syncPrepaid(id: string) {
  const ctx = await getFinanceContext();
  if (!(await booksStarted(ctx))) return { recorded: 0, posted: 0, failed: 0 };
  const cur = ctx.business.baseCurrency;
  const today = businessToday(ctx.business);
  const p = await prisma.prepaidCost.findUniqueOrThrow({ where: { id }, include: { movement: { select: { status: true } } } });
  const facts: FinanceFact[] =
    p.movement.status !== "POSTED"
      ? []
      : prepaidSchedule(toMinor(p.amount, cur), businessDateOf(p.serviceStart), businessDateOf(p.serviceEnd))
          .filter((s) => s.date <= today && s.amount > 0)
          .map((s) => ({
            semanticKey: `prepaid:${p.id}:${s.period}`, type: OWNER_BOOKS_EVENT_TYPES.prepaidShare, date: s.date, entityType: "PrepaidCost", entityId: p.id,
            payload: { prepaidId: p.id, name: p.name, period: s.period, amount: s.amount, expenseAccountId: p.expenseAccountId },
          }));
  const ids = await financeTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-prepaid:${id}`}))`;
    return applyFinanceFacts(tx, ctx, `prepaid:${id}:`, facts);
  });
  return { recorded: ids.length, ...(await postRecorded(ids)) };
}

export async function syncAllPrepaid() {
  const { business } = await getFinanceContext();
  const rows = await prisma.prepaidCost.findMany({ where: { businessId: business.id }, select: { id: true } });
  const total = { prepaid: rows.length, recorded: 0, posted: 0, failed: 0 };
  for (const r of rows) {
    const s = await syncPrepaid(r.id);
    total.recorded += s.recorded;
    total.posted += s.posted;
    total.failed += s.failed;
  }
  return total;
}
