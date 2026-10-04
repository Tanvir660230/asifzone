import { Router } from "express";
import { adjustStockSchema, stockMovementListQuerySchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import * as inventoryController from "./inventory.controller";

export const inventoryRouter = Router();

inventoryRouter.get(
  "/movements",
  requireAdmin,
  requirePermission("inventory.read"),
  validate(stockMovementListQuerySchema, "query"),
  inventoryController.listMovements,
);
inventoryRouter.post(
  "/variants/:variantId/adjust",
  requireAdmin,
  requirePermission("inventory.adjust"),
  validate(adjustStockSchema),
  inventoryController.adjust,
);
inventoryRouter.get("/reconciliation", requireAdmin, requirePermission("inventory.read"), inventoryController.reconciliation);
