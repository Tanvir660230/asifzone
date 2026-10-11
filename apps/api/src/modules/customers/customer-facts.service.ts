import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { customerMetricsFor } from "../../domain/metrics/metrics.service";
import { utcInstant } from "../../domain/metrics/store-time";
import { captureError } from "../../lib/observability/error-capture";
import { computeCustomerTags, computeRiskSignals, tagsExpireAt } from "./customer-tags";

/**
 * Blueprint V2 PERF-01/02 — keeps the customer list's read model (CustomerFact) current, so the list filters, sorts and
 * pages in SQL instead of loading every customer and order. Nothing here is a second formula: spend and order counts are
 * the metrics engine's (customerMetricsFor — the registry grouping for a subset), tags and risk the shared definitions
 * (customer-tags.ts), the remaining fields the same reads loadCustomersWithComputedFields makes.
 *
 * Each sync recomputes only the customers that may have changed since the last one:
 *   - their own row, or any of their orders, payments, refunds, returned units or return/exchange requests, touched
 *     since the watermark (minus an overlap, so a transaction that committed late isn't missed);
 *   - an order of theirs purged or moved to someone else (CustomerFactDirty, filled by a trigger on "Order");
 *   - a date-based tag due to flip (tagsExpireAt);
 *   - no fact yet (new customers, or the first build).
 * Reads call it first, so the list is never staler than the read itself.
 */

/** Re-scan this much before the watermark: an order written in a transaction that committed after the last sync started. */
const OVERLAP_MS = 2 * 60_000;
const BATCH = 500;

let running: Promise<void> | null = null;
let queued: Promise<void> | null = null;

/** Brings the read model up to date. Concurrent callers share one run; a caller arriving mid-run gets a follow-up run, so
 * a change committed just before the call is always included. */
export function syncCustomerFacts(): Promise<void> {
  if (!running) {
    running = runSync().finally(() => {
      running = null;
    });
    return running;
  }
  queued ??= running.then(() => {
    queued = null;
    return syncCustomerFacts();
  });
  return queued;
}

async function runSync(): Promise<void> {
  const startedAt = new Date();
  const watermark = await prisma.customerFactSync.findUnique({ where: { id: 1 } });
  const ids = watermark ? await changedCustomerIds(new Date(watermark.syncedAt.getTime() - OVERLAP_MS), startedAt) : await allCustomerIds();
  const dirty = (await prisma.customerFactDirty.findMany({ select: { customerId: true, markedAt: true } })) ?? [];
  const toRefresh = [...new Set([...ids, ...dirty.map((d) => d.customerId)])];

  for (let i = 0; i < toRefresh.length; i += BATCH) await refreshCustomers(toRefresh.slice(i, i + BATCH), startedAt);

  // Clear only the marks this run saw (a purge during the run stays marked for the next one).
  for (const d of dirty) await prisma.customerFactDirty.deleteMany({ where: { customerId: d.customerId, markedAt: { lte: d.markedAt } } });
  await prisma.customerFactSync.upsert({ where: { id: 1 }, create: { id: 1, syncedAt: startedAt }, update: { syncedAt: startedAt } });
}

async function allCustomerIds(): Promise<string[]> {
  return (await prisma.customer.findMany({ select: { id: true } })).map((c) => c.id);
}

async function changedCustomerIds(since: Date, now: Date): Promise<string[]> {
  // A bounded window, [since, now): consecutive syncs' windows meet (the next starts at this run's start minus the
  // overlap), and a row stamped in the future (clock skew, an import) is picked up once, when its time comes — not on
  // every read until then.
  const t = utcInstant(since);
  const u = utcInstant(now);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT c."id" FROM "Customer" c WHERE c."updatedAt" >= ${t} AND c."updatedAt" < ${u}
    UNION SELECT o."customerId" FROM "Order" o WHERE o."updatedAt" >= ${t} AND o."updatedAt" < ${u} AND o."customerId" IS NOT NULL
    UNION SELECT o."customerId" FROM "Payment" p JOIN "Order" o ON o."id" = p."orderId"
      WHERE ((p."createdAt" >= ${t} AND p."createdAt" < ${u}) OR (p."settledAt" >= ${t} AND p."settledAt" < ${u})) AND o."customerId" IS NOT NULL
    UNION SELECT o."customerId" FROM "Refund" r JOIN "Order" o ON o."id" = r."orderId"
      WHERE ((r."createdAt" >= ${t} AND r."createdAt" < ${u}) OR (r."completedAt" >= ${t} AND r."completedAt" < ${u})) AND o."customerId" IS NOT NULL
    UNION SELECT o."customerId" FROM "StockMovement" sm JOIN "Order" o ON o."id" = sm."orderId"
      WHERE sm."createdAt" >= ${t} AND sm."createdAt" < ${u} AND o."customerId" IS NOT NULL
    UNION SELECT o."customerId" FROM "ReturnRequest" rr JOIN "Order" o ON o."id" = rr."orderId"
      WHERE rr."updatedAt" >= ${t} AND rr."updatedAt" < ${u} AND o."customerId" IS NOT NULL
    UNION SELECT f."customerId" FROM "CustomerFact" f WHERE f."tagsExpireAt" <= ${u}
    UNION SELECT c."id" FROM "Customer" c LEFT JOIN "CustomerFact" f ON f."customerId" = c."id" WHERE f."customerId" IS NULL`;
  return rows.map((r) => r.id);
}

async function refreshCustomers(ids: string[], now: Date): Promise<void> {
  const [customers, metrics, orders] = await Promise.all([
    prisma.customer.findMany({
      where: { id: { in: ids } },
      select: { id: true, phone: true, createdAt: true, isBlocked: true, codRisk: true, addresses: { where: { isDefault: true }, take: 1, select: { district: true } } },
    }),
    customerMetricsFor(ids, now),
    prisma.order.findMany({
      where: { customerId: { in: ids }, deletedAt: null },
      select: { customerId: true, status: true, createdAt: true, shippingDistrict: true, courierStatus: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const ordersBy = new Map<string, typeof orders>();
  for (const o of orders) ordersBy.set(o.customerId!, [...(ordersBy.get(o.customerId!) ?? []), o]);

  const rows = customers.map((c) => {
    // The same derivation as loadCustomersWithComputedFields (customer.service.ts).
    const own = ordersBy.get(c.id) ?? [];
    const canonical = metrics.get(c.id);
    const ordersPlaced = canonical?.orders ?? 0;
    const netSpend = canonical?.netSpend ?? 0;
    const cancelledOrders = own.filter((o) => o.status === "CANCELLED").length;
    const holdOrders = own.filter((o) => o.courierStatus === "hold").length;
    const lastOrderAt = own[0]?.createdAt ?? null;
    const district = c.addresses[0]?.district ?? own[0]?.shippingDistrict ?? null;
    const riskSignals = computeRiskSignals({ phone: c.phone, totalOrders: own.length, cancelledOrders, holdOrders });
    const tags = computeCustomerTags({ createdAt: c.createdAt, totalOrders: ordersPlaced, totalSpent: netSpend, lastOrderAt, isBlocked: c.isBlocked, codRisk: c.codRisk, riskSignals });
    return Prisma.sql`(${c.id}, ${netSpend}::numeric, ${ordersPlaced}, ${canonical?.realisedOrders ?? 0}, ${own.length}, ${cancelledOrders}, ${holdOrders},
      ${lastOrderAt}::timestamptz AT TIME ZONE 'UTC', ${district}, ${tags}::text[], ${tagsExpireAt({ createdAt: c.createdAt, lastOrderAt }, now)}::timestamptz AT TIME ZONE 'UTC',
      ${now}::timestamptz AT TIME ZONE 'UTC')`;
  });
  if (!rows.length) return;
  await prisma.$executeRaw`
    INSERT INTO "CustomerFact" ("customerId", "netSpend", "ordersPlaced", "ordersRealised", "ordersAll", "cancelledOrders", "holdOrders",
      "lastOrderAt", "district", "tags", "tagsExpireAt", "refreshedAt")
    VALUES ${Prisma.join(rows)}
    ON CONFLICT ("customerId") DO UPDATE SET
      "netSpend" = EXCLUDED."netSpend", "ordersPlaced" = EXCLUDED."ordersPlaced", "ordersRealised" = EXCLUDED."ordersRealised",
      "ordersAll" = EXCLUDED."ordersAll", "cancelledOrders" = EXCLUDED."cancelledOrders", "holdOrders" = EXCLUDED."holdOrders",
      "lastOrderAt" = EXCLUDED."lastOrderAt", "district" = EXCLUDED."district", "tags" = EXCLUDED."tags",
      "tagsExpireAt" = EXCLUDED."tagsExpireAt", "refreshedAt" = EXCLUDED."refreshedAt"`;
}

/** Builds the read model in the background at startup, so the first list read doesn't pay for the whole store. */
export function warmCustomerFacts(): void {
  void syncCustomerFacts().catch((err) => captureError(err, { operation: "customer-facts.warm" }));
}
