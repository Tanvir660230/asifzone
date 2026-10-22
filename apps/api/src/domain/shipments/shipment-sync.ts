/**
 * Keeps the shipment legs in step with the orders they belong to (docs/COURIER_COSTS.md §3): the consignment an order is
 * booked with is its OUTBOUND leg (REPLACEMENT for an exchange order), the courier's status drives the leg's operational
 * status, and a booking that is unlinked stops being tracked (the old leg is kept, never deleted). A manual carrier's
 * parcel is a leg too, once the order has shipped. An approved return / exchange opens the RETURN leg.
 *
 * Idempotent: every entry point can run any number of times (booking hook, courier webhook / cron, opening the order).
 */
import { Prisma } from "@prisma/client";
import type { OrderStatus, ShipmentOperationalStatus, ShipmentType } from "@clothing-brand/shared";
import { LEGACY_ZONE_KEYS, loadShippingZones } from "../pricing/pricing-config";
import { resolveZone, businessDate } from "@clothing-brand/shared";
import { getCurrency, getTimezone } from "../config/commerce-settings";
import { getSettings } from "../../modules/settings/settings.service";
import { prisma } from "../../config/prisma";
import { FINANCE_BUSINESS_KEY } from "../finance/finance-context";
import { loadRateCards } from "../finance/charge-projection";
import { rateCardFor, zoneOf, type RateCard } from "../finance/charge-estimates";
import { logger } from "../../lib/observability/logger";
import { derivedColumns, FINISHED_STATUSES, recordShipmentEvent, type Db } from "./shipment-core";

export const STEADFAST = "Steadfast";
const SHIPPED_ORDER_STATUSES: OrderStatus[] = ["SHIPPED", "DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "REFUNDED"];
const isFinished = (s: ShipmentOperationalStatus) => (FINISHED_STATUSES as readonly string[]).includes(s);

/** The leg's operational status from the courier's word first, then the order's own status. A courier "cancelled" is a
 * parcel that came back when it had already shipped, otherwise a booking voided before pickup. Pure. */
export function operationalStatusFor(o: { status: OrderStatus; courierStatus: string | null; shipped: boolean }): ShipmentOperationalStatus {
  const cs = (o.courierStatus ?? "").trim().toLowerCase();
  const cameBack = o.shipped || o.status === "RETURNED" || o.status === "REFUNDED";
  if (cs.startsWith("partial_delivered")) return "PARTIALLY_DELIVERED";
  if (cs.startsWith("delivered")) return "DELIVERED";
  if (cs.startsWith("cancelled")) return cameBack ? "RETURNED" : "CANCELLED";
  switch (o.status) {
    case "DELIVERED":
      return "DELIVERED";
    case "PARTIALLY_DELIVERED":
      return "PARTIALLY_DELIVERED";
    case "RETURNED":
    case "REFUNDED":
      return "RETURNED";
    case "CANCELLED":
      return cameBack ? "RETURNED" : "CANCELLED";
    case "SHIPPED":
      return "IN_TRANSIT";
    default:
      return "BOOKED";
  }
}

// ── reference charges: the tariff and the estimate (never the actual) ─────────────────────────────────────────────────

export interface ChargeReference {
  deliveryZone: string | null;
  standardCharge: number | null;
  standardChargeSource: string | null;
  estimatedCharge: number | null;
}

/** Loads the courier tariff once for a batch: the finance rate card when the books have one (Finance › Courier &
 * gateway rates), otherwise the inside / outside Dhaka courier fees in Settings. Never creates the finance business. */
export async function chargeReferences(db: Db = prisma) {
  const business = await db.financeBusiness.findUnique({ where: { key: FINANCE_BUSINESS_KEY }, select: { id: true, baseCurrency: true, timezone: true } });
  const cards: RateCard[] = business ? (await loadRateCards(business.id, business.baseCurrency)).cards : [];
  const [settings, zones] = await Promise.all([getSettings(), loadShippingZones(await getCurrency(), db)]);
  const tz = business?.timezone ?? (await getTimezone());

  return (input: { district: string; area: string; division: string; type: ShipmentType; operationalStatus: ShipmentOperationalStatus; at: Date }): ChargeReference => {
    const card = cards.length ? rateCardFor(cards, businessDate(input.at, tz)) : null;
    const comesBack = input.type === "OUTBOUND" && input.operationalStatus === "RETURNED";
    if (card) {
      const { zone, charge } = zoneOf(card, input.district, input.area);
      // The courier's own delivery / return charge only — its COD charge is billed per payout, not per parcel.
      const estimate = comesBack ? Math.round((charge * card.returnChargePercent) / 100) : charge;
      return { deliveryZone: zone, standardCharge: charge / 100, standardChargeSource: "RATE_CARD", estimatedCharge: estimate / 100 };
    }
    const zone = resolveZone(zones, { district: input.district, division: input.division });
    const inside = zone?.key === LEGACY_ZONE_KEYS.insideDhaka;
    const fee = Number((inside ? settings.courierReturnFeeDhaka : settings.courierReturnFeeOutsideDhaka).toString());
    return { deliveryZone: inside ? "Inside Dhaka" : "Outside Dhaka", standardCharge: fee, standardChargeSource: "SETTINGS", estimatedCharge: fee };
  };
}
type ReferenceFn = Awaited<ReturnType<typeof chargeReferences>>;

// ── the order's own legs ──────────────────────────────────────────────────────────────────────────────────────────────

const orderSelect = {
  id: true,
  status: true,
  carrier: true,
  trackingNumber: true,
  courierConsignmentId: true,
  courierStatus: true,
  courierStatusSyncedAt: true,
  courierBookedAt: true,
  shippingDistrict: true,
  shippingArea: true,
  shippingDivision: true,
  updatedAt: true,
  statusHistory: { where: { status: "SHIPPED" as const }, select: { id: true }, take: 1 },
  exchangeReturnRequests: { select: { id: true, orderId: true }, take: 1 },
} satisfies Prisma.OrderSelect;
type SyncOrder = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

/** Brings the legs of one order (the consignment it is booked with, a manual carrier's parcel) up to date. */
export async function syncOrderShipments(orderId: string, opts: { db?: Db; refs?: ReferenceFn } = {}) {
  const db = opts.db ?? prisma;
  const order = await db.order.findUnique({ where: { id: orderId }, select: orderSelect });
  if (!order) return;
  const refs = opts.refs ?? (await chargeReferences(db));
  await syncTrackedLeg(db, order, refs);
  await untrackStaleLegs(db, order);
  await syncManualCarrierLeg(db, order, refs);
}

/** The same, never throwing — for hooks that must not fail the booking / courier update they follow. */
export async function syncOrderShipmentsSafely(orderId: string) {
  try {
    await syncOrderShipments(orderId);
  } catch (err) {
    logger.error(`[shipments] sync failed for order ${orderId}:`, { detail: err instanceof Error ? err.message : String(err) });
  }
}

function legIdentity(order: SyncOrder) {
  const exchange = order.exchangeReturnRequests[0];
  return {
    type: (exchange ? "REPLACEMENT" : "OUTBOUND") as ShipmentType,
    rootOrderId: exchange ? exchange.orderId : order.id,
    returnRequestId: exchange?.id ?? null,
  };
}

const shippedOf = (order: SyncOrder) => order.statusHistory.length > 0 || SHIPPED_ORDER_STATUSES.includes(order.status);

async function syncTrackedLeg(db: Db, order: SyncOrder, refs: ReferenceFn) {
  const consignmentId = order.courierConsignmentId;
  if (!consignmentId) return;
  const { type, rootOrderId, returnRequestId } = legIdentity(order);
  const op = operationalStatusFor({ status: order.status, courierStatus: order.courierStatus, shipped: shippedOf(order) });
  const existing = await db.shipment.findFirst({ where: { courier: STEADFAST, consignmentId, type } });
  const finishedAt = isFinished(op) ? (order.courierStatusSyncedAt ?? order.updatedAt) : null;

  if (!existing) {
    const ref = refs({ district: order.shippingDistrict, area: order.shippingArea, division: order.shippingDivision, type, operationalStatus: op, at: order.courierBookedAt ?? new Date() });
    const base = {
      type, operationalStatus: op, actualCharge: null, chargeStatus: "MISSING" as const, contributionReported: null, contributionVerified: null,
      contributionStatus: "NOT_RECORDED" as const, uncoveredTreatment: "UNDECIDED" as const, excessTreatment: "UNDECIDED" as const, reconciledAt: null, reviewReason: null,
    };
    try {
      const created = await db.shipment.create({
        data: {
          orderId: rootOrderId, parcelOrderId: order.id, returnRequestId, type, courier: STEADFAST, consignmentId, trackingCode: order.trackingNumber,
          courierStatus: order.courierStatus, courierSyncedAt: order.courierStatusSyncedAt, operationalStatus: op, trackedByCourier: true,
          bookedAt: order.courierBookedAt, completedAt: finishedAt, ...ref, ...derivedColumns(base),
        },
      });
      await recordShipmentEvent(db, { shipmentId: created.id, action: "CREATED", source: "COURIER_BOOKING", reference: consignmentId, note: `Booked with ${STEADFAST}` });
    } catch (err) {
      // A concurrent sync created it first (partial unique index) — nothing left to do.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
    return;
  }

  const opChanged = existing.operationalStatus !== op;
  const nothingNew = !opChanged && existing.courierStatus === order.courierStatus && existing.trackingCode === order.trackingNumber && existing.trackedByCourier;
  if (nothingNew) {
    if (order.courierStatusSyncedAt && existing.courierSyncedAt?.getTime() !== order.courierStatusSyncedAt.getTime()) {
      await db.shipment.update({ where: { id: existing.id }, data: { courierSyncedAt: order.courierStatusSyncedAt } });
    }
    return;
  }
  // A courier status that moves after an admin reconciled the record needs a second look, not a silent change.
  const reviewReason = opChanged && existing.reconciledAt ? `The courier's status changed after reconciliation (${existing.operationalStatus} → ${op})` : existing.reviewReason;
  // The estimate depends on the outcome (a returned parcel is billed the return charge).
  const ref = opChanged ? refs({ district: order.shippingDistrict, area: order.shippingArea, division: order.shippingDivision, type, operationalStatus: op, at: existing.bookedAt ?? new Date() }) : null;
  const next = { ...existing, operationalStatus: op, reviewReason };
  await db.shipment.update({
    where: { id: existing.id },
    data: {
      operationalStatus: op, courierStatus: order.courierStatus, courierSyncedAt: order.courierStatusSyncedAt, trackingCode: order.trackingNumber, trackedByCourier: true,
      completedAt: isFinished(op) ? (existing.completedAt ?? finishedAt) : null, reviewReason,
      ...(ref ? { estimatedCharge: ref.estimatedCharge, deliveryZone: existing.deliveryZone ?? ref.deliveryZone, standardCharge: existing.standardCharge ?? ref.standardCharge, standardChargeSource: existing.standardChargeSource ?? ref.standardChargeSource } : {}),
      ...derivedColumns(next),
    },
  });
  if (opChanged) {
    await recordShipmentEvent(db, {
      shipmentId: existing.id, action: reviewReason !== existing.reviewReason ? "REVIEW_FLAGGED" : "SYNCED", source: "COURIER_STATUS", reference: order.courierStatus,
      changes: { operationalStatus: { from: existing.operationalStatus, to: op } }, note: reviewReason !== existing.reviewReason ? reviewReason : null,
    });
  }
}

/** A consignment the order no longer points at (unlinked, then possibly re-booked): kept as history, no longer tracked. */
async function untrackStaleLegs(db: Db, order: SyncOrder) {
  const stale = await db.shipment.findMany({
    where: { parcelOrderId: order.id, trackedByCourier: true, ...(order.courierConsignmentId ? { NOT: { consignmentId: order.courierConsignmentId } } : {}) },
  });
  for (const leg of stale) {
    const op: ShipmentOperationalStatus = isFinished(leg.operationalStatus) ? leg.operationalStatus : "CANCELLED";
    await db.shipment.update({
      where: { id: leg.id },
      data: { trackedByCourier: false, operationalStatus: op, completedAt: leg.completedAt ?? new Date(), ...derivedColumns({ ...leg, operationalStatus: op }) },
    });
    await recordShipmentEvent(db, {
      shipmentId: leg.id, action: "SYNCED", source: "COURIER_UNLINK", reference: leg.consignmentId,
      changes: op !== leg.operationalStatus ? { operationalStatus: { from: leg.operationalStatus, to: op } } : {},
      note: "The courier booking was unlinked from the order — this consignment is no longer tracked",
    });
  }
}

/** A parcel sent with a manual carrier (Delivery › Manual carrier) becomes a leg once the order has shipped. */
async function syncManualCarrierLeg(db: Db, order: SyncOrder, refs: ReferenceFn) {
  if (order.courierConsignmentId || !(order.carrier || order.trackingNumber) || !shippedOf(order)) return;
  const { type, rootOrderId, returnRequestId } = legIdentity(order);
  const op = operationalStatusFor({ status: order.status, courierStatus: null, shipped: true });
  const existing = await db.shipment.findFirst({ where: { parcelOrderId: order.id, type, consignmentId: null } });
  if (!existing) {
    const ref = refs({ district: order.shippingDistrict, area: order.shippingArea, division: order.shippingDivision, type, operationalStatus: op, at: new Date() });
    const base = {
      type, operationalStatus: op, actualCharge: null, chargeStatus: "MISSING" as const, contributionReported: null, contributionVerified: null,
      contributionStatus: "NOT_RECORDED" as const, uncoveredTreatment: "UNDECIDED" as const, excessTreatment: "UNDECIDED" as const, reconciledAt: null, reviewReason: null,
    };
    try {
      const created = await db.shipment.create({
        data: {
          orderId: rootOrderId, parcelOrderId: order.id, returnRequestId, type, courier: order.carrier?.trim() || "Manual carrier", trackingCode: order.trackingNumber,
          operationalStatus: op, trackedByCourier: false, completedAt: isFinished(op) ? order.updatedAt : null, ...ref, ...derivedColumns(base),
        },
      });
      await recordShipmentEvent(db, { shipmentId: created.id, action: "CREATED", source: "MANUAL_CARRIER", reference: order.trackingNumber, note: `Sent with ${created.courier}` });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
    return;
  }
  // Only moves forward to a finished state the order reached; a status staff set by hand is otherwise theirs.
  if (!isFinished(existing.operationalStatus) && isFinished(op)) {
    await db.shipment.update({ where: { id: existing.id }, data: { operationalStatus: op, completedAt: new Date(), ...derivedColumns({ ...existing, operationalStatus: op }) } });
    await recordShipmentEvent(db, { shipmentId: existing.id, action: "SYNCED", source: "ORDER_STATUS", changes: { operationalStatus: { from: existing.operationalStatus, to: op } } });
  }
}

/** An approved return / exchange: the parcel coming back is a leg of its own (RETURN_REQUESTED until it moves). Runs in
 * the approval's transaction; a second call for the same request does nothing. */
export async function openReturnLeg(tx: Prisma.TransactionClient, request: { id: string; orderId: string; type: "RETURN" | "EXCHANGE" }, adminId: string | null) {
  const existing = await tx.shipment.findFirst({ where: { returnRequestId: request.id, type: "RETURN" } });
  if (existing) return existing;
  const order = await tx.order.findUnique({ where: { id: request.orderId }, select: { carrier: true, courierConsignmentId: true, shippingDistrict: true, shippingArea: true, shippingDivision: true } });
  if (!order) return null;
  const refs = await chargeReferences(tx);
  const ref = refs({ district: order.shippingDistrict, area: order.shippingArea, division: order.shippingDivision, type: "RETURN", operationalStatus: "RETURN_REQUESTED", at: new Date() });
  const base = {
    type: "RETURN" as const, operationalStatus: "RETURN_REQUESTED" as const, actualCharge: null, chargeStatus: "MISSING" as const, contributionReported: null,
    contributionVerified: null, contributionStatus: "NOT_RECORDED" as const, uncoveredTreatment: "UNDECIDED" as const, excessTreatment: "UNDECIDED" as const,
    reconciledAt: null, reviewReason: null,
  };
  const created = await tx.shipment.create({
    data: {
      orderId: request.orderId, parcelOrderId: request.orderId, returnRequestId: request.id, type: "RETURN",
      courier: order.courierConsignmentId ? STEADFAST : order.carrier?.trim() || STEADFAST, operationalStatus: "RETURN_REQUESTED", trackedByCourier: false,
      createdByAdminId: adminId, ...ref, ...derivedColumns(base),
    },
  });
  await recordShipmentEvent(tx, {
    shipmentId: created.id, action: "CREATED", source: "RETURN_REQUEST", reference: request.id, adminId,
    note: request.type === "EXCHANGE" ? "Exchange approved — the item is to be collected" : "Return approved — the item is to come back",
  });
  return created;
}

/** Cron sweep: orders touched recently (status changes by staff, manual carriers) get their legs brought up to date. */
export async function syncRecentShipments(sinceMs = 2 * 86_400_000): Promise<number> {
  const orders = await prisma.order.findMany({
    where: { updatedAt: { gte: new Date(Date.now() - sinceMs) }, OR: [{ courierConsignmentId: { not: null } }, { carrier: { not: null } }, { trackingNumber: { not: null } }] },
    select: { id: true },
    take: 2000,
  });
  const refs = await chargeReferences();
  for (const o of orders) {
    try {
      await syncOrderShipments(o.id, { refs });
    } catch (err) {
      logger.error(`[shipments] sweep failed for order ${o.id}:`, { detail: err instanceof Error ? err.message : String(err) });
    }
  }
  return orders.length;
}

/** Fills the tariff / estimate on legs that have none yet (historical legs recorded before a rate existed). */
export async function fillMissingReferences(limit = 500): Promise<number> {
  const legs = await prisma.shipment.findMany({
    where: { standardCharge: null },
    select: { id: true, type: true, operationalStatus: true, bookedAt: true, createdAt: true, parcelOrder: { select: { shippingDistrict: true, shippingArea: true, shippingDivision: true } }, order: { select: { shippingDistrict: true, shippingArea: true, shippingDivision: true } } },
    take: limit,
  });
  if (!legs.length) return 0;
  const refs = await chargeReferences();
  for (const leg of legs) {
    const addr = leg.parcelOrder ?? leg.order;
    const ref = refs({ district: addr.shippingDistrict, area: addr.shippingArea, division: addr.shippingDivision, type: leg.type, operationalStatus: leg.operationalStatus, at: leg.bookedAt ?? leg.createdAt });
    await prisma.shipment.update({ where: { id: leg.id }, data: ref });
  }
  return legs.length;
}
