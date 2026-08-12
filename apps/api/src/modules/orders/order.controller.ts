import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import * as orderService from "./order.service";
import { initSslcommerzSession } from "../payments/sslcommerz.service";
import { bookOrderWithSteadfast, bookOrdersWithSteadfastBulk, refreshSteadfastStatus } from "../courier/courier.service";

export const create = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.createOrder(req.body, req.customer?.customerId ?? null);

  if (order.paymentMethod !== "SSLCOMMERZ") {
    return res.status(201).json({ order });
  }

  try {
    const { gatewayUrl, sessionKey } = await initSslcommerzSession({
      orderNumber: order.orderNumber,
      amount: Number(order.total),
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      customerAddress: order.shippingAddressLine,
    });

    await orderService.setPaymentSessionKey(order.id, sessionKey);
    res.status(201).json({ order, gatewayUrl });
  } catch (err) {
    await orderService.cancelUnstartedOrder(order.id);
    throw err;
  }
});

export const track = asyncHandler(async (req: Request, res: Response) => {
  const { orderNumber, phone } = req.body;
  res.json({ order: await orderService.trackOrder(orderNumber, phone) });
});

// --- admin ---

export const createManual = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.createManualOrder(req.body, req.admin!.adminId);
  res.status(201).json({ order });
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
  res.json({ order: await orderService.updateOrderDetails(req.params.id!, req.body) });
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
