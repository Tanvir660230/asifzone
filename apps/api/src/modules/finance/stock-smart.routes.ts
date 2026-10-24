import { Router, type NextFunction, type Request, type Response } from "express";
import { stockApprovalDecisionSchema, stockApprovalsQuerySchema, stockItemSettingsSchema, stockItemsQuerySchema } from "@clothing-brand/shared";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { asyncHandler } from "../../lib/async-handler";
import { validate } from "../../middlewares/validate";
import { setItemSettings } from "../../domain/stock/item-settings.service";
import { listStockItems } from "../../domain/stock/stock-items.service";
import { decideApproval, listApprovals } from "../../domain/stock/count-approval.service";
import { stockToday } from "../../domain/stock/stock-today.service";
import { retryAutoFill } from "../../domain/stock/auto-fill.service";
import { stockActivity } from "../../domain/stock/stock-activity.service";
import { actorOf } from "./finance.routes";

/**
 * The smart stock page's API (docs/STOCK_HUB.md §7), mounted beside the owner's-books router at /api/v1/finance: the stock
 * list, Today, per-item settings and count losses waiting for the owner. Every route states its permission.
 */
export const stockSmartRouter = Router();

stockSmartRouter.use(requireAdmin);
stockSmartRouter.use((_req: Request, res: Response, next: NextFunction) => {
  res.locals.auditHandled = true;
  next();
});

const canSeeCost = (req: Request) => req.admin!.permissions.includes("costing.read");

stockSmartRouter.get("/stock/items", requirePermission("inventory.read"), validate(stockItemsQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await listStockItems(req.query as never, { canSeeCost: canSeeCost(req) }))));
stockSmartRouter.put("/stock/items/:id/settings", requirePermission("inventory.adjust"), validate(stockItemSettingsSchema), asyncHandler(async (req, res) => res.json(await setItemSettings(req.params.id!, req.body, await actorOf(req)))));
stockSmartRouter.get("/stock/approvals", requirePermission("inventory.read"), validate(stockApprovalsQuerySchema, "query"), asyncHandler(async (req, res) => res.json(await listApprovals(req.query as never, { canSeeCost: canSeeCost(req) }))));
stockSmartRouter.post("/stock/approvals/:id/decision", requirePermission("inventory.approve"), validate(stockApprovalDecisionSchema), asyncHandler(async (req, res) => res.json(await decideApproval(req.params.id!, req.body, await actorOf(req)))));
stockSmartRouter.get("/stock/today", requirePermission("inventory.read"), asyncHandler(async (req, res) => res.json(await stockToday({ canSeeCost: canSeeCost(req) }))));
stockSmartRouter.post("/stock/auto-fill-failures/:id/retry", requirePermission("manufacturing.approve"), asyncHandler(async (req, res) => res.json(await retryAutoFill(req.params.id!, await actorOf(req)))));
stockSmartRouter.get("/stock/activity", requirePermission("inventory.read"), asyncHandler(async (req, res) => res.json(await stockActivity({ limit: Number(req.query.limit) || undefined }, { canSeeCost: canSeeCost(req) }))));
