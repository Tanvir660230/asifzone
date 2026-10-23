import { Router, type NextFunction, type Request, type Response } from "express";
import {
  accountMappingUpdateSchema,
  commerceSyncSchema,
  exceptionAcknowledgeSchema,
  exceptionEstimateSchema,
  financeCostPolicySchema,
  financeExceptionQuerySchema,
  settlementCreateSchema,
  settlementImportSchema,
  settlementListQuerySchema,
  settlementReverseSchema,
  adjustmentSchema,
  bankAdjustSchema,
  bankFlagSchema,
  bankMatchSchema,
  bankReconciliationAbandonSchema,
  bankReconciliationCompleteSchema,
  bankReconciliationCreateSchema,
  bankReconciliationListQuerySchema,
  bankTransactionCreateSchema,
  bankTransactionListQuerySchema,
  bankUnmatchSchema,
  depositSchema,
  movementListQuerySchema,
  movementRejectSchema,
  movementReverseSchema,
  openingFundingSchema,
  statementImportListQuerySchema,
  statementImportSchema,
  transferSchema,
  withdrawalSchema,
  FINANCIAL_ACCOUNT_KINDS,
  financeAuditQuerySchema,
  financeBusinessUpdateSchema,
  financialAccountCreateSchema,
  financialAccountUpdateSchema,
  financialEventListQuerySchema,
  journalCorrectSchema,
  journalDraftSchema,
  journalListQuerySchema,
  journalReverseSchema,
  ledgerAccountCreateSchema,
  ledgerAccountUpdateSchema,
  ledgerRangeQuerySchema,
  statementPeriodQuerySchema,
  expenseCreateSchema,
  budgetCreateSchema,
  budgetLinesSchema,
  budgetQuerySchema,
  cashForecastQuerySchema,
  monthEndQuerySchema,
  payComponentCreateSchema,
  payComponentUpdateSchema,
  employeeCreateSchema,
  employeeUpdateSchema,
  payRunCreateSchema,
  payslipUpdateSchema,
  payrollPaySchema,
  payrollRemitSchema,
  payRunReverseSchema,
  partnerCreateSchema,
  partnerUpdateSchema,
  profitShareRunSchema,
  profitSharePaySchema,
  ownerMoneySchema,
  partnerCapitalSchema,
  payoutsTakenSchema,
  partnerActivityQuerySchema,
  equityQuerySchema,
  loanCreateSchema,
  loanRepaymentSchema,
  loanAccrualSchema,
  loanAccrualReverseSchema,
  fixedAssetCreateSchema,
  fixedAssetUpdateSchema,
  fixedAssetDisposeSchema,
  depreciationRunSchema,
  depreciationReverseSchema,
  fixedAssetListQuerySchema,
  expenseListQuerySchema,
  commitmentCreateSchema,
  commitmentUpdateSchema,
  commitmentListQuerySchema,
  balanceSheetQuerySchema,
  openingBalanceLinesSchema,
  openingInventoryItemsSchema,
  periodActionSchema,
  reconciliationRunSchema,
  cutoverApproveSchema,
  cutoverDraftSchema,
  cutoverLineQuerySchema,
  cutoverLinesSchema,
  cutoverReopenSchema,
  cutoverSettingsSchema,
} from "@clothing-brand/shared";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import { asyncHandler } from "../../lib/async-handler";
import { idempotencyKeyOf } from "../orders/order.controller";
import type { FinanceActor } from "../../domain/finance/finance-audit";
import { getFinanceContext } from "../../domain/finance/finance-context";
import { financeError } from "../../domain/finance/finance-values";
import * as chart from "../../domain/finance/chart.service";
import * as financialAccounts from "../../domain/finance/financial-accounts.service";
import * as periods from "../../domain/finance/periods.service";
import * as journals from "../../domain/finance/journal.service";
import * as ledger from "../../domain/finance/ledger.service";
import * as statements from "../../domain/finance/statements.service";
import * as expenses from "../../domain/finance/expenses.service";
import * as fixedAssets from "../../domain/finance/fixed-assets.service";
import * as loans from "../../domain/finance/loans.service";
import * as budgets from "../../domain/finance/budgets.service";
import * as alerts from "../../domain/finance/finance-alerts.service";
import * as payroll from "../../domain/finance/payroll.service";
import * as equity from "../../domain/finance/equity.service";
import * as partnerProfit from "../../domain/finance/partner-profit.service";
import * as partnerStatements from "../../domain/finance/partner-statement.service";
import * as events from "../../domain/finance/events.service";
import * as opening from "../../domain/finance/opening-balances.service";
import * as reconciliation from "../../domain/finance/reconciliation.service";
import * as treasury from "../../domain/finance/treasury.service";
import * as bank from "../../domain/finance/bank.service";
import * as bankRecon from "../../domain/finance/bank-reconciliation.service";
import * as commerce from "../../domain/finance/commerce-accounting.service";
import * as settlements from "../../domain/finance/settlements.service";
import * as exceptions from "../../domain/finance/finance-exceptions.service";
import * as cutover from "../../domain/finance/inventory-cutover.service";
import { ensureCommerceAccounting } from "../../domain/finance/commerce-setup.service";
import type { FinanceViewer } from "../../domain/finance/finance-values";

/** Phase 3 §11: what this admin may see of ownership / partner / payroll accounts. */
const viewerOf = (req: Request): FinanceViewer => ({ sensitive: req.admin!.permissions.includes("finance.sensitive") });

/**
 * Financial Core admin API (docs/FINANCE_PHASE_1.md §6) — /api/v1/finance. Every route states a finance.* permission
 * (OWNER-only until a finance role is decided). Finance records its own audit trail inside each operation's transaction
 * (FinanceAuditEntry), so these routes opt out of the generic, best-effort AuditLog row.
 */
export const financeRouter = Router();

financeRouter.use(requireAdmin);
financeRouter.use((_req: Request, res: Response, next: NextFunction) => {
  res.locals.auditHandled = true;
  next();
});

/** The acting admin, with a label readable without joins (email when the account still exists). */
export async function actorOf(req: Request): Promise<FinanceActor> {
  const admin = req.admin!;
  const row = await prisma.adminUser.findUnique({ where: { id: admin.adminId }, select: { email: true } });
  return { type: "ADMIN", adminId: admin.adminId, label: row?.email ?? `admin:${admin.adminId}`, permissions: admin.permissions };
}

const id = (req: Request) => req.params.id!;
const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50), checkKey: z.string().trim().max(64).optional() });

// ── business & brands ───────────────────────────────────────────────────────────────────────────────────────────────
financeRouter.get("/business", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await chart.getBusinessSettings())));
financeRouter.patch("/business", requirePermission("finance.configure"), validate(financeBusinessUpdateSchema), asyncHandler(async (req, res) => res.json(await chart.updateBusinessSettings(req.body, await actorOf(req)))));

// ── chart of accounts & mappings ────────────────────────────────────────────────────────────────────────────────────
financeRouter.get("/accounts", requirePermission("finance.read"), asyncHandler(async (req, res) => res.json({ accounts: await chart.listAccounts(viewerOf(req)) })));
financeRouter.post("/accounts", requirePermission("finance.configure"), validate(ledgerAccountCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await chart.createAccount(req.body, await actorOf(req)))));
financeRouter.patch("/accounts/:id", requirePermission("finance.configure"), validate(ledgerAccountUpdateSchema), asyncHandler(async (req, res) => res.json(await chart.updateAccount(id(req), req.body, await actorOf(req)))));
financeRouter.get("/accounts/:id/ledger", requirePermission("finance.read"), validate(ledgerRangeQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await ledger.getAccountLedger(id(req), req.query as never, viewerOf(req)))));
financeRouter.get("/mappings", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json({ mappings: await chart.listMappings() })));
financeRouter.put("/mappings/:key", requirePermission("finance.configure"), validate(accountMappingUpdateSchema), asyncHandler(async (req, res) => res.json(await chart.setMapping(req.params.key!, req.body, await actorOf(req)))));

// ── financial accounts (cash, bank, wallets, gateways, couriers) ────────────────────────────────────────────────────
const accountListQuery = z.object({ brandId: z.string().trim().min(1).max(64).optional(), kind: z.enum(FINANCIAL_ACCOUNT_KINDS).optional() });
financeRouter.get("/financial-accounts", requirePermission("finance.read"), validate(accountListQuery, "query"), asyncHandler(async (req, res) => res.json({ financialAccounts: await financialAccounts.listFinancialAccounts(req.query as never) })));
financeRouter.get("/financial-accounts/:id", requirePermission("finance.read"), asyncHandler(async (req, res) => res.json(await financialAccounts.getFinancialAccount(id(req)))));
financeRouter.get("/financial-accounts/:id/ledger", requirePermission("finance.read"), validate(ledgerRangeQuerySchema, "query"), asyncHandler(async (req, res) => {
  const account = await financialAccounts.getFinancialAccount(id(req));
  res.json(await ledger.getAccountLedger(account.ledgerAccount.id, req.query as never));
}));
financeRouter.post("/financial-accounts", requirePermission("finance.configure"), validate(financialAccountCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await financialAccounts.createFinancialAccount(req.body, await actorOf(req)))));
financeRouter.patch("/financial-accounts/:id", requirePermission("finance.configure"), validate(financialAccountUpdateSchema), asyncHandler(async (req, res) => res.json(await financialAccounts.updateFinancialAccount(id(req), req.body, await actorOf(req)))));

// ── periods ─────────────────────────────────────────────────────────────────────────────────────────────────────────
financeRouter.get("/periods", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json({ periods: await periods.listPeriods() })));
for (const transition of ["soft-close", "close", "reopen"] as const) {
  financeRouter.post(`/periods/:id/${transition}`, requirePermission("finance.period_close"), validate(periodActionSchema), asyncHandler(async (req, res) => res.json(await periods.changePeriodStatus(id(req), transition, req.body.reason, await actorOf(req)))));
}

// ── journals ────────────────────────────────────────────────────────────────────────────────────────────────────────
financeRouter.get("/journals", requirePermission("finance.read"), validate(journalListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await journals.listJournals(req.query as never, viewerOf(req)))));
financeRouter.get("/journals/:id", requirePermission("finance.read"), asyncHandler(async (req, res) => res.json(await journals.getJournal(id(req), viewerOf(req)))));
financeRouter.post("/journals", requirePermission("finance.transact"), validate(journalDraftSchema), asyncHandler(async (req, res) => {
  const result = await journals.createDraftJournal(req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(result.replayed ? 200 : 201).json(result);
}));
financeRouter.put("/journals/:id", requirePermission("finance.transact"), validate(journalDraftSchema), asyncHandler(async (req, res) => res.json(await journals.updateDraftJournal(id(req), req.body, await actorOf(req)))));
financeRouter.delete("/journals/:id", requirePermission("finance.transact"), asyncHandler(async (req, res) => {
  await journals.deleteDraftJournal(id(req), await actorOf(req), typeof req.query.reason === "string" ? req.query.reason.slice(0, 500) : null);
  res.status(204).end();
}));
financeRouter.post("/journals/:id/post", requirePermission("finance.post"), asyncHandler(async (req, res) => res.json(await journals.postDraftJournal(id(req), await actorOf(req)))));
financeRouter.post("/journals/:id/reverse", requirePermission("finance.reverse"), validate(journalReverseSchema), asyncHandler(async (req, res) => {
  const result = await journals.reverseJournal(id(req), req.body, await actorOf(req));
  res.status(result.replayed ? 200 : 201).json(result);
}));
financeRouter.post("/journals/:id/correct", requirePermission("finance.reverse"), validate(journalCorrectSchema), asyncHandler(async (req, res) => {
  const result = await journals.correctJournal(id(req), req.body, await actorOf(req));
  res.status(result.replayed ? 200 : 201).json(result);
}));

// ── general ledger ──────────────────────────────────────────────────────────────────────────────────────────────────
financeRouter.get("/trial-balance", requirePermission("finance.read"), validate(ledgerRangeQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await ledger.getTrialBalance(req.query as never, viewerOf(req)))));
financeRouter.get("/statements/income", requirePermission("finance.read"), validate(statementPeriodQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await statements.incomeStatement(req.query as never, viewerOf(req)))));
financeRouter.get("/statements/balance-sheet", requirePermission("finance.read"), validate(balanceSheetQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await statements.balanceSheet(req.query as never, viewerOf(req)))));
financeRouter.get("/statements/cash-flow", requirePermission("finance.read"), validate(statementPeriodQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await statements.cashFlow(req.query as never, viewerOf(req)))));

// ── expenses & recurring commitments (docs/FINANCE_EXPENSES.md) ─────────────────────────────────────────────────────────
financeRouter.get("/expenses", requirePermission("finance.read"), validate(expenseListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await expenses.listExpenses(req.query as never))));
financeRouter.get("/expenses/summary", requirePermission("finance.read"), validate(statementPeriodQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await expenses.expenseSummary(req.query as never))));
financeRouter.post("/expenses", requirePermission("finance.transact"), validate(expenseCreateSchema), asyncHandler(async (req, res) => {
  const r = await expenses.recordExpense(req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));
financeRouter.get("/commitments", requirePermission("finance.read"), validate(commitmentListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await expenses.listCommitments(req.query as never))));
financeRouter.post("/commitments", requirePermission("finance.transact"), validate(commitmentCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await expenses.createCommitment(req.body, await actorOf(req)))));
financeRouter.patch("/commitments/:id", requirePermission("finance.transact"), validate(commitmentUpdateSchema), asyncHandler(async (req, res) => res.json(await expenses.updateCommitment(id(req), req.body, await actorOf(req)))));

// ── fixed assets & depreciation (docs/FINANCE_FIXED_ASSETS.md) ──────────────────────────────────────────────────────────
financeRouter.get("/fixed-assets", requirePermission("finance.read"), validate(fixedAssetListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await fixedAssets.assetRegister(req.query as never))));
financeRouter.post("/fixed-assets", requirePermission("finance.transact"), validate(fixedAssetCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await fixedAssets.createAsset(req.body, await actorOf(req)))));
financeRouter.patch("/fixed-assets/:id", requirePermission("finance.transact"), validate(fixedAssetUpdateSchema), asyncHandler(async (req, res) => res.json(await fixedAssets.updateAsset(id(req), req.body, await actorOf(req)))));
financeRouter.post("/fixed-assets/:id/dispose", requirePermission("finance.post"), validate(fixedAssetDisposeSchema), asyncHandler(async (req, res) => res.json(await fixedAssets.disposeAsset(id(req), req.body, await actorOf(req)))));
financeRouter.post("/depreciation-runs", requirePermission("finance.post"), validate(depreciationRunSchema), asyncHandler(async (req, res) => {
  const r = await fixedAssets.runDepreciation(req.body.periodKey, await actorOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));
financeRouter.post("/depreciation-runs/reverse-latest", requirePermission("finance.reverse"), validate(depreciationReverseSchema), asyncHandler(async (req, res) => res.json(await fixedAssets.reverseLatestRun(req.body.reason, await actorOf(req)))));

// ── loans (docs/FINANCE_LOANS.md) ─────────────────────────────────────────────────────────────────────────────────────────
financeRouter.get("/loans", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await loans.listLoans())));
financeRouter.post("/loans", requirePermission("finance.transact"), validate(loanCreateSchema), asyncHandler(async (req, res) => {
  const r = await loans.drawLoan(req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));
financeRouter.post("/loans/:id/repayments", requirePermission("finance.transact"), validate(loanRepaymentSchema), asyncHandler(async (req, res) => {
  const r = await loans.repayLoan(id(req), req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));
financeRouter.post("/loan-accruals", requirePermission("finance.post"), validate(loanAccrualSchema), asyncHandler(async (req, res) => {
  const r = await loans.runInterestAccrual(req.body.periodKey, await actorOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));
financeRouter.post("/loan-accruals/reverse-latest", requirePermission("finance.reverse"), validate(loanAccrualReverseSchema), asyncHandler(async (req, res) => res.json(await loans.reverseLatestAccrual(req.body.reason, await actorOf(req)))));

// ── budgets, cash forecast & runway (docs/FINANCE_BUDGETS.md) ───────────────────────────────────────────────────────────
financeRouter.get("/budgets", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await budgets.listBudgets())));
financeRouter.post("/budgets", requirePermission("finance.transact"), validate(budgetCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await budgets.createBudget(req.body, await actorOf(req)))));
financeRouter.get("/budgets/:id", requirePermission("finance.read"), validate(budgetQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await budgets.budgetVsActual(id(req), req.query as never))));
financeRouter.put("/budgets/:id/lines", requirePermission("finance.transact"), validate(budgetLinesSchema), asyncHandler(async (req, res) => res.json(await budgets.setBudgetLines(id(req), req.body.lines, await actorOf(req)))));
financeRouter.delete("/budgets/:id", requirePermission("finance.transact"), asyncHandler(async (req, res) => {
  await budgets.deleteBudget(id(req), await actorOf(req));
  res.status(204).end();
}));
financeRouter.get("/cash-forecast", requirePermission("finance.read"), validate(cashForecastQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await budgets.cashForecast(req.query as never))));

// ── alerts & month-end close (docs/FINANCE_ALERTS.md) ───────────────────────────────────────────────────────────────────
financeRouter.get("/alerts", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await alerts.financeAlerts())));
financeRouter.get("/month-end", requirePermission("finance.read"), validate(monthEndQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await alerts.monthEndChecklist(req.query as never))));

// ── payroll (docs/FINANCE_PAYROLL.md) — salaries are sensitive: reading and drafting need finance.sensitive ──────────────
const SENSITIVE = requirePermission("finance.sensitive");
financeRouter.get("/payroll", SENSITIVE, asyncHandler(async (_req, res) => res.json(await payroll.payrollOverview())));
financeRouter.get("/payroll/components", SENSITIVE, asyncHandler(async (_req, res) => res.json(await payroll.listComponents())));
financeRouter.post("/payroll/components", SENSITIVE, validate(payComponentCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await payroll.createComponent(req.body, await actorOf(req)))));
financeRouter.patch("/payroll/components/:id", SENSITIVE, validate(payComponentUpdateSchema), asyncHandler(async (req, res) => res.json(await payroll.updateComponent(id(req), req.body, await actorOf(req)))));
financeRouter.get("/payroll/employees", SENSITIVE, asyncHandler(async (_req, res) => res.json(await payroll.listEmployees())));
financeRouter.post("/payroll/employees", SENSITIVE, validate(employeeCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await payroll.createEmployee(req.body, await actorOf(req)))));
financeRouter.patch("/payroll/employees/:id", SENSITIVE, validate(employeeUpdateSchema), asyncHandler(async (req, res) => res.json(await payroll.updateEmployee(id(req), req.body, await actorOf(req)))));
financeRouter.post("/payroll/runs", SENSITIVE, validate(payRunCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await payroll.createPayRun(req.body, await actorOf(req)))));
financeRouter.get("/payroll/runs/:id", SENSITIVE, asyncHandler(async (req, res) => res.json(await payroll.getPayRun(id(req)))));
financeRouter.delete("/payroll/runs/:id", SENSITIVE, asyncHandler(async (req, res) => {
  await payroll.deleteDraftPayRun(id(req), await actorOf(req));
  res.status(204).end();
}));
financeRouter.patch("/payroll/runs/:id/payslips/:payslipId", SENSITIVE, validate(payslipUpdateSchema), asyncHandler(async (req, res) => res.json(await payroll.updatePayslip(id(req), req.params.payslipId!, req.body, await actorOf(req)))));
financeRouter.post("/payroll/runs/:id/employees/:employeeId", SENSITIVE, asyncHandler(async (req, res) => res.json(await payroll.setPayslipPresence(id(req), req.params.employeeId!, true, await actorOf(req)))));
financeRouter.delete("/payroll/runs/:id/employees/:employeeId", SENSITIVE, asyncHandler(async (req, res) => res.json(await payroll.setPayslipPresence(id(req), req.params.employeeId!, false, await actorOf(req)))));
financeRouter.post("/payroll/runs/:id/post", requirePermission("finance.post"), asyncHandler(async (req, res) => res.json(await payroll.postPayRun(id(req), await actorOf(req)))));
financeRouter.post("/payroll/runs/:id/reverse", requirePermission("finance.reverse"), validate(payRunReverseSchema), asyncHandler(async (req, res) => res.json(await payroll.reversePayRun(id(req), req.body.reason, await actorOf(req)))));
financeRouter.post("/payroll/runs/:id/pay", requirePermission("finance.transact"), validate(payrollPaySchema), asyncHandler(async (req, res) => {
  const r = await payroll.payPayslips(id(req), req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));
financeRouter.post("/payroll/remittances", requirePermission("finance.transact"), validate(payrollRemitSchema), asyncHandler(async (req, res) => {
  const r = await payroll.remitDeductions(req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));

// ── partners & equity, foundation (docs/FINANCE_EQUITY.md) — partner balances are sensitive ─────────────────────────────
financeRouter.get("/equity", SENSITIVE, validate(equityQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await equity.equityOverview(req.query as never))));
financeRouter.post("/equity/partners", requirePermission("finance.configure"), validate(partnerCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await equity.createPartner(req.body, await actorOf(req)))));
financeRouter.patch("/equity/partners/:id", requirePermission("finance.configure"), validate(partnerUpdateSchema), asyncHandler(async (req, res) => res.json(await equity.updatePartner(id(req), req.body, await actorOf(req)))));
// the owner and the partners: monthly profit shares, paying them, the owner putting in and taking out (docs/FINANCE_EQUITY.md §8–§10) — owner-only
financeRouter.get("/equity/profit-shares", SENSITIVE, asyncHandler(async (_req, res) => res.json(await partnerProfit.profitShareOverview())));
financeRouter.post("/equity/profit-shares/run", SENSITIVE, validate(profitShareRunSchema), asyncHandler(async (req, res) => res.json(await partnerProfit.runProfitShares(req.body, await actorOf(req)))));
financeRouter.get("/equity/partners/:id/activity", SENSITIVE, validate(partnerActivityQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await partnerProfit.partnerActivity(id(req), req.query as never))));
financeRouter.post("/equity/partners/:id/pay", SENSITIVE, validate(profitSharePaySchema), asyncHandler(async (req, res) => {
  const r = await partnerProfit.payPartner(id(req), req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));
financeRouter.post("/equity/partners/:id/capital", SENSITIVE, validate(partnerCapitalSchema), asyncHandler(async (req, res) => {
  const r = await partnerProfit.partnerCapital(id(req), req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));
financeRouter.post("/equity/owner/money", SENSITIVE, validate(ownerMoneySchema), asyncHandler(async (req, res) => {
  const r = await partnerProfit.ownerMoney(req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));
financeRouter.get("/equity/owner/payouts", SENSITIVE, asyncHandler(async (_req, res) => res.json(await partnerProfit.ownerPayouts())));
// one source for every partner and owner figure (partner-statement.service): a partner's statement, the owner's summary
financeRouter.get("/equity/partners/:id/statement", SENSITIVE, validate(partnerActivityQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await partnerStatements.partnerStatement(id(req), req.query as never))));
financeRouter.get("/equity/owner/summary", SENSITIVE, validate(equityQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await partnerStatements.ownerSummary((req.query as { asOf?: string }).asOf))));
financeRouter.post("/equity/owner/payouts-taken", SENSITIVE, validate(payoutsTakenSchema), asyncHandler(async (req, res) => res.json(await partnerProfit.markPayoutsTaken(req.body.settlementIds, await actorOf(req)))));

// ── financial events ────────────────────────────────────────────────────────────────────────────────────────────────
financeRouter.get("/events", requirePermission("finance.read"), validate(financialEventListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await events.listFinancialEvents(req.query as never))));
financeRouter.post("/events/:id/retry", requirePermission("finance.reconcile"), asyncHandler(async (req, res) => res.json(await events.retryFinancialEvent(id(req)))));

// ── opening balances ────────────────────────────────────────────────────────────────────────────────────────────────
financeRouter.get("/opening-balances", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await opening.getOpeningBalances())));
financeRouter.put("/opening-balances/lines", requirePermission("finance.transact"), validate(openingBalanceLinesSchema), asyncHandler(async (req, res) => res.json(await opening.saveOpeningLines(req.body, await actorOf(req)))));
financeRouter.put("/opening-balances/inventory", requirePermission("finance.transact"), validate(openingInventoryItemsSchema), asyncHandler(async (req, res) => res.json(await opening.saveOpeningInventory(req.body.items, await actorOf(req)))));
financeRouter.post("/opening-balances/inventory/prefill", requirePermission("finance.transact"), asyncHandler(async (req, res) => res.json(await opening.prefillOpeningInventory(await actorOf(req)))));
financeRouter.post("/opening-balances/post", requirePermission("finance.post"), asyncHandler(async (req, res) => res.json(await opening.postOpeningBalances(await actorOf(req), { nothingHeld: req.body?.nothingHeld === true }))));

// ── reconciliation ──────────────────────────────────────────────────────────────────────────────────────────────────
financeRouter.get("/reconciliation/checks", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json({ checks: reconciliation.listReconciliationChecks() })));
financeRouter.get("/reconciliation/runs", requirePermission("finance.read"), validate(pageQuery, "query"), asyncHandler(async (req, res) => res.json(await reconciliation.listReconciliationRuns(req.query as never))));
financeRouter.post("/reconciliation/run", requirePermission("finance.reconcile"), validate(reconciliationRunSchema), asyncHandler(async (req, res) => res.json(await reconciliation.runReconciliation(req.body, await actorOf(req)))));

// ── financial audit trail ───────────────────────────────────────────────────────────────────────────────────────────
financeRouter.get("/audit", requirePermission("finance.read"), validate(financeAuditQuerySchema, "query"), asyncHandler(async (req, res) => {
  const { business } = await getFinanceContext();
  const q = req.query as unknown as { entityType?: string; entityId?: string; page: number; pageSize: number };
  if (q.entityId && !q.entityType) throw financeError(400, "AUDIT_FILTER", "Filter by entityId needs entityType");
  const where = { businessId: business.id, entityType: q.entityType, entityId: q.entityId };
  const [total, entries] = await Promise.all([
    prisma.financeAuditEntry.count({ where }),
    prisma.financeAuditEntry.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  res.json({ total, page: q.page, pageSize: q.pageSize, entries: entries.map((e) => ({ ...e, txId: e.txId.toString() })) });
}));

// ── Phase 2: money movements (docs/FINANCE_PHASE_2.md §7) — every movement needs an Idempotency-Key ─────────────────
const movement = (kind: treasury.MovementRequest["kind"], map: (b: Record<string, unknown>) => Partial<treasury.MovementRequest>) =>
  asyncHandler(async (req, res) => {
    const b = req.body as Record<string, unknown> & { movementDate: string; amount: number; reference?: string | null; description: string; reason?: string | null };
    const result = await treasury.requestMovement({ kind, movementDate: b.movementDate, amount: b.amount, reference: b.reference, description: b.description, reason: b.reason, ...map(b) }, await actorOf(req), idempotencyKeyOf(req));
    res.status(result.replayed ? 200 : 201).json(result);
  });
financeRouter.post("/movements/deposit", requirePermission("finance.transact"), validate(depositSchema), movement("DEPOSIT", (b) => ({ toFinancialAccountId: b.toFinancialAccountId as string, counterAccountId: b.counterAccountId as string })));
financeRouter.post("/movements/withdrawal", requirePermission("finance.transact"), validate(withdrawalSchema), movement("WITHDRAWAL", (b) => ({ fromFinancialAccountId: b.fromFinancialAccountId as string, counterAccountId: b.counterAccountId as string, partnerAdvanceReason: (b.partnerAdvanceReason as string | undefined) ?? null })));
financeRouter.post("/movements/transfer", requirePermission("finance.transact"), validate(transferSchema), movement("TRANSFER", (b) => ({ fromFinancialAccountId: b.fromFinancialAccountId as string, toFinancialAccountId: b.toFinancialAccountId as string })));
financeRouter.post("/movements/adjustment", requirePermission("finance.transact"), validate(adjustmentSchema), movement("ADJUSTMENT", (b) => ({
  direction: b.direction as "IN" | "OUT",
  counterAccountId: b.counterAccountId as string,
  ...(b.direction === "IN" ? { toFinancialAccountId: b.financialAccountId as string } : { fromFinancialAccountId: b.financialAccountId as string }),
})));
financeRouter.post("/movements/opening-funding", requirePermission("finance.transact"), validate(openingFundingSchema), movement("OPENING_FUNDING", (b) => ({ toFinancialAccountId: b.financialAccountId as string })));
financeRouter.get("/movements", requirePermission("finance.read"), validate(movementListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await treasury.listMovements(req.query as never))));
financeRouter.get("/movements/:id", requirePermission("finance.read"), asyncHandler(async (req, res) => res.json(await treasury.getMovement(id(req)))));
financeRouter.post("/movements/:id/approve", requirePermission("finance.post"), asyncHandler(async (req, res) => res.json(await treasury.approveMovement(id(req), await actorOf(req)))));
financeRouter.post("/movements/:id/reject", requirePermission("finance.post"), validate(movementRejectSchema), asyncHandler(async (req, res) => res.json(await treasury.rejectMovement(id(req), req.body.reason, await actorOf(req)))));
financeRouter.post("/movements/:id/reverse", requirePermission("finance.reverse"), validate(movementReverseSchema), asyncHandler(async (req, res) => {
  const result = await treasury.reverseMovement(id(req), req.body, await actorOf(req));
  res.status(result.replayed ? 200 : 201).json(result);
}));

// ── Phase 2: statement lines & matching ─────────────────────────────────────────────────────────────────────────────
financeRouter.get("/bank-transactions", requirePermission("finance.read"), validate(bankTransactionListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await bank.listBankTransactions(req.query as never))));
financeRouter.get("/bank-transactions/:id", requirePermission("finance.read"), asyncHandler(async (req, res) => res.json(await bank.getBankTransaction(id(req)))));
financeRouter.get("/bank-transactions/:id/candidates", requirePermission("finance.read"), asyncHandler(async (req, res) => res.json({ candidates: await bank.matchCandidates(id(req)) })));
financeRouter.post("/bank-transactions", requirePermission("finance.transact"), validate(bankTransactionCreateSchema), asyncHandler(async (req, res) => {
  const result = await bank.createBankTransaction(req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(result.replayed ? 200 : 201).json(result);
}));
financeRouter.delete("/bank-transactions/:id", requirePermission("finance.transact"), asyncHandler(async (req, res) => {
  await bank.deleteBankTransaction(id(req), typeof req.query.reason === "string" ? req.query.reason.slice(0, 500) : null, await actorOf(req));
  res.status(204).end();
}));
financeRouter.post("/bank-transactions/:id/match", requirePermission("finance.reconcile"), validate(bankMatchSchema), asyncHandler(async (req, res) => res.json(await bank.matchBankTransaction(id(req), req.body, await actorOf(req)))));
financeRouter.post("/bank-transactions/:id/flag", requirePermission("finance.reconcile"), validate(bankFlagSchema), asyncHandler(async (req, res) => res.json(await bank.flagBankTransaction(id(req), req.body, await actorOf(req)))));
financeRouter.post("/bank-transactions/:id/adjust", requirePermission("finance.reconcile"), validate(bankAdjustSchema), asyncHandler(async (req, res) => res.json(await bank.adjustBankTransaction(id(req), req.body, await actorOf(req)))));
financeRouter.post("/bank-matches/:id/unmatch", requirePermission("finance.reconcile"), validate(bankUnmatchSchema), asyncHandler(async (req, res) => res.json(await bank.unmatch(id(req), req.body.reason, await actorOf(req)))));

// ── Phase 2: statement import ───────────────────────────────────────────────────────────────────────────────────────
financeRouter.post("/statement-imports/preview", requirePermission("finance.transact"), validate(statementImportSchema), asyncHandler(async (req, res) => res.json(await bank.previewStatementImport(req.body))));
financeRouter.post("/statement-imports", requirePermission("finance.transact"), validate(statementImportSchema), asyncHandler(async (req, res) => {
  const result = await bank.importStatement(req.body, await actorOf(req));
  res.status(result.replayed ? 200 : 201).json(result);
}));
financeRouter.get("/statement-imports", requirePermission("finance.read"), validate(statementImportListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await bank.listStatementImports(req.query as never))));

// ── Phase 2: bank reconciliation ────────────────────────────────────────────────────────────────────────────────────
financeRouter.get("/bank-reconciliations", requirePermission("finance.read"), validate(bankReconciliationListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await bankRecon.listReconciliations(req.query as never))));
financeRouter.get("/bank-reconciliations/:id", requirePermission("finance.read"), asyncHandler(async (req, res) => res.json(await bankRecon.getReconciliation(id(req)))));
financeRouter.post("/bank-reconciliations", requirePermission("finance.reconcile"), validate(bankReconciliationCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await bankRecon.startReconciliation(req.body, await actorOf(req)))));
financeRouter.post("/bank-reconciliations/:id/auto-match", requirePermission("finance.reconcile"), asyncHandler(async (req, res) => res.json(await bankRecon.autoMatch(id(req), await actorOf(req)))));
financeRouter.post("/bank-reconciliations/:id/complete", requirePermission("finance.reconcile"), validate(bankReconciliationCompleteSchema), asyncHandler(async (req, res) => res.json(await bankRecon.completeReconciliation(id(req), req.body, await actorOf(req)))));
financeRouter.post("/bank-reconciliations/:id/abandon", requirePermission("finance.reconcile"), validate(bankReconciliationAbandonSchema), asyncHandler(async (req, res) => res.json(await bankRecon.abandonReconciliation(id(req), req.body.reason, await actorOf(req)))));

// ── Phase 3: commerce accounting (docs/FINANCE_PHASE_3.md §7) ──────────────────────────────────────────────────────
financeRouter.get("/commerce/status", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await commerce.syncStatus())));
financeRouter.post("/commerce/setup", requirePermission("finance.configure"), asyncHandler(async (req, res) => res.json(await ensureCommerceAccounting(await actorOf(req)))));
financeRouter.post("/commerce/sync", requirePermission("finance.reconcile"), validate(commerceSyncSchema), asyncHandler(async (req, res) => res.json(await commerce.syncCommerce({ full: req.body.full, actor: await actorOf(req) }))));
financeRouter.get("/commerce/orders/:id", requirePermission("finance.read"), asyncHandler(async (req, res) => res.json(await commerce.orderAccounting(id(req)))));
financeRouter.post("/commerce/orders/:id/sync", requirePermission("finance.reconcile"), asyncHandler(async (req, res) => res.json(await commerce.projectOrder(id(req)))));
financeRouter.put("/business/cost-policy", requirePermission("finance.configure"), validate(financeCostPolicySchema), asyncHandler(async (req, res) => res.json(await chart.setCostPolicy(req.body, await actorOf(req)))));

financeRouter.get("/exceptions", requirePermission("finance.read"), validate(financeExceptionQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await exceptions.listExceptions(req.query as never))));
financeRouter.post("/exceptions/:id/acknowledge", requirePermission("finance.reconcile"), validate(exceptionAcknowledgeSchema), asyncHandler(async (req, res) => res.json(await exceptions.acknowledgeException(id(req), req.body.note, await actorOf(req)))));
financeRouter.post("/exceptions/:id/approve-estimate", requirePermission("finance.post"), validate(exceptionEstimateSchema), asyncHandler(async (req, res) => res.json(await commerce.approveCostEstimate(id(req), req.body.unitCost, req.body.note, await actorOf(req)))));

financeRouter.get("/settlements", requirePermission("finance.read"), validate(settlementListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await settlements.listSettlements(req.query as never))));
financeRouter.get("/settlements/:id", requirePermission("finance.read"), asyncHandler(async (req, res) => res.json(await settlements.getSettlement(id(req)))));
financeRouter.post("/settlements", requirePermission("finance.transact"), validate(settlementCreateSchema), asyncHandler(async (req, res) => {
  const result = await settlements.createSettlement(req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(result.replayed ? 200 : 201).json(result);
}));
financeRouter.post("/settlements/import", requirePermission("finance.transact"), validate(settlementImportSchema), asyncHandler(async (req, res) => {
  const result = await settlements.importSettlementCsv(req.body, await actorOf(req));
  res.status(result.replayed ? 200 : 201).json(result);
}));
financeRouter.post("/settlements/:id/post", requirePermission("finance.post"), asyncHandler(async (req, res) => res.json(await settlements.postSettlement(id(req), await actorOf(req)))));
financeRouter.post("/settlements/:id/reverse", requirePermission("finance.reverse"), validate(settlementReverseSchema), asyncHandler(async (req, res) => res.json(await settlements.reverseSettlement(id(req), req.body.reason, await actorOf(req)))));
financeRouter.delete("/settlements/:id", requirePermission("finance.transact"), asyncHandler(async (req, res) => {
  await settlements.deleteDraftSettlement(id(req), await actorOf(req));
  res.status(204).end();
}));
financeRouter.get("/clearing/:id", requirePermission("finance.read"), asyncHandler(async (req, res) => res.json(await settlements.clearingPosition(id(req)))));

// ── Phase 4C: the valuation cutover (docs/FINANCE_PHASE_4C.md) — reading needs costing.read; every change, costing.adjust (OWNER) ──
financeRouter.get("/inventory-cutover", requirePermission("costing.read"), asyncHandler(async (_req, res) => res.json(await cutover.getCutover())));
financeRouter.get("/inventory-cutover/lines", requirePermission("costing.read"), validate(cutoverLineQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await cutover.listCutoverLines(req.query as never))));
financeRouter.post("/inventory-cutover", requirePermission("costing.adjust"), validate(cutoverDraftSchema), asyncHandler(async (req, res) => res.json(await cutover.draftCutover(req.body, await actorOf(req)))));
financeRouter.patch("/inventory-cutover", requirePermission("costing.adjust"), validate(cutoverSettingsSchema), asyncHandler(async (req, res) => res.json(await cutover.updateCutoverSettings(req.body, await actorOf(req)))));
financeRouter.patch("/inventory-cutover/lines", requirePermission("costing.adjust"), validate(cutoverLinesSchema), asyncHandler(async (req, res) => res.json(await cutover.updateCutoverLines(req.body.lines, await actorOf(req)))));
financeRouter.post("/inventory-cutover/approve", requirePermission("costing.adjust"), validate(cutoverApproveSchema), asyncHandler(async (req, res) => res.json(await cutover.approveCutover(req.body, await actorOf(req)))));
financeRouter.post("/inventory-cutover/reopen", requirePermission("costing.adjust"), validate(cutoverReopenSchema), asyncHandler(async (req, res) => res.json(await cutover.reopenCutover(req.body, await actorOf(req)))));
financeRouter.post("/inventory-cutover/post", requirePermission("costing.adjust"), asyncHandler(async (req, res) => res.json(await cutover.postCutover(await actorOf(req)))));
