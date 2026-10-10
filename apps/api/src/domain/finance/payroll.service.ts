/**
 * Payroll (ERP programme E8, docs/FINANCE_PAYROLL.md) — a configurable structure. The owner defines every pay component;
 * no statutory rule (income tax, provident fund, festival bonus) is built in (blocker B-3: those rules are the owner's).
 *
 *   components   EARNING (basic, allowances, bonus) → an expense account; DEDUCTION (tax, provident fund, advance
 *                recovery) → a liability until remitted; EMPLOYER_CONTRIBUTION → an expense and a liability. Each is a
 *                fixed amount per employee, or a percentage of the employee's basic.
 *   pay run      one per month: drafted from each employee's pay items (joiners / leavers prorated by calendar days),
 *                edited, then posted as ONE journal at the month end — Dr earnings and contributions / Cr salaries
 *                payable (per employee), deductions and contributions payable. Reversed only while nothing is paid.
 *   payment      net pay leaves through a Treasury WITHDRAWAL against salaries payable (one movement for the payslips
 *                chosen; approval thresholds apply); a payslip counts as paid while its movement is live.
 *   remittance   deductions and contributions paid over: a WITHDRAWAL against their liability account.
 *
 * Check payroll.subledger ties salaries payable to the posted payslips less their posted payments.
 */
import type { PayCalculation, PayComponentKind, Prisma, TreasuryMovementStatus } from "@prisma/client";
import { PAYROLL_MAPPING_KEYS } from "@clothing-brand/shared";
import { prisma, type AppTransactionClient } from "../../config/prisma";
import { recordFinanceAudit, type FinanceActor, type FinanceAuditInput } from "./finance-audit";
import { businessToday, getFinanceContext, type FinanceBusinessInfo } from "./finance-context";
import { businessDateOf, dateColumn, financeError, toDecimal, toMajorNumber, toMinor } from "./finance-values";
import { financeTransaction } from "./finance-tx";
import { nextFinanceSequence } from "./suppliers.service";
import { chartState, provisionTemplateAccountsInTx } from "./chart-provisioning";
import { resolveMappedAccount } from "./chart.service";
import { postJournalInTx, reverseJournalInTx, type JournalLineSpec } from "./journal.service";
import { requestMovementInTx } from "./treasury.service";
import { divRound } from "./costing.service";

const adminOf = (actor: FinanceActor) => (actor.type === "ADMIN" ? actor.adminId : null);
export const employeeNumber = (n: number) => `EMP-${String(n).padStart(3, "0")}`;
export const payRunNumber = (n: number) => `PR-${String(n).padStart(3, "0")}`;
const PAYING_KINDS = new Set(["CASH", "BANK", "MOBILE_WALLET"]);
const LIVE: TreasuryMovementStatus[] = ["PENDING_APPROVAL", "POSTED"];
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const lastDay = (key: string) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).toISOString().slice(0, 10);
const daysIn = (key: string) => Number(lastDay(key).slice(8, 10));
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const rateOf = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

async function ensureSetup(tx: AppTransactionClient, business: Pick<FinanceBusinessInfo, "id">, actor: FinanceActor) {
  const audits: FinanceAuditInput[] = [];
  const { byCode, mapped } = await chartState(tx, business.id);
  await provisionTemplateAccountsInTx(tx, business, { needed: new Set<string>(PAYROLL_MAPPING_KEYS), byCode, mapped, audits, actor, reason: "Payroll set-up" });
  if (audits.length) await recordFinanceAudit(tx, audits);
  const missing = PAYROLL_MAPPING_KEYS.filter((k) => !mapped.has(k));
  if (missing.length) throw financeError(409, "PAYROLL_MAPPINGS", `Map ${missing.join(", ")} in the chart first`);
}

// ── components ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ComponentInput {
  name: string;
  kind: PayComponentKind;
  calculation?: PayCalculation;
  isBasic?: boolean;
  ratePct?: number | null;
  expenseAccountId?: string | null;
  liabilityAccountId?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

const COMPONENT_INCLUDE = { expenseAccount: { select: { id: true, code: true, name: true } }, liabilityAccount: { select: { id: true, code: true, name: true } } } satisfies Prisma.PayComponentInclude;
type ComponentRow = Prisma.PayComponentGetPayload<{ include: typeof COMPONENT_INCLUDE }>;
const componentDto = (c: ComponentRow) => ({
  id: c.id, name: c.name, kind: c.kind, calculation: c.calculation, isBasic: c.isBasic, ratePct: rateOf(c.ratePct),
  expenseAccount: c.expenseAccount, liabilityAccount: c.liabilityAccount, isActive: c.isActive, sortOrder: c.sortOrder,
});

async function postableAccount(tx: AppTransactionClient, businessId: string, id: string, types: string[], what: string) {
  const a = await tx.ledgerAccount.findFirst({ where: { id, businessId } });
  if (!a) throw financeError(404, "ACCOUNT_NOT_FOUND", `The ${what} account was not found`);
  if (!a.isPostable || !a.isActive || !types.includes(a.type)) throw financeError(400, "PAYROLL_ACCOUNT", `${a.code} ${a.name} can't be the ${what} account (a postable, active ${types.join(" / ").toLowerCase()} account)`);
  return a;
}

/** Fills the default accounts for a kind and checks the shape (the database checks it again). */
async function componentAccounts(tx: AppTransactionClient, businessId: string, kind: PayComponentKind, input: { expenseAccountId?: string | null; liabilityAccountId?: string | null }) {
  const wantsExpense = kind !== "DEDUCTION";
  const wantsLiability = kind !== "EARNING";
  const expenseId = wantsExpense ? input.expenseAccountId ?? (await resolveMappedAccount(tx, businessId, kind === "EARNING" ? "expense.salaries" : "expense.employer_contributions")).id : null;
  const liabilityId = wantsLiability ? input.liabilityAccountId ?? (await resolveMappedAccount(tx, businessId, "liability.payroll_deductions")).id : null;
  if (expenseId) await postableAccount(tx, businessId, expenseId, ["EXPENSE", "COGS", "OTHER_EXPENSE"], "expense");
  if (liabilityId) await postableAccount(tx, businessId, liabilityId, ["LIABILITY"], "liability");
  return { expenseAccountId: expenseId, liabilityAccountId: liabilityId };
}

function checkCalculation(kind: PayComponentKind, calculation: PayCalculation, isBasic: boolean, ratePct: number | null | undefined) {
  if (isBasic && (kind !== "EARNING" || calculation !== "FIXED")) throw financeError(400, "BASIC_COMPONENT", "The basic salary is a fixed earning");
  if (calculation === "PERCENT_OF_BASIC" && (ratePct === null || ratePct === undefined)) throw financeError(400, "COMPONENT_RATE", "A percentage component needs its rate");
}

export async function listComponents() {
  const { business } = await getFinanceContext();
  const rows = await prisma.payComponent.findMany({ where: { businessId: business.id }, include: COMPONENT_INCLUDE, orderBy: [{ isBasic: "desc" }, { sortOrder: "asc" }, { name: "asc" }] });
  return { components: rows.map(componentDto) };
}

export async function createComponent(input: ComponentInput, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const calculation = input.calculation ?? "FIXED";
  checkCalculation(input.kind, calculation, input.isBasic ?? false, input.ratePct);
  return financeTransaction(async (tx) => {
    await ensureSetup(tx, business, actor);
    if (await tx.payComponent.findFirst({ where: { businessId: business.id, name: { equals: input.name.trim(), mode: "insensitive" } } })) throw financeError(409, "COMPONENT_EXISTS", `A component named ${input.name.trim()} exists`);
    if (input.isBasic && (await tx.payComponent.findFirst({ where: { businessId: business.id, isBasic: true } }))) throw financeError(409, "BASIC_EXISTS", "There is already a basic salary component");
    const accounts = await componentAccounts(tx, business.id, input.kind, input);
    const row = await tx.payComponent.create({
      data: {
        businessId: business.id, name: input.name.trim(), kind: input.kind, calculation, isBasic: input.isBasic ?? false,
        ratePct: calculation === "PERCENT_OF_BASIC" ? input.ratePct!.toFixed(4) : null, ...accounts, isActive: input.isActive ?? true, sortOrder: input.sortOrder ?? 0,
      },
      include: COMPONENT_INCLUDE,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "payroll.component_create", entityType: "PayComponent", entityId: row.id, after: componentDto(row) });
    return componentDto(row);
  });
}

/** Name, rate, accounts, order and active flag can change; kind, calculation and basic are fixed once on a payslip. */
export async function updateComponent(id: string, input: Partial<ComponentInput>, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  return financeTransaction(async (tx) => {
    const before = await tx.payComponent.findFirst({ where: { id, businessId: business.id }, include: COMPONENT_INCLUDE });
    if (!before) throw financeError(404, "COMPONENT_NOT_FOUND", "Pay component not found");
    const kind = input.kind ?? before.kind;
    const calculation = input.calculation ?? before.calculation;
    const isBasic = input.isBasic ?? before.isBasic;
    const structural = kind !== before.kind || calculation !== before.calculation || isBasic !== before.isBasic;
    if (structural && (await tx.payslipLine.count({ where: { componentId: id } }))) throw financeError(409, "COMPONENT_IN_USE", "This component is on payslips — its kind and calculation can't change (create a new component)");
    const ratePct = input.ratePct !== undefined ? input.ratePct : rateOf(before.ratePct);
    checkCalculation(kind, calculation, isBasic, ratePct);
    if (input.name && input.name.trim().toLowerCase() !== before.name.toLowerCase() && (await tx.payComponent.findFirst({ where: { businessId: business.id, name: { equals: input.name.trim(), mode: "insensitive" }, id: { not: id } } }))) throw financeError(409, "COMPONENT_EXISTS", `A component named ${input.name.trim()} exists`);
    const accounts = await componentAccounts(tx, business.id, kind, {
      expenseAccountId: input.expenseAccountId !== undefined ? input.expenseAccountId : kind === before.kind ? before.expenseAccountId : null,
      liabilityAccountId: input.liabilityAccountId !== undefined ? input.liabilityAccountId : kind === before.kind ? before.liabilityAccountId : null,
    });
    const row = await tx.payComponent.update({
      where: { id },
      data: { name: input.name?.trim(), kind, calculation, isBasic, ratePct: calculation === "PERCENT_OF_BASIC" ? ratePct!.toFixed(4) : null, ...accounts, isActive: input.isActive, sortOrder: input.sortOrder },
      include: COMPONENT_INCLUDE,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "payroll.component_update", entityType: "PayComponent", entityId: id, before: componentDto(before), after: componentDto(row) });
    return componentDto(row);
  });
}

// ── employees ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EmployeeInput {
  name: string;
  designation?: string | null;
  department?: string | null;
  phone?: string | null;
  payoutDetails?: string | null;
  joinDate: string;
  leaveDate?: string | null;
  notes?: string | null;
}
export interface PayItemInput { componentId: string; amount?: number | null; ratePct?: number | null }

const EMPLOYEE_INCLUDE = { payItems: { include: { component: { include: COMPONENT_INCLUDE } } } } satisfies Prisma.EmployeeInclude;
type EmployeeRow = Prisma.EmployeeGetPayload<{ include: typeof EMPLOYEE_INCLUDE }>;

/** Minor units. The standard month: every pay item at full amount (factor 1), or prorated by days payable. */
export function standardLines(items: Array<{ amount: number | null; ratePct: number | null; component: { id: string; name: string; kind: PayComponentKind; calculation: PayCalculation; isBasic: boolean; ratePct: number | null; isActive: boolean } }>, daysPayable: number, daysInPeriod: number) {
  const prorate = (minor: number) => (daysPayable === daysInPeriod ? minor : Number(divRound(BigInt(minor) * BigInt(daysPayable), BigInt(daysInPeriod))));
  const active = items.filter((i) => i.component.isActive);
  const basic = active.filter((i) => i.component.isBasic).reduce((s, i) => s + prorate(i.amount ?? 0), 0);
  return active
    .map((i) => {
      const c = i.component;
      if (c.calculation === "FIXED") return { componentId: c.id, name: c.name, kind: c.kind, amount: prorate(i.amount ?? 0) };
      const rate = i.ratePct ?? c.ratePct ?? 0;
      return { componentId: c.id, name: c.name, kind: c.kind, amount: Number(divRound(BigInt(basic) * BigInt(Math.round(rate * 10_000)), 100n * 10_000n)) };
    })
    .filter((l) => l.amount > 0);
}

export function totalsOf(lines: Array<{ kind: PayComponentKind; amount: number }>) {
  const sum = (k: PayComponentKind) => lines.filter((l) => l.kind === k).reduce((s, l) => s + l.amount, 0);
  const gross = sum("EARNING");
  const deductions = sum("DEDUCTION");
  return { gross, deductions, net: gross - deductions, employerCost: sum("EMPLOYER_CONTRIBUTION") };
}

const itemsOf = (e: EmployeeRow, cur: string) => e.payItems.map((i) => ({
  amount: i.amount === null ? null : toMinor(i.amount, cur), ratePct: rateOf(i.ratePct),
  component: { id: i.component.id, name: i.component.name, kind: i.component.kind, calculation: i.component.calculation, isBasic: i.component.isBasic, ratePct: rateOf(i.component.ratePct), isActive: i.component.isActive },
}));

function employeeDto(e: EmployeeRow, cur: string, today: string) {
  const m = (n: number) => toMajorNumber(n, cur);
  const standard = totalsOf(standardLines(itemsOf(e, cur), 30, 30));
  const leaveDate = e.leaveDate ? businessDateOf(e.leaveDate) : null;
  return {
    id: e.id, number: employeeNumber(e.number), name: e.name, designation: e.designation, department: e.department, phone: e.phone, payoutDetails: e.payoutDetails,
    joinDate: businessDateOf(e.joinDate), leaveDate, notes: e.notes, status: leaveDate && leaveDate < today ? "LEFT" : "ACTIVE",
    payItems: e.payItems
      .sort((a, b) => Number(b.component.isBasic) - Number(a.component.isBasic) || a.component.sortOrder - b.component.sortOrder || a.component.name.localeCompare(b.component.name))
      .map((i) => ({ componentId: i.componentId, name: i.component.name, kind: i.component.kind, calculation: i.component.calculation, isBasic: i.component.isBasic, amount: i.amount === null ? null : m(toMinor(i.amount, cur)), ratePct: rateOf(i.ratePct) ?? rateOf(i.component.ratePct) })),
    standard: { gross: m(standard.gross), deductions: m(standard.deductions), net: m(standard.net), employerCost: m(standard.employerCost) },
  };
}

export async function listEmployees() {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const rows = await prisma.employee.findMany({ where: { businessId: business.id }, include: EMPLOYEE_INCLUDE, orderBy: { number: "asc" } });
  const employees = rows.map((e) => employeeDto(e, cur, today));
  const active = employees.filter((e) => e.status === "ACTIVE");
  const sum = (k: "gross" | "net" | "employerCost") => toMajorNumber(active.reduce((s, e) => s + toMinor(e.standard[k], cur), 0), cur);
  return { asOf: today, employees, totals: { active: active.length, monthlyGross: sum("gross"), monthlyNet: sum("net"), monthlyEmployerCost: sum("employerCost") } };
}

async function payItemsData(tx: AppTransactionClient, businessId: string, items: PayItemInput[], cur: string) {
  const ids = [...new Set(items.map((i) => i.componentId))];
  if (ids.length !== items.length) throw financeError(400, "DUPLICATE_COMPONENT", "A component appears once per employee");
  const comps = await tx.payComponent.findMany({ where: { businessId, id: { in: ids } } });
  if (comps.length !== ids.length) throw financeError(404, "COMPONENT_NOT_FOUND", "Pay component not found");
  return items.map((i) => {
    const c = comps.find((x) => x.id === i.componentId)!;
    if (c.calculation === "FIXED") {
      if (i.amount === null || i.amount === undefined || i.amount < 0) throw financeError(400, "PAY_ITEM_AMOUNT", `${c.name}: an amount is needed`);
      return { componentId: c.id, amount: toDecimal(toMinor(i.amount, cur), cur), ratePct: null };
    }
    if (i.ratePct !== null && i.ratePct !== undefined && (i.ratePct < 0 || i.ratePct > 100)) throw financeError(400, "PAY_ITEM_RATE", `${c.name}: a rate is 0–100%`);
    return { componentId: c.id, amount: null, ratePct: i.ratePct === null || i.ratePct === undefined ? null : i.ratePct.toFixed(4) };
  });
}

export async function createEmployee(input: EmployeeInput & { payItems?: PayItemInput[] }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  if (input.leaveDate && input.leaveDate < input.joinDate) throw financeError(400, "EMPLOYEE_DATES", "The leaving date is on or after the joining date");
  return financeTransaction(async (tx) => {
    await ensureSetup(tx, business, actor);
    const items = await payItemsData(tx, business.id, input.payItems ?? [], cur);
    const row = await tx.employee.create({
      data: {
        businessId: business.id, number: await nextFinanceSequence(tx, business.id, "employee"), name: input.name.trim(), designation: input.designation ?? null, department: input.department ?? null,
        phone: input.phone ?? null, payoutDetails: input.payoutDetails ?? null, joinDate: dateColumn(input.joinDate), leaveDate: input.leaveDate ? dateColumn(input.leaveDate) : null, notes: input.notes ?? null,
        createdByAdminId: adminOf(actor), payItems: { create: items },
      },
      include: EMPLOYEE_INCLUDE,
    });
    const dto = employeeDto(row, cur, businessToday(business));
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "payroll.employee_create", entityType: "Employee", entityId: row.id, after: dto });
    return dto;
  });
}

/** Details and, with `payItems`, the whole pay structure (replaces it). A payslip already drafted keeps its figures. */
export async function updateEmployee(id: string, input: Partial<EmployeeInput> & { payItems?: PayItemInput[] }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  return financeTransaction(async (tx) => {
    const before = await tx.employee.findFirst({ where: { id, businessId: business.id }, include: EMPLOYEE_INCLUDE });
    if (!before) throw financeError(404, "EMPLOYEE_NOT_FOUND", "Employee not found");
    const joinDate = input.joinDate ?? businessDateOf(before.joinDate);
    const leaveDate = input.leaveDate !== undefined ? input.leaveDate : before.leaveDate ? businessDateOf(before.leaveDate) : null;
    if (leaveDate && leaveDate < joinDate) throw financeError(400, "EMPLOYEE_DATES", "The leaving date is on or after the joining date");
    if (input.payItems) {
      const items = await payItemsData(tx, business.id, input.payItems, cur);
      await tx.employeePayItem.deleteMany({ where: { employeeId: id } });
      if (items.length) await tx.employeePayItem.createMany({ data: items.map((i) => ({ ...i, employeeId: id })) });
    }
    const row = await tx.employee.update({
      where: { id },
      data: {
        name: input.name?.trim(), designation: input.designation, department: input.department, phone: input.phone, payoutDetails: input.payoutDetails, notes: input.notes,
        joinDate: dateColumn(joinDate), leaveDate: leaveDate ? dateColumn(leaveDate) : null,
      },
      include: EMPLOYEE_INCLUDE,
    });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "payroll.employee_update", entityType: "Employee", entityId: id, before: employeeDto(before, cur, today), after: employeeDto(row, cur, today) });
    return employeeDto(row, cur, today);
  });
}

// ── pay runs ────────────────────────────────────────────────────────────────────────────────────────────────────────

const RUN_INCLUDE = {
  payslips: {
    include: {
      employee: { select: { id: true, number: true, name: true, designation: true, payoutDetails: true } },
      lines: { include: { component: { select: { name: true, sortOrder: true, isBasic: true } } } },
      payments: { include: { movement: { select: { id: true, status: true, movementDate: true, fromAccount: { select: { name: true } } } } } },
    },
  },
} satisfies Prisma.PayRunInclude;
type RunRow = Prisma.PayRunGetPayload<{ include: typeof RUN_INCLUDE }>;
type SlipRow = RunRow["payslips"][number];

const KIND_ORDER: Record<PayComponentKind, number> = { EARNING: 0, DEDUCTION: 1, EMPLOYER_CONTRIBUTION: 2 };

function slipPayment(s: SlipRow) {
  const live = s.payments.find((p) => LIVE.includes(p.movement.status));
  return { status: !live ? "UNPAID" : live.movement.status === "POSTED" ? "PAID" : "AWAITING_APPROVAL", movement: live ? { id: live.movement.id, status: live.movement.status, date: businessDateOf(live.movement.movementDate), from: live.movement.fromAccount?.name ?? null } : null } as const;
}

function runDto(r: RunRow, cur: string) {
  const m = (v: Prisma.Decimal) => toMajorNumber(toMinor(v, cur), cur);
  const slips = [...r.payslips].sort((a, b) => a.employee.number - b.employee.number);
  const payslips = slips.map((s) => ({
    id: s.id, employee: { ...s.employee, number: employeeNumber(s.employee.number) }, daysPayable: s.daysPayable, daysInPeriod: s.daysInPeriod,
    gross: m(s.gross), deductions: m(s.deductions), net: m(s.net), employerCost: m(s.employerCost),
    lines: [...s.lines].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || Number(b.component.isBasic) - Number(a.component.isBasic) || a.component.sortOrder - b.component.sortOrder || a.component.name.localeCompare(b.component.name)).map((l) => ({ componentId: l.componentId, name: l.component.name, kind: l.kind, amount: m(l.amount) })),
    payment: slipPayment(s),
  }));
  const unpaid = payslips.filter((p) => p.payment.status === "UNPAID" && p.net > 0);
  return {
    id: r.id, number: payRunNumber(r.number), periodKey: r.periodKey, payDate: businessDateOf(r.payDate), status: r.status,
    gross: m(r.gross), deductions: m(r.deductions), net: m(r.net), employerCost: m(r.employerCost), notes: r.notes,
    journalEntryId: r.journalEntryId, postedAt: r.postedAt, reversedAt: r.reversedAt, reversalReason: r.reversalReason,
    payslips,
    unpaid: { count: unpaid.length, amount: toMajorNumber(unpaid.reduce((s, p) => s + toMinor(p.net, cur), 0), cur) },
  };
}

async function lockRun(tx: AppTransactionClient, businessId: string, id: string) {
  const [locked] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "PayRun" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
  if (!locked) throw financeError(404, "PAY_RUN_NOT_FOUND", "Pay run not found");
  return tx.payRun.findUniqueOrThrow({ where: { id }, include: RUN_INCLUDE });
}

/** Calendar days an employee was employed in the month (0 = not at all). */
function daysEmployed(e: { joinDate: Date; leaveDate: Date | null }, periodKey: string) {
  const from = `${periodKey}-01`;
  const to = lastDay(periodKey);
  const start = businessDateOf(e.joinDate) > from ? businessDateOf(e.joinDate) : from;
  const end = e.leaveDate && businessDateOf(e.leaveDate) < to ? businessDateOf(e.leaveDate) : to;
  return end < start ? 0 : dayDiff(start, end) + 1;
}

async function writeSlip(tx: AppTransactionClient, runId: string, employeeId: string, daysPayable: number, daysInPeriod: number, lines: Array<{ componentId: string; kind: PayComponentKind; amount: number }>, cur: string, existingId?: string) {
  const t = totalsOf(lines);
  if (t.net < 0) throw financeError(400, "NEGATIVE_NET_PAY", "Deductions are more than the earnings on this payslip");
  const data = { daysPayable, daysInPeriod, gross: toDecimal(t.gross, cur), deductions: toDecimal(t.deductions, cur), net: toDecimal(t.net, cur), employerCost: toDecimal(t.employerCost, cur) };
  const slip = existingId ? await tx.payslip.update({ where: { id: existingId }, data }) : await tx.payslip.create({ data: { runId, employeeId, ...data } });
  if (existingId) await tx.payslipLine.deleteMany({ where: { payslipId: slip.id } });
  if (lines.length) await tx.payslipLine.createMany({ data: lines.map((l) => ({ payslipId: slip.id, componentId: l.componentId, kind: l.kind, amount: toDecimal(l.amount, cur) })) });
  return slip;
}

async function refreshRunTotals(tx: AppTransactionClient, runId: string, cur: string) {
  const slips = await tx.payslip.findMany({ where: { runId } });
  const sum = (k: "gross" | "deductions" | "net" | "employerCost") => toDecimal(slips.reduce((s, x) => s + toMinor(x[k], cur), 0), cur);
  await tx.payRun.update({ where: { id: runId }, data: { gross: sum("gross"), deductions: sum("deductions"), net: sum("net"), employerCost: sum("employerCost") } });
}

/** Drafts the month's pay run: a payslip for everyone employed in the month who has a pay structure. */
export async function createPayRun(input: { periodKey: string; payDate?: string | null; notes?: string | null }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  if (!PERIOD.test(input.periodKey)) throw financeError(400, "PERIOD_KEY", "A month is YYYY-MM");
  if (business.openingDate && lastDay(input.periodKey) < business.openingDate) throw financeError(400, "BEFORE_OPENING_DATE", `The books start on ${business.openingDate}`);
  if (input.periodKey > businessToday(business).slice(0, 7)) throw financeError(409, "MONTH_NOT_STARTED", `${input.periodKey} hasn't started — run payroll in or after the month`);
  const payDate = input.payDate ?? lastDay(input.periodKey);
  if (payDate < `${input.periodKey}-01`) throw financeError(400, "PAY_DATE", "Salaries are paid in or after the month");
  return financeTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-pay-run:${business.id}`}))`;
    await ensureSetup(tx, business, actor);
    const live = await tx.payRun.findFirst({ where: { businessId: business.id, periodKey: input.periodKey, status: { not: "REVERSED" } } });
    if (live) throw financeError(409, "PAY_RUN_EXISTS", `${payRunNumber(live.number)} already covers ${input.periodKey}`);
    const employees = await tx.employee.findMany({ where: { businessId: business.id, joinDate: { lte: dateColumn(lastDay(input.periodKey)) } }, include: EMPLOYEE_INCLUDE, orderBy: { number: "asc" } });
    const run = await tx.payRun.create({ data: { businessId: business.id, number: await nextFinanceSequence(tx, business.id, "pay_run"), periodKey: input.periodKey, payDate: dateColumn(payDate), notes: input.notes ?? null, createdByAdminId: adminOf(actor) } });
    const days = daysIn(input.periodKey);
    let slips = 0;
    for (const e of employees) {
      const payable = daysEmployed(e, input.periodKey);
      if (!payable || !e.payItems.length) continue;
      await writeSlip(tx, run.id, e.id, payable, days, standardLines(itemsOf(e, cur), payable, days), cur);
      slips += 1;
    }
    await refreshRunTotals(tx, run.id, cur);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "payroll.run_create", entityType: "PayRun", entityId: run.id, after: { number: payRunNumber(run.number), periodKey: input.periodKey, payslips: slips } });
    return runDto(await tx.payRun.findUniqueOrThrow({ where: { id: run.id }, include: RUN_INCLUDE }), cur);
  });
}

/** Draft only: change the days paid (recomputes the standard lines) or set the lines themselves (one-off bonus, overtime). */
export async function updatePayslip(runId: string, payslipId: string, input: { daysPayable?: number; lines?: Array<{ componentId: string; amount: number }> }, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const run = await lockRun(tx, business.id, runId);
    if (run.status !== "DRAFT") throw financeError(409, "PAY_RUN_NOT_DRAFT", "Only a draft pay run can be edited");
    const slip = run.payslips.find((s) => s.id === payslipId);
    if (!slip) throw financeError(404, "PAYSLIP_NOT_FOUND", "Payslip not found");
    const daysPayable = input.daysPayable ?? slip.daysPayable;
    if (daysPayable < 0 || daysPayable > slip.daysInPeriod) throw financeError(400, "DAYS_PAYABLE", `Days paid are 0–${slip.daysInPeriod}`);
    let lines: Array<{ componentId: string; kind: PayComponentKind; amount: number }>;
    if (input.lines) {
      const ids = [...new Set(input.lines.map((l) => l.componentId))];
      if (ids.length !== input.lines.length) throw financeError(400, "DUPLICATE_COMPONENT", "A component appears once per payslip");
      const comps = await tx.payComponent.findMany({ where: { businessId: business.id, id: { in: ids } } });
      if (comps.length !== ids.length) throw financeError(404, "COMPONENT_NOT_FOUND", "Pay component not found");
      lines = input.lines.filter((l) => l.amount > 0).map((l) => ({ componentId: l.componentId, kind: comps.find((c) => c.id === l.componentId)!.kind, amount: toMinor(l.amount, cur) }));
    } else {
      const e = await tx.employee.findUniqueOrThrow({ where: { id: slip.employeeId }, include: EMPLOYEE_INCLUDE });
      lines = standardLines(itemsOf(e, cur), daysPayable, slip.daysInPeriod);
    }
    const before = { daysPayable: slip.daysPayable, net: toMinor(slip.net, cur), lines: slip.lines.map((l) => [l.component.name, toMinor(l.amount, cur)]) };
    await writeSlip(tx, run.id, slip.employeeId, daysPayable, slip.daysInPeriod, lines, cur, slip.id);
    await refreshRunTotals(tx, run.id, cur);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "payroll.payslip_edit", entityType: "PayRun", entityId: run.id, before, after: { employee: employeeNumber(slip.employee.number), daysPayable, lines: lines.map((l) => [l.componentId, l.amount]) } });
    return runDto(await tx.payRun.findUniqueOrThrow({ where: { id: run.id }, include: RUN_INCLUDE }), cur);
  });
}

/** Draft only: add a payslip (an employee's standard month) or remove one. */
export async function setPayslipPresence(runId: string, employeeId: string, present: boolean, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const run = await lockRun(tx, business.id, runId);
    if (run.status !== "DRAFT") throw financeError(409, "PAY_RUN_NOT_DRAFT", "Only a draft pay run can be edited");
    const slip = run.payslips.find((s) => s.employeeId === employeeId);
    if (present && !slip) {
      const e = await tx.employee.findFirst({ where: { id: employeeId, businessId: business.id }, include: EMPLOYEE_INCLUDE });
      if (!e) throw financeError(404, "EMPLOYEE_NOT_FOUND", "Employee not found");
      if (!e.payItems.length) throw financeError(409, "NO_PAY_STRUCTURE", `${e.name} has no pay set up — add their pay first`);
      const days = daysIn(run.periodKey);
      const payable = daysEmployed(e, run.periodKey);
      if (!payable) throw financeError(409, "NOT_EMPLOYED_IN_MONTH", `${e.name} wasn't employed in ${run.periodKey}`);
      await writeSlip(tx, run.id, e.id, payable, days, standardLines(itemsOf(e, cur), payable, days), cur);
    } else if (!present && slip) {
      await tx.payslip.delete({ where: { id: slip.id } });
    } else return runDto(run, cur);
    await refreshRunTotals(tx, run.id, cur);
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: present ? "payroll.payslip_add" : "payroll.payslip_remove", entityType: "PayRun", entityId: run.id, after: { employeeId } });
    return runDto(await tx.payRun.findUniqueOrThrow({ where: { id: run.id }, include: RUN_INCLUDE }), cur);
  });
}

export async function deleteDraftPayRun(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  await financeTransaction(async (tx) => {
    const run = await lockRun(tx, business.id, id);
    if (run.status !== "DRAFT") throw financeError(409, "PAY_RUN_NOT_DRAFT", "Only a draft pay run can be deleted — reverse a posted one");
    await tx.payRun.delete({ where: { id } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "payroll.run_delete", entityType: "PayRun", entityId: id, before: { number: payRunNumber(run.number), periodKey: run.periodKey } });
  });
}

/** Posts the run: ONE journal at the month end. Earnings and contributions by expense account; net pay per employee. */
export async function postPayRun(id: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const run = await lockRun(tx, business.id, id);
    if (run.status !== "DRAFT") throw financeError(409, "PAY_RUN_NOT_DRAFT", `${payRunNumber(run.number)} is ${run.status.toLowerCase()}`);
    if (!run.payslips.length) throw financeError(400, "PAY_RUN_EMPTY", "The pay run has no payslips");
    await ensureSetup(tx, business, actor);
    const comps = await tx.payComponent.findMany({ where: { businessId: business.id, id: { in: [...new Set(run.payslips.flatMap((s) => s.lines.map((l) => l.componentId)))] } } });
    const comp = new Map(comps.map((c) => [c.id, c]));
    const debit = new Map<string, number>();
    const credit = new Map<string, number>();
    const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
    for (const s of run.payslips) {
      for (const l of s.lines) {
        const c = comp.get(l.componentId)!;
        const v = toMinor(l.amount, cur);
        if (l.kind === "EARNING") add(debit, c.expenseAccountId!, v);
        else if (l.kind === "DEDUCTION") add(credit, c.liabilityAccountId!, v);
        else { add(debit, c.expenseAccountId!, v); add(credit, c.liabilityAccountId!, v); }
      }
    }
    for (const accountId of [...debit.keys()]) await postableAccount(tx, business.id, accountId, ["EXPENSE", "COGS", "OTHER_EXPENSE"], "expense");
    for (const accountId of [...credit.keys()]) await postableAccount(tx, business.id, accountId, ["LIABILITY"], "liability");
    const payable = await resolveMappedAccount(tx, business.id, "liability.salaries_payable");
    const label = `Payroll ${run.periodKey} (${payRunNumber(run.number)})`;
    const lines: JournalLineSpec[] = [
      ...[...debit].filter(([, v]) => v > 0).map(([accountId, v]) => ({ accountId, debit: v, credit: 0, memo: label })),
      ...[...credit].filter(([, v]) => v > 0).map(([accountId, v]) => ({ accountId, debit: 0, credit: v, memo: label })),
      ...run.payslips.filter((s) => toMinor(s.net, cur) > 0).map((s) => ({ accountId: payable.id, debit: 0, credit: toMinor(s.net, cur), memo: `Net pay — ${employeeNumber(s.employee.number)} ${s.employee.name}`, partyType: "Employee", partyId: s.employeeId })),
    ];
    if (!lines.length) throw financeError(400, "PAY_RUN_EMPTY", "The pay run has nothing to post");
    const { entry } = await postJournalInTx(tx, business, { entryDate: lastDay(run.periodKey), description: label, kind: "ADJUSTMENT", sourceType: "PayRun", sourceId: run.id, idempotencyKey: `pay-run:${run.id}`, lines }, actor);
    await tx.payRun.update({ where: { id }, data: { status: "POSTED", journalEntryId: entry.id, postedAt: new Date(), postedByAdminId: adminOf(actor) } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "payroll.run_post", entityType: "PayRun", entityId: id, before: { status: "DRAFT" }, after: { status: "POSTED", journal: entry.number, netMinor: toMinor(run.net, cur) } });
    return runDto(await tx.payRun.findUniqueOrThrow({ where: { id }, include: RUN_INCLUDE }), cur);
  });
}

/** Reverses a posted run — refused while any of its payslips has a live payment (reverse or reject that first). */
export async function reversePayRun(id: string, reason: string, actor: FinanceActor) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  return financeTransaction(async (tx) => {
    const run = await lockRun(tx, business.id, id);
    if (run.status !== "POSTED") throw financeError(409, "PAY_RUN_NOT_POSTED", "Only a posted pay run can be reversed");
    if (run.payslips.some((s) => slipPayment(s).status !== "UNPAID")) throw financeError(409, "PAYSLIPS_PAID", "Some payslips are paid — reverse those payments first");
    // dated like the run (its month end), so the month nets to zero — a run may be posted before its month ends
    await reverseJournalInTx(tx, business, run.journalEntryId!, reason, lastDay(run.periodKey), actor);
    await tx.payRun.update({ where: { id }, data: { status: "REVERSED", reversedAt: new Date(), reversalReason: reason } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "payroll.run_reverse", entityType: "PayRun", entityId: id, before: { status: "POSTED" }, after: { status: "REVERSED" }, reason });
    return runDto(await tx.payRun.findUniqueOrThrow({ where: { id }, include: RUN_INCLUDE }), cur);
  });
}

async function payingAccount(tx: AppTransactionClient, businessId: string, id: string) {
  const fa = await tx.financialAccount.findFirst({ where: { id, businessId } });
  if (!fa) throw financeError(404, "FINANCIAL_ACCOUNT_NOT_FOUND", "Money account not found");
  if (!PAYING_KINDS.has(fa.kind)) throw financeError(400, "PAYMENT_SOURCE_KIND", `${fa.name} is a clearing account — use cash, a bank or a wallet`);
  return fa;
}

/** Pays the net pay of the chosen (default: every unpaid) payslips of a posted run — one money movement. Idempotent. */
export async function payPayslips(runId: string, input: { payslipIds?: string[]; fromFinancialAccountId: string; paymentDate?: string; reference?: string | null }, actor: FinanceActor, idempotencyKey: string | null) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every payment");
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const paymentDate = input.paymentDate ?? businessToday(business);
  return financeTransaction(async (tx) => {
    const run = await lockRun(tx, business.id, runId);
    const prior = await tx.treasuryMovement.findFirst({ where: { businessId: business.id, idempotencyKey: `payroll-pay:${idempotencyKey}` }, select: { id: true } });
    if (prior) {
      const paidHere = await tx.payslipPayment.count({ where: { movementId: prior.id, payslip: { runId } } });
      if (!paidHere) throw financeError(409, "IDEMPOTENCY_KEY_REUSED", "This key was used for another money movement");
      return { run: runDto(run, cur), movementId: prior.id, replayed: true };
    }
    if (run.status !== "POSTED") throw financeError(409, "PAY_RUN_NOT_POSTED", "Post the pay run before paying it");
    if (paymentDate < `${run.periodKey}-01`) throw financeError(400, "PAYMENT_DATE", "Salaries are paid in or after the month");
    const chosen = input.payslipIds?.length ? run.payslips.filter((s) => input.payslipIds!.includes(s.id)) : run.payslips;
    if (input.payslipIds?.length && chosen.length !== new Set(input.payslipIds).size) throw financeError(404, "PAYSLIP_NOT_FOUND", "Payslip not found in this run");
    const due = chosen.filter((s) => slipPayment(s).status === "UNPAID" && toMinor(s.net, cur) > 0);
    if (input.payslipIds?.length && due.length !== chosen.length) throw financeError(409, "PAYSLIP_ALREADY_PAID", "Some of these payslips are paid or awaiting approval");
    if (!due.length) throw financeError(409, "NOTHING_TO_PAY", "Every payslip of this run is paid");
    const fa = await payingAccount(tx, business.id, input.fromFinancialAccountId);
    const total = due.reduce((s, x) => s + toMinor(x.net, cur), 0);
    const payable = await resolveMappedAccount(tx, business.id, "liability.salaries_payable");
    const { movement } = await requestMovementInTx(tx, business, {
      kind: "WITHDRAWAL", movementDate: paymentDate, amount: toMajorNumber(total, cur), fromFinancialAccountId: fa.id, counterAccountId: payable.id,
      reference: input.reference ?? null, description: `Salaries ${run.periodKey} — ${due.length === 1 ? due[0]!.employee.name : `${due.length} employees`} (${payRunNumber(run.number)})`.slice(0, 300),
    }, actor, `payroll-pay:${idempotencyKey}`);
    const audits: FinanceAuditInput[] = [];
    for (const s of due) {
      const p = await tx.payslipPayment.create({ data: { payslipId: s.id, movementId: movement.id, amount: s.net } });
      audits.push({ businessId: business.id, actor, action: "payroll.pay", entityType: "PayslipPayment", entityId: p.id, after: { run: payRunNumber(run.number), employee: employeeNumber(s.employee.number), netMinor: toMinor(s.net, cur), movement: movement.status } });
    }
    await recordFinanceAudit(tx, audits);
    return { run: runDto(await tx.payRun.findUniqueOrThrow({ where: { id: runId }, include: RUN_INCLUDE }), cur), movementId: movement.id, replayed: false };
  });
}

/** Posted credit balance (minor units) of a liability account. */
async function liabilityBalance(tx: AppTransactionClient | typeof prisma, businessId: string, accountId: string, cur: string) {
  const [b] = await tx.$queryRaw<Array<{ d: Prisma.Decimal; c: Prisma.Decimal }>>`
    SELECT COALESCE(SUM(l.debit), 0) AS d, COALESCE(SUM(l.credit), 0) AS c FROM "JournalLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
    WHERE e."businessId" = ${businessId} AND e.status = 'POSTED' AND l."accountId" = ${accountId}`;
  return toMinor(b!.c, cur) - toMinor(b!.d, cur);
}

/** The liability accounts payroll withholds into: every deduction / contribution component's, and the default one. */
async function payrollLiabilityAccounts(tx: AppTransactionClient | typeof prisma, businessId: string) {
  const comps = await tx.payComponent.findMany({ where: { businessId, liabilityAccountId: { not: null } }, select: { liabilityAccountId: true } });
  const ids = new Set(comps.map((c) => c.liabilityAccountId!));
  const map = await tx.accountMapping.findFirst({ where: { businessId, key: "liability.payroll_deductions" } });
  if (map) ids.add(map.accountId);
  return tx.ledgerAccount.findMany({ where: { id: { in: [...ids] } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
}

/** Pays withheld deductions / contributions over (tax authority, provident fund). Never more than is owed. Idempotent. */
export async function remitDeductions(input: { liabilityAccountId: string; amount: number; fromFinancialAccountId: string; paymentDate?: string; periodKey?: string | null; reference?: string | null }, actor: FinanceActor, idempotencyKey: string | null) {
  if (!idempotencyKey) throw financeError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send an Idempotency-Key header with every remittance");
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  if (input.periodKey && !PERIOD.test(input.periodKey)) throw financeError(400, "PERIOD_KEY", "A month is YYYY-MM");
  return financeTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-payroll-remit:${business.id}`}))`;
    const prior = await tx.treasuryMovement.findFirst({ where: { businessId: business.id, idempotencyKey: `payroll-remit:${idempotencyKey}` }, include: { payrollRemittance: true } });
    if (prior) {
      if (!prior.payrollRemittance) throw financeError(409, "IDEMPOTENCY_KEY_REUSED", "This key was used for another money movement");
      return { remittanceId: prior.payrollRemittance.id, movementId: prior.id, replayed: true };
    }
    const allowed = await payrollLiabilityAccounts(tx, business.id);
    const account = allowed.find((a) => a.id === input.liabilityAccountId);
    if (!account) throw financeError(400, "NOT_A_PAYROLL_LIABILITY", "Choose a payroll deduction or contribution account");
    const amount = toMinor(input.amount, cur);
    if (amount <= 0) throw financeError(400, "REMITTANCE_AMOUNT", "A remittance is more than zero");
    const pending = await tx.payrollRemittance.findMany({ where: { businessId: business.id, liabilityAccountId: account.id, movement: { status: "PENDING_APPROVAL" } }, select: { amount: true } });
    const owed = (await liabilityBalance(tx, business.id, account.id, cur)) - pending.reduce((s, p) => s + toMinor(p.amount, cur), 0);
    if (amount > owed) throw financeError(409, "REMITTANCE_TOO_LARGE", `Only ${toMajorNumber(Math.max(0, owed), cur)} is owed on ${account.code} ${account.name}`);
    const fa = await payingAccount(tx, business.id, input.fromFinancialAccountId);
    const { movement } = await requestMovementInTx(tx, business, {
      kind: "WITHDRAWAL", movementDate: input.paymentDate ?? businessToday(business), amount: toMajorNumber(amount, cur), fromFinancialAccountId: fa.id, counterAccountId: account.id,
      reference: input.reference ?? null, description: `Payroll remittance — ${account.name}${input.periodKey ? ` ${input.periodKey}` : ""}`.slice(0, 300),
    }, actor, `payroll-remit:${idempotencyKey}`);
    const r = await tx.payrollRemittance.create({ data: { businessId: business.id, liabilityAccountId: account.id, movementId: movement.id, amount: toDecimal(amount, cur), periodKey: input.periodKey ?? null, reference: input.reference ?? null, createdByAdminId: adminOf(actor) } });
    await recordFinanceAudit(tx, { businessId: business.id, actor, action: "payroll.remit", entityType: "PayrollRemittance", entityId: r.id, after: { account: account.code, amountMinor: amount, movement: movement.status } });
    return { remittanceId: r.id, movementId: movement.id, replayed: false };
  });
}

export async function getPayRun(id: string) {
  const { business } = await getFinanceContext();
  const run = await prisma.payRun.findFirst({ where: { id, businessId: business.id }, include: RUN_INCLUDE });
  if (!run) throw financeError(404, "PAY_RUN_NOT_FOUND", "Pay run not found");
  return runDto(run, business.baseCurrency);
}

/** The payroll page: runs, what is owed to employees and to the authorities, and the next month to run. */
export async function payrollOverview() {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const runs = await prisma.payRun.findMany({ where: { businessId: business.id }, include: RUN_INCLUDE, orderBy: [{ periodKey: "desc" }, { number: "desc" }], take: 36 });
  const dtos = runs.map((r) => runDto(r, cur));
  const liabilities = await payrollLiabilityAccounts(prisma, business.id);
  const remittances = await prisma.payrollRemittance.findMany({ where: { businessId: business.id }, include: { movement: { select: { status: true, movementDate: true, fromAccount: { select: { name: true } } } }, liabilityAccount: { select: { code: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
  const withheld = [];
  for (const a of liabilities) withheld.push({ account: a, owed: toMajorNumber(await liabilityBalance(prisma, business.id, a.id, cur), cur) });
  const live = new Set(dtos.filter((r) => r.status !== "REVERSED").map((r) => r.periodKey));
  const thisMonth = today.slice(0, 7);
  const employees = await prisma.employee.findMany({ where: { businessId: business.id }, select: { joinDate: true, leaveDate: true, payItems: { select: { id: true } } } });
  // the first month from the start of payroll in which someone with a pay structure was employed and no live run exists
  const paidMonths = employees.filter((e) => e.payItems.length).map((e) => businessDateOf(e.joinDate).slice(0, 7)).sort();
  let next: string | null = null;
  if (paidMonths.length) {
    const start = await payrollStartMonth(business.id, business.openingDate, today);
    const startKey = paidMonths[0]! > start ? paidMonths[0]! : start;
    for (let k = startKey; k <= thisMonth; k = addMonth(k)) {
      if (!live.has(k) && employees.some((e) => e.payItems.length && daysEmployed(e, k) > 0)) { next = k; break; }
    }
  }
  const unpaid = dtos.filter((r) => r.status === "POSTED").reduce((s, r) => s + toMinor(r.unpaid.amount, cur), 0);
  return {
    asOf: today, runs: dtos, nextRunMonth: next,
    unpaidNet: toMajorNumber(unpaid, cur),
    withheld,
    remittances: remittances.map((r) => ({ id: r.id, account: r.liabilityAccount, amount: toMajorNumber(toMinor(r.amount, cur), cur), periodKey: r.periodKey, reference: r.reference, status: r.movement.status, date: businessDateOf(r.movement.movementDate), from: r.movement.fromAccount?.name ?? null })),
  };
}

/** When payroll began here: the first pay run's month; before any run, last month (or the books' opening month, if later)
 * — months before the owner adopted payroll were paid outside it and are not asked for. */
export async function payrollStartMonth(businessId: string, openingDate: string | null, today: string) {
  const first = await prisma.payRun.findFirst({ where: { businessId }, orderBy: { periodKey: "asc" }, select: { periodKey: true } });
  if (first) return first.periodKey;
  const i = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 2;
  const lastMonth = `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  const opening = openingDate?.slice(0, 7) ?? "";
  return lastMonth > opening ? lastMonth : opening;
}

const addMonth = (key: string) => {
  const i = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7));
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};

/** For the cash forecast: net pay posted and not paid (by run pay date), and the standard monthly net of active staff. */
export async function payrollCashOutlook(businessId: string, cur: string, today: string) {
  const runs = await prisma.payRun.findMany({ where: { businessId, status: { in: ["DRAFT", "POSTED"] } }, include: RUN_INCLUDE });
  const unpaid = runs.map((r) => ({ periodKey: r.periodKey, payDate: businessDateOf(r.payDate), number: payRunNumber(r.number), status: r.status, amount: r.payslips.filter((s) => slipPayment(s).status === "UNPAID").reduce((s, x) => s + toMinor(x.net, cur), 0) })).filter((r) => r.amount > 0);
  const employees = await prisma.employee.findMany({ where: { businessId, OR: [{ leaveDate: null }, { leaveDate: { gte: dateColumn(today) } }] }, include: EMPLOYEE_INCLUDE });
  const monthlyNet = employees.reduce((s, e) => s + totalsOf(standardLines(itemsOf(e, cur), 30, 30)).net, 0);
  return { unpaid, monthlyNet, coveredMonths: new Set(runs.map((r) => r.periodKey)) };
}
