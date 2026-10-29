import { prisma } from "../../src/config/prisma";
import { orderFinishedWhere, orderInProgressWhere } from "../../src/modules/orders/order-history";
import { getOrderStats } from "../../src/modules/orders/order.service";

/** Read-only: how a database's orders split between the daily work list and Order history, per status, and what keeps
 * finished-status orders on the work list. DATABASE_URL=<a demo copy> npx tsx scripts/perf/history-split.ts */
async function main() {
  const g = async (where: object) => prisma.order.groupBy({ by: ["status"], where: { deletedAt: null, ...where }, _count: true });
  console.log("work list:", Object.fromEntries((await g(orderInProgressWhere())).map((r) => [r.status, r._count])));
  console.log("history:  ", Object.fromEntries((await g(orderFinishedWhere())).map((r) => [r.status, r._count])));
  const stuck = { status: { in: ["DELIVERED", "PARTIALLY_DELIVERED", "CANCELLED", "RETURNED", "REFUNDED"] as never[] }, ...orderInProgressWhere() };
  const why = {
    unsettledCod: await prisma.order.count({ where: { deletedAt: null, ...stuck, AND: [{ shipments: { some: { type: "OUTBOUND", trackedByCourier: true, courierPayoutRef: null, operationalStatus: { in: ["DELIVERED", "PARTIALLY_DELIVERED"] } } } }], paymentMethod: "COD" } }),
    legReview: await prisma.order.count({ where: { deletedAt: null, ...stuck, AND: [{ shipments: { some: { financialStatus: { in: ["NEEDS_REVIEW", "EXCESS_REVIEW"] } } } }] } }),
    deliveredUnpaid: await prisma.order.count({ where: { deletedAt: null, status: { in: ["DELIVERED", "PARTIALLY_DELIVERED"] }, paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID", "FAILED"] } } }),
    moneyHeld: await prisma.order.count({ where: { deletedAt: null, status: { in: ["CANCELLED", "RETURNED", "REFUNDED"] }, paymentStatus: { in: ["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED"] } } }),
    parcelNotBackOrInspected: await prisma.order.count({ where: { deletedAt: null, ...stuck, courierConsignmentId: { not: null }, returnInspectedAt: null, status: { in: ["CANCELLED", "RETURNED"] } } }),
  };
  console.log("finished-status orders still on the work list, by reason (overlapping):", why);
  const t = performance.now();
  for (let i = 0; i < 10; i++) await getOrderStats();
  console.log(`getOrderStats avg ${((performance.now() - t) / 10).toFixed(0)} ms`);
  await prisma.$disconnect();
  // Imported services open a Redis connection; this is a one-shot script.
  process.exit(0);
}
void main();
