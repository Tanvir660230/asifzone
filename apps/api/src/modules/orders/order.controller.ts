import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { AppError } from "../../lib/app-error";
import * as orderService from "./order.service";
import { toCustomerOrder } from "./customer-order-view";
import { initiatePendingPayment, refundOrderPayment, listRefundsForOrder } from "../payments/payment.service";
import { metaContextFromRequest } from "../../lib/meta/capi";
import { completeRefund, getOrderPaymentSummary, recordManualPayment } from "../../domain/payments/payment-ledger.service";
import {
  bookOrderWithSteadfast,
  bookOrdersWithSteadfastBulk,
  bulkSyncCourierStatuses,
  checkDeliveryScoresBulk,
  getOrderByIdWithAutoSync,
  refreshSteadfastStatus,
  unlinkCourierBooking,
} from "../courier/courier.service";
import { can } from "../../domain/auth/authorization";

/** The Idempotency-Key header (PRICING_INVARIANTS §11): printable, bounded, or absent. */
export function idempotencyKeyOf(req: Request): string | null {
  const raw = req.get("Idempotency-Key");
  if (!raw) return null;
  const key = raw.trim();
  if (!/^[!-~]{8,128}$/.test(key)) throw AppError.badRequest("Idempotency-Key must be 8–128 printable characters");
  return key;
}

export const create = asyncHandler(async (req: Request, res: Response) => {
  // COD has no gateway step — the order is real (and collectable) the instant it's placed, exactly
  // as before. Every other payment method must NOT create an Order yet: initiatePendingPayment only
  // opens a PaymentSession (no Order, no stock touched) and the Order is materialized later, in
  // settlePaymentSession, only once the gateway confirms success — a failed/cancelled attempt never
  // produces an Order at all, only the Payment FAILED row that already serves as its payment log.
  // Captured here, from the shopper's own request, because it's the last point that has one — an
  // online payment's Order is only written later from a gateway callback/IPN/cron (lib/meta/).
  const metaContext = metaContextFromRequest(req);

  // Store balance is only ever the signed-in account's own (never a guest matched by phone).
  const creditCustomerId = req.body.useStoreCredit && req.customer ? req.customer.customerId : null;
  if (req.body.paymentMethod === "COD") {
    const order = await orderService.createOrder(req.body, req.customer?.customerId ?? null, {
      idempotencyKey: idempotencyKeyOf(req),
      metaContext,
      storeCreditCustomerId: creditCustomerId,
    });
    return res.status(201).json({ order: toCustomerOrder(order) });
  }

  const started = await initiatePendingPayment(req.body, req.customer?.customerId ?? null, req.ip, idempotencyKeyOf(req), metaContext);
  // Store balance covered the whole order: it is placed (and paid) without a gateway step.
  if ("order" in started) return res.status(201).json({ order: toCustomerOrder(started.order as never) });
  res.status(201).json({ gatewayUrl: started.gatewayUrl });
});

export const track = asyncHandler(async (req: Request, res: Response) => {
  const { orderNumber, phone } = req.body;
  res.json({ order: toCustomerOrder(await orderService.trackOrder(orderNumber, phone)) });
});

export const retryPayment = asyncHandler(async (req: Request, res: Response) => {
  const { gatewayUrl } = await orderService.retryPayment(req.params.orderNumber!, req.body.phone, req.ip);
  res.json({ gatewayUrl });
});

// --- admin ---

export const createManual = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.createManualOrder(req.body, req.admin!.adminId, idempotencyKeyOf(req));
  res.status(201).json({ order });
});

export const createRefund = asyncHandler(async (req: Request, res: Response) => {
  const { summary, ...refund } = await refundOrderPayment(req.params.id!, req.body, req.admin!.adminId, idempotencyKeyOf(req));
  res.status(201).json({ refund, summary });
});

export const completeRefundRequest = asyncHandler(async (req: Request, res: Response) => {
  res.json(await completeRefund(req.params.id!, req.params.refundId!, req.body, req.admin!.adminId));
});

export const recordPayment = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(await recordManualPayment(req.params.id!, req.body, req.admin!.adminId, idempotencyKeyOf(req)));
});

export const getPayment = asyncHandler(async (req: Request, res: Response) => {
  res.json({ payment: await getOrderPaymentSummary(req.params.id!) });
});

export const listRefunds = asyncHandler(async (req: Request, res: Response) => {
  res.json({ refunds: await listRefundsForOrder(req.params.id!) });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json(await orderService.listOrders(req.query as never));
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const order = await getOrderByIdWithAutoSync(req.params.id!);
  res.json({ order: { ...order, ...(await orderService.getAdminOrderContext(order)) } });
});

export const bulkGet = asyncHandler(async (req: Request, res: Response) => {
  res.json({ orders: await orderService.getOrdersByIds(req.body.ids) });
});

/** DR-5: a move to Cancelled also needs orders.cancel (the route already required orders.manage). */
function assertMayCancel(req: Request, status: unknown) {
  if (status === "CANCELLED" && !can(req.admin!, "orders.cancel")) throw AppError.forbidden("You don't have permission to cancel orders");
}

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  assertMayCancel(req, req.body.status);
  res.json({ order: await orderService.updateOrderStatus(req.params.id!, req.body, req.admin!.adminId) });
});

export const updateDetails = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await orderService.updateOrderDetails(req.params.id!, req.body, req.admin!.adminId) });
});

export const hold = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await orderService.holdOrderForFollowUp(req.params.id!, req.body, req.admin!.adminId) });
});

export const clearHold = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await orderService.clearOrderHold(req.params.id!, req.admin!.adminId) });
});

export const adjustPrice = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await orderService.adjustOrderPrice(req.params.id!, req.body, req.admin!.adminId) });
});

export const reconcilePartialDelivery = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await orderService.reconcilePartialDelivery(req.params.id!, req.body, req.admin!.adminId) });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await orderService.deleteOrder(req.params.id!, req.admin!.adminId) });
});

export const restore = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await orderService.restoreOrder(req.params.id!, req.admin!.adminId) });
});

export const permanentlyRemove = asyncHandler(async (req: Request, res: Response) => {
  await orderService.permanentlyDeleteOrder(req.params.id!);
  res.status(204).send();
});

export const stats = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await orderService.getOrderStats());
});

export const exportCsv = asyncHandler(async (req: Request, res: Response) => {
  const csv = await orderService.exportOrdersCsv(req.query as never);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="orders-${Date.now()}.csv"`);
  res.send(csv);
});

export const bulkStatus = asyncHandler(async (req: Request, res: Response) => {
  assertMayCancel(req, req.body.status);
  res.json(await orderService.bulkUpdateOrderStatus(req.body.ids, req.body.status, req.admin!.adminId, req.body.note));
});

export const bulkDelete = asyncHandler(async (req: Request, res: Response) => {
  res.json(await orderService.bulkDeleteOrders(req.body.ids, req.admin!.adminId));
});

export const bulkRestore = asyncHandler(async (req: Request, res: Response) => {
  res.json(await orderService.bulkRestoreOrders(req.body.ids, req.admin!.adminId));
});

export const bulkPermanentDelete = asyncHandler(async (req: Request, res: Response) => {
  res.json(await orderService.bulkPermanentlyDeleteOrders(req.body.ids));
});

export const bookCourier = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await bookOrderWithSteadfast(req.params.id!) });
});

export const bulkBookCourier = asyncHandler(async (req: Request, res: Response) => {
  res.json(await bookOrdersWithSteadfastBulk(req.body.ids));
});

export const bulkSyncCourier = asyncHandler(async (req: Request, res: Response) => {
  res.json(await bulkSyncCourierStatuses(req.body.ids));
});

export const bulkCheckDeliveryScore = asyncHandler(async (req: Request, res: Response) => {
  res.json(await checkDeliveryScoresBulk(req.body.ids));
});

export const refreshCourier = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await refreshSteadfastStatus(req.params.id!) });
});

export const unlinkCourier = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await unlinkCourierBooking(req.params.id!) });
});
