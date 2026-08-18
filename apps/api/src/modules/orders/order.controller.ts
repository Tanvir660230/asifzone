import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as orderService from "./order.service";
import { initiatePendingPayment, refundOrderPayment, listRefundsForOrder } from "../payments/payment.service";
import {
  bookOrderWithSteadfast,
  bookOrdersWithSteadfastBulk,
  refreshSteadfastStatus,
  unlinkCourierBooking,
} from "../courier/courier.service";

export const create = asyncHandler(async (req: Request, res: Response) => {
  // COD has no gateway step — the order is real (and collectable) the instant it's placed, exactly
  // as before. Every other payment method must NOT create an Order yet: initiatePendingPayment only
  // opens a PaymentSession (no Order, no stock touched) and the Order is materialized later, in
  // settlePaymentSession, only once the gateway confirms success — a failed/cancelled attempt never
  // produces an Order at all, only the Payment FAILED row that already serves as its payment log.
  if (req.body.paymentMethod === "COD") {
    const order = await orderService.createOrder(req.body, req.customer?.customerId ?? null);
    return res.status(201).json({ order });
  }

  const { gatewayUrl } = await initiatePendingPayment(req.body, req.customer?.customerId ?? null);
  res.status(201).json({ gatewayUrl });
});

export const track = asyncHandler(async (req: Request, res: Response) => {
  const { orderNumber, phone } = req.body;
  res.json({ order: await orderService.trackOrder(orderNumber, phone) });
});

export const retryPayment = asyncHandler(async (req: Request, res: Response) => {
  const { gatewayUrl } = await orderService.retryPayment(req.params.orderNumber!, req.body.phone);
  res.json({ gatewayUrl });
});

// --- admin ---

export const createManual = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.createManualOrder(req.body, req.admin!.adminId);
  res.status(201).json({ order });
});

export const createRefund = asyncHandler(async (req: Request, res: Response) => {
  const refund = await refundOrderPayment(req.params.id!, req.body, req.admin!.adminId);
  res.status(201).json({ refund });
});

export const listRefunds = asyncHandler(async (req: Request, res: Response) => {
  res.json({ refunds: await listRefundsForOrder(req.params.id!) });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json(await orderService.listOrders(req.query as never));
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await orderService.getOrderById(req.params.id!) });
});

export const bulkGet = asyncHandler(async (req: Request, res: Response) => {
  res.json({ orders: await orderService.getOrdersByIds(req.body.ids) });
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
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
  res.json({ order: await orderService.restoreOrder(req.params.id!) });
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
  await orderService.bulkUpdateOrderStatus(req.body.ids, req.body.status, req.admin!.adminId);
  res.status(204).send();
});

export const bulkDelete = asyncHandler(async (req: Request, res: Response) => {
  await orderService.bulkDeleteOrders(req.body.ids, req.admin!.adminId);
  res.status(204).send();
});

export const bulkPermanentDelete = asyncHandler(async (req: Request, res: Response) => {
  await orderService.bulkPermanentlyDeleteOrders(req.body.ids);
  res.status(204).send();
});

export const bookCourier = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await bookOrderWithSteadfast(req.params.id!) });
});

export const bulkBookCourier = asyncHandler(async (req: Request, res: Response) => {
  res.json(await bookOrdersWithSteadfastBulk(req.body.ids));
});

export const refreshCourier = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await refreshSteadfastStatus(req.params.id!) });
});

export const unlinkCourier = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await unlinkCourierBooking(req.params.id!) });
});
