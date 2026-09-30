/**
 * Phase 9 operator reliability report (docs/PHASE_9_AUDIT.md §J): one read-only view of what is stuck, failed or
 * inconsistent right now, which aggregate it concerns, and whether retrying is safe. Every section reuses the subsystem's
 * own detector — nothing here repairs anything (detect → report; repairs stay explicit, per subsystem).
 */
import { prisma } from "../../config/prisma";
import { outboxStatus } from "../../domain/outbox/processor";
import { paymentLedgerDrift } from "../../domain/payments/payment-ledger.service";
import { readModelDrift } from "../../domain/storefront/read-model.service";
import { getStockDiscrepancies } from "../inventory/inventory.service";
import { loyaltyDrift } from "../customers/customer.service";
import { COURIER_BOOKING_LEASE_MS } from "../courier/courier.service";

const STUCK_CAMPAIGN_MS = 30 * 60_000;
const TOP = 20;

export async function reliabilityReport(now: Date = new Date()) {
  const [outbox, courierClaims, ledger, stock, readModel, loyalty, campaigns] = await Promise.all([
    outboxStatus(now),
    prisma.order.findMany({
      where: { courierBookingStartedAt: { not: null }, courierConsignmentId: null },
      select: { id: true, orderNumber: true, courierBookingStartedAt: true, courierSyncError: true },
      orderBy: { courierBookingStartedAt: "asc" },
    }),
    paymentLedgerDrift(),
    getStockDiscrepancies(),
    readModelDrift(now),
    loyaltyDrift(),
    prisma.campaign.findMany({
      where: { status: "SENDING", updatedAt: { lt: new Date(now.getTime() - STUCK_CAMPAIGN_MS) } },
      select: { id: true, name: true, updatedAt: true },
      orderBy: { updatedAt: "asc" },
    }),
  ]);

  const courier = courierClaims.map((o) => {
    const outcomeUnknown = (o.courierSyncError ?? "").startsWith("Booking outcome unknown");
    const leaseExpired = now.getTime() - o.courierBookingStartedAt!.getTime() > COURIER_BOOKING_LEASE_MS;
    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      startedAt: o.courierBookingStartedAt!.toISOString(),
      outcomeUnknown,
      // Unknown outcome: Steadfast may already hold the consignment — check the portal for the invoice before re-booking.
      safeToRetry: !outcomeUnknown && leaseExpired,
      detail: o.courierSyncError,
    };
  });

  const sections = {
    outbox: {
      undelivered: outbox.undelivered,
      failed: outbox.counts.FAILED ?? 0,
      oldestUndelivered: outbox.oldestUndelivered,
      dispatcherHealthy: outbox.dispatcher.healthy,
      recentFailures: outbox.recentFailures.slice(0, TOP),
      retry: "POST /api/v1/outbox/:id/retry (OWNER) — consumers are idempotent (Phase 8)",
    },
    courierBookings: { count: courier.length, items: courier.slice(0, TOP) },
    paymentLedgerDrift: {
      count: ledger.drift.length,
      violations: ledger.violations.length,
      items: ledger.drift.slice(0, TOP),
      repair: "payment-ledger:reconcile (dry run by default)",
    },
    stockDrift: { count: stock.length, items: stock.slice(0, TOP), repair: "adjust stock with a reason (never auto-corrected)" },
    readModelDrift: { count: readModel.length, items: readModel.slice(0, TOP), repair: "read-model:rebuild — derived data, always safe (also every 15 min)" },
    loyaltyDrift: { count: loyalty.length, items: loyalty.slice(0, TOP), repair: "an explained manual points adjustment" },
    stuckCampaigns: { count: campaigns.length, items: campaigns.slice(0, TOP).map((c) => ({ ...c, updatedAt: c.updatedAt.toISOString() })) },
  };
  const needsAttention =
    sections.outbox.failed +
    (outbox.dispatcher.healthy ? 0 : 1) +
    courier.length +
    ledger.drift.length +
    ledger.violations.length +
    stock.length +
    readModel.length +
    loyalty.length +
    campaigns.length;
  return { generatedAt: now.toISOString(), needsAttention, sections };
}
