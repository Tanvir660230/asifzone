import { Router } from "express";
import {
  checkoutSchema,
  adminCreateOrderSchema,
  orderListQuerySchema,
  updateOrderStatusSchema,
  updateOrderDetailsSchema,
  holdOrderSchema,
  trackOrderSchema,
  bulkOrderIdsSchema,
  bulkOrderStatusSchema,
  bulkCourierBookSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requireRole } from "../../middlewares/require-admin";
import { attachCustomerIfPresent } from "../../middlewares/require-customer";
import { orderCreateRateLimit, orderTrackRateLimit } from "../../middlewares/rate-limit";
import * as orderController from "./order.controller";

export const orderRouter = Router();

orderRouter.post(
  "/",
  orderCreateRateLimit,
  attachCustomerIfPresent,
  validate(checkoutSchema),
  orderController.create,
);
orderRouter.post("/track", orderTrackRateLimit, validate(trackOrderSchema), orderController.track);

orderRouter.get("/", requireAdmin, validate(orderListQuerySchema, "query"), orderController.list);
orderRouter.post("/admin", requireAdmin, validate(adminCreateOrderSchema), orderController.createManual);
// Must come before "/:id" — otherwise Express would match "stats"/"export" as an :id param.
orderRouter.get("/stats", requireAdmin, orderController.stats);
orderRouter.get("/export/csv", requireAdmin, validate(orderListQuerySchema, "query"), orderController.exportCsv);
orderRouter.post("/bulk/status", requireAdmin, validate(bulkOrderStatusSchema), orderController.bulkStatus);
orderRouter.post("/bulk/delete", requireAdmin, requireRole("OWNER"), validate(bulkOrderIdsSchema), orderController.bulkDelete);
orderRouter.post(
  "/bulk/permanent",
  requireAdmin,
  requireRole("OWNER"),
  validate(bulkOrderIdsSchema),
  orderController.bulkPermanentDelete,
);
orderRouter.post(
  "/bulk/courier/book",
  requireAdmin,
  validate(bulkCourierBookSchema),
  orderController.bulkBookCourier,
);
orderRouter.post("/bulk/get", requireAdmin, validate(bulkOrderIdsSchema), orderController.bulkGet);
orderRouter.get("/:id", requireAdmin, orderController.getOne);
orderRouter.patch("/:id/status", requireAdmin, validate(updateOrderStatusSchema), orderController.updateStatus);
orderRouter.patch("/:id/details", requireAdmin, validate(updateOrderDetailsSchema), orderController.updateDetails);
orderRouter.post("/:id/hold", requireAdmin, validate(holdOrderSchema), orderController.hold);
orderRouter.post("/:id/hold/clear", requireAdmin, orderController.clearHold);
orderRouter.post("/:id/courier/book", requireAdmin, orderController.bookCourier);
orderRouter.post("/:id/courier/refresh", requireAdmin, orderController.refreshCourier);
orderRouter.post("/:id/courier/unlink", requireAdmin, orderController.unlinkCourier);
orderRouter.delete("/:id", requireAdmin, requireRole("OWNER"), orderController.remove);
orderRouter.post("/:id/restore", requireAdmin, requireRole("OWNER"), orderController.restore);
orderRouter.delete("/:id/permanent", requireAdmin, requireRole("OWNER"), orderController.permanentlyRemove);
