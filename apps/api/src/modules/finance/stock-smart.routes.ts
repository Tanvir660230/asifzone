import { Router, type NextFunction, type Request, type Response } from "express";
import { stockItemSettingsSchema, stockItemsQuerySchema } from "@clothing-brand/shared";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { asyncHandler } from "../../lib/async-handler";
import { validate } from "../../middlewares/validate";
import { setItemSettings } from "../../domain/stock/item-settings.service";
import { listStockItems } from "../../domain/stock/stock-items.service";
import { actorOf } from "./finance.routes";

/**
 * The smart stock page's API (docs/STOCK_HUB.md §7), mounted beside the owner's-books router at /api/v1/finance: the stock
 * list and per-item settings. Every route states its permission.
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
