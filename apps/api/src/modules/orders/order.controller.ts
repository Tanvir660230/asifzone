import type { Request, Response } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { prisma } from "../../config/prisma";
import * as orderService from "./order.service";
import { initSslcommerzSession } from "../payments/sslcommerz.service";

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

    await prisma.order.update({ where: { id: order.id }, data: { paymentSessionKey: sessionKey } });
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

export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json(await orderService.listOrders(req.query as never));
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await orderService.getOrderById(req.params.id!) });
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  res.json({ order: await orderService.updateOrderStatus(req.params.id!, req.body) });
});
