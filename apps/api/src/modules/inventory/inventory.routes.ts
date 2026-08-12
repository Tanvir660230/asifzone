import { Router } from "express";
import { adjustStockSchema, stockMovementListQuerySchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import * as inventoryController from "./inventory.controller";

export const inventoryRouter = Router();

inventoryRouter.get(
  "/movements",
  requireAdmin,
  validate(stockMovementListQuerySchema, "query"),
  inventoryController.listMovements,
);
inventoryRouter.post(
  "/variants/:variantId/adjust",
  requireAdmin,
  validate(adjustStockSchema),
  inventoryController.adjust,
);
inventoryRouter.get("/reconciliation", requireAdmin, inventoryController.reconciliation);
