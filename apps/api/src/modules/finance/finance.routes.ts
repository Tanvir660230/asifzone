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

// ── financial events ────────────────────────────────────────────────────────────────────────────────────────────────
financeRouter.get("/events", requirePermission("finance.read"), validate(financialEventListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await events.listFinancialEvents(req.query as never))));
financeRouter.post("/events/:id/retry", requirePermission("finance.reconcile"), asyncHandler(async (req, res) => res.json(await events.retryFinancialEvent(id(req)))));

// ── opening balances ────────────────────────────────────────────────────────────────────────────────────────────────
financeRouter.get("/opening-balances", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await opening.getOpeningBalances())));
financeRouter.put("/opening-balances/lines", requirePermission("finance.transact"), validate(openingBalanceLinesSchema), asyncHandler(async (req, res) => res.json(await opening.saveOpeningLines(req.body, await actorOf(req)))));
financeRouter.put("/opening-balances/inventory", requirePermission("finance.transact"), validate(openingInventoryItemsSchema), asyncHandler(async (req, res) => res.json(await opening.saveOpeningInventory(req.body.items, await actorOf(req)))));
financeRouter.post("/opening-balances/inventory/prefill", requirePermission("finance.transact"), asyncHandler(async (req, res) => res.json(await opening.prefillOpeningInventory(await actorOf(req)))));
financeRouter.post("/opening-balances/post", requirePermission("finance.post"), asyncHandler(async (req, res) => res.json(await opening.postOpeningBalances(await actorOf(req)))));

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
financeRouter.post("/movements/withdrawal", requirePermission("finance.transact"), validate(withdrawalSchema), movement("WITHDRAWAL", (b) => ({ fromFinancialAccountId: b.fromFinancialAccountId as string, counterAccountId: b.counterAccountId as string })));
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
