import { Router } from "express";
import * as orderHoldController from "./order-hold.controller";
import {
  packScanSchema,
  checkoutSchema,
  adminCreateOrderSchema,
  orderListQuerySchema,
  updateOrderStatusSchema,
  updateOrderDetailsSchema,
  holdOrderSchema,
  placeOrderHoldSchema,
  adjustOrderPriceSchema,
  reconcilePartialDeliverySchema,
  doorShortfallSchema,
  trackOrderSchema,
  retryPaymentSchema,
  recordRefundSchema,
  completeRefundSchema,
  recordPaymentSchema,
  reclassifyPaymentSchema,
  voidPaymentSchema,
  bulkOrderIdsSchema,
  confirmationDecisionSchema,
  recordConfirmationAttemptSchema,
  bulkOrderStatusSchema,
  bulkCourierBookSchema,
  bulkDeliveryScoreCheckSchema,
  bulkCourierExternalSchema,
  orderModificationSchema,
  recordItemReturnSchema,
  itemReturnPreviewSchema,
  issueStoreCreditSchema,
  createPaymentLinkSchema,
  sendPaymentLinkSchema,
  receiveReturnedParcelSchema,
  linkCourierConsignmentSchema,
} from "@clothing-brand/shared";
import { validate } from "../../middlewares/validate";
import { createDoorSwapSchema, createOrderIssueSchema } from "@clothing-brand/shared";
import * as doorSwap from "../return-requests/door-swap.controller";
import { requireAdmin, requirePermission } from "../../middlewares/require-admin";
import { attachCustomerIfPresent } from "../../middlewares/require-customer";
import { orderCreateRateLimit, orderTrackRateLimit, retryPaymentRateLimit } from "../../middlewares/rate-limit";
import * as orderController from "./order.controller";
import { packByScan } from "./pack-scan.service";
import { setCourierExternal } from "../courier/courier.service";
import { asyncHandler } from "../../lib/async-handler";
import * as confirmationController from "./confirmation.controller";
import * as adjustments from "./order-adjustments.controller";

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
// Exception Center (docs/WAREHOUSE_OPERATIONS.md §5): read-only counts of parcels whose facts disagree or waited too long.
orderRouter.get("/exceptions", requireAdmin, requirePermission("orders.read"), orderController.exceptions);
// Customer confirmation (Order Operations phase 3): claim the next order to call — before "/:id" like the others.
orderRouter.post("/confirmation/next", requireAdmin, requirePermission("orders.manage"), confirmationController.next);
// Blueprint P1.5: parcels cancelled after shipping that haven't come back yet (receive them with POST /:id/receive-return)
orderRouter.get("/export/csv", requireAdmin, requirePermission("orders.export"), validate(orderListQuerySchema, "query"), orderController.exportCsv);
orderRouter.post("/bulk/status", requireAdmin, requirePermission("orders.manage"), validate(bulkOrderStatusSchema), orderController.bulkStatus);
// Pack scan: a label scanned at the packing table marks its confirmed / processing order Packed (pack-scan.service.ts).
orderRouter.post(
  "/pack-scan", requireAdmin, requirePermission("orders.manage"), validate(packScanSchema),
  asyncHandler(async (req, res) => {
    res.json(await packByScan(req.body.code, req.admin!.adminId));
  }),
);
orderRouter.post("/bulk/delete", requireAdmin, requirePermission("orders.delete"), validate(bulkOrderIdsSchema), orderController.bulkDelete);
orderRouter.post("/bulk/restore", requireAdmin, requirePermission("orders.delete"), validate(bulkOrderIdsSchema), orderController.bulkRestore);
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
// Parcels booked on a courier account this store can't read: stop checking them (or start again).
orderRouter.post(
  "/bulk/courier/external",
  requireAdmin,
  requirePermission("courier.manage"),
  validate(bulkCourierExternalSchema),
  asyncHandler(async (req, res) => {
    res.json(await setCourierExternal(req.body.ids, req.body.external, req.admin!.adminId, req.ip));
  }),
);
orderRouter.post(
  "/bulk/delivery-score",
  requireAdmin,
  requirePermission("orders.manage"),
  validate(bulkDeliveryScoreCheckSchema),
  orderController.bulkCheckDeliveryScore,
);
orderRouter.post("/bulk/get", requireAdmin, requirePermission("orders.read"), validate(bulkOrderIdsSchema), orderController.bulkGet);
// Collected less (docs/PAYMENT_LEDGER.md §5d): delivered parcels whose courier collected less than the order says.
orderRouter.get("/door-shortfalls", requireAdmin, requirePermission("orders.read"), orderController.doorShortfalls);
orderRouter.get("/:id", requireAdmin, requirePermission("orders.read"), orderController.getOne);
orderRouter.patch("/:id/status", requireAdmin, requirePermission("orders.manage"), validate(updateOrderStatusSchema), orderController.updateStatus);
orderRouter.get("/:id/courier-note", requireAdmin, requirePermission("orders.read"), orderController.getCourierNote);
orderRouter.patch("/:id/details", requireAdmin, requirePermission("orders.manage"), validate(updateOrderDetailsSchema), orderController.updateDetails);
orderRouter.post("/:id/courier-update-done", requireAdmin, requirePermission("orders.manage"), orderController.courierUpdateDone);
orderRouter.post("/:id/hold", requireAdmin, requirePermission("orders.manage"), validate(holdOrderSchema), orderController.hold);
orderRouter.post("/:id/hold/clear", requireAdmin, requirePermission("orders.manage"), orderController.clearHold);
// Order hold (docs/ORDER_HOLD.md): the customer asked us to wait. A hold past the two-hold limit: orders.escalations (service).
orderRouter.post("/:id/order-hold", requireAdmin, requirePermission("orders.manage"), validate(placeOrderHoldSchema), orderHoldController.place);
orderRouter.post("/:id/order-hold/end", requireAdmin, requirePermission("orders.manage"), orderHoldController.end);
orderRouter.get("/:id/confirmation", requireAdmin, requirePermission("orders.read"), confirmationController.state);
orderRouter.post("/:id/confirmation-attempts", requireAdmin, requirePermission("orders.manage"), validate(recordConfirmationAttemptSchema), confirmationController.recordAttempt);
orderRouter.post("/:id/confirmation/release", requireAdmin, requirePermission("orders.manage"), confirmationController.release);
// assign: orders.manage; one more try / phone fixed on an escalated order: orders.escalations, checked in the service.
orderRouter.patch("/:id/confirmation", requireAdmin, requirePermission("orders.manage"), validate(confirmationDecisionSchema), confirmationController.decide);
orderRouter.patch("/:id/price", requireAdmin, requirePermission("orders.adjust_price"), validate(adjustOrderPriceSchema), orderController.adjustPrice);
orderRouter.patch(
  "/:id/reconcile-partial-delivery",
  requireAdmin,
  requirePermission("orders.manage"),
  validate(reconcilePartialDeliverySchema),
  orderController.reconcilePartialDelivery,
);
// It changes the order's total and its payments: the service also requires payments.record.
orderRouter.post("/:id/door-shortfall", requireAdmin, requirePermission("orders.adjust_price"), validate(doorShortfallSchema), orderController.decideDoorShortfall);
orderRouter.get("/:id/fill-status", requireAdmin, requirePermission("orders.read"), orderController.fillStatus);
// Receiving a parcel back is the inspection that makes returned or refused units stock again (owner decision D-OO1) — the
// returns permission, not the general order one (least privilege: a role that edits orders need not restock goods).
orderRouter.post("/:id/receive-return", requireAdmin, requirePermission("returns.manage"), validate(receiveReturnedParcelSchema), orderController.receiveReturnedParcel);
orderRouter.post("/:id/refunds", requireAdmin, requirePermission("refunds.manage"), validate(recordRefundSchema), orderController.createRefund);
orderRouter.get("/:id/refunds", requireAdmin, requirePermission("orders.read"), orderController.listRefunds);
orderRouter.post("/:id/refunds/:refundId/complete", requireAdmin, requirePermission("refunds.manage"), validate(completeRefundSchema), orderController.completeRefundRequest);
// Payment ledger (docs/PAYMENT_LEDGER.md §8): the order's payment position, and payments staff record by hand.
orderRouter.get("/:id/payment", requireAdmin, requirePermission("orders.read"), orderController.getPayment);
orderRouter.post("/:id/payments", requireAdmin, requirePermission("payments.record"), validate(recordPaymentSchema), orderController.recordPayment);
// §5a: re-mark a payment as a refused parcel's return charge (or back). It decides whether money is owed back → refunds.manage.
orderRouter.patch("/:id/payments/:paymentId", requireAdmin, requirePermission("refunds.manage"), validate(reclassifyPaymentSchema), orderController.reclassifyPayment);
orderRouter.post("/:id/payments/:paymentId/void", requireAdmin, requirePermission("refunds.manage"), validate(voidPaymentSchema), orderController.voidPayment);
// Door-swap exchanges and customer-reported item problems (docs/superpowers/plans/2026-11-28-door-swap-exchange.md).
orderRouter.get("/:id/exchanges", requireAdmin, requirePermission("orders.read"), doorSwap.listExchanges);
orderRouter.post("/:id/exchanges", requireAdmin, requirePermission("orders.manage"), validate(createDoorSwapSchema), doorSwap.createExchange);
orderRouter.post("/:id/exchanges/:requestId/outcome", requireAdmin, requirePermission("orders.manage"), validate(doorSwap.swapOutcomeSchema), doorSwap.setOutcome);
orderRouter.get("/:id/issues", requireAdmin, requirePermission("orders.read"), doorSwap.listIssues);
orderRouter.post("/:id/issues", requireAdmin, requirePermission("orders.manage"), validate(createOrderIssueSchema), doorSwap.createIssue);
orderRouter.post("/:id/issues/:issueId/resolve", requireAdmin, requirePermission("orders.manage"), validate(doorSwap.resolveIssueSchema), doorSwap.resolveIssue);

// Order adjustments (docs/ORDER_ADJUSTMENTS.md): modifications, item returns, store credit, payment links.
orderRouter.post("/:id/modifications/preview", requireAdmin, requirePermission("orders.manage"), validate(orderModificationSchema), adjustments.adminPreviewModification);
orderRouter.post("/:id/modifications", requireAdmin, requirePermission("orders.manage"), validate(orderModificationSchema), adjustments.adminApplyModification);
orderRouter.get("/:id/modifications", requireAdmin, requirePermission("orders.read"), adjustments.adminListModifications);
orderRouter.post("/:id/returns/preview", requireAdmin, requirePermission("returns.manage"), validate(itemReturnPreviewSchema), adjustments.adminPreviewReturn);
orderRouter.post("/:id/returns", requireAdmin, requirePermission("returns.manage"), validate(recordItemReturnSchema), adjustments.adminRecordReturn);
orderRouter.get("/:id/returns", requireAdmin, requirePermission("orders.read"), adjustments.adminListReturns);
orderRouter.post("/:id/store-credit", requireAdmin, requirePermission("refunds.manage"), validate(issueStoreCreditSchema), adjustments.adminCreditToStore);
orderRouter.get("/:id/payment-links", requireAdmin, requirePermission("orders.read"), adjustments.adminListPaymentLinks);
orderRouter.post("/:id/payment-links", requireAdmin, requirePermission("payments.record"), validate(createPaymentLinkSchema), adjustments.adminCreatePaymentLink);
orderRouter.post("/:id/payment-links/:linkId/cancel", requireAdmin, requirePermission("payments.record"), adjustments.adminCancelPaymentLink);
orderRouter.post("/:id/payment-links/:linkId/send", requireAdmin, requirePermission("payments.record"), validate(sendPaymentLinkSchema), adjustments.adminSendPaymentLink);
orderRouter.post("/:id/courier/book", requireAdmin, requirePermission("courier.manage"), orderController.bookCourier);
orderRouter.post("/:id/courier/refresh", requireAdmin, requirePermission("courier.manage"), orderController.refreshCourier);
orderRouter.post("/:id/courier/link", requireAdmin, requirePermission("courier.manage"), validate(linkCourierConsignmentSchema), orderController.linkCourier);
orderRouter.post("/:id/courier/unlink", requireAdmin, requirePermission("courier.manage"), orderController.unlinkCourier);
orderRouter.delete("/:id", requireAdmin, requirePermission("orders.delete"), orderController.remove);
orderRouter.post("/:id/restore", requireAdmin, requirePermission("orders.delete"), orderController.restore);
orderRouter.delete("/:id/permanent", requireAdmin, requirePermission("orders.delete"), orderController.permanentlyRemove);
