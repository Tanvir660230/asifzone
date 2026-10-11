import { Router } from "express";
import { adjustStockSchema, stockLevelsQuerySchema, stockMovementListQuerySchema } from "@clothing-brand/shared";
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
inventoryRouter.get(
  "/levels",
  requireAdmin,
  requirePermission("inventory.read"),
  validate(stockLevelsQuerySchema, "query"),
  inventoryController.levels,
);
inventoryRouter.get("/reconciliation", requireAdmin, requirePermission("inventory.read"), inventoryController.reconciliation);
