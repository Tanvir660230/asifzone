import { normalizeBdPhone, type OrderStatus } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { notify } from "../../lib/notify";
import {
  createSteadfastConsignment,
  createBulkSteadfastConsignments,
  getSteadfastStatusByConsignmentId,
  getSteadfastFraudCheck,
} from "../../lib/steadfast";
import { getOrderById, updateOrderStatus } from "../orders/order.service";

// PARTIALLY_DELIVERED is terminal from the courier's point of view (Steadfast won't report
// anything further for this consignment) even though it still needs an admin to reconcile which
// items came back — see reconcilePartialDelivery in order.service.ts.
const TERMINAL_ORDER_STATUSES: OrderStatus[] = ["DELIVERED", "PARTIALLY_DELIVERED", "CANCELLED", "REFUNDED", "RETURNED"];
const TERMINAL_COURIER_STATUSES = ["delivered", "partial_delivered", "cancelled"];

// Booking a Steadfast consignment only means a courier *record* now exists — the box still has to
// actually be packed and handed over, which in practice happens after the admin prints the label
// (apps/web/app/admin/(shell)/orders/print-labels). Advancing straight to SHIPPED at booking time
// used to fire the SHIPPED customer SMS before the parcel had physically left the building, which
// is worse than just being an inaccurate status. So booking only nudges pre-fulfillment orders up
// to PACKED; SHIPPED stays a deliberate, manual admin action once the parcel is actually handed
// off. Orders already at PACKED or later are left alone — booking never rewinds or re-nudges
// anything an admin has already progressed by hand.
const PRE_PACKED_ORDER_STATUSES: OrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING"];

// Steadfast's status_by_cid API never reports a distinct "picked up / in transit" state — it only
// ever returns in_review/pending/hold until the parcel resolves to delivered/partial_delivered/
// cancelled. Used below to word a "cancelled" report correctly: if our own status hasn't been
// manually advanced past PACKED yet, Steadfast most likely voided the booking before ever picking
// it up; if it has, this is a genuine "shipped, then returned" case.
const PRE_SHIP_ORDER_STATUSES: OrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED"];

// An order in one of these has already been voided, fulfilled, or restocked — booking a real
// (billable) courier consignment for one would create a live shipment/COD collection for an order
// the store no longer intends to send, and restockNeeded's CANCELLED/REFUNDED bookkeeping in
// order.service.ts assumes those statuses are final, not "shipped after the fact".
const NOT_BOOKABLE_STATUSES: OrderStatus[] = ["CANCELLED", "REFUNDED", "RETURNED", "DELIVERED", "PARTIALLY_DELIVERED"];

// "partial_delivered" used to be folded into DELIVERED here, which silently left whatever the
// customer refused to accept stuck as "sold" forever — nothing else in the system ever restocked
// it, since a fully DELIVERED order has nothing left to reconcile. Mapping it to its own status
// forces an admin through reconcilePartialDelivery (order.service.ts) before stock is trusted again.
function mapSteadfastStatusToOrderStatus(status: string): OrderStatus | null {
  if (status === "delivered") return "DELIVERED";
  if (status === "partial_delivered") return "PARTIALLY_DELIVERED";
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

/** Cheap defense-in-depth guard, not a replacement for UI-level validation — updateOrderDetailsSchema
 * already rejects blank shipping/customer fields going forward, but this catches rows written before
 * those columns were admin-editable/validated, so a Steadfast booking never goes out with an
 * unusable address. */
function hasUsableAddress(order: {
  customerName: string;
  customerPhone: string;
  shippingAddressLine: string;
  shippingArea: string;
  shippingDistrict: string;
  shippingDivision: string;
}): boolean {
  return [
    order.customerName,
    order.customerPhone,
    order.shippingAddressLine,
    order.shippingArea,
    order.shippingDistrict,
    order.shippingDivision,
  ].every((f) => f.trim().length > 0);
}

/** Records the raw Steadfast status and, if it maps onto one of our own order statuses and the
 * order isn't already in a terminal state, drives it through the normal updateOrderStatus path
 * (order.service.ts) so the status-history timeline and delivery-points award stay authoritative —
 * a courier update is just another way an order's status changes, not a side channel. */
async function applyCourierStatus(order: { id: string; orderNumber: string; status: OrderStatus }, status: string) {
  await prisma.order.update({
    where: { id: order.id },
    data: { courierStatus: status, courierStatusSyncedAt: new Date(), courierSyncError: null },
  });

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
  if (!hasUsableAddress(order)) {
    throw AppError.badRequest("This order is missing customer/address details — edit the order before booking a courier");
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

  if (PRE_PACKED_ORDER_STATUSES.includes(order.status)) {
    await updateOrderStatus(orderId, { status: "PACKED", note: "Booked with Steadfast — ready for handover" });
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
    } else if (!hasUsableAddress(order)) {
      failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason: "Missing address details" });
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
    // Success is judged by "did Steadfast actually give us a consignment_id + tracking_code", not
    // by matching a specific `status` value — Steadfast's own bulk response format for a *successful*
    // item was never confirmed (see steadfast.ts's RawSteadfastBulkResultItem comment), so gating on
    // an assumed status string/code risked marking real bookings as failed if that assumption was
    // wrong. This was the actual bug behind bulk booking silently failing entirely.
    if (!result || !result.consignment_id || !result.tracking_code) {
      const reason = result?.message ?? "No result returned by Steadfast";
      if (!result?.message) {
        console.error(`[steadfast] bulk item for ${order.orderNumber} had no usable result:`, JSON.stringify(result));
      }
      failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason });
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
    if (PRE_PACKED_ORDER_STATUSES.includes(order.status)) {
      await updateOrderStatus(order.id, { status: "PACKED", note: "Booked with Steadfast — ready for handover" });
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

/** Extracts a message worth showing an admin from whatever getSteadfastStatusByConsignmentId threw
 * — AppError.message is already human-readable; anything else falls back to a generic string
 * rather than leaking a raw axios/network error shape into the UI. */
function syncErrorMessage(err: unknown): string {
  return err instanceof AppError || err instanceof Error ? err.message : "Could not reach Steadfast";
}

async function recordCourierSyncError(orderId: string, message: string) {
  await prisma.order.update({ where: { id: orderId }, data: { courierSyncError: message } });
}

export async function refreshSteadfastStatus(orderId: string) {
  const order = await getOrderById(orderId);
  if (!order.courierConsignmentId) throw AppError.badRequest("This order has not been booked with a courier yet");

  try {
    const status = await getSteadfastStatusByConsignmentId(order.courierConsignmentId);
    await applyCourierStatus(order, status);
  } catch (err) {
    await recordCourierSyncError(orderId, syncErrorMessage(err));
    throw err;
  }
  return getOrderById(orderId);
}

export interface BulkCourierSyncResult {
  synced: Array<{ orderId: string; orderNumber: string; courierStatus: string }>;
  failed: Array<{ orderId: string; orderNumber: string; reason: string }>;
}

/** Admin-triggered bulk "Sync courier status" for a set of already-booked orders — the selection-
 * based counterpart to bookOrdersWithSteadfastBulk. Unlike syncPendingCourierStatuses (the cron
 * sweep), this always re-checks every order passed in, including terminal ones, since an admin who
 * explicitly selected them wants a fresh answer right now. */
export async function bulkSyncCourierStatuses(orderIds: string[]): Promise<BulkCourierSyncResult> {
  const orders = await prisma.order.findMany({ where: { id: { in: orderIds } } });

  const synced: BulkCourierSyncResult["synced"] = [];
  const failed: BulkCourierSyncResult["failed"] = [];
  for (const order of orders) {
    if (!order.courierConsignmentId) {
      failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason: "Not booked with a courier" });
      continue;
    }
    try {
      const status = await getSteadfastStatusByConsignmentId(order.courierConsignmentId);
      await applyCourierStatus(order, status);
      synced.push({ orderId: order.id, orderNumber: order.orderNumber, courierStatus: status });
    } catch (err) {
      const reason = syncErrorMessage(err);
      await recordCourierSyncError(order.id, reason);
      failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason });
    }
  }

  return { synced, failed };
}

export interface BulkDeliveryScoreResult {
  checked: Array<{ orderId: string; orderNumber: string; successRate: number | null; totalParcels: number }>;
  failed: Array<{ orderId: string; orderNumber: string; reason: string }>;
}

/** Admin-triggered bulk "Check delivery score" for a set of orders on the admin order list —
 * fraud_check is keyed by phone, not order, so this groups the selection by customerId first and
 * makes one Steadfast call per distinct customer, then fans the cached result back out to every
 * order in that group instead of burning one API call per row. Orders with no linked Customer
 * (shouldn't happen post-checkout — see findOrCreateGuestCustomer — but possible for old rows) are
 * reported as failed up front. Uses the order's own customerPhone snapshot rather than Customer.phone
 * to look up the score, since that's the exact value findOrCreateGuestCustomer wrote to the Customer
 * row at checkout time; the cached result is still stored on the Customer row so it's shared across
 * every one of that customer's orders, not just the ones selected here. */
export async function checkDeliveryScoresBulk(orderIds: string[]): Promise<BulkDeliveryScoreResult> {
  const orders = await prisma.order.findMany({ where: { id: { in: orderIds } } });

  const checked: BulkDeliveryScoreResult["checked"] = [];
  const failed: BulkDeliveryScoreResult["failed"] = [];

  const groupsByCustomerId = new Map<string, typeof orders>();
  for (const order of orders) {
    if (!order.customerId) {
      failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason: "No customer record linked to this order" });
      continue;
    }
    const group = groupsByCustomerId.get(order.customerId);
    if (group) group.push(order);
    else groupsByCustomerId.set(order.customerId, [order]);
  }

  for (const [customerId, group] of groupsByCustomerId) {
    try {
      const phone = normalizeBdPhone(group[0]!.customerPhone);
      const result = await getSteadfastFraudCheck(phone);
      await prisma.customer.update({
        where: { id: customerId },
        data: {
          deliveryTotalParcels: result.totalParcels,
          deliverySuccessParcels: result.successParcels,
          deliveryCancelledParcels: result.cancelledParcels,
          deliverySuccessRate: result.successRate,
          deliveryScoreCheckedAt: new Date(),
        },
      });
      for (const order of group) {
        checked.push({ orderId: order.id, orderNumber: order.orderNumber, successRate: result.successRate, totalParcels: result.totalParcels });
      }
    } catch (err) {
      const reason = syncErrorMessage(err);
      for (const order of group) failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason });
    }
  }

  return { checked, failed };
}

// Never block viewing an order on Steadfast being reachable, and never re-check on every single
// request — a 2-minute floor is short enough to feel "live" to an admin flipping between orders,
// long enough that repeatedly opening/re-rendering the same order in a session doesn't hammer
// Steadfast's API.
const AUTO_SYNC_STALE_MS = 2 * 60 * 1000;

/** Used by GET /api/orders/:id so opening an order's detail page always shows a current courier
 * status without the admin having to click "Sync Now" first. Only fires for orders that are booked,
 * not yet in a terminal delivery state, and stale — otherwise just returns the order as stored. */
export async function getOrderByIdWithAutoSync(orderId: string) {
  const order = await getOrderById(orderId);
  const isStale = !order.courierStatusSyncedAt || Date.now() - new Date(order.courierStatusSyncedAt).getTime() > AUTO_SYNC_STALE_MS;
  const isTerminal = order.courierStatus ? TERMINAL_COURIER_STATUSES.includes(order.courierStatus) : false;

  if (!order.courierConsignmentId || isTerminal || !isStale) return order;

  try {
    return await refreshSteadfastStatus(orderId);
  } catch {
    // Error already persisted inside refreshSteadfastStatus; re-fetch so the caller still sees it.
    return getOrderById(orderId);
  }
}

/** Clears a stuck courier booking so the order can be re-booked. Exists for the case where the
 * consignment was voided/deleted from the Steadfast merchant panel directly — status_by_cid then
 * has nothing to report for that consignment_id, refreshSteadfastStatus just keeps failing, and
 * without this there was no way back into a bookable state (bookOrderWithSteadfast refuses to
 * re-book while courierConsignmentId is still set). Deliberately leaves the order's own `status`
 * untouched — unlinking is about the courier record, not a claim about fulfillment state, and an
 * admin who already manually marked it Shipped/Packed shouldn't have that silently reverted. */
export async function unlinkCourierBooking(orderId: string) {
  const order = await getOrderById(orderId);
  if (!order.courierConsignmentId) throw AppError.badRequest("This order has no courier booking to unlink");

  await prisma.order.update({
    where: { id: orderId },
    data: {
      carrier: null,
      trackingNumber: null,
      courierConsignmentId: null,
      courierStatus: null,
      courierTrackingLink: null,
      courierBookedAt: null,
      courierStatusSyncedAt: null,
      courierSyncError: null,
    },
  });

  notify({
    type: "order.courier_update",
    title: `Order ${order.orderNumber}'s courier booking was unlinked`,
    body: "It can be booked with Steadfast again.",
    link: `/admin/orders/${orderId}`,
  });

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
    select: { id: true, orderNumber: true, status: true, courierConsignmentId: true, courierStatus: true, courierSyncError: true },
  });

  let changed = 0;
  for (const order of pending) {
    try {
      const status = await getSteadfastStatusByConsignmentId(order.courierConsignmentId!);
      if (status !== order.courierStatus) {
        await applyCourierStatus(order, status);
        changed++;
      } else if (order.courierSyncError) {
        // A previous poll failed but this one recovered without the status itself having changed —
        // still need to clear the stale error and stamp a fresh sync time.
        await prisma.order.update({ where: { id: order.id }, data: { courierStatusSyncedAt: new Date(), courierSyncError: null } });
      }
    } catch (err) {
      console.error(`[courier-status-cron] failed to refresh order ${order.id}:`, err);
      await recordCourierSyncError(order.id, syncErrorMessage(err));
    }
  }
  return changed;
}
