/**
 * Is Steadfast telling us about parcel changes, and is polling keeping up? (Order Operations plan, Phase 0.) Read-only
 * counts over the webhook log (CourierWebhookEvent), the refused calls (CourierWebhookRejection), how each courier status
 * change reached us (CourierStatusChange) and the open parcels' poll schedule. courier-sync-policy.ts turns them into a
 * verdict and the poll level. Nothing here holds a token, a header or a request body.
 */
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { allowedPollLevel, compareCourierStatuses, evaluateWebhookHealth, isPushedTransition, type CourierHealthStats } from "./courier-sync-policy";

/** Courier statuses after which Steadfast reports nothing more for a consignment. */
export const TERMINAL_COURIER_STATUSES = ["delivered", "partial_delivered", "cancelled"];

/** A booked parcel the courier hasn't finished with — the set the poll sweeps. */
export const OPEN_PARCEL_WHERE = {
  courierConsignmentId: { not: null },
  deletedAt: null,
  OR: [{ courierStatus: null }, { courierStatus: { notIn: TERMINAL_COURIER_STATUSES } }],
};

/** A parcel this far past its scheduled re-check means the poll is falling behind (two full runs missed). */
const OVERDUE_GRACE_MS = 30 * 60_000;
const HOUR = 3_600_000;

export async function courierHealthStats(windowHours: number, now: Date = new Date()): Promise<CourierHealthStats> {
  const from = new Date(now.getTime() - windowHours * HOUR);
  const [byOutcome, last, rejections, pairs, transitions, openParcels, overdueParcels] = await Promise.all([
    prisma.courierWebhookEvent.groupBy({ by: ["outcome"], where: { receivedAt: { gte: from } }, _count: true }),
    prisma.courierWebhookEvent.findFirst({ where: { receivedAt: { gte: from } }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    prisma.courierWebhookRejection.count({ where: { receivedAt: { gte: from } } }),
    // The body's status beside the status API's, one row per distinct pair — classified below (compareCourierStatuses).
    prisma.courierWebhookEvent.groupBy({
      by: ["status", "verifiedStatus"],
      where: { receivedAt: { gte: from }, status: { not: null }, verifiedStatus: { not: null } },
      _count: true,
    }),
    prisma.courierStatusChange.groupBy({ by: ["fromStatus", "toStatus", "source"], where: { observedAt: { gte: from } }, _count: true }),
    prisma.order.count({ where: OPEN_PARCEL_WHERE }),
    prisma.order.count({ where: { ...OPEN_PARCEL_WHERE, courierNextPollAt: { lt: new Date(now.getTime() - OVERDUE_GRACE_MS) } } }),
  ]);
  const agreement = { compared: 0, disagreed: 0, awaitingApproval: 0, apiBehind: 0 };
  for (const p of pairs) {
    const kind = compareCourierStatuses(p.status!, p.verifiedStatus!);
    agreement.compared += p._count;
    if (kind === "CONTRADICTION") agreement.disagreed += p._count;
    else if (kind === "AWAITING_APPROVAL") agreement.awaitingApproval += p._count;
    else if (kind === "API_BEHIND") agreement.apiBehind += p._count;
  }
  const changes: Record<string, number> = {};
  let notPushed = 0;
  for (const t of transitions) {
    if (!isPushedTransition(t.fromStatus, t.toStatus)) notPushed += t._count;
    else changes[t.source] = (changes[t.source] ?? 0) + t._count;
  }
  return {
    windowHours,
    events: Object.fromEntries(byOutcome.map((r) => [r.outcome, r._count])),
    lastValidEventAt: last?.receivedAt ?? null,
    rejections,
    ...agreement,
    changes,
    notPushed,
    openParcels,
    overdueParcels,
  };
}

/** The poll level allowed right now (0 = full pace). Never above the operator's COURIER_POLL_MAX_LEVEL (default 0). */
export async function currentPollLevel(now: Date = new Date()): Promise<number> {
  const maxLevel = env.courierPollMaxLevel;
  if (maxLevel <= 0) return 0;
  const [day2, week] = await Promise.all([courierHealthStats(48, now), courierHealthStats(7 * 24, now)]);
  return allowedPollLevel(evaluateWebhookHealth(day2, now).state, evaluateWebhookHealth(week, now).state, maxLevel);
}

/** GET /api/v1/ops/courier-health — the 48-hour verdict with each check, the week's, refused calls and the poll pace. */
export async function courierHealthReport(now: Date = new Date()) {
  const [day2, week, lastRejection] = await Promise.all([
    courierHealthStats(48, now),
    courierHealthStats(7 * 24, now),
    prisma.courierWebhookRejection.findFirst({ orderBy: { receivedAt: "desc" }, select: { reason: true, receivedAt: true } }),
  ]);
  const last48h = evaluateWebhookHealth(day2, now);
  const lastWeek = evaluateWebhookHealth(week, now);
  const maxLevel = env.courierPollMaxLevel;
  return {
    generatedAt: now.toISOString(),
    webhook: {
      last48h: { ...last48h, stats: day2 },
      lastWeek: { state: lastWeek.state },
      lastRejection: lastRejection ? { reason: lastRejection.reason, at: lastRejection.receivedAt.toISOString() } : null,
    },
    polling: { level: allowedPollLevel(last48h.state, lastWeek.state, maxLevel), maxLevel, openParcels: day2.openParcels, overdueParcels: day2.overdueParcels },
  };
}

/** Refused calls are only counted for health: kept 30 days. Status-change sources: 90 days. Run by the daily retention job. */
export async function purgeOldCourierHealthData(now: Date = new Date()) {
  const [rejections, changes] = await Promise.all([
    prisma.courierWebhookRejection.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - 30 * 24 * HOUR) } } }),
    prisma.courierStatusChange.deleteMany({ where: { observedAt: { lt: new Date(now.getTime() - 90 * 24 * HOUR) } } }),
  ]);
  return { rejections: rejections.count, changes: changes.count };
}
