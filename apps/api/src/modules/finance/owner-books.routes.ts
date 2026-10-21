import { Router, type NextFunction, type Request, type Response } from "express";
import {
  cashCountCreateSchema,
  cashCountListQuerySchema,
  custodianUpdateSchema,
  custodyExpenseSchema,
  handoverCreateSchema,
  handoverRejectSchema,
  moneyMapQuerySchema,
  ownerPaidExpenseSchema,
  courierPayoutImportSchema,
  courierRateCardSchema,
  courierReconciliationQuerySchema,
  gatewayFeeRateSchema,
  adCampaignCreateSchema,
  adCampaignListQuerySchema,
  adCampaignUpdateSchema,
  adSpendDaySchema,
  adPeriodSpendSchema,
  metaSpendImportSchema,
  prepaidCreateSchema,
  prepaidUpdateSchema,
  packingRuleCreateSchema,
  packingRuleUpdateSchema,
  landedCostCreateSchema,
  quickRefillSchema,
  profitQuerySchema,
  courierClaimCreateSchema,
  courierClaimSettleSchema,
  landedCostCancelSchema,
  adCsvImportSchema,
  verificationSetSchema,
  verificationListQuerySchema,
  expenseAllocationSchema,
  smsBalanceSchema,
  stockCountSchema,
  materialRollOpenSchema,
  materialRollFinishSchema,
  financeCenterSettingsSchema,
  financeAutopilotSchema,
  ownerHomeQuerySchema,
} from "@clothing-brand/shared";
import * as center from "../../domain/finance/finance-center.service";
import * as autopilot from "../../domain/finance/autopilot.service";
import { ownerHome } from "../../domain/finance/owner-home.service";
import * as stockCheck from "../../domain/finance/stock-check.service";
import { prisma } from "../../config/prisma";
import { getFinanceContext } from "../../domain/finance/finance-context";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { validate } from "../../middlewares/validate";
import { asyncHandler } from "../../lib/async-handler";
import { idempotencyKeyOf } from "../orders/order.controller";
import { actorOf } from "./finance.routes";
import type { FinanceViewer } from "../../domain/finance/finance-values";
import * as custody from "../../domain/finance/custody.service";
import * as rateCards from "../../domain/finance/rate-cards.service";
import * as courierPayouts from "../../domain/finance/courier-payouts.service";
import * as ads from "../../domain/finance/ads.service";
import * as prepaid from "../../domain/finance/prepaid.service";
import * as packaging from "../../domain/finance/packaging.service";
import { syncOwnerBooks } from "../../domain/finance/owner-books-sync";
import * as landed from "../../domain/finance/landed-costs.service";
import * as refill from "../../domain/manufacturing/quick-refill.service";
import * as profit from "../../domain/finance/profit.service";
import * as claims from "../../domain/finance/courier-claims.service";
import { markUnmatchedAsOutsideSales } from "../../domain/finance/settlements.service";

/**
 * The owner's-books API (docs/FINANCE_OWNER_BOOKS.md), mounted beside the finance router at /api/v1/finance. Every route
 * states its permission; finance records its own audit trail inside each operation's transaction.
 */
export const ownerBooksRouter = Router();

ownerBooksRouter.use(requireAdmin);
ownerBooksRouter.use((_req: Request, res: Response, next: NextFunction) => {
  res.locals.auditHandled = true;
  next();
});

const id = (req: Request) => req.params.id!;
const viewerOf = (req: Request): FinanceViewer => ({ sensitive: req.admin!.permissions.includes("finance.sensitive") });

// ── who holds the money (§2) ────────────────────────────────────────────────────────────────────────────────────────
ownerBooksRouter.get("/owner-home", requirePermission("finance.read"), validate(ownerHomeQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await ownerHome(req.query as never, viewerOf(req)))));
ownerBooksRouter.get("/money-map", requirePermission("finance.read"), validate(moneyMapQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await custody.moneyMap(req.query as never, viewerOf(req)))));
ownerBooksRouter.put("/financial-accounts/:id/custodian", requirePermission("finance.configure"), validate(custodianUpdateSchema), asyncHandler(async (req, res) => res.json(await custody.setCustodian(id(req), req.body, await actorOf(req)))));
ownerBooksRouter.get("/custody/me", requirePermission("finance.custody"), asyncHandler(async (req, res) => res.json(await custody.myCustody(await actorOf(req)))));
ownerBooksRouter.post("/custody/handovers", requirePermission("finance.custody"), validate(handoverCreateSchema), asyncHandler(async (req, res) => {
  const r = await custody.requestHandover(req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));
ownerBooksRouter.post("/custody/handovers/:id/confirm", requirePermission("finance.custody"), asyncHandler(async (req, res) => res.json(await custody.confirmHandover(id(req), await actorOf(req)))));
ownerBooksRouter.post("/custody/handovers/:id/reject", requirePermission("finance.custody"), validate(handoverRejectSchema), asyncHandler(async (req, res) => res.json(await custody.rejectHandover(id(req), req.body.reason, await actorOf(req)))));
ownerBooksRouter.get("/custody/cash-counts", requirePermission("finance.custody"), validate(cashCountListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await custody.listCashCounts(req.query as never, await actorOf(req)))));
ownerBooksRouter.post("/custody/cash-counts", requirePermission("finance.custody"), validate(cashCountCreateSchema), asyncHandler(async (req, res) => {
  const r = await custody.recordCashCount(req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));
ownerBooksRouter.post("/custody/expenses", requirePermission("finance.custody"), validate(custodyExpenseSchema), asyncHandler(async (req, res) => {
  const r = await custody.custodyExpense(req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));
ownerBooksRouter.post("/expenses/owner-paid", requirePermission("finance.transact"), validate(ownerPaidExpenseSchema), asyncHandler(async (req, res) => {
  const r = await custody.ownerPaidExpense(req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));

// ── courier & gateway charges (§3–§4) ───────────────────────────────────────────────────────────────────────────────
ownerBooksRouter.get("/rate-cards", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await rateCards.listRateCards())));
ownerBooksRouter.put("/rate-cards/courier", requirePermission("finance.configure"), validate(courierRateCardSchema), asyncHandler(async (req, res) => res.json(await rateCards.saveRateCard(req.body, await actorOf(req)))));
ownerBooksRouter.delete("/rate-cards/courier/:id", requirePermission("finance.configure"), asyncHandler(async (req, res) => {
  await rateCards.deleteRateCard(id(req), await actorOf(req));
  res.status(204).end();
}));
ownerBooksRouter.put("/rate-cards/gateway", requirePermission("finance.configure"), validate(gatewayFeeRateSchema), asyncHandler(async (req, res) => res.json(await rateCards.saveGatewayRate(req.body, await actorOf(req)))));
ownerBooksRouter.delete("/rate-cards/gateway/:id", requirePermission("finance.configure"), asyncHandler(async (req, res) => {
  await rateCards.deleteGatewayRate(id(req), await actorOf(req));
  res.status(204).end();
}));
ownerBooksRouter.get("/courier/reconciliation", requirePermission("finance.read"), validate(courierReconciliationQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await courierPayouts.courierReconciliation(req.query as never))));
ownerBooksRouter.post("/courier/payouts/import", requirePermission("finance.transact"), validate(courierPayoutImportSchema), asyncHandler(async (req, res) => res.json(await courierPayouts.importCourierPayouts(req.body, await actorOf(req)))));

// ── advertising (§5) ────────────────────────────────────────────────────────────────────────────────────────────────
ownerBooksRouter.get("/ads/campaigns", requirePermission("finance.read"), validate(adCampaignListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await ads.listCampaigns(req.query as never))));
ownerBooksRouter.post("/ads/campaigns", requirePermission("finance.transact"), validate(adCampaignCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await ads.createCampaign(req.body, await actorOf(req)))));
ownerBooksRouter.patch("/ads/campaigns/:id", requirePermission("finance.transact"), validate(adCampaignUpdateSchema), asyncHandler(async (req, res) => res.json(await ads.updateCampaign(id(req), req.body, await actorOf(req)))));
ownerBooksRouter.put("/ads/campaigns/:id/spend", requirePermission("finance.transact"), validate(adSpendDaySchema), asyncHandler(async (req, res) => {
  await ads.recordDaySpend(id(req), req.body, await actorOf(req));
  res.json({ ok: true });
}));
ownerBooksRouter.put("/ads/campaigns/:id/period-spend", requirePermission("finance.transact"), validate(adPeriodSpendSchema), asyncHandler(async (req, res) => res.json(await ads.recordPeriodSpend(id(req), req.body, await actorOf(req)))));
ownerBooksRouter.post("/ads/import-meta", requirePermission("finance.transact"), validate(metaSpendImportSchema), asyncHandler(async (req, res) => res.json(await ads.importMetaSpend(req.body, await actorOf(req)))));

// ── prepaid costs (§6.1) ────────────────────────────────────────────────────────────────────────────────────────────
ownerBooksRouter.get("/prepaid", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await prepaid.listPrepaid())));
ownerBooksRouter.post("/prepaid", requirePermission("finance.transact"), validate(prepaidCreateSchema), asyncHandler(async (req, res) => {
  const r = await prepaid.createPrepaid(req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));
ownerBooksRouter.patch("/prepaid/:id", requirePermission("finance.transact"), validate(prepaidUpdateSchema), asyncHandler(async (req, res) => res.json(await prepaid.updatePrepaid(id(req), req.body, await actorOf(req)))));

// ── packaging (§6.2) ────────────────────────────────────────────────────────────────────────────────────────────────
ownerBooksRouter.get("/packaging", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await packaging.packagingOverview())));
ownerBooksRouter.post("/packaging/rules", requirePermission("finance.configure"), validate(packingRuleCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await packaging.createPackingRule(req.body, await actorOf(req)))));
ownerBooksRouter.patch("/packaging/rules/:id", requirePermission("finance.configure"), validate(packingRuleUpdateSchema), asyncHandler(async (req, res) => res.json(await packaging.setPackingRuleActive(id(req), req.body.isActive, await actorOf(req)))));

// ── everything that books itself, now (the finance sync cron runs it every 5 minutes) ──────────────────────────────
ownerBooksRouter.post("/owner-books/sync", requirePermission("finance.reconcile"), asyncHandler(async (_req, res) => res.json(await syncOwnerBooks())));

// ── landed costs (§7.1) and quick refills (§7.2) ────────────────────────────────────────────────────────────────────
ownerBooksRouter.get("/landed-costs", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await landed.listLandedCosts())));
ownerBooksRouter.get("/landed-costs/receipts", requirePermission("purchasing.read"), asyncHandler(async (_req, res) => res.json(await landed.receiptsForLandedCost())));
ownerBooksRouter.post("/landed-costs", requirePermission("finance.transact"), validate(landedCostCreateSchema), asyncHandler(async (req, res) => {
  const r = await landed.createLandedCost(req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));
ownerBooksRouter.get("/quick-refills", requirePermission("manufacturing.read"), asyncHandler(async (_req, res) => res.json(await refill.listQuickRefills())));
ownerBooksRouter.post("/quick-refills", requirePermission("manufacturing.approve"), validate(quickRefillSchema), asyncHandler(async (req, res) => {
  const r = await refill.quickRefill(req.body, await actorOf(req), idempotencyKeyOf(req));
  res.status(r.replayed ? 200 : 201).json(r);
}));

// ── profit (§8) and the launch weeks before the books (§9) ──────────────────────────────────────────────────────────
ownerBooksRouter.get("/profit", requirePermission("finance.read"), validate(profitQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await profit.profitReport(req.query as never, viewerOf(req)))));
ownerBooksRouter.get("/profit/launch", requirePermission("finance.read"), validate(profitQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await profit.launchReport(req.query as never))));

// ── courier claims for lost parcels (§3.5); cancelling a landed cost (§7.1) ─────────────────────────────────────────
ownerBooksRouter.get("/courier/claims", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await claims.listClaims())));
ownerBooksRouter.post("/courier/claims", requirePermission("finance.transact"), validate(courierClaimCreateSchema), asyncHandler(async (req, res) => res.status(201).json(await claims.openClaim(req.body, await actorOf(req)))));
ownerBooksRouter.post("/courier/claims/:id/settle", requirePermission("finance.transact"), validate(courierClaimSettleSchema), asyncHandler(async (req, res) => res.json(await claims.settleClaim(id(req), req.body, await actorOf(req), idempotencyKeyOf(req)))));
ownerBooksRouter.post("/landed-costs/:id/cancel", requirePermission("finance.post"), validate(landedCostCancelSchema), asyncHandler(async (req, res) => res.json(await landed.cancelLandedCost(id(req), req.body.reason, await actorOf(req)))));
ownerBooksRouter.post("/settlements/:id/outside-sales", requirePermission("finance.transact"), asyncHandler(async (req, res) => res.json(await markUnmatchedAsOutsideSales(id(req), await actorOf(req)))));

// ── Finance Center (docs/FINANCE_CENTER.md) ───────────────────────────────────────────────────────────────────────────
ownerBooksRouter.post("/ads/import-csv", requirePermission("finance.transact"), validate(adCsvImportSchema), asyncHandler(async (req, res) => res.json(await ads.importAdCsv(req.body, await actorOf(req)))));
ownerBooksRouter.get("/center/summary", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await center.financeCenterSummary())));
ownerBooksRouter.get("/center/verifications", requirePermission("finance.read"), validate(verificationListQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await center.listVerifications(req.query as never))));
ownerBooksRouter.put("/center/verifications", requirePermission("finance.post"), validate(verificationSetSchema), asyncHandler(async (req, res) => res.json(await center.setVerification(req.body, await actorOf(req)))));
ownerBooksRouter.get("/center/allocations", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await center.listAwaitingAllocation())));
ownerBooksRouter.put("/center/allocations/:id", requirePermission("finance.post"), validate(expenseAllocationSchema), asyncHandler(async (req, res) => res.json(await center.setExpenseAllocations(id(req), req.body.lines, await actorOf(req)))));
ownerBooksRouter.get("/center/renewals", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json({ renewals: await center.listRenewals() })));
ownerBooksRouter.get("/center/sms", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await center.smsStatus())));
ownerBooksRouter.post("/center/sms/balance", requirePermission("finance.transact"), validate(smsBalanceSchema), asyncHandler(async (req, res) => res.status(201).json({ id: await center.recordSmsBalance(req.body, await actorOf(req)) })));
ownerBooksRouter.get("/center/settings", requirePermission("finance.read"), asyncHandler(async (_req, res) => {
  const { business } = await getFinanceContext();
  const s = await prisma.financeBusiness.findUniqueOrThrow({ where: { id: business.id }, select: { defaultUsdRate: true, smsWarnAt: true } });
  res.json({ defaultUsdRate: s.defaultUsdRate ? Number(s.defaultUsdRate) : null, smsLowBalance: s.smsWarnAt ? Number(s.smsWarnAt) : null });
}));
ownerBooksRouter.patch("/center/settings", requirePermission("finance.configure"), validate(financeCenterSettingsSchema), asyncHandler(async (req, res) => res.json(await center.updateFinanceCenterSettings(req.body, await actorOf(req)))));

// ── autopilot (§15): payouts, owner drawings, Meta spend and profit shares, every morning and evening ──────────────────
ownerBooksRouter.get("/center/autopilot", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await autopilot.getAutopilotSettings())));
ownerBooksRouter.patch("/center/autopilot", requirePermission("finance.sensitive"), validate(financeAutopilotSchema), asyncHandler(async (req, res) => res.json(await autopilot.updateAutopilotSettings(req.body, await actorOf(req)))));
ownerBooksRouter.post("/center/autopilot/run", requirePermission("finance.sensitive"), asyncHandler(async (req, res) => res.json(await autopilot.runAutopilot(await actorOf(req)))));

// ── Stock check: counts and rolls (docs/FINANCE_CENTER.md §7) ─────────────────────────────────────────────────────────
ownerBooksRouter.get("/center/stock-check", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await stockCheck.stockCheck())));
ownerBooksRouter.post("/center/stock-counts", requirePermission("finance.transact"), validate(stockCountSchema), asyncHandler(async (req, res) => res.status(201).json(await stockCheck.recordStockCount(req.body, await actorOf(req)))));
ownerBooksRouter.get("/center/rolls", requirePermission("finance.read"), asyncHandler(async (_req, res) => res.json(await stockCheck.listRolls())));
ownerBooksRouter.post("/center/rolls", requirePermission("finance.transact"), validate(materialRollOpenSchema), asyncHandler(async (req, res) => res.status(201).json(await stockCheck.openRoll(req.body, await actorOf(req)))));
ownerBooksRouter.post("/center/rolls/:id/finish", requirePermission("finance.transact"), validate(materialRollFinishSchema), asyncHandler(async (req, res) => res.json(await stockCheck.finishRoll(id(req), req.body, await actorOf(req)))));
