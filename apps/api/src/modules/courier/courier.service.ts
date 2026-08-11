import type { OrderStatus } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { notify } from "../../lib/notify";
import { createSteadfastConsignment, getSteadfastStatusByConsignmentId } from "../../lib/steadfast";
import { getOrderById, updateOrderStatus } from "../orders/order.service";

const TERMINAL_ORDER_STATUSES: OrderStatus[] = ["DELIVERED", "CANCELLED", "REFUNDED"];
const TERMINAL_COURIER_STATUSES = ["delivered", "partial_delivered", "cancelled"];

function mapSteadfastStatusToOrderStatus(status: string): OrderStatus | null {
  if (status === "delivered" || status === "partial_delivered") return "DELIVERED";
  if (status === "cancelled") return "CANCELLED";
  return null;
}

function buildRecipientAddress(order: {
  shippingAddressLine: string;
  shippingArea: string;
  shippingDistrict: string;
  shippingDivision: string;
}): string {
  return [order.shippingAddressLine, order.shippingArea, order.shippingDistrict, order.shippingDivision]
    .filter(Boolean)
    .join(", ");
}

/** Records the raw Steadfast status and, if it maps onto one of our own order statuses and the
 * order isn't already in a terminal state, drives it through the normal updateOrderStatus path
 * (order.service.ts) so the status-history timeline and delivery-points award stay authoritative —
 * a courier update is just another way an order's status changes, not a side channel. */
async function applyCourierStatus(order: { id: string; orderNumber: string; status: OrderStatus }, status: string) {
  await prisma.order.update({ where: { id: order.id }, data: { courierStatus: status } });

  const mapped = mapSteadfastStatusToOrderStatus(status);
  if (!mapped || mapped === order.status || TERMINAL_ORDER_STATUSES.includes(order.status)) return;

  await updateOrderStatus(order.id, { status: mapped, note: `Steadfast delivery status: ${status}` });
  notify({
    type: "order.courier_update",
    title: `Order ${order.orderNumber} marked ${mapped.toLowerCase()} by Steadfast`,
    link: `/admin/orders/${order.id}`,
  });
}

export async function bookOrderWithSteadfast(orderId: string) {
  const order = await getOrderById(orderId);
  if (order.deletedAt) throw AppError.badRequest("Restore this order before booking a courier");
  if (order.courierConsignmentId) throw AppError.conflict("This order is already booked with a courier");

  const codAmount = order.paymentMethod === "COD" ? Number(order.total) : 0;

  const consignment = await createSteadfastConsignment({
    invoice: order.orderNumber,
    recipientName: order.customerName,
    recipientPhone: order.customerPhone,
    recipientAddress: buildRecipientAddress(order),
    codAmount,
    note: order.notes ?? undefined,
  });

  await prisma.order.update({
    where: { id: orderId },
    data: {
      carrier: "Steadfast",
      trackingNumber: consignment.tracking_code,
      courierConsignmentId: String(consignment.consignment_id),
      courierStatus: consignment.status,
      courierBookedAt: new Date(),
    },
  });

  notify({
    type: "order.courier_booked",
    title: `Order ${order.orderNumber} booked with Steadfast`,
    body: `Tracking code ${consignment.tracking_code}`,
    link: `/admin/orders/${orderId}`,
  });

  return getOrderById(orderId);
}

export async function refreshSteadfastStatus(orderId: string) {
  const order = await getOrderById(orderId);
  if (!order.courierConsignmentId) throw AppError.badRequest("This order has not been booked with a courier yet");

  const status = await getSteadfastStatusByConsignmentId(order.courierConsignmentId);
  await applyCourierStatus(order, status);
  return getOrderById(orderId);
}

/** Webhook payloads from Steadfast carry no signature — rather than trusting the posted status
 * directly, this re-fetches the status from Steadfast's own API using only the consignment_id out
 * of the payload, mirroring the SSLCommerz IPN handler's "verify server-to-server, never trust the
 * callback body" pattern (payments/sslcommerz.service.ts). Silently no-ops on an unrecognized
 * consignment_id or malformed payload — Steadfast doesn't require (or check) a response body, and
 * there is nothing useful to do with a webhook we can't tie back to one of our orders. */
export async function handleSteadfastWebhook(payload: { consignment_id?: number | string }) {
  const consignmentId = payload.consignment_id != null ? String(payload.consignment_id) : null;
  if (!consignmentId) return;

  const order = await prisma.order.findFirst({
    where: { courierConsignmentId: consignmentId },
    select: { id: true, orderNumber: true, status: true },
  });
  if (!order) return;

  const status = await getSteadfastStatusByConsignmentId(consignmentId);
  await applyCourierStatus(order, status);
}

/** Called every 15 minutes by jobs/courier-status-cron.ts — catches deliveries whose webhook was
 * never configured in the Steadfast merchant panel, or whose delivery got dropped in transit.
 * Returns how many orders changed status. */
export async function syncPendingCourierStatuses(): Promise<number> {
  const pending = await prisma.order.findMany({
    where: {
      courierConsignmentId: { not: null },
      deletedAt: null,
      OR: [{ courierStatus: null }, { courierStatus: { notIn: TERMINAL_COURIER_STATUSES } }],
    },
    select: { id: true, orderNumber: true, status: true, courierConsignmentId: true, courierStatus: true },
  });

  let changed = 0;
  for (const order of pending) {
    try {
      const status = await getSteadfastStatusByConsignmentId(order.courierConsignmentId!);
      if (status !== order.courierStatus) {
        await applyCourierStatus(order, status);
        changed++;
      }
    } catch (err) {
      console.error(`[courier-status-cron] failed to refresh order ${order.id}:`, err);
    }
  }
  return changed;
}
