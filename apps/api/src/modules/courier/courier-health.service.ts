/**
 * Is Steadfast telling us about parcel changes, and is polling keeping up? (Order Operations plan, Phase 0.) Read-only
 * counts over the webhook log (CourierWebhookEvent), the refused calls (CourierWebhookRejection), how each courier status
 * change reached us (CourierStatusChange) and the open parcels' poll schedule. courier-sync-policy.ts turns them into a
 * verdict and the poll level. Nothing here holds a token, a header or a request body.
 */
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { allowedPollLevel, evaluateWebhookHealth, type CourierHealthStats } from "./courier-sync-policy";

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
  const [byOutcome, last, rejections, compared, disagreed, changes, openParcels, overdueParcels] = await Promise.all([
    prisma.courierWebhookEvent.groupBy({ by: ["outcome"], where: { receivedAt: { gte: from } }, _count: true }),
    prisma.courierWebhookEvent.findFirst({ where: { receivedAt: { gte: from } }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    prisma.courierWebhookRejection.count({ where: { receivedAt: { gte: from } } }),
    prisma.courierWebhookEvent.count({ where: { receivedAt: { gte: from }, status: { not: null }, verifiedStatus: { not: null } } }),
    // The body's status and the status API's, compared in SQL (Prisma can't compare two columns).
    prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM "CourierWebhookEvent"
      WHERE "receivedAt" >= ${from} AND status IS NOT NULL AND "verifiedStatus" IS NOT NULL AND status <> "verifiedStatus"`,
    prisma.courierStatusChange.groupBy({ by: ["source"], where: { observedAt: { gte: from } }, _count: true }),
    prisma.order.count({ where: OPEN_PARCEL_WHERE }),
    prisma.order.count({ where: { ...OPEN_PARCEL_WHERE, courierNextPollAt: { lt: new Date(now.getTime() - OVERDUE_GRACE_MS) } } }),
  ]);
  return {
    windowHours,
    events: Object.fromEntries(byOutcome.map((r) => [r.outcome, r._count])),
    lastValidEventAt: last?.receivedAt ?? null,
    rejections,
    compared,
    disagreed: disagreed[0]?.n ?? 0,
    changes: Object.fromEntries(changes.map((r) => [r.source, r._count])),
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
