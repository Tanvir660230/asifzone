import { Router } from "express";
import { createFlashSaleSchema, updateFlashSaleSchema, addFlashSaleItemSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import * as flashSaleController from "./flash-sale.controller";

export const flashSaleRouter = Router();

flashSaleRouter.get("/active", flashSaleController.active);

flashSaleRouter.get("/", requireAdmin, requirePermission("promotions.manage"), flashSaleController.list);
flashSaleRouter.get("/:id", requireAdmin, requirePermission("promotions.manage"), flashSaleController.getOne);
flashSaleRouter.post("/", requireAdmin, requirePermission("promotions.manage"), validate(createFlashSaleSchema), flashSaleController.create);
flashSaleRouter.patch("/:id", requireAdmin, requirePermission("promotions.manage"), validate(updateFlashSaleSchema), flashSaleController.update);
flashSaleRouter.delete("/:id", requireAdmin, requirePermission("promotions.manage"), flashSaleController.remove);

flashSaleRouter.post(
  "/:id/items",
  requireAdmin,
  requirePermission("promotions.manage"),
  validate(addFlashSaleItemSchema),
  flashSaleController.addItem,
);
flashSaleRouter.delete("/:id/items/:itemId", requireAdmin, requirePermission("promotions.manage"), flashSaleController.removeItem);
