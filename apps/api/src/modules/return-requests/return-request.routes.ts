import { Router } from "express";
import { createReturnRequestSchema, reviewReturnRequestSchema, returnRequestListQuerySchema } from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireCustomer } from "../../middlewares/require-customer";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import * as returnRequestController from "./return-request.controller";

export const returnRequestRouter = Router();

returnRequestRouter.post("/", requireCustomer, validate(createReturnRequestSchema), returnRequestController.create);
returnRequestRouter.get(
  "/mine",
  requireCustomer,
  validate(returnRequestListQuerySchema, "query"),
  returnRequestController.listMine,
);

returnRequestRouter.get(
  "/",
  requireAdmin,
  requirePermission("returns.manage"),
  validate(returnRequestListQuerySchema, "query"),
  returnRequestController.list,
);
// Read-only: what approving this exchange would do (same pricing as approval — docs/ORDER_ADJUSTMENTS.md §9).
returnRequestRouter.get("/:id/exchange-preview", requireAdmin, requirePermission("returns.manage"), returnRequestController.exchangePreview);
returnRequestRouter.patch(
  "/:id",
  requireAdmin,
  requirePermission("returns.manage"),
  validate(reviewReturnRequestSchema),
  returnRequestController.review,
);
