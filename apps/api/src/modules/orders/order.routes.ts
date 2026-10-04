import { Router } from "express";
import {
  checkoutSchema,
  adminCreateOrderSchema,
  orderListQuerySchema,
  updateOrderStatusSchema,
  updateOrderDetailsSchema,
  holdOrderSchema,
  adjustOrderPriceSchema,
  reconcilePartialDeliverySchema,
  trackOrderSchema,
  retryPaymentSchema,
  recordRefundSchema,
  completeRefundSchema,
  recordPaymentSchema,
  bulkOrderIdsSchema,
  bulkOrderStatusSchema,
  bulkCourierBookSchema,
  bulkDeliveryScoreCheckSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { attachCustomerIfPresent } from "../../middlewares/require-customer";
import { orderCreateRateLimit, orderTrackRateLimit, retryPaymentRateLimit } from "../../middlewares/rate-limit";
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
orderRouter.post(
  "/:orderNumber/retry-payment",
  retryPaymentRateLimit,
  validate(retryPaymentSchema),
  orderController.retryPayment,
);

orderRouter.get("/", requireAdmin, requirePermission("orders.read"), validate(orderListQuerySchema, "query"), orderController.list);
orderRouter.post("/admin", requireAdmin, requirePermission("orders.manage"), validate(adminCreateOrderSchema), orderController.createManual);
// Must come before "/:id" — otherwise Express would match "stats"/"export" as an :id param.
orderRouter.get("/stats", requireAdmin, requirePermission("orders.read"), orderController.stats);
orderRouter.get("/export/csv", requireAdmin, requirePermission("orders.export"), validate(orderListQuerySchema, "query"), orderController.exportCsv);
orderRouter.post("/bulk/status", requireAdmin, requirePermission("orders.manage"), validate(bulkOrderStatusSchema), orderController.bulkStatus);
orderRouter.post("/bulk/delete", requireAdmin, requirePermission("orders.delete"), validate(bulkOrderIdsSchema), orderController.bulkDelete);
orderRouter.post(
  "/bulk/permanent",
  requireAdmin,
  requirePermission("orders.delete"),
  validate(bulkOrderIdsSchema),
  orderController.bulkPermanentDelete,
);
orderRouter.post(
  "/bulk/courier/book",
  requireAdmin,
  requirePermission("courier.manage"),
  validate(bulkCourierBookSchema),
  orderController.bulkBookCourier,
);
orderRouter.post(
  "/bulk/courier/sync",
  requireAdmin,
  requirePermission("courier.manage"),
  validate(bulkOrderIdsSchema),
  orderController.bulkSyncCourier,
);
orderRouter.post(
  "/bulk/delivery-score",
  requireAdmin,
  requirePermission("orders.manage"),
  validate(bulkDeliveryScoreCheckSchema),
  orderController.bulkCheckDeliveryScore,
);
orderRouter.post("/bulk/get", requireAdmin, requirePermission("orders.read"), validate(bulkOrderIdsSchema), orderController.bulkGet);
orderRouter.get("/:id", requireAdmin, requirePermission("orders.read"), orderController.getOne);
orderRouter.patch("/:id/status", requireAdmin, requirePermission("orders.manage"), validate(updateOrderStatusSchema), orderController.updateStatus);
orderRouter.patch("/:id/details", requireAdmin, requirePermission("orders.manage"), validate(updateOrderDetailsSchema), orderController.updateDetails);
orderRouter.post("/:id/hold", requireAdmin, requirePermission("orders.manage"), validate(holdOrderSchema), orderController.hold);
orderRouter.post("/:id/hold/clear", requireAdmin, requirePermission("orders.manage"), orderController.clearHold);
orderRouter.patch("/:id/price", requireAdmin, requirePermission("orders.adjust_price"), validate(adjustOrderPriceSchema), orderController.adjustPrice);
orderRouter.patch(
  "/:id/reconcile-partial-delivery",
  requireAdmin,
  requirePermission("orders.manage"),
  validate(reconcilePartialDeliverySchema),
  orderController.reconcilePartialDelivery,
);
orderRouter.post("/:id/refunds", requireAdmin, requirePermission("refunds.manage"), validate(recordRefundSchema), orderController.createRefund);
orderRouter.get("/:id/refunds", requireAdmin, requirePermission("orders.read"), orderController.listRefunds);
orderRouter.post("/:id/refunds/:refundId/complete", requireAdmin, requirePermission("refunds.manage"), validate(completeRefundSchema), orderController.completeRefundRequest);
// Payment ledger (docs/PAYMENT_LEDGER.md §8): the order's payment position, and payments staff record by hand.
orderRouter.get("/:id/payment", requireAdmin, requirePermission("orders.read"), orderController.getPayment);
orderRouter.post("/:id/payments", requireAdmin, requirePermission("payments.record"), validate(recordPaymentSchema), orderController.recordPayment);
orderRouter.post("/:id/courier/book", requireAdmin, requirePermission("courier.manage"), orderController.bookCourier);
orderRouter.post("/:id/courier/refresh", requireAdmin, requirePermission("courier.manage"), orderController.refreshCourier);
orderRouter.post("/:id/courier/unlink", requireAdmin, requirePermission("courier.manage"), orderController.unlinkCourier);
orderRouter.delete("/:id", requireAdmin, requirePermission("orders.delete"), orderController.remove);
orderRouter.post("/:id/restore", requireAdmin, requirePermission("orders.delete"), orderController.restore);
orderRouter.delete("/:id/permanent", requireAdmin, requirePermission("orders.delete"), orderController.permanentlyRemove);
