import { Router } from "express";
import { createFlashSaleSchema, updateFlashSaleSchema, addFlashSaleItemSchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin } from "../../middlewares/require-admin";
import * as flashSaleController from "./flash-sale.controller";

export const flashSaleRouter = Router();

flashSaleRouter.get("/active", flashSaleController.active);

flashSaleRouter.get("/", requireAdmin, flashSaleController.list);
flashSaleRouter.get("/:id", requireAdmin, flashSaleController.getOne);
flashSaleRouter.post("/", requireAdmin, validate(createFlashSaleSchema), flashSaleController.create);
flashSaleRouter.patch("/:id", requireAdmin, validate(updateFlashSaleSchema), flashSaleController.update);
flashSaleRouter.delete("/:id", requireAdmin, flashSaleController.remove);

flashSaleRouter.post(
  "/:id/items",
  requireAdmin,
  validate(addFlashSaleItemSchema),
  flashSaleController.addItem,
);
flashSaleRouter.delete("/:id/items/:itemId", requireAdmin, flashSaleController.removeItem);
