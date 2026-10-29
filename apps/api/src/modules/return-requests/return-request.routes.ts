import { Router } from "express";
import { createReturnRequestSchema, reviewReturnRequestSchema, returnRequestListQuerySchema, withdrawReturnRequestSchema, writeOffUnreturnedSchema } from "@clothing-brand/shared";
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
// Blueprint P0.4: a return withdrawn before anything came back (S8); units agreed back that never arrived, written off (S7 —
// over the count-loss limit only with inventory.approve, checked in the service).
returnRequestRouter.post("/:id/withdraw", requireAdmin, requirePermission("returns.manage"), validate(withdrawReturnRequestSchema), returnRequestController.withdraw);
returnRequestRouter.post("/expectations/:id/write-off", requireAdmin, requirePermission("returns.manage"), validate(writeOffUnreturnedSchema), returnRequestController.writeOffUnreturned);
returnRequestRouter.patch(
  "/:id",
  requireAdmin,
  requirePermission("returns.manage"),
  validate(reviewReturnRequestSchema),
  returnRequestController.review,
);
