import { Router, type NextFunction, type Request, type Response } from "express";
import {
  accountMappingUpdateSchema,
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
  openingBalanceLinesSchema,
  openingInventoryItemsSchema,
  periodActionSchema,
  reconciliationRunSchema,
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
import * as events from "../../domain/finance/events.service";
import * as opening from "../../domain/finance/opening-balances.service";
import * as reconciliation from "../../domain/finance/reconciliation.service";

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
async function actorOf(req: Request): Promise<FinanceActor> {
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
financeRouter.get("/accounts", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json({ accounts: await chart.listAccounts() })));
financeRouter.post("/accounts", requirePermission("finance.configure"), validate(ledgerAccountCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await chart.createAccount(req.body, await actorOf(req)))));
financeRouter.patch("/accounts/:id", requirePermission("finance.configure"), validate(ledgerAccountUpdateSchema), asyncHandler(async (req, res) => res.json(await chart.updateAccount(id(req), req.body, await actorOf(req)))));
financeRouter.get("/accounts/:id/ledger", requirePermission("finance.read"), validate(ledgerRangeQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await ledger.getAccountLedger(id(req), req.query as never))));
financeRouter.get("/mappings", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json({ mappings: await chart.listMappings() })));
financeRouter.put("/mappings/:key", requirePermission("finance.configure"), validate(accountMappingUpdateSchema), asyncHandler(async (req, res) => res.json(await chart.setMapping(req.params.key!, req.body, await actorOf(req)))));

// ── financial accounts (cash, bank, wallets, gateways, couriers) ────────────────────────────────────────────────────
financeRouter.get("/financial-accounts", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json({ financialAccounts: await financialAccounts.listFinancialAccounts() })));
financeRouter.post("/financial-accounts", requirePermission("finance.configure"), validate(financialAccountCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await financialAccounts.createFinancialAccount(req.body, await actorOf(req)))));
financeRouter.patch("/financial-accounts/:id", requirePermission("finance.configure"), validate(financialAccountUpdateSchema), asyncHandler(async (req, res) => res.json(await financialAccounts.updateFinancialAccount(id(req), req.body, await actorOf(req)))));

// ── periods ─────────────────────────────────────────────────────────────────────────────────────────────────────────
financeRouter.get("/periods", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json({ periods: await periods.listPeriods() })));
for (const transition of ["soft-close", "close", "reopen"] as const) {
  financeRouter.post(`/periods/:id/${transition}`, requirePermission("finance.period_close"), validate(periodActionSchema), asyncHandler(async (req, res) => res.json(await periods.changePeriodStatus(id(req), transition, req.body.reason, await actorOf(req)))));
}

// ── journals ────────────────────────────────────────────────────────────────────────────────────────────────────────
financeRouter.get("/journals", requirePermission("finance.read"), validate(journalListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await journals.listJournals(req.query as never))));
financeRouter.get("/journals/:id", requirePermission("finance.read"), asyncHandler(async (req, res) => res.json(await journals.getJournal(id(req)))));
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
financeRouter.get("/trial-balance", requirePermission("finance.read"), validate(ledgerRangeQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await ledger.getTrialBalance(req.query as never))));

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
