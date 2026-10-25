/**
 * Finance alerts and the month-end close checklist (ERP programme E14, docs/FINANCE_ALERTS.md). Nothing here is stored:
 * every alert and checklist step is computed from what the books already know, names how many records it concerns and
 * links to the page where it is fixed — so it clears by itself once the cause is fixed. Read-only.
 */
import { listAwaitingAllocation, listRenewals } from "./finance-center.service";
import { prisma } from "../../config/prisma";
import { businessToday, getFinanceContext } from "./finance-context";
import { businessDateOf, toMajorNumber, toMinor } from "./finance-values";
import { cashForecast } from "./budgets.service";
import { assetRegister } from "./fixed-assets.service";
import { listLoans } from "./loans.service";
import { listReconciliationChecks } from "./reconciliation.service";
import { unpaidDeliveredCod } from "./courier-payouts.service";
import { dueDates } from "./expenses.service";
import { payrollOverview, payrollStartMonth } from "./payroll.service";

export type AlertSeverity = "critical" | "warning" | "info";
export interface FinanceAlert {
  key: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  count: number;
  /** Major units, when the alert is about money. */
  amount: number | null;
  href: string;
  action: string;
}

const STALE_EVENT_MS = 15 * 60_000;
/** The Steadfast check flags delivered COD parcels unpaid after this many days (its own default). */
const COURIER_UNPAID_DAYS = 7;
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monthIndex = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;
const monthKey = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
const lastDayOf = (key: string) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).toISOString().slice(0, 10);
const day = (d: string) => new Date(`${d}T00:00:00Z`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** The latest run of every reconciliation check. */
async function latestCheckRuns(businessId: string) {
  return prisma.$queryRaw<Array<{ checkKey: string; status: string; createdAt: Date }>>`
    SELECT DISTINCT ON ("checkKey") "checkKey", "status"::text AS status, "createdAt"
    FROM "ReconciliationRun" WHERE "businessId" = ${businessId}
    ORDER BY "checkKey", "createdAt" DESC`;
}

/** How far back the inventory alerts look at stock movements. */
const INVENTORY_ALERT_DAYS = 30;
/** Stock that rose without a document behind it: a manual adjustment, a count that found more, an import. */
const UNDOCUMENTED_GAINS = ["ADJUSTMENT", "RESTOCK", "IMPORT"] as const;
/** How a filled bottle legitimately comes into stock: a fill, or a parcel / cancellation putting one back. */
const BOTTLE_SOURCES = new Set(["PRODUCTION_RECEIPT", "RETURN", "CANCELLATION"]);

type AddAlert = (a: Omit<FinanceAlert, "amount"> & { amount?: number | null }) => void;

/** Inventory recovery F-e: each alert names the item, the quantity, when it happened and what to do. */
async function inventoryAlerts(
  business: { id: string; baseCurrency: string; timezone: string },
  checkRuns: Array<{ checkKey: string; status: string }>,
  add: AddAlert,
) {
  const cur = business.baseCurrency;
  const since = new Date(Date.now() - INVENTORY_ALERT_DAYS * 86_400_000);
  const at = new Intl.DateTimeFormat("en-GB", { timeZone: business.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const line = (m: { change: number; createdAt: Date; reason: string; variant: { sku: string } }) => `${m.variant.sku} ${m.change > 0 ? "+" : ""}${m.change} (${m.reason.toLowerCase()}, ${at.format(m.createdAt)})`;
  const list = (xs: string[]) => xs.slice(0, 5).join(" · ") + (xs.length > 5 ? ` … and ${xs.length - 5} more` : "");

  const [settings, gains, bottles, unvalued] = await Promise.all([
    prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { inventoryGainAlertThreshold: true } }),
    prisma.stockMovement.findMany({
      where: { createdAt: { gte: since }, change: { gt: 0 }, reason: { in: [...UNDOCUMENTED_GAINS] }, valuationEntry: { isNot: null } },
      select: { change: true, createdAt: true, reason: true, variant: { select: { sku: true } }, valuationEntry: { select: { valueChange: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.stockMovement.findMany({
      where: { createdAt: { gte: since }, change: { gt: 0 }, variant: { product: { fillToOrder: true } } },
      select: { change: true, createdAt: true, reason: true, variant: { select: { sku: true } } },
      orderBy: { createdAt: "desc" },
    }),
    // read from the movements, not the exceptions the commerce sync raises later, so a receipt without a cost shows at once
    prisma.stockMovement.findMany({
      where: { createdAt: { gte: since }, change: { gt: 0 }, valuationEntry: { valuationStatus: "MISSING" } },
      select: { id: true, change: true, createdAt: true, reason: true, variant: { select: { sku: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  // … less the ones the owner has already dealt with on Finance › Exceptions (acknowledged or costed)
  const settled = unvalued.length
    ? new Set((await prisma.financeException.findMany({ where: { businessId: business.id, key: { in: unvalued.map((m) => `stock:${m.id}`) }, status: { not: "OPEN" } }, select: { key: true } })).map((e) => e.key))
    : new Set<string>();
  const receipts = unvalued.filter((m) => !settled.has(`stock:${m.id}`));

  // gains booked to 5210 (count adjustments) at or above the owner's threshold: profit nobody bought
  const threshold = toMinor(settings.inventoryGainAlertThreshold, cur);
  const big = gains.filter((g) => toMinor(g.valuationEntry!.valueChange, cur) >= threshold);
  add({
    key: "inventory.gains",
    severity: "critical",
    title: "Stock gains booked as profit",
    detail: `${list(big.map(line))}. Each one added stock value and counted it as income (5210) without a purchase or fill behind it.`,
    count: big.length,
    amount: toMajorNumber(big.reduce((s, g) => s + toMinor(g.valuationEntry!.valueChange, cur), 0), cur),
    href: "/admin/stock",
    action: "Record the real purchase or fill, or count the item again",
  });

  const unfilled = bottles.filter((m) => !BOTTLE_SOURCES.has(m.reason));
  add({
    key: "inventory.bottles_without_fill",
    severity: "warning",
    title: "Bottles added without a fill",
    detail: `${list(unfilled.map(line))}. Filled bottles come from Stock › Filled bottles, which also takes the oil and the empty bottles out.`,
    count: unfilled.length,
    href: "/admin/stock",
    action: "Record the fill with Stock › Filled bottles, or count the bottles again",
  });

  add({
    key: "inventory.unvalued_receipts",
    severity: "warning",
    title: "Stock received without a cost",
    detail: `${list(receipts.map(line))}. The books can't value these units until their cost is entered.`,
    count: receipts.length,
    href: "/admin/finance/exceptions",
    action: "Enter the cost from the bill, or count the item again",
  });

  const valuation = checkRuns.find((r) => r.checkKey === "inventory.valuation_vs_ledger");
  if (valuation && (valuation.status === "DIFFERENCE" || valuation.status === "ERROR")) {
    add({ key: "inventory.valuation_difference", severity: "critical", title: "Stock value and the books disagree", detail: "The inventory valuation does not match the inventory accounts in the ledger.", count: 1, href: "/admin/finance/checks", action: "Open the inventory check" });
  }
}

export async function financeAlerts() {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const major = (minor: number) => toMajorNumber(minor, cur);
  const alerts: FinanceAlert[] = [];
  const add = (a: Omit<FinanceAlert, "amount"> & { amount?: number | null }) => { if (a.count > 0) alerts.push({ amount: null, ...a }); };

  const stale = new Date(Date.now() - STALE_EVENT_MS);
  const [openingBatch, failedEvents, waitingEvents, approvals, exceptions, readyToClose, checkRuns, periods, unpaidCod] = await Promise.all([
    prisma.openingBalanceBatch.findUnique({ where: { businessId: business.id }, select: { status: true } }),
    prisma.financialEvent.count({ where: { businessId: business.id, status: "FAILED" } }),
    prisma.financialEvent.count({ where: { businessId: business.id, status: "RECEIVED", receivedAt: { lt: stale } } }),
    prisma.treasuryMovement.aggregate({ where: { businessId: business.id, status: "PENDING_APPROVAL" }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.financeException.aggregate({ where: { businessId: business.id, status: "OPEN" }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.productionOrder.findMany({ where: { businessId: business.id, status: "RECEIVED" }, select: { id: true, number: true }, orderBy: { number: "asc" } }),
    latestCheckRuns(business.id),
    prisma.financialPeriod.findMany({ where: { businessId: business.id, status: { not: "CLOSED" }, endDate: { lt: day(addDays(today, -5)) } }, orderBy: { startDate: "asc" }, select: { startDate: true } }),
    business.openingDate ? unpaidDeliveredCod(business, COURIER_UNPAID_DAYS, 20_000) : null,
  ]);

  // Until the opening balances are posted the books record nothing — every other finance page reads empty.
  if (!business.openingDate) add({ key: "books.not_started", severity: "critical", title: "The books haven't started", detail: "Choose the date your books start — nothing is recorded in Finance until then.", count: 1, href: "/admin/finance/opening", action: "Start the books" });
  else if (openingBatch?.status !== "POSTED") add({ key: "books.not_started", severity: "warning", title: "Opening balances not posted", detail: `Books start on ${business.openingDate}. Enter what you had and owed that day, then post it — sales are recorded from then on.`, count: 1, href: "/admin/finance/opening", action: "Finish starting the books" });
  add({ key: "events.failed", severity: "critical", title: "Financial events failed to post", detail: "These sales, receipts or stock movements are not in the books yet. Open them to see the error and retry.", count: failedEvents, href: "/admin/finance/activity?view=events", action: "Review events" });
  // The courier holds the cash for delivered COD parcels until it pays out — money the owner should chase.
  if (unpaidCod) add({ key: "courier.unpaid", severity: "warning", title: "Unpaid by Steadfast", detail: `Delivered more than ${COURIER_UNPAID_DAYS} days ago and not in any payout yet: ${unpaidCod.orders.slice(0, 4).map((o) => o.orderNumber).join(" · ")}${unpaidCod.orders.length > 4 ? " …" : ""}. Ask Steadfast for the payout, then import it.`, count: unpaidCod.orders.length, amount: major(unpaidCod.orders.reduce((s, o) => s + toMinor(o.total, cur), 0)), href: "/admin/finance/courier", action: "Open Steadfast check" });
  add({ key: "events.waiting", severity: "warning", title: "Financial events waiting to post", detail: "Received more than 15 minutes ago and still not posted.", count: waitingEvents, href: "/admin/finance/activity?view=events", action: "Review events" });

  const labels = new Map<string, string>(listReconciliationChecks().map((c) => [c.key, c.label]));
  const differing = checkRuns.filter((r) => r.status === "DIFFERENCE" || r.status === "ERROR");
  add({ key: "checks.difference", severity: "critical", title: "Finance checks show a difference", detail: differing.map((r) => labels.get(r.checkKey) ?? r.checkKey).join(" · "), count: differing.length, href: "/admin/finance/checks", action: "Open checks" });
  const lastCheck = checkRuns.reduce<Date | null>((m, r) => (!m || r.createdAt > m ? r.createdAt : m), null);
  if (!lastCheck || Date.now() - lastCheck.getTime() > 7 * 86_400_000) {
    add({ key: "checks.stale", severity: "info", title: "Finance checks not run this week", detail: lastCheck ? `Last run ${businessDateOf(lastCheck)}.` : "They have never been run.", count: 1, href: "/admin/finance/checks", action: "Run checks" });
  }

  add({ key: "treasury.approvals", severity: "warning", title: "Money movements waiting for approval", detail: "Payments and transfers are not in the books until they are approved or rejected.", count: approvals._count._all, amount: approvals._sum.amount ? major(toMinor(approvals._sum.amount, cur)) : null, href: "/admin/finance/accounts", action: "Review approvals" });
  add({ key: "exceptions.open", severity: "warning", title: "Open finance exceptions", detail: "Missing costs and unmatched records the books will not guess about.", count: exceptions._count._all, amount: exceptions._sum.amount ? major(toMinor(exceptions._sum.amount, cur)) : null, href: "/admin/finance/exceptions", action: "Review exceptions" });
  await inventoryAlerts(business, checkRuns, add);

  // money owed and cash: from the cash forecast, so the figures agree with it
  const forecast = await cashForecast({ weeks: 13 });
  const sumOf = (xs: Array<{ amount: number }>) => major(xs.reduce((s, l) => s - toMinor(l.amount, cur), 0));
  const bills = forecast.lines.filter((l) => l.source === "SUPPLIER_BILL");
  const overdueBills = bills.filter((l) => l.date < today);
  const dueBills = bills.filter((l) => l.date >= today && l.date <= addDays(today, 7));
  add({ key: "payables.overdue", severity: "warning", title: "Supplier bills overdue", detail: "Past their due date and not fully paid.", count: overdueBills.length, amount: sumOf(overdueBills), href: "/admin/finance/payables", action: "Pay suppliers" });
  add({ key: "payables.due_soon", severity: "info", title: "Supplier bills due within 7 days", detail: `Due by ${addDays(today, 7)}.`, count: dueBills.length, amount: sumOf(dueBills), href: "/admin/finance/payables", action: "Plan payments" });
  const overdueCosts = forecast.lines.filter((l) => l.source === "COMMITMENT" && l.date < today);
  add({ key: "expenses.overdue", severity: "warning", title: "Recurring costs overdue", detail: overdueCosts.slice(0, 4).map((l) => l.label).join(" · ") + (overdueCosts.length > 4 ? " …" : ""), count: overdueCosts.length, amount: sumOf(overdueCosts), href: "/admin/finance/expenses", action: "Record payments" });
  if (forecast.lowest.balance < 0) {
    add({ key: "cash.below_zero", severity: "critical", title: "Cash is forecast to go below zero", detail: `Lowest point in week ${forecast.lowest.week} (by ${forecast.lowest.date}).`, count: 1, amount: forecast.lowest.balance, href: "/admin/finance/budgets", action: "Open forecast" });
  }

  const [assets, loans, payroll] = await Promise.all([assetRegister(), listLoans(), payrollOverview()]);
  if (payroll.nextRunMonth && payroll.nextRunMonth < today.slice(0, 7)) {
    add({ key: "payroll.not_run", severity: "warning", title: "Payroll not run", detail: `No posted pay run for ${payroll.nextRunMonth}.`, count: monthIndex(today.slice(0, 7)) - monthIndex(payroll.nextRunMonth), href: "/admin/finance/payroll", action: "Run payroll" });
  }
  const unpaidRuns = payroll.runs.filter((r) => r.status === "POSTED" && r.unpaid.count > 0 && r.payDate < today);
  add({ key: "payroll.unpaid", severity: "warning", title: "Salaries due and not paid", detail: unpaidRuns.map((r) => `${r.number} ${r.periodKey}`).join(" · "), count: unpaidRuns.reduce((s, r) => s + r.unpaid.count, 0), amount: major(unpaidRuns.reduce((s, r) => s + toMinor(r.unpaid.amount, cur), 0)), href: unpaidRuns.length === 1 ? `/admin/finance/payroll?run=${unpaidRuns[0]!.id}` : "/admin/finance/payroll", action: "Pay salaries" });
  if (assets.nextRun && assets.nextRun < today.slice(0, 7)) {
    add({ key: "assets.depreciation_due", severity: "warning", title: "Depreciation not run", detail: `Next month to run: ${assets.nextRun}.`, count: monthIndex(today.slice(0, 7)) - monthIndex(assets.nextRun), amount: assets.nextRunCharge, href: "/admin/finance/fixed-assets", action: "Run depreciation" });
  }
  const lateLoans = loans.loans.filter((l) => l.overdue.instalments > 0);
  add({ key: "loans.overdue", severity: "warning", title: "Loan instalments overdue", detail: lateLoans.map((l) => `${l.number} ${l.lender} since ${l.overdue.since}`).join(" · "), count: lateLoans.reduce((s, l) => s + l.overdue.instalments, 0), amount: major(lateLoans.reduce((s, l) => s + toMinor(l.overdue.amount, cur), 0)), href: "/admin/finance/loans", action: "Record repayments" });
  if (loans.nextAccrual) {
    add({ key: "loans.interest_due", severity: "warning", title: "Loan interest not accrued", detail: `Next month to accrue: ${loans.nextAccrual}.`, count: monthIndex(today.slice(0, 7)) - monthIndex(loans.nextAccrual), href: "/admin/finance/loans", action: "Accrue interest" });
  }

  add({ key: "manufacturing.ready_to_close", severity: "info", title: "Production orders ready to close", detail: readyToClose.slice(0, 6).map((o) => `MO-${String(o.number).padStart(6, "0")}`).join(" · "), count: readyToClose.length, href: readyToClose.length === 1 ? `/admin/manufacturing/production-orders/${readyToClose[0]!.id}` : "/admin/manufacturing/production-orders", action: "Close orders" });

  if (periods.length) {
    const first = businessDateOf(periods[0]!.startDate).slice(0, 7);
    add({ key: "periods.open", severity: "info", title: "Months ended but not closed", detail: `From ${first}. Closing a month stops further postings into it.`, count: periods.length, href: `/admin/finance/attention?view=month-end&month=${first}`, action: "Month-end checklist" });
  }

  // Finance Center: subscriptions to renew, the SMS balance running low, costs still to split (docs/FINANCE_CENTER.md)
  const renewals = (await listRenewals()).filter((r) => r.status === "RENEW_SOON" || r.status === "EXPIRED");
  add({ key: "subscriptions.renew", severity: renewals.some((r) => r.status === "EXPIRED") ? "warning" : "info", title: "Subscriptions to renew", detail: renewals.slice(0, 4).map((r) => `${r.name} ${r.status === "EXPIRED" ? "ended" : "ends"} ${r.serviceEnd}`).join(" · "), count: renewals.length, amount: renewals.reduce((s, r) => s + (r.renewalAmount ?? 0), 0) || null, href: "/admin/finance/center?view=renewals", action: "Plan renewals" });
  const sms = await prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { smsWarnAt: true } });
  const lastSms = sms.smsWarnAt ? await prisma.smsBalanceSnapshot.findFirst({ where: { businessId: business.id }, orderBy: { takenAt: "desc" } }) : null;
  if (lastSms && sms.smsWarnAt && toMinor(lastSms.balance, cur) <= toMinor(sms.smsWarnAt, cur)) {
    add({ key: "sms.low", severity: "warning", title: "SMS balance is low", detail: `${cur} ${major(toMinor(lastSms.balance, cur))} left (read ${businessDateOf(lastSms.takenAt)}).`, count: 1, href: "/admin/finance/center?view=sms", action: "Recharge SMS" });
  }
  const awaiting = await listAwaitingAllocation();
  const toSplit = awaiting.expenses.filter((e) => e.paymentStatus === "POSTED" && e.status !== "ALLOCATED");
  add({ key: "expenses.unallocated", severity: "info", title: "Expenses awaiting allocation", detail: toSplit.slice(0, 3).map((e) => `${e.number} ${e.description}`).join(" · "), count: toSplit.length, amount: awaiting.remaining, href: "/admin/finance/center?view=allocate", action: "Split them" });

  alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const count = (s: AlertSeverity) => alerts.filter((a) => a.severity === s).length;
  return { asOf: today, alerts, counts: { critical: count("critical"), warning: count("warning"), info: count("info") } };
}

// ── month-end close checklist ─────────────────────────────────────────────────────────────────────────────────────────

export type StepStatus = "DONE" | "TODO" | "NOT_APPLICABLE";
export interface ChecklistStep {
  key: string;
  label: string;
  status: StepStatus;
  detail: string;
  href: string;
}

/** What has to be true before a month is closed, in the order an accountant works through it. Default: last month. */
export async function monthEndChecklist(q: { month?: string } = {}) {
  const { business } = await getFinanceContext();
  const cur = business.baseCurrency;
  const today = businessToday(business);
  const month = q.month ?? monthKey(monthIndex(today.slice(0, 7)) - 1);
  const from = `${month}-01`;
  const to = lastDayOf(month);
  const steps: ChecklistStep[] = [];
  const step = (s: ChecklistStep) => steps.push(s);

  const stale = new Date(Date.now() - STALE_EVENT_MS);
  const [events, approvals, drafts, exceptions, period, moneyAccounts, recs, assets, depRun, loans, accRun, commitments, checkRuns] = await Promise.all([
    prisma.financialEvent.count({ where: { businessId: business.id, financialDate: { lte: day(to) }, OR: [{ status: "FAILED" }, { status: "RECEIVED", receivedAt: { lt: stale } }] } }),
    prisma.treasuryMovement.count({ where: { businessId: business.id, status: "PENDING_APPROVAL", movementDate: { gte: day(from), lte: day(to) } } }),
    prisma.supplierInvoice.count({ where: { businessId: business.id, status: "DRAFT", invoiceDate: { gte: day(from), lte: day(to) } } }),
    prisma.financeException.count({ where: { businessId: business.id, status: "OPEN" } }),
    prisma.financialPeriod.findUnique({ where: { businessId_startDate: { businessId: business.id, startDate: day(from) } } }),
    prisma.financialAccount.findMany({ where: { businessId: business.id, isActive: true, kind: { in: ["BANK", "MOBILE_WALLET"] }, ledgerAccount: { lines: { some: { entry: { status: "POSTED", entryDate: { lte: day(to) } } } } } }, select: { id: true, name: true } }),
    prisma.bankReconciliation.findMany({ where: { businessId: business.id, status: "COMPLETED", periodEnd: { gte: day(to) } }, select: { financialAccountId: true } }),
    prisma.fixedAsset.count({ where: { businessId: business.id, depreciationStart: { lte: month }, OR: [{ status: "IN_USE" }, { disposedAt: { gt: day(to) } }] } }),
    prisma.depreciationRun.findFirst({ where: { businessId: business.id, periodKey: month, status: "POSTED" }, select: { id: true } }),
    listLoans(),
    prisma.loanAccrualRun.findFirst({ where: { businessId: business.id, periodKey: month, status: "POSTED" }, select: { id: true } }),
    prisma.recurringCommitment.findMany({ where: { businessId: business.id, isActive: true }, include: { expenses: { select: { periodKey: true, movement: { select: { status: true } } } } } }),
    latestCheckRuns(business.id),
  ]);
  const [payRun, payees, payrollStart] = await Promise.all([
    prisma.payRun.findFirst({ where: { businessId: business.id, periodKey: month, status: { not: "REVERSED" } }, select: { number: true, status: true } }),
    prisma.employee.count({ where: { businessId: business.id, joinDate: { lte: day(to) }, OR: [{ leaveDate: null }, { leaveDate: { gte: day(from) } }], payItems: { some: {} } } }),
    payrollStartMonth(business.id, business.openingDate, today),
  ]);

  step({ key: "events", label: "Every financial event is posted", status: events ? "TODO" : "DONE", detail: events ? `${plural(events, "event")} failed or still waiting.` : "Sales, receipts and stock movements are all in the books.", href: "/admin/finance/activity?view=events" });
  step({ key: "approvals", label: "Money movements approved or rejected", status: approvals ? "TODO" : "DONE", detail: approvals ? `${plural(approvals, "movement")} dated this month waiting for approval.` : "Nothing waiting.", href: "/admin/finance/accounts" });

  const unpaid: string[] = [];
  for (const c of commitments) {
    for (const d of dueDates({ frequency: c.frequency, dayOfMonth: c.dayOfMonth, startDate: businessDateOf(c.startDate), endDate: c.endDate ? businessDateOf(c.endDate) : null }, from, to)) {
      if (!c.expenses.some((e) => e.periodKey === d.periodKey && ["PENDING_APPROVAL", "POSTED"].includes(e.movement.status))) unpaid.push(c.name);
    }
  }
  step({ key: "expenses", label: "Recurring costs recorded", status: !commitments.length ? "NOT_APPLICABLE" : unpaid.length ? "TODO" : "DONE", detail: !commitments.length ? "No recurring costs are set up." : unpaid.length ? `Not recorded: ${unpaid.join(", ")}.` : "Every cost due this month is recorded.", href: "/admin/finance/expenses" });
  step({ key: "payroll", label: "Payroll posted", status: !payees || month < payrollStart ? "NOT_APPLICABLE" : payRun?.status === "POSTED" ? "DONE" : "TODO", detail: month < payrollStart ? `Before payroll started (${payrollStart}).` : !payees ? "Nobody on the payroll this month." : payRun?.status === "POSTED" ? `Pay run PR-${String(payRun.number).padStart(3, "0")} posted.` : payRun ? "The pay run is still a draft." : `No pay run for ${month}.`, href: "/admin/finance/payroll" });
  step({ key: "bills", label: "Supplier bills entered and posted", status: drafts ? "TODO" : "DONE", detail: drafts ? `${plural(drafts, "draft bill")} dated this month.` : "No draft bills dated this month.", href: "/admin/finance/supplier-invoices" });

  const reconciled = new Set(recs.map((r) => r.financialAccountId));
  const missing = moneyAccounts.filter((a) => !reconciled.has(a.id)).map((a) => a.name);
  step({ key: "bank", label: "Bank and wallet accounts reconciled", status: !moneyAccounts.length ? "NOT_APPLICABLE" : missing.length ? "TODO" : "DONE", detail: !moneyAccounts.length ? `No bank or wallet account had movements by ${to}.` : missing.length ? `Not reconciled to ${to}: ${missing.join(", ")}.` : `Every account is reconciled to ${to} or later.`, href: "/admin/finance/reconciliation" });

  step({ key: "depreciation", label: "Depreciation run", status: !assets ? "NOT_APPLICABLE" : depRun ? "DONE" : "TODO", detail: !assets ? "No assets depreciating this month." : depRun ? `Posted for ${month}.` : `Not run for ${month}.`, href: "/admin/finance/fixed-assets" });
  const borrowing = loans.loans.filter((l) => l.drawdownDate <= to && (l.status === "ACTIVE" || l.status === "REPAID"));
  const needsInterest = borrowing.some((l) => l.status === "ACTIVE") || (borrowing.length > 0 && !!accRun);
  step({ key: "interest", label: "Loan interest accrued", status: !needsInterest ? "NOT_APPLICABLE" : accRun ? "DONE" : "TODO", detail: !needsInterest ? "No loans outstanding this month." : accRun ? `Accrued for ${month}.` : month >= today.slice(0, 7) ? "The month has not ended yet." : `Not accrued for ${month}.`, href: "/admin/finance/loans" });

  step({ key: "exceptions", label: "Finance exceptions reviewed", status: exceptions ? "TODO" : "DONE", detail: exceptions ? `${plural(exceptions, "open exception")} — acknowledge or resolve each.` : "No open exceptions.", href: "/admin/finance/exceptions" });

  const labels = new Map<string, string>(listReconciliationChecks().map((c) => [c.key, c.label]));
  const afterMonth = checkRuns.filter((r) => businessDateOf(r.createdAt) > to);
  const differing = checkRuns.filter((r) => r.status === "DIFFERENCE" || r.status === "ERROR").map((r) => labels.get(r.checkKey) ?? r.checkKey);
  step({ key: "checks", label: "Finance checks match", status: differing.length || afterMonth.length < labels.size ? "TODO" : "DONE", detail: differing.length ? `Difference: ${differing.join(", ")}.` : afterMonth.length < labels.size ? `Run every check after ${to}.` : "Every check matched after the month ended.", href: "/admin/finance/checks" });

  const before = steps.filter((s) => s.status === "TODO").length;
  return {
    month, from, to, asOf: today, currency: cur,
    ended: to < today,
    period: period ? { id: period.id, status: period.status, closedAt: period.closedAt } : null,
    steps,
    open: before,
    /** Every step done (or not applicable) and the month has ended. */
    ready: before === 0 && to < today,
  };
}
