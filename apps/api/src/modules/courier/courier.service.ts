import { normalizeBdPhone, type OrderStatus } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { notify } from "../../lib/notify";
import {
  createSteadfastConsignment,
  createBulkSteadfastConsignments,
  getSteadfastStatusByConsignmentId,
} from "../../lib/steadfast";
import { getOrderById, updateOrderStatus } from "../orders/order.service";

const TERMINAL_ORDER_STATUSES: OrderStatus[] = ["DELIVERED", "CANCELLED", "REFUNDED"];
const TERMINAL_COURIER_STATUSES = ["delivered", "partial_delivered", "cancelled"];

// Steadfast's status_by_cid API never reports a distinct "picked up / in transit" state — it only
// ever returns in_review/pending/hold until the parcel resolves to delivered/partial_delivered/
// cancelled. So there is no courier signal to poll for "shipped": the courier handoff itself (a
// consignment successfully created) *is* the shipping event, which is why bookOrderWithSteadfast
// and bookOrdersWithSteadfastBulk advance the order to SHIPPED right there instead of waiting on
// applyCourierStatus. Only orders still earlier in the manual workflow get bumped, so booking never
// rewinds an order an admin already pushed further (or past) SHIPPED by hand.
const PRE_SHIP_ORDER_STATUSES: OrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED"];

// An order in one of these has already been voided, fulfilled, or restocked — booking a real
// (billable) courier consignment for one would create a live shipment/COD collection for an order
// the store no longer intends to send, and restockNeeded's CANCELLED/REFUNDED bookkeeping in
// order.service.ts assumes those statuses are final, not "shipped after the fact".
const NOT_BOOKABLE_STATUSES: OrderStatus[] = ["CANCELLED", "REFUNDED", "RETURNED", "DELIVERED"];

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

  // Steadfast reports both "we voided this before pickup" and "delivery failed and the parcel came
  // back to you" as the same "cancelled" delivery_status — but by the time this fires the order has
  // almost always already been auto-bumped to SHIPPED (bookOrderWithSteadfast does that at booking
  // time, since Steadfast has no separate "in transit" signal). A plain "Steadfast delivery status:
  // cancelled" note would then read as if the order was voided, when really the parcel shipped and
  // bounced back — spell that out explicitly so the audit trail isn't misleading.
  const note =
    status === "cancelled" && !PRE_SHIP_ORDER_STATUSES.includes(order.status)
      ? "Steadfast could not deliver this parcel — it was returned to origin after already shipping"
      : `Steadfast delivery status: ${status}`;

  await updateOrderStatus(order.id, { status: mapped, note });
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
  if (NOT_BOOKABLE_STATUSES.includes(order.status)) {
    throw AppError.badRequest(`Cannot book a courier for an order that is ${order.status.toLowerCase()}`);
  }

  const codAmount = order.paymentMethod === "COD" ? Number(order.total) : 0;

  const consignment = await createSteadfastConsignment({
    invoice: order.orderNumber,
    recipientName: order.customerName,
    // Steadfast requires exactly 11 digits — checkout normalizes new orders' customerPhone to that
    // form already, but this defends against rows written before that validation existed (same
    // reasoning as lib/sms.ts's own re-normalization before dialing out).
    recipientPhone: normalizeBdPhone(order.customerPhone),
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
      courierTrackingLink: consignment.tracking_link,
      courierBookedAt: new Date(),
    },
  });

  if (PRE_SHIP_ORDER_STATUSES.includes(order.status)) {
    await updateOrderStatus(orderId, { status: "SHIPPED", note: "Booked with Steadfast — handed to courier" });
  }

  notify({
    type: "order.courier_booked",
    title: `Order ${order.orderNumber} booked with Steadfast`,
    body: `Tracking code ${consignment.tracking_code}`,
    link: `/admin/orders/${orderId}`,
  });

  return getOrderById(orderId);
}

export interface BulkCourierBookResult {
  booked: Array<{ orderId: string; orderNumber: string; trackingNumber: string }>;
  failed: Array<{ orderId: string; orderNumber: string; reason: string }>;
}

/** Books every eligible order in `orderIds` with Steadfast in one API round-trip (up to Steadfast's
 * own 500-per-request cap). Orders that are trashed or already booked are reported as failures up
 * front rather than sent to Steadfast — everything else goes through createBulkSteadfastConsignments
 * and is matched back to its order by invoice (= orderNumber, which we always send as the invoice). */
export async function bookOrdersWithSteadfastBulk(orderIds: string[]): Promise<BulkCourierBookResult> {
  const orders = await prisma.order.findMany({ where: { id: { in: orderIds } } });

  const eligible: typeof orders = [];
  const failed: BulkCourierBookResult["failed"] = [];
  for (const order of orders) {
    if (order.deletedAt) {
      failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason: "Order is in Trash" });
    } else if (order.courierConsignmentId) {
      failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason: "Already booked with a courier" });
    } else if (NOT_BOOKABLE_STATUSES.includes(order.status)) {
      failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason: `Order is ${order.status.toLowerCase()}` });
    } else {
      eligible.push(order);
    }
  }

  if (!eligible.length) return { booked: [], failed };

  const results = await createBulkSteadfastConsignments(
    eligible.map((order) => ({
      invoice: order.orderNumber,
      recipientName: order.customerName,
      recipientPhone: normalizeBdPhone(order.customerPhone),
      recipientAddress: buildRecipientAddress(order),
      codAmount: order.paymentMethod === "COD" ? Number(order.total) : 0,
      note: order.notes ?? undefined,
    })),
  );
  const byInvoice = new Map(results.map((r) => [r.invoice, r]));

  const booked: BulkCourierBookResult["booked"] = [];
  for (const order of eligible) {
    const result = byInvoice.get(order.orderNumber);
    if (!result || result.status !== "success" || !result.consignment_id || !result.tracking_code) {
      failed.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        reason: result?.message ?? (result ? `Steadfast status: ${result.status}` : "No result returned by Steadfast"),
      });
      continue;
    }

    await prisma.order.update({
      where: { id: order.id },
      data: {
        carrier: "Steadfast",
        trackingNumber: result.tracking_code,
        courierConsignmentId: String(result.consignment_id),
        courierStatus: "in_review",
        courierTrackingLink: result.tracking_link ?? null,
        courierBookedAt: new Date(),
      },
    });
    if (PRE_SHIP_ORDER_STATUSES.includes(order.status)) {
      await updateOrderStatus(order.id, { status: "SHIPPED", note: "Booked with Steadfast — handed to courier" });
    }
    booked.push({ orderId: order.id, orderNumber: order.orderNumber, trackingNumber: result.tracking_code });
  }

  if (booked.length) {
    notify({
      type: "order.courier_booked",
      title: `${booked.length} order(s) booked with Steadfast`,
      body: failed.length ? `${failed.length} order(s) could not be booked` : undefined,
      link: `/admin/orders`,
    });
  }

  return { booked, failed };
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
