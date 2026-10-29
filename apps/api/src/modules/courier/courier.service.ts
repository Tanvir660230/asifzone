import { canTransitionOrder, COURIER_UNBOOKABLE_STATUSES, normalizeBdPhone, type OrderStatus } from "@clothing-brand/shared";
import { prisma } from "../../config/prisma";
import { AppError } from "../../lib/app-error";
import { notify } from "../../lib/notify";
import { changeOrderStatus, getOrderById, updateOrderStatus } from "../orders/order.service";
import { checkAndUpdateDeliveryScore } from "../customers/customer.service";
import type { Prisma } from "@prisma/client";
import { codToCollectFor, settleCourierCollected } from "../../domain/payments/payment-ledger.service";
import { buildCourierNotes, effectiveCourierNote } from "./courier-note";
import { parseSteadfastWebhook } from "./steadfast-webhook";
import { getCurrency } from "../../domain/config/commerce-settings";
import { getSettings } from "../settings/settings.service";
import { logger } from "../../lib/observability/logger";
import { captureError } from "../../lib/observability/error-capture";
import { getProviders } from "../../providers/registry";
import { CourierOutcomeUnknownError, CourierRateLimitedError } from "../../providers/errors";
import { currentPollLevel, OPEN_PARCEL_WHERE, TERMINAL_COURIER_STATUSES } from "./courier-health.service";
import { basePollIntervalMs, pollIntervalMs } from "./courier-sync-policy";
import { syncOrderShipmentsSafely } from "../../domain/shipments/shipment-sync";
import { fillForBookedOrder, planAutoFill, type AutoFillPlan } from "../../domain/stock/auto-fill.service";

// PARTIALLY_DELIVERED is terminal from the courier's point of view (Steadfast won't report
// anything further for this consignment) even though it still needs an admin to reconcile which
// items came back — see reconcilePartialDelivery in order.service.ts.
const TERMINAL_ORDER_STATUSES: OrderStatus[] = ["DELIVERED", "PARTIALLY_DELIVERED", "CANCELLED", "REFUNDED", "RETURNED"];

// Owner decision D-AA3 (2026-10-25): a booked order becomes SHIPPED at booking, through PACKED when it hadn't been packed
// yet (shipOnBooking, below) — so the SHIPPED SMS goes out at booking. A booking still only proves a courier RECORD exists,
// not that the parcel left: physical handover is a separate fact (Order Operations plan, Phase 4 dispatch scan). Orders
// already at SHIPPED or later are left alone — booking never rewinds or re-nudges anything an admin progressed by hand.
const PRE_PACKED_ORDER_STATUSES: OrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING"];

// Steadfast's status_by_cid API never reports a distinct "picked up / in transit" state — it only ever returns
// in_review/pending/hold (or an *_approval_pending / unknown state) until the parcel resolves to delivered/
// partial_delivered/cancelled. Used below to word a "cancelled" report: an order still before SHIPPED was voided before
// pickup. Since D-AA3 every booked order is SHIPPED, so for those the courier's word can't tell "returned to us" from
// "never picked up" — the parcel is counted back only when it is received on the order (receiveReturnedParcel).
const PRE_SHIP_ORDER_STATUSES: OrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED"];

// An order in one of these has already been voided, fulfilled, or restocked — booking a real
// (billable) courier consignment for one would create a live shipment/COD collection for an order
// the store no longer intends to send, and restockNeeded's CANCELLED/REFUNDED bookkeeping in
// order.service.ts assumes those statuses are final, not "shipped after the fact".
// Shared with the admin UI (packages/shared order-operations.ts) so it only offers booking where this allows it.
const NOT_BOOKABLE_STATUSES = COURIER_UNBOOKABLE_STATUSES;

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

/** How a courier status reached us: the Steadfast webhook, the scheduled poll, or an admin's look (opening the order,
 * Sync now, bulk sync). The webhook-health coverage check compares them (courier-health.service.ts). */
type CourierStatusSource = "WEBHOOK" | "POLL" | "ON_DEMAND";

type BookedOrder = { id: string; orderNumber: string; status: OrderStatus; courierBookedAt: Date | null; createdAt: Date };

/** When the poll should next look at a parcel just verified outside the sweep: the full-pace (level 0) interval for its age. */
function nextPollAfterCheck(order: Pick<BookedOrder, "courierBookedAt" | "createdAt">, now: Date): Date {
  return new Date(now.getTime() + basePollIntervalMs(now.getTime() - (order.courierBookedAt ?? order.createdAt).getTime()));
}

/** Records the raw Steadfast status and, if it maps onto one of our own order statuses and the
 * order isn't already in a terminal state, drives it through the normal updateOrderStatus path
 * (order.service.ts) so the status-history timeline and delivery-points award stay authoritative —
 * a courier update is just another way an order's status changes, not a side channel. Then the order's shipment leg
 * follows (docs/COURIER_COSTS.md) — never failing the courier update it follows. */
async function applyCourierStatus(order: BookedOrder, status: string, source: CourierStatusSource, nextPollAt?: Date) {
  await applyCourierStatusToOrder(order, status, source, nextPollAt ?? nextPollAfterCheck(order, new Date()));
  await syncOrderShipmentsSafely(order.id);
}

async function applyCourierStatusToOrder(order: BookedOrder, status: string, source: CourierStatusSource, nextPollAt: Date) {
  const before = await prisma.order.findUnique({ where: { id: order.id }, select: { courierStatus: true, courierConsignmentId: true } });
  // Conditional on the status read: when a webhook and a poll report the same change at once, only one records it.
  const moved =
    before && before.courierStatus !== status
      ? (await prisma.order.updateMany({ where: { id: order.id, courierStatus: before.courierStatus }, data: { courierStatus: status } })).count === 1
      : false;
  await prisma.order.update({
    where: { id: order.id },
    data: { courierStatus: status, courierStatusSyncedAt: new Date(), courierSyncError: null, courierNextPollAt: nextPollAt },
  });
  if (moved && before?.courierConsignmentId) {
    await prisma.courierStatusChange
      .create({ data: { consignmentId: before.courierConsignmentId, orderId: order.id, fromStatus: before.courierStatus, toStatus: status, source } })
      .catch((err) => captureError(err, { msg: "[courier] could not record a status change:" }));
  }

  const mapped = mapSteadfastStatusToOrderStatus(status);
  // Only moves the order state machine allows (docs/ORDER_STATE_MACHINE.md) — e.g. a late "cancelled" report for an
  // order already DELIVERED/RETURNED just updates courierStatus above; it never rewinds or reopens the order.
  if (!mapped || mapped === order.status || TERMINAL_ORDER_STATUSES.includes(order.status) || !canTransitionOrder(order.status, mapped)) return;

  // Steadfast reports both "we voided this before pickup" and "delivery failed, the parcel is coming back" as the same
  // "cancelled" — and since D-AA3 the order is SHIPPED from booking, so a SHIPPED order may never have been picked up. The
  // note says only what is known: the courier cancelled it, and any parcel must be received back before it counts as stock.
  const note =
    status === "cancelled" && !PRE_SHIP_ORDER_STATUSES.includes(order.status)
      ? "Steadfast cancelled this consignment — if the parcel left, receive it back on the order before its units count as stock"
      : `Steadfast delivery status: ${status}`;

  // quietNoop: a duplicate / concurrent webhook for a status already applied leaves no second timeline entry, and only
  // the call that actually changed the status notifies admins (Phase 9).
  const { changed } = await changeOrderStatus(order.id, { status: mapped, note }, undefined, { quietNoop: true });
  if (!changed) return;
  notify({
    type: "order.courier_update",
    title: `Order ${order.orderNumber} marked ${mapped.toLowerCase()} by Steadfast`,
    link: `/admin/orders/${order.id}`,
  });
}

/** Phase 9 (D-4): a booking holds this claim from just before the Steadfast call until the consignment is saved. */
export const COURIER_BOOKING_LEASE_MS = 10 * 60_000;

/** Atomically claims the right to book `orderId` (no consignment yet, no live claim). Two concurrent bookings — a double
 * click, two admins, single + bulk — can't both win, so only one ever reaches Steadfast. */
export async function claimCourierBooking(orderId: string, now: Date = new Date()): Promise<boolean> {
  const claimed = await prisma.order.updateMany({
    where: {
      id: orderId,
      courierConsignmentId: null,
      OR: [{ courierBookingStartedAt: null }, { courierBookingStartedAt: { lt: new Date(now.getTime() - COURIER_BOOKING_LEASE_MS) } }],
    },
    data: { courierBookingStartedAt: now },
  });
  return claimed.count === 1;
}

async function releaseCourierBooking(orderId: string) {
  await prisma.order.updateMany({ where: { id: orderId, courierConsignmentId: null }, data: { courierBookingStartedAt: null } });
}

/** The claim is KEPT: Steadfast may have created the consignment. Re-booking waits for the lease, and the order says why. */
async function flagCourierOutcomeUnknown(orderId: string, orderNumber: string, detail: string) {
  await prisma.order.update({
    where: { id: orderId },
    data: { courierSyncError: `Booking outcome unknown (${detail}) — check Steadfast for invoice ${orderNumber} before booking again` },
  });
}

/** Owner, 2026-10-25 (admin audit, docs/BUSINESS_DECISIONS.md D-AA3): a parcel booked with Steadfast is leaving, so the
 * order becomes SHIPPED at booking — through PACKED when it hadn't been packed yet, so the timeline keeps every step.
 * Steadfast reports no pickup, so nothing else would ever move it on. */
async function shipOnBooking(orderId: string, status: OrderStatus) {
  if (PRE_PACKED_ORDER_STATUSES.includes(status)) {
    await updateOrderStatus(orderId, { status: "PACKED", note: "Booked with Steadfast" });
    status = "PACKED";
  }
  // Plan M4: the "shipped" SMS goes at booking (today's default) or, once the owner switches shippedSmsTrigger to
  // HANDOVER after the pilot, at the dispatch scan — the order status means the same either way.
  const deferShippedSms = (await getSettings()).shippedSmsTrigger === "HANDOVER";
  if (status === "PACKED") await updateOrderStatus(orderId, { status: "SHIPPED", note: "Booked with Steadfast" }, undefined, { deferShippedSms });
}

/** The auto-fill plan (docs/STOCK_HUB.md §7) must never stop a booking: if it can't be read, nothing is filled. */
async function planAutoFillSafely(orderIds: string[]): Promise<AutoFillPlan> {
  try {
    return await planAutoFill(orderIds);
  } catch (err) {
    logger.error("[stock] couldn't plan the auto-fill for a booking", { detail: String(err) });
    return new Map();
  }
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

  // The payment ledger's cash-to-collect (PL-6): the balance due of an open COD order — 0 when it was prepaid.
  const codAmount = order.payment.codToCollect;

  // The parcel note (store rules + customer note, or staff's own wording) — built before the claim so a failure here
  // can't leave the order stuck behind a booking lease.
  const courierNote = effectiveCourierNote(order.courierNote, (await buildCourierNotes([orderId])).get(orderId));
  if (!(await claimCourierBooking(orderId))) {
    throw AppError.conflict("This order is already booked with a courier, or a booking for it is in progress");
  }
  // attar bottles still owed for this parcel — read while it is still on the shelf (docs/STOCK_HUB.md §7)
  const fillPlan = await planAutoFillSafely([orderId]);

  let consignment;
  try {
    consignment = await getProviders().courier.createShipment({
      invoice: order.orderNumber,
      recipientName: order.customerName,
      // Steadfast requires exactly 11 digits — checkout normalizes new orders' customerPhone to that
      // form already, but this defends against rows written before that validation existed (same
      // reasoning as providers/sms/bulksmsbd.ts's own re-normalization before dialing out).
      recipientPhone: normalizeBdPhone(order.customerPhone),
      recipientAddress: buildRecipientAddress(order),
      codAmount,
      note: courierNote ?? undefined,
    });
  } catch (err) {
    if (err instanceof CourierOutcomeUnknownError) await flagCourierOutcomeUnknown(orderId, order.orderNumber, err.message);
    else await releaseCourierBooking(orderId);
    throw err;
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      carrier: "Steadfast",
      trackingNumber: consignment.tracking_code,
      courierConsignmentId: String(consignment.consignment_id),
      courierStatus: consignment.status,
      courierTrackingLink: consignment.tracking_link,
      courierBookedAt: new Date(),
      courierBookingStartedAt: null,
      courierSyncError: null,
      courierNoteSent: courierNote,
    },
  });

  await shipOnBooking(orderId, order.status);
  await syncOrderShipmentsSafely(orderId);
  await fillForBookedOrder(orderId, String(consignment.consignment_id), fillPlan);

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

  const builtNotes = await buildCourierNotes(eligible.map((order) => order.id));
  const courierNotes = new Map(eligible.map((order) => [order.id, effectiveCourierNote(order.courierNote, builtNotes.get(order.id))]));

  // Claim each order first (Phase 9 D-4): one another booking already holds is skipped, never sent twice.
  const claimed: typeof eligible = [];
  for (const order of eligible) {
    if (await claimCourierBooking(order.id)) claimed.push(order);
    else failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason: "A booking for this order is already in progress" });
  }
  if (!claimed.length) return { booked: [], failed };
  const codAmounts = await codToCollectFor(claimed.map((order) => order.id));
  const fillPlan = await planAutoFillSafely(claimed.map((order) => order.id));

  let results;
  try {
    results = await getProviders().courier.createShipments(
      claimed.map((order) => ({
        invoice: order.orderNumber,
        recipientName: order.customerName,
        recipientPhone: normalizeBdPhone(order.customerPhone),
        recipientAddress: buildRecipientAddress(order),
        codAmount: codAmounts.get(order.id) ?? 0,
        note: courierNotes.get(order.id) ?? undefined,
      })),
    );
  } catch (err) {
    if (err instanceof CourierOutcomeUnknownError) {
      for (const order of claimed) {
        await flagCourierOutcomeUnknown(order.id, order.orderNumber, err.message);
        failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason: "Booking outcome unknown — check Steadfast before booking again" });
      }
      return { booked: [], failed };
    }
    for (const order of claimed) await releaseCourierBooking(order.id);
    throw err;
  }
  const byInvoice = new Map(results.map((r) => [r.invoice, r]));

  const booked: BulkCourierBookResult["booked"] = [];
  for (const order of claimed) {
    const result = byInvoice.get(order.orderNumber);
    // Success is judged by "did Steadfast actually give us a consignment_id + tracking_code", not
    // by matching a specific `status` value — Steadfast's own bulk response format for a *successful*
    // item was never confirmed (see steadfast.ts's RawSteadfastBulkResultItem comment), so gating on
    // an assumed status string/code risked marking real bookings as failed if that assumption was
    // wrong. This was the actual bug behind bulk booking silently failing entirely.
    if (!result || !result.consignment_id || !result.tracking_code) {
      const reason = result?.message ?? "No result returned by Steadfast";
      if (!result?.message) {
        logger.error(`[steadfast] bulk item for ${order.orderNumber} had no usable result:`, { detail: JSON.stringify(result) });
      }
      failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason });
      await releaseCourierBooking(order.id);
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
        courierBookingStartedAt: null,
        courierSyncError: null,
        courierNoteSent: courierNotes.get(order.id) ?? null,
      },
    });
    await shipOnBooking(order.id, order.status);
    await syncOrderShipmentsSafely(order.id);
    await fillForBookedOrder(order.id, String(result.consignment_id), fillPlan);
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
    const status = await getProviders().courier.statusByConsignment(order.courierConsignmentId);
    await applyCourierStatus(order, status, "ON_DEMAND");
  } catch (err) {
    // A rate limit says nothing about this parcel: no sync error is pinned on it.
    if (!(err instanceof CourierRateLimitedError)) await recordCourierSyncError(orderId, syncErrorMessage(err));
    throw err;
  }
  return getOrderById(orderId);
}

export interface BulkCourierSyncResult {
  synced: Array<{ orderId: string; orderNumber: string; courierStatus: string }>;
  failed: Array<{ orderId: string; orderNumber: string; reason: string }>;
}

/** Bulk Sync and Check score stop this long into a request — well inside nginx's 60 s proxy timeout — and report the rest
 * as not checked, instead of the whole request turning into a 504 with nothing saved to show for it. */
const BULK_COURIER_BUDGET_MS = 40_000;

/** Admin-triggered bulk "Sync courier status" for a set of already-booked orders — the selection-
 * based counterpart to bookOrdersWithSteadfastBulk. Unlike syncPendingCourierStatuses (the cron
 * sweep), this always re-checks every order passed in, including terminal ones, since an admin who
 * explicitly selected them wants a fresh answer right now — within the request budget; a 429 from Steadfast stops it. */
export async function bulkSyncCourierStatuses(orderIds: string[], opts: { budgetMs?: number } = {}): Promise<BulkCourierSyncResult> {
  const orders = await prisma.order.findMany({ where: { id: { in: orderIds } } });
  const budgetMs = opts.budgetMs ?? BULK_COURIER_BUDGET_MS;
  const startedAt = Date.now();

  const synced: BulkCourierSyncResult["synced"] = [];
  const failed: BulkCourierSyncResult["failed"] = [];
  let rateLimited = false;
  for (const order of orders) {
    if (!order.courierConsignmentId) {
      failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason: "Not booked with a courier" });
      continue;
    }
    if (rateLimited) {
      failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason: "Not checked — Steadfast is limiting requests; try again in a minute" });
      continue;
    }
    if (Date.now() - startedAt > budgetMs) {
      failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason: "Not checked yet — run Sync again for these" });
      continue;
    }
    try {
      const status = await getProviders().courier.statusByConsignment(order.courierConsignmentId);
      await applyCourierStatus(order, status, "ON_DEMAND");
      synced.push({ orderId: order.id, orderNumber: order.orderNumber, courierStatus: status });
    } catch (err) {
      if (err instanceof CourierRateLimitedError) {
        rateLimited = true;
        failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason: "Not checked — Steadfast is limiting requests; try again in a minute" });
        continue;
      }
      const reason = syncErrorMessage(err);
      await recordCourierSyncError(order.id, reason);
      failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason });
    }
  }

  return { synced, failed };
}

export interface BulkDeliveryScoreResult {
  checked: Array<{ orderId: string; orderNumber: string; successRate: number | null; totalParcels: number; volumeRange: string | null }>;
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
const BULK_FRAUD_CHECK_SPACING_MS = 1000;
const BULK_FRAUD_CHECK_BUDGET_MS = BULK_COURIER_BUDGET_MS;

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

  const startedAt = Date.now();
  let first = true;
  for (const [customerId, group] of groupsByCustomerId) {
    // Pacing (and 429 retries inside getSteadfastFraudCheck) make a big selection slow; stop well before
    // nginx's 60s proxy timeout turns the whole request into a 504 and report the rest as not checked.
    if (Date.now() - startedAt > BULK_FRAUD_CHECK_BUDGET_MS) {
      for (const order of group) {
        failed.push({ orderId: order.id, orderNumber: order.orderNumber, reason: "Not checked yet — run Check score again for these" });
      }
      continue;
    }
    // Pace the calls: Steadfast's score endpoint answers a burst with HTTP 429.
    if (!first) await new Promise((resolve) => setTimeout(resolve, BULK_FRAUD_CHECK_SPACING_MS));
    first = false;
    try {
      const result = await checkAndUpdateDeliveryScore(customerId, group[0]!.customerPhone);
      for (const order of group) {
        checked.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          successRate: result.successRate,
          totalParcels: result.totalParcels,
          volumeRange: result.volumeRange,
        });
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
      courierBookingStartedAt: null,
      courierStatusSyncedAt: null,
      courierSyncError: null,
    },
  });
  // The unlinked consignment's leg is kept as history, no longer tracked (docs/COURIER_COSTS.md).
  await syncOrderShipmentsSafely(orderId);

  notify({
    type: "order.courier_update",
    title: `Order ${order.orderNumber}'s courier booking was unlinked`,
    body: "It can be booked with Steadfast again.",
    link: `/admin/orders/${orderId}`,
  });

  return getOrderById(orderId);
}

/** Above this many refused calls in an hour, more are not stored (a flood can't fill the table); the report still shows it. */
const MAX_REJECTIONS_PER_HOUR = 500;

/** A webhook call refused at the token check — when and why, nothing else. Never throws (the 401 is answered regardless). */
export async function recordWebhookRejection(reason: "not_configured" | "missing_token" | "bad_token") {
  try {
    const recent = await prisma.courierWebhookRejection.count({ where: { receivedAt: { gte: new Date(Date.now() - 3_600_000) } } });
    if (recent < MAX_REJECTIONS_PER_HOUR) await prisma.courierWebhookRejection.create({ data: { reason } });
  } catch (err) {
    captureError(err, { msg: "[steadfast-webhook] could not record a refused call:" });
  }
}

/** Webhook payloads from Steadfast carry no signature — rather than trusting the posted status
 * directly, this re-fetches the status from Steadfast's own API using only the consignment_id out
 * of the payload, mirroring the SSLCommerz IPN handler's "verify server-to-server, never trust the
 * callback body" pattern (providers/payment/sslcommerz.ts). Silently no-ops on an unrecognized
 * consignment_id or malformed payload — Steadfast doesn't require (or check) a response body, and
 * there is nothing useful to do with a webhook we can't tie back to one of our orders. */
export async function handleSteadfastWebhook(payload: unknown, meta: { idempotencyKey?: string | null } = {}) {
  const event = parseSteadfastWebhook(payload);
  const idempotencyKey = meta.idempotencyKey?.trim().slice(0, 200) || null;
  // Steadfast sends the same Idempotency-Key on every retry of one event: the first one is the one that counts.
  if (idempotencyKey && (await prisma.courierWebhookEvent.findUnique({ where: { idempotencyKey }, select: { id: true } }))) return "DUPLICATE";

  let orderId: string | null = null;
  let verifiedStatus: string | null = null;
  let outcome = "NO_CONSIGNMENT";
  try {
    if (!event.consignmentId) return outcome;
    const order = await prisma.order.findFirst({
      where: { courierConsignmentId: event.consignmentId },
      select: { id: true, orderNumber: true, status: true, courierCollectedAmount: true, courierBookedAt: true, createdAt: true },
    });
    outcome = "NO_ORDER";
    if (!order) return outcome;
    orderId = order.id;

    const status = await getProviders().courier.statusByConsignment(event.consignmentId);
    // Kept beside the body's own claim (event.status): the health report counts how often the two disagree.
    verifiedStatus = status;
    await applyCourierStatus(order, status, "WEBHOOK");
    // What the rider collected on a partial delivery (PAYMENT_LEDGER §5b) — the body's cod_amount is accepted only when
    // Steadfast's own status API also says partial_delivered, so a mistyped or replayed body can't put money on an order.
    if (status === "partial_delivered" && event.status === "partial_delivered" && event.codAmount !== null) {
      await recordCourierCollected(order, event.codAmount);
    }
    outcome = "APPLIED";
    return outcome;
  } catch (err) {
    outcome = "FAILED";
    throw err;
  } finally {
    await prisma.courierWebhookEvent
      .create({
        data: {
          idempotencyKey,
          notificationType: event.notificationType,
          consignmentId: event.consignmentId,
          orderId,
          status: event.status,
          verifiedStatus,
          codAmount: event.codAmount,
          deliveryCharge: event.deliveryCharge,
          trackingMessage: event.trackingMessage,
          payload: (payload && typeof payload === "object" ? payload : { body: String(payload) }) as Prisma.InputJsonValue,
          outcome,
        },
      })
      .catch((err) => captureError(err, { msg: "[steadfast-webhook] could not log the event:" }));
  }
}

/** Keeps Steadfast's reported collection on the order (with a timeline line when it changes), then settles it as the
 * return charge if the customer kept nothing (settleCourierCollected decides; it waits for the reconciliation otherwise). */
async function recordCourierCollected(order: { id: string; courierCollectedAmount: Prisma.Decimal | null }, collected: number) {
  if (order.courierCollectedAmount === null || !order.courierCollectedAmount.equals(collected)) {
    const [current, currency] = await Promise.all([prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } }), getCurrency()]);
    await prisma.order.update({
      where: { id: order.id },
      data: {
        courierCollectedAmount: collected,
        courierCollectedAt: new Date(),
        statusHistory: { create: { status: current.status, note: `Steadfast: the rider collected ${currency} ${collected.toFixed(2)} on this partial delivery` } },
      },
    });
  }
  await settleCourierCollected(order.id);
}

/** One sweep's limits: at most this many parcels, for at most this long (the cron fires every 15 minutes). */
export const COURIER_SWEEP_MAX_PER_RUN = 150;
export const COURIER_SWEEP_BUDGET_MS = 8 * 60_000;

export interface CourierSweepResult {
  /** Parcels whose status was asked for this run. */
  checked: number;
  /** …of which the courier status changed. */
  changed: number;
  /** Parcels due when the run started (more than `checked` = the rest wait for the next run, oldest-due first). */
  due: number;
  /** Steadfast answered 429: the run stopped there. */
  rateLimited: boolean;
  /** The poll level used (courier-sync-policy.ts): 0 = full pace. */
  level: number;
}

/** Called every 15 minutes by jobs/courier-status-cron.ts — the backstop behind the webhook: re-checks every booked parcel
 * that is due (courierNextPollAt NULL or past), oldest-due first, at most COURIER_SWEEP_MAX_PER_RUN per run and within
 * COURIER_SWEEP_BUDGET_MS. Each check schedules the parcel's next one from its age and the poll level, so old, quiet
 * parcels stop crowding out fresh ones; a check that fails is rescheduled too, so a broken consignment can't block the
 * head of the queue. A 429 stops the run and leaves the rest due. `orderIds` limits the sweep (tests, targeted re-runs). */
export async function syncPendingCourierStatuses(
  opts: { now?: Date; maxPerRun?: number; budgetMs?: number; orderIds?: string[] } = {},
): Promise<CourierSweepResult> {
  const now = opts.now ?? new Date();
  const level = await currentPollLevel(now);
  const where = {
    ...OPEN_PARCEL_WHERE,
    ...(opts.orderIds ? { id: { in: opts.orderIds } } : {}),
    AND: [{ OR: [{ courierNextPollAt: null }, { courierNextPollAt: { lte: now } }] }],
  };
  const [due, batch] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      select: { id: true, orderNumber: true, status: true, courierConsignmentId: true, courierStatus: true, courierBookedAt: true, createdAt: true },
      orderBy: [{ courierNextPollAt: { sort: "asc", nulls: "first" } }, { courierBookedAt: "asc" }],
      take: opts.maxPerRun ?? COURIER_SWEEP_MAX_PER_RUN,
    }),
  ]);

  const budgetMs = opts.budgetMs ?? COURIER_SWEEP_BUDGET_MS;
  const startedAt = Date.now();
  let checked = 0;
  let changed = 0;
  let rateLimited = false;
  for (const order of batch) {
    if (Date.now() - startedAt > budgetMs) break;
    const nextPollAt = new Date(Date.now() + pollIntervalMs(now.getTime() - (order.courierBookedAt ?? order.createdAt).getTime(), level));
    try {
      const status = await getProviders().courier.statusByConsignment(order.courierConsignmentId!);
      checked++;
      if (status !== order.courierStatus) {
        await applyCourierStatus(order, status, "POLL", nextPollAt);
        changed++;
      } else {
        // Unchanged (or recovered from an earlier failed check): a fresh sync time, no error, and the next check scheduled.
        await prisma.order.update({ where: { id: order.id }, data: { courierStatusSyncedAt: new Date(), courierSyncError: null, courierNextPollAt: nextPollAt } });
      }
    } catch (err) {
      if (err instanceof CourierRateLimitedError) {
        rateLimited = true;
        logger.warn("[courier-status-cron] Steadfast is rate-limiting — stopping this run; the rest stay due", { detail: String(err.retryAfterMs ?? "") });
        break;
      }
      checked++;
      captureError(err, { msg: `[courier-status-cron] failed to refresh order ${order.id}:` });
      await prisma.order.update({ where: { id: order.id }, data: { courierSyncError: syncErrorMessage(err), courierNextPollAt: nextPollAt } });
    }
  }
  return { checked, changed, due, rateLimited, level };
}
